from flask import (
    session,
    request,
    current_app,
    g,
)
import uuid
import json
import asyncio
from io import BytesIO
from flask_socketio import emit
from flaskr import socketio
import flaskr.ecocircuit.models as model
from flaskr.ecocircuit.method import Metabolism, ImageTask
from flaskr.ecocircuit.utils import get_user_async_client
from flaskr.account.api_utils import decrypt_key
import tempfile, base64
from flaskr.ecocircuit.resource_safety import decode_image_upload
import nest_asyncio
from flaskr.auth0.utils import api_key_required

nest_asyncio.apply()


def _authorize_mutation(data, id_field, error_event):
    if not isinstance(data, dict) or not model.can_mutate_project(data.get(id_field)):
        emit(error_event, {"status": "error", "error": "Project not found or access denied."}, to=request.sid)
        return False
    return True


@socketio.on("connect", namespace="/ecocircuit")
def handle_connect():
    if "sid" not in session:
        session["sid"] = str(uuid.uuid4())
    sid = session.get("sid")
    if sid:
        print(f"✅ User {sid} connected.")
        emit(
            "private_msg",
            {"user_id": sid, "data": f"Hello user {sid}!"},
            to=request.sid,
        )


@socketio.on("receiving/prompt", namespace="/ecocircuit")
def handle_prompt(data):
    try:
        if not isinstance(data, dict) or data.get("requesttype") not in ("image", "description"):
            raise ValueError("Select an image or description.")
        image_binary = decode_image_upload(data.get("image")) if data["requesttype"] == "image" else None
    except ValueError as exc:
        emit("prompt_response", {"status": "error", "error": str(exc)}, to=request.sid)
        return
    sid = session.get("sid")
    if sid is None:
        session["sid"] = str(uuid.uuid4())

    user_client = get_user_async_client(decrypt_key(session.get("encrypted_api_key")))
    author_id = session.get("user")["id"] if session.get("user") else None

    request_type = data.get("requesttype")
    project_system = data.get("system")

    initial_data = {
        "project_id": None,
        "author_id": author_id,
        "title": "Untitled",
        "request_type": request_type,
        "info": None,
        "img_url": None,
        "system": project_system,
        "access": "temporary" if author_id is None else "private",
    }

    new_project_id = model.create_or_update_project(**initial_data)
    if author_id is None:
        session["claim_project_id"] = new_project_id
        session.modified = True

    if not new_project_id:
        emit(
            "prompt_response",
            {"status": "error", "error": "Project creation failed."},
            to=request.sid,
        )
        return
    emit(
        "progress_update",
        {"percent": 0, "message": "Project created successfully."},
        to=request.sid,
    )
    socketio.sleep(0)
    if request_type == "description":
        initial_data["info"] = data.get("description")
    elif request_type == "image":
        if not data.get("image"):
            emit("prompt_response", {"status": "error", "error": "Image missing."}, to=request.sid)
            return
        cropped_img_stream = ImageTask.crop_image_in_memory(
            BytesIO(image_binary), size=720
        )
        cropped_img_stream.seek(0)
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as temp:
            temp.write(cropped_img_stream.read())
            temp.flush()
            temp.seek(0)
            ImageTask.s3_upload(temp.name, f"{new_project_id}.jpg")

    metabolism_data = {
        "env": initial_data.get("info"),
        "syscolor": json.loads(initial_data["system"]),
        "id": new_project_id,
    }

    async def run_metabolism():
        try:
            # Create simple progress callback for handle_prompt
            def emit_progress_prompt(percent, message):
                socketio.emit("progress_update", 
                    {"percent": percent, "message": message}, 
                    to=request.sid,
                    namespace="/ecocircuit"
                )
                socketio.sleep(0.01)

            metabolism = Metabolism(clientasync=user_client, progress_callback=emit_progress_prompt)
            
            # Run metabolism
            generated_data = await metabolism.run(metabolism_data)
            
            if generated_data is None:
                socketio.emit(
                    "prompt_response",
                    {"status": "error", "error": "Generation returned empty."},
                    to=request.sid,
                    namespace="/ecocircuit"
                )
                return

            parsed_data = {
                "project_id": new_project_id,
                "author_id": author_id,
                "title": "Untitled",
                "request_type": request_type,
                "info": generated_data.get("env"),
                "img_url": generated_data.get("image"),
                "system": project_system,
            }

            required_fields = [
                generated_data.get("parsed_io"),
                generated_data.get("parsed_metabolism"),
            ]
            required_fields.extend(
                [value for key, value in parsed_data.items() if key != "author_id"]
            )

            if any(field is None for field in required_fields):
                socketio.emit("prompt_response", 
                    {"status": "error", "error": "Parsed data incomplete."}, 
                    to=request.sid,
                    namespace="/ecocircuit"
                )
                return

            model.create_or_update_project(**parsed_data)
            model.find_or_create_or_update_iodata(
                new_project_id, json.dumps(generated_data.get("parsed_io"))
            )
            model.find_or_create_or_update_metabolism(
                new_project_id, json.dumps(generated_data.get("parsed_metabolism"))
            )

            from flask import url_for
            socketio.emit(
                "prompt_response",
                {
                    "status": "success",
                    "redirect_url": url_for("ecocircuit.generate", id=new_project_id),
                },
                to=request.sid,
                namespace="/ecocircuit"
            )
            
        except Exception as e:
            socketio.emit(
                "prompt_response",
                {"status": "error", "error": f"Generation error: {str(e)}"},
                to=request.sid,
                namespace="/ecocircuit"
            )
    
    # Run async function
    asyncio.run(run_metabolism())


@socketio.on("update_access", namespace="/ecocircuit")
def update_project_access(data):
    if not _authorize_mutation(data, "project_id", "update_access_response"):
        return
    access = data.get("access")
    user_id = (session.get("user") or {}).get("id")
    if not isinstance(access, str) or access.strip().lower() not in ("private", "public") or not user_id:
        emit("update_access_response", {"status": "error", "error": "Sign in and select private or public."}, to=request.sid)
        return
    access = access.strip().lower()
    if not model.update_project_access(data["project_id"], user_id, access):
        emit("update_access_response", {"status": "error", "error": "Access change denied."}, to=request.sid)
        return
    if session.get("claim_project_id") == data["project_id"]:
        session.pop("claim_project_id", None)
    emit("update_access_response", {"status": "success", "message": f"Access level updated to {access}."}, to=request.sid)


@socketio.on("update_system_cosmetic", namespace="/ecocircuit")
def handle_update_system_cosmetic(data):
    if not _authorize_mutation(data, "projectId", "update_system_cosmetic_error"):
        return
    """Update only the visual properties (colors and/or icons) of systems without triggering recomputation"""
    project_id = data.get("projectId")
    sys_color = data.get("sysColor")
    
    if not project_id or not sys_color:
        emit("update_system_cosmetic_error", {"error": "Missing project ID or system colors"}, to=request.sid)
        return
    
    try:
        # Update only the system colors/icons in the database
        model.update_project_system(project_id, json.dumps(sys_color))
        emit("update_system_cosmetic_success", {"message": "System cosmetic properties updated successfully"}, to=request.sid)
    except Exception as e:
        emit("update_system_cosmetic_error", {"error": f"Failed to update system cosmetic properties: {str(e)}"}, to=request.sid)


@socketio.on("iterate", namespace="/ecocircuit")
def handle_iterate(data):
    if not _authorize_mutation(data, "projectId", "iterate_error"):
        return
    print(f"DEBUG: handle_iterate called with data keys: {list(data.keys())}")
    
    encrypted_key = session.get("encrypted_api_key")
    
    # Emit immediate acknowledgment using request.sid
    emit("iterate_started", {"message": "Processing metabolism request..."}, to=request.sid)
    
    if encrypted_key is None:
        html_content = """
        <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 23 23"
              fill="none"
              transform="translate(0, -2.5)"
            >
              <path
                d="M5.5 20.5H9.5C9.5 21.6 8.6 22.5 7.5 22.5C6.4 22.5 5.5 21.6 5.5 20.5ZM3.5 19.5H11.5V17.5H3.5V19.5ZM15 10C15 13.82 12.34 15.86 11.23 16.5H3.77C2.66 15.86 0 13.82 0 10C0 5.86 3.36 2.5 7.5 2.5C11.64 2.5 15 5.86 15 10ZM13 10C13 6.97 10.53 4.5 7.5 4.5C4.47 4.5 2 6.97 2 10C2 12.47 3.49 13.89 4.35 14.5H10.65C11.51 13.89 13 12.47 13 10ZM19.87 7.87L18.5 8.5L19.87 9.13L20.5 10.5L21.13 9.13L22.5 8.5L21.13 7.87L20.5 6.5L19.87 7.87ZM17.5 6.5L18.44 4.44L20.5 3.5L18.44 2.56L17.5 0.5L16.56 2.56L14.5 3.5L16.56 4.44L17.5 6.5Z"
                fill="black"
              />
            </svg>
            <div>
              Here is the
              <a
                class="bold link-to-external"
                href="https://acrobat.adobe.com/id/urn:aaid:sc:VA6C2:933702cb-e150-4d7a-bc7c-878ca6774eb1"
                target="_blank"
                rel="noopener noreferrer"
                >link</a
              >
              to key-fetch guide and expense explanation.
            </div>
        </div>
        <form autocomplete="off" id="api-key-form">
            <input type="hidden" name="from_401" value="true"/>
            <input type="text" name="api_key" placeholder="Input your OPENAI API key" autocomplete="off" required/>
            <button type="submit" id="start-button">
                <span class="icon-start"></span>
            </button>
        </form>
        """
        emit(
            "iterate_error",
            {
                "error": "API key not found. Please enter your API key first.",
                "html": html_content,
                "status": 401
            },
            to=request.sid
        )
        return

    metabolism_data = {
        "env": data.get("env"),
        "syscolor": data.get("sysColor"),
        "id": data.get("projectId"),
        "parsed_io": data.get("ioData"),
        "parsed_metabolism": data.get("metabolism"),
    }

    async def run_metabolism():
        try:
            user_client = get_user_async_client(decrypt_key(encrypted_key))
            
            # Create progress callback
            def emit_progress(percent, message):
                socketio.emit("iterate_progress", 
                    {"percent": percent, "message": message}, 
                    to=request.sid,
                    namespace="/ecocircuit"
                )
                socketio.sleep(0.01)
            
            metabolism_instance = Metabolism(clientasync=user_client, progress_callback=emit_progress)
            
            # Run metabolism
            result_data = await metabolism_instance.run(metabolism_data)
            
            if not model.can_mutate_project(metabolism_data["id"]):
                raise ValueError("Project no longer available for editing.")
            if not isinstance(result_data, dict) or result_data.get("id") != metabolism_data["id"]:
                raise ValueError("Generation returned an invalid project ID.")
            # Update project data
            model.update_project_system(
                result_data.get("id"), json.dumps(metabolism_data.get("syscolor"))
            )
            model.find_or_create_or_update_iodata(
                result_data.get("id"), json.dumps(result_data.get("parsed_io"))
            )
            model.find_or_create_or_update_metabolism(
                result_data.get("id"), json.dumps(result_data.get("parsed_metabolism"))
            )
            
            # Emit success
            socketio.emit("iterate_response", result_data, to=request.sid, namespace="/ecocircuit")
            
        except Exception as e:
            socketio.emit("iterate_error", {"error": str(e)}, to=request.sid, namespace="/ecocircuit")
    
    # Run async function
    asyncio.run(run_metabolism())


@socketio.on("save_project", namespace="/ecocircuit")
def handle_save_project(data):
    if not _authorize_mutation(data, "projectId", "save_project_error"):
        return
    """Save project data (IO, metabolism, and system colors) without recomputation"""
    project_id = data.get("projectId")
    sys_color = data.get("sysColor")
    io_data = data.get("ioData")
    metabolism_data = data.get("metabolism")
    env = data.get("env")
    
    if not project_id:
        emit("save_project_error", {"error": "Missing project ID"}, to=request.sid)
        return
    
    try:
        # Update system colors
        if sys_color:
            model.update_project_system(project_id, json.dumps(sys_color))
        
        # Update IO data
        if io_data:
            model.find_or_create_or_update_iodata(project_id, json.dumps(io_data))
        
        # Update metabolism data
        if metabolism_data:
            model.find_or_create_or_update_metabolism(project_id, json.dumps(metabolism_data))
        
        # Emit success response
        emit("save_project_success", 
             {"message": "Project saved successfully"}, 
             to=request.sid)
        
    except Exception as e:
        emit("save_project_error", 
             {"error": f"Failed to save project: {str(e)}"}, 
             to=request.sid)


@socketio.on("save_thumbnails", namespace="/ecocircuit")
def handle_save_thumbnails(data):
    if not _authorize_mutation(data, "projectId", "thumbnail_save_error"):
        return
    print(f"DEBUG: handle_save_thumbnails called")
    
    project_id = data.get("projectId")
    thumbnails = data.get("thumbnails", {})
    
    if not project_id or not thumbnails:
        emit("thumbnail_save_error", {"error": "Missing project ID or thumbnails"}, to=request.sid)
        return
    
    try:
        import time
        import tempfile
        
        # Process and upload thumbnails
        thumbnail_urls = {}
        expires_at = int(time.time()) + current_app.config["PRESIGNED_TTL_SECONDS"]  # Use configured TTL (6 days)
        
        if not isinstance(thumbnails, dict) or any(k not in ("matrix_io", "matrix_metabolism") for k in thumbnails):
            raise ValueError("Invalid thumbnail types")
        for thumb_type, thumb_data in thumbnails.items():
            if thumb_data and thumb_data.startswith('data:image'):
                # Process base64 image
                image_binary = decode_image_upload(thumb_data)
                
                # Create temp file and upload to S3
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as temp:
                    temp.write(image_binary)
                    temp.flush()
                    
                    # Upload with unique filename
                    filename = f"{project_id}_{thumb_type}.jpg"
                    ImageTask.s3_upload(temp.name, filename)
                    
                    # Generate presigned URL
                    thumbnail_urls[thumb_type] = ImageTask.s3_genurl(filename, isThumbnails=True)
        
        if thumbnail_urls:
            # Save to database
            model.get_or_update_thumbnails_and_expires_at_by_id(project_id, json.dumps(thumbnail_urls), expires_at)
            emit("thumbnail_save_success", {"message": "Thumbnails saved successfully"}, to=request.sid)
        else:
            emit("thumbnail_save_error", {"error": "No valid thumbnails processed"}, to=request.sid)
            
    except Exception as e:
        print(f"Error saving thumbnails: {str(e)}")
        emit("thumbnail_save_error", {"error": f"Failed to save thumbnails: {str(e)}"}, to=request.sid)


@socketio.on("delete_temporary_project", namespace="/ecocircuit")
def handle_delete_temporary_project(data):
    if not _authorize_mutation(data, "project_id", "temporary_project_delete_error"):
        return
    """Delete temporary project when user leaves the page"""
    project_id = data.get("project_id")
    
    if not project_id:
        return
    
    # Get the project to verify it's temporary
    project = model.get_project_by_id(project_id)
    
    # Only delete if:
    # 1. Project exists
    # 2. Project is temporary
    # 3. User is the one who created it (session check)
    if (project and 
        project["access"] == "temporary" and
        session.get("claim_project_id") == project_id):
        
        # Delete the project
        if model.delete_project(project_id, temporary=True) is None:
            return
        
        # Clear from session
        session.pop("claim_project_id", None)
        
        print(f"Deleted temporary project: {project_id}")
        emit("temporary_project_deleted", {"project_id": project_id})
