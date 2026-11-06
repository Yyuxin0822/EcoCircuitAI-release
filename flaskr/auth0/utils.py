from functools import wraps
from flask import current_app, redirect, url_for, session, request, flash, g
from flaskr.db import get_db
from urllib.parse import urlparse, urljoin
import requests

def is_safe_url(target):
    """Check if the target URL is safe for redirect (same host only)."""
    if not target:
        return False
    
    # Only allow redirects to same host, absolute path, or relative path
    host_url = urlparse(request.host_url)
    redirect_url = urlparse(urljoin(request.host_url, target))
    return (redirect_url.scheme in ('http', 'https') and
            host_url.netloc == redirect_url.netloc)

def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        # Check if login is disabled via the app configuration
        if current_app.config.get('LOGIN_DISABLED', False):
            return view(**kwargs)

        # Prefer g.user which is set in a before_request
        if g.get("user") is None:
            return redirect(url_for("auth0.login", next=request.url))

        return view(**kwargs)

    return wrapped_view

def login_and_api_key_redirect(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        
        if request.args.get("skip_redirect") == "1":
            print("DEBUG: should be landing at landing.html")
            return view(*args, **kwargs)
        
        if g.get("user"):
            if session.get("encrypted_api_key"):
                return redirect(url_for("ecocircuit.prompt"))
            
            user_id = g.user["id"]
            db = get_db()
            
            key_record = db.execute(
                "SELECT api_key FROM user_api_key WHERE user_id = ?",
                (user_id,)
            ).fetchone()

            
            if key_record and key_record["api_key"]:
                session["encrypted_api_key"] = key_record["api_key"]
                session.modified = True
                return redirect(url_for("ecocircuit.prompt"))
            
        return view(*args, **kwargs)

    return wrapped_view

def ensure_api_key_in_session() -> bool:
    """Ensure `session['encrypted_api_key']` is set.

    - If already present, return True.
    - If user is logged in, try fetching from DB, set session, return True if found.
    - Otherwise, return False.
    """
    encrypted_key = session.get("encrypted_api_key")

    if encrypted_key:
        return True

    if g.get("user"):
        user_id = g.user["id"]
        db = get_db()
        key_record = db.execute(
            "SELECT api_key FROM user_api_key WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if key_record and key_record["api_key"]:
            session["encrypted_api_key"] = key_record["api_key"]
            session.modified = True
            return True

    return False

def api_key_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        # Prefer session, otherwise fetch from DB if possible
        if ensure_api_key_in_session():
            return view(*args, **kwargs)

        # Missing key and cannot populate from DB
        flash("API key not found. There may be a mistake. Please enter your API key.", "warning")
        if g.get("user"):
            return redirect(url_for("account.api_key"))
        else:
            return redirect(url_for("ecocircuit.index"))
    
    return wrapped_view

def get_auth0_mgmt_token():
    """
    Perform a Client Credentials grant to Auth0 to get a Management API token.
    """
    domain = current_app.config["AUTH0_DOMAIN"]
    client_id = current_app.config["AUTH0_CLIENT_ID"]
    client_secret = current_app.config["AUTH0_CLIENT_SECRET"]
    token_url = f"https://{domain}/oauth/token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "audience": f"https://{domain}/api/v2/"
    }
    resp = requests.post(token_url, json=payload, timeout=(5, 15))
    resp.raise_for_status()
    return resp.json()["access_token"]
