from flask import (
    Blueprint,
    abort,
    flash,
    g,
    redirect,
    render_template,
    url_for,
    jsonify,
    current_app,
    session,
    request,
    Response,
)
from werkzeug.utils import secure_filename
from flaskr.auth0.utils import login_required, api_key_required
from flaskr.ecocircuit.utils import access_required
from flaskr.db import get_db

# from flaskr.errorhandler import *
import asyncio
import requests
import re
from flaskr.ecocircuit import ecocircuit_bp
import flaskr.ecocircuit.models as model
from flaskr.ecocircuit.utils import *
import nest_asyncio
from flaskr.auth0.utils import login_and_api_key_redirect
import io
from flaskr.ecocircuit.resource_safety import allowed_s3_url, static_export_data_uri, validate_export_dimensions
nest_asyncio.apply()

# Import events to register SocketIO handlers
from flaskr.ecocircuit import events  # noqa: F401


@ecocircuit_bp.route("/", methods=["GET"])
@login_and_api_key_redirect
def index():
    return render_template("landing.html")


loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)


@ecocircuit_bp.route("/prompt", methods=["GET"])
@api_key_required
def prompt():
    return render_template("prompt.html")


@ecocircuit_bp.route("/contributors", methods=["GET"])
def contributors():
    return render_template("contributors.html")



@ecocircuit_bp.route("/<string:id>", methods=["GET", "POST"])
@access_required
def generate(id):
    print(f"DEBUG: generate called with id={id}")
    saved_data, access_level = model.get_project_by_id(id, return_access_level=True)

    authenticated = g.user is not None
    show_claim_prompt = False

    if session.get("claim_project_id") == id and saved_data["access"] == "temporary":
        show_claim_prompt = True

    if access_level[1] == "forbidden" and not show_claim_prompt:
        abort(403, description="You do not have permission to access this project.")

    authorname = model.get_username_by_id(saved_data["author_id"])
    syscolor = saved_data["system"]
    env = saved_data["info"]
    iodata = model.find_or_create_or_update_iodata(project_id=id, iodata=None)
    metabolism = model.find_or_create_or_update_metabolism(
        project_id=id, metabolism=None
    )

    if iodata is None or metabolism is None:
        flash("The project does not exist.")
        return render_template("prompt.html"), 400

    from flaskr.ecocircuit.method import ImageTask

    img_url = ImageTask.s3_genurl(f"{id}.jpg")

    # if either iodata or metabolism is None, then there was an error
    return render_template(
        "metabolism.html",
        id=id,
        env=env,
        img_url=img_url,
        syscolor=syscolor,
        iodata=iodata,
        metabolism=metabolism,
        is_authenticated=authenticated,
        is_generated_text=saved_data["type"] == "description",
        access_level=access_level,
        show_claim_prompt=show_claim_prompt,
        authorname=authorname if authorname else "Anonymous",
    )


@ecocircuit_bp.route("/project/<string:project_id>", methods=["DELETE"])
@login_required
def delete_project(project_id):
    deleted_project_id = model.delete_project(project_id, author_id=g.user["id"])
    if deleted_project_id is None:
        return (
            jsonify(
                {
                    "message": "Project not found or you do not have permission to delete it."
                }
            ),
            404,
        )
    return jsonify({"message": "Project deleted"}), 200




# S3 Image Proxy for CORS issues in thumbnail generation


@ecocircuit_bp.route("/regenerate-thumbnail/<string:project_id>", methods=["GET"])
def regenerate_thumbnail(project_id):
    """Refresh URLs only for a project the current visitor may view."""
    project = get_db().execute(
        "SELECT author_id, access FROM project WHERE id = ?", (project_id,)
    ).fetchone()
    if project is None:
        return jsonify({"error": "Project not found"}), 404
    user_id = g.user["id"] if g.get("user") else None
    allowed = (
        project["access"] == "public"
        or (project["access"] == "private"
            and user_id is not None and user_id == project["author_id"])
        or (project["access"] == "temporary"
            and session.get("claim_project_id") == project_id)
    )
    if not allowed:
        return jsonify({"error": "Access denied"}), 403

    from flaskr.ecocircuit.method import ImageTask
    matrix_io_url = ImageTask.s3_genurl(f"{project_id}_matrix_io.jpg", isThumbnails=True)
    matrix_metabolism_url = ImageTask.s3_genurl(f"{project_id}_matrix_metabolism.jpg", isThumbnails=True)
    response = jsonify({
        "status": "success" if matrix_io_url or matrix_metabolism_url else "error",
        "matrix_io": matrix_io_url,
        "matrix_metabolism": matrix_metabolism_url,
    })
    response.headers["Cache-Control"] = "private, no-store"
    return response, 200 if matrix_io_url or matrix_metabolism_url else 502


@ecocircuit_bp.route("/img-proxy", methods=["GET"])
def img_proxy():
    """Proxy S3 images to avoid CORS issues during thumbnail generation."""
    url = request.args.get("url", "")
    
    if not url:
        return jsonify({"error": "URL parameter required"}), 400
    
    # Security: Only allow S3 amazonaws.com URLs
    if not allowed_s3_url(url):
        current_app.logger.warning("Blocked image proxy URL")
        return jsonify({"error": "Only S3 URLs allowed"}), 403
    
    try:
        import time
        deadline = time.monotonic() + 20
        with requests.get(url, timeout=(5, 10), stream=True, allow_redirects=False) as response:
            if response.status_code != 200:
                return jsonify({"error": "Image unavailable"}), 502
            content_type = response.headers.get("Content-Type", "").split(";")[0].lower()
            if content_type not in ("image/jpeg", "image/png", "image/webp"):
                return jsonify({"error": "Unsupported image type"}), 415
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                if time.monotonic() > deadline:
                    return jsonify({"error": "Image fetch timed out"}), 504
                size += len(chunk)
                if size > 10 * 1024 * 1024:
                    return jsonify({"error": "Image too large"}), 413
                chunks.append(chunk)
        flask_response = Response(b"".join(chunks), content_type=content_type)
        flask_response.headers["Cache-Control"] = "private, no-store"
        return flask_response
        
    except requests.exceptions.RequestException as e:
        current_app.logger.warning("Image proxy fetch failed")
        return jsonify({"error": "Failed to fetch image"}), 502



@ecocircuit_bp.route("/convert-svg-to-jpg", methods=["POST"])
def convert_svg():
    """
    Convert an SVG string to PNG (default) or JPG.
    Request: JSON { "svg": "<svg...>", "format": "png|jpg", "filename": "optional-name" }
    Response: attachment with image/* content type
    """
    if not request.is_json:
        return jsonify({"error": "Send JSON with 'svg'"}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    svg = data.get("svg")
    if not svg or not isinstance(svg, str):
        return jsonify({"error": "Field 'svg' (string) is required"}), 400

    if not isinstance(data.get("format", "png"), str) or not isinstance(data.get("filename", "download"), str):
        return jsonify({"error": "Invalid format or filename"}), 400
    fmt = (data.get("format") or "png").lower()
    if fmt not in ("png", "jpg", "jpeg"):
        return jsonify({"error": "format must be 'png' or 'jpg'"}), 400

    filename = secure_filename(data.get("filename") or "download") or "download"

    # Optional: support data URI input like "data:image/svg+xml;base64,..."
    s = svg.strip()
    if s.startswith("data:image/svg+xml;base64,"):
        import base64
        try:
            s = base64.b64decode(s.split(",", 1)[1]).decode("utf-8", "replace")
        except Exception:
            return jsonify({"error": "Invalid base64 data URI for SVG"}), 400
        svg = s

    try:
        import asyncio
        from pyppeteer import launch
        import re
        import base64
        import mimetypes
        from pathlib import Path
        
        # Resolve only static image assets; never fetch user-supplied URLs.
        def replace_image_url(match):
            value = html.unescape(match.group(1)).strip().strip("\"'")
            if value.startswith(("data:image/", "#")):
                return match.group(0)
            embedded = static_export_data_uri(value, current_app.root_path)
            quote = '&quot;' if '&quot;' in match.group(0) else '"'
            return 'url(' + quote + embedded + quote + ')'
        import html
        svg = re.sub(r'url\(["\x27]?([^)"\x27]+)["\x27]?\)', replace_image_url, svg)
        # Create HTML with embedded SVG and font loading
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
            <style>
                
                body {{
                    margin: 0;
                    padding: 0;
                    background: white;
                    font-family: "Comfortaa", Inter, Roboto, Arial, sans-serif;
                }}
                svg {{
                    display: block;
                }}
                /* Ensure text elements have proper fonts */
                text, tspan {{
                    font-family: "Comfortaa", "ADLaM Display", "Combo", Inter, Roboto, Arial, sans-serif !important;
                }}
            </style>
        </head>
        <body>
            {svg}
        </body>
        </html>
        """
        
        async def render_svg():
            browser = None
            try:
                browser = await launch(
                    headless=True,
                    handleSIGINT=False,
                    handleSIGTERM=False,
                    handleSIGHUP=False,
                    args=[
                        '--no-sandbox', 
                        '--disable-setuid-sandbox', 
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--single-process',
                        '--disable-features=VizDisplayCompositor',
                    ]
                )
                page = await browser.newPage()
                await page.setJavaScriptEnabled(False)
                await page.setRequestInterception(True)
                async def block_request(resource):
                    if resource.url.startswith("data:image/"):
                        await resource.continue_()
                    else:
                        await resource.abort()
                page.on("request", lambda resource: asyncio.ensure_future(block_request(resource)))
                
                # Set viewport with higher DPI for better rendering
                await page.setViewport({
                    'width': 1200, 
                    'height': 800,
                    'deviceScaleFactor': 2  # Higher resolution
                })
                
                await page.setContent(html_content)
                
                # Wait for SVG elements to be present
                try:
                    await page.waitForSelector('svg', {'timeout': 5000})
                except:
                    pass  # SVG selector timeout, proceeding anyway
                
                # Wait for fonts to load first
                await page.evaluate('''() => {
                    return new Promise((resolve) => {
                        if (document.fonts && document.fonts.ready) {
                            document.fonts.ready.then(resolve);
                            // Fallback timeout for font loading
                            setTimeout(resolve, 5000);
                        } else {
                            setTimeout(resolve, 2000);
                        }
                    });
                }''')
                
                # Wait for images and other resources to load
                await page.evaluate('''() => {
                    return new Promise((resolve) => {
                        if (document.readyState === 'complete') {
                            resolve();
                        } else {
                            window.addEventListener('load', resolve);
                            // Fallback timeout
                            setTimeout(resolve, 3000);
                        }
                    });
                }''')
                
                # Additional wait for any animations or async rendering
                await page.waitFor(2000)  # Wait 2 seconds
                
                # Get actual SVG dimensions from the page
                dimensions = await page.evaluate('''() => {
                    const svg = document.querySelector('svg');
                    if (svg) {
                        const rect = svg.getBoundingClientRect();
                        return {width: Math.ceil(rect.width), height: Math.ceil(rect.height)};
                    }
                    return {width: 1200, height: 800};
                }''')
                
                validate_export_dimensions(dimensions['width'], dimensions['height'])

                # Set precise viewport to SVG size with high DPI
                await page.setViewport({
                    'width': dimensions['width'], 
                    'height': dimensions['height'],
                    'deviceScaleFactor': 2  # Keep high resolution
                })
                
                # Take screenshot as PNG
                screenshot = await page.screenshot({
                    'type': 'png',
                    'omitBackground': False,  # Include white background
                    'clip': {
                        'x': 0,
                        'y': 0,
                        'width': dimensions['width'],
                        'height': dimensions['height']
                    }
                })
                
                return screenshot
                
            except Exception as render_error:
                raise render_error
            finally:
                if browser:
                    await browser.close()
        
        # Use the existing event loop with nest_asyncio
        try:
            # Try using the existing loop first
            png_bytes = loop.run_until_complete(asyncio.wait_for(render_svg(), timeout=45))
        except RuntimeError as e:
            # Fallback to asyncio.run if loop issues
            png_bytes = asyncio.run(asyncio.wait_for(render_svg(), timeout=45))
        
        
    except Exception as e:
        current_app.logger.exception("Puppeteer SVG->PNG failed")
        return jsonify({"error": "SVG conversion failed. Check image resources and diagram size."}), 500

    # Add white padding for matrix-io exports
    if filename == "matrix-io":
        try:
            from PIL import Image
            im = Image.open(io.BytesIO(png_bytes))
            
            # Calculate new dimensions for ~55% content width
            original_width, original_height = im.size
            new_width = int(original_width * 1.8)
            new_height = int(original_height * 1.2)  # Add some vertical padding too
            
            # Create white background
            white_bg = Image.new("RGB", (new_width, new_height), (255, 255, 255))
            
            # Calculate position to center the original image
            x_offset = (new_width - original_width) // 2
            y_offset = (new_height - original_height) // 2
            
            # Paste original image onto white background
            if "A" in im.getbands():  # has alpha channel
                white_bg.paste(im, (x_offset, y_offset), mask=im.getchannel("A"))
            else:
                white_bg.paste(im, (x_offset, y_offset))
            
            # Convert back to bytes
            out = io.BytesIO()
            white_bg.save(out, format="PNG")
            out.seek(0)
            png_bytes = out.getvalue()
            
        except Exception as e:
            current_app.logger.warning(f"Failed to add white padding: {e}")
            # Continue with original png_bytes if padding fails

    # If PNG requested, return immediately
    if fmt == "png":
        return Response(
            png_bytes,
            mimetype="image/png",
            headers={"Content-Disposition": f'attachment; filename="{filename}.png"'},
        )

    # Otherwise convert PNG -> JPG with white background
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(png_bytes))
        if "A" in im.getbands():  # has alpha channel
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.getchannel("A"))
            im = bg
        else:
            im = im.convert("RGB")

        out = io.BytesIO()
        im.save(out, format="JPEG", quality=95, optimize=True)
        out.seek(0)
        jpg_bytes = out.getvalue()
    except Exception as e:
        current_app.logger.exception("PNG->JPG failed")
        return jsonify({"error": "JPEG conversion failed."}), 500

    return Response(
        jpg_bytes,
        mimetype="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}.jpg"'},
    )

@ecocircuit_bp.errorhandler(403)
def handle_forbidden(e):
    flash(e.description, "warning")
    return redirect(url_for("ecocircuit.index"))


if __name__ == "__main__":
    pass
