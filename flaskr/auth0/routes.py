from urllib.parse import urlencode
from flask import current_app, url_for, redirect, session, request
from flaskr.auth0 import auth0_bp
from flaskr.db import get_db
import uuid


@auth0_bp.route("/login")
def login():
    from .utils import is_safe_url
    
    # Capture intended URL and store it in session
    next_url = request.args.get("next", "/")
    if not is_safe_url(next_url):
        next_url = "/"
    session["post_login_redirect"] = next_url
    session.modified = True
    
    oauth = auth0_bp.oauth
    auth0 = oauth.create_client("auth0")
    return auth0.authorize_redirect(
        redirect_uri=url_for("auth0.callback", _external=True)
    )


@auth0_bp.route("/callback")
def callback():
    oauth = auth0_bp.oauth
    auth0 = oauth.create_client("auth0")

    try:
        token = auth0.authorize_access_token()
        userinfo = auth0.userinfo(token=token)


        # ✅ Check if user exists in DB, insert if not
        auth0_id = userinfo["sub"]
        email = userinfo.get("email")
        name = userinfo.get("name")

        db = get_db()
        existing_user = db.execute(
            "SELECT * FROM user WHERE auth0_id = ?", (auth0_id,)
        ).fetchone()

        if not existing_user:
            # Generate UUID for new user
            user_id = str(uuid.uuid4()).replace("-", "")
            db.execute(
                "INSERT INTO user (id, auth0_id, email, name) VALUES (?, ?, ?, ?)",
                (user_id, auth0_id, email, name),
            )
            db.commit()
        else:
            user_id = existing_user["id"]
            # Use the name from our database, not Auth0's name
            name = existing_user["name"]

        userinfo["id"] = user_id  # Add user ID to userinfo
        userinfo["name"] = name  # Use local DB name instead of Auth0's name
        # Never carry an API key across an identity change.
        session.pop("encrypted_api_key", None)
        if session.get("user") and session["user"].get("id") != user_id:
            session.pop("claim_project_id", None)
        session["user"] = userinfo

        # ✅ Check if user has a saved API key
        api_key_record = db.execute(
            "SELECT api_key FROM user_api_key WHERE user_id = ?", (user_id,)
        ).fetchone()

        # ✅ User data stored in session
        if api_key_record:
            session["encrypted_api_key"] = api_key_record["api_key"]
            session.modified = True
        
        # Retrieve the stored redirect URL from session
        from .utils import is_safe_url
        next_url = session.pop("post_login_redirect", None)
        print(f"DEBUG: OAuth callback - next_url={next_url}")
        
        # Validate and redirect to intended URL
        if next_url and is_safe_url(next_url):
            return redirect(next_url)
        
        # Fall back to default behavior based on API key
        if api_key_record:
            return redirect(url_for("ecocircuit.prompt"))
        else:
            return redirect("/")

    except Exception as e:
        print("OAuth callback failed:", e)
        session.pop("post_login_redirect", None)
        return redirect(url_for("ecocircuit.index", skip_redirect=1))


@auth0_bp.route("/logout")
def logout():
    print("Reaching Sign Out Link")
    
    # Clear all session data
    session.clear()
    session.modified = True
    
    # Build Auth0 logout URL
    domain = current_app.config["AUTH0_DOMAIN"]
    client_id = current_app.config["AUTH0_CLIENT_ID"]
    return_to = url_for("index", _external=True)
    
    # Create logout URL with federated logout
    params = urlencode({
        "returnTo": return_to,
        "client_id": client_id
    })
    
    print(f"Redirecting to Auth0 logout: https://{domain}/v2/logout?{params}")
    
    # Redirect to Auth0 logout
    return redirect(f"https://{domain}/v2/logout?{params}")
