from flask import (
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    url_for,
    jsonify,
    current_app,
    session,
)
from flaskr.auth0.utils import login_required
from flaskr.account import account_bp
import flaskr.account.models as model
from flaskr.account.api_utils import encrypt_key, authenticate_openai_key
import requests
import flaskr.auth0.utils as auth0_util


@account_bp.route("/api-key", methods=["GET"])
@login_required
def api_key():
    user_id = g.user["id"]
    api_key = model.get_user_api_key_preview(user_id)
    return render_template("account/api_key.html", api_key=api_key)

@account_bp.route("/projects", methods=["GET"])
@login_required
def projects():
    user_id = g.user["id"]
    projects = [dict(row) for row in model.get_user_projects(user_id)]
    return render_template("account/projects.html", projects=projects)

@account_bp.route("/settings", methods=["GET"])
@login_required
def settings():
    return render_template("account/account_settings.html")

@account_bp.route("/api-key-crud", methods=["DELETE"])
@login_required
def api_key_crud():
    user_id = g.user["id"]
    if request.method == "DELETE":
        model.delete_user_api_key(user_id)
        # Also clear a session-only key; repeated deletion is safe.
        session.pop("encrypted_api_key", None)
        session.modified = True
        return jsonify({"message": "API key deleted"}), 200

@account_bp.route("/settings", methods=["DELETE"])
@login_required
def delete_account():
    user_id = g.user["id"]
    auth0_sub = g.user.get("sub")
    if not auth0_sub:
        return jsonify({"status": "error", "message": "Sign in again before deleting your account."}), 401
    # Preserve local data when the identity provider refuses or cannot be reached.
    try:
        mgmt_token = auth0_util.get_auth0_mgmt_token()
        from urllib.parse import quote
        domain = current_app.config["AUTH0_DOMAIN"]
        response = requests.delete(
            f"https://{domain}/api/v2/users/{quote(auth0_sub, safe='')}",
            headers={"Authorization": f"Bearer {mgmt_token}"}, timeout=(5, 15),
        )
        if response.status_code != 404:
            response.raise_for_status()
    except (requests.RequestException, KeyError, ValueError):
        current_app.logger.warning("Account identity deletion failed")
        return jsonify({"status": "error", "message": "Account deletion could not be completed. Your local data has been kept. Please retry later."}), 502
    try:
        deleted = model.delete_user_account(user_id)
    except Exception:
        current_app.logger.error("Local account deletion failed after identity deletion")
        return jsonify({"status": "error", "message": "Identity removed, but local cleanup failed. Contact the administrator before closing this session."}), 500
    if not deleted:
        return jsonify({"status": "error", "message": "Local account cleanup could not be confirmed. Contact the administrator."}), 500
    session.clear()
    session.modified = True
    return jsonify({"status": "success", "message": "Account deleted.",
                    "redirect_url": url_for("ecocircuit.index")}), 200

@account_bp.route("/store-key", methods=["POST"])
def store_key():
    api_key = request.form.get("api_key")
    if not isinstance(api_key, str) or not api_key.strip() or len(api_key) > 512:
        return jsonify({"error": "Enter a valid API key."}), 400
    api_key = api_key.strip()
    is_ajax = (
        request.headers.get("X-Requested-With") == "XMLHttpRequest"
        or request.form.get("from_401", "false") == "true"
    )

    consent_logged = log_user_consent()

    if not consent_logged and not is_ajax:
        flash("You must agree to the Terms of Use and Privacy Policy.")
        return render_template("landing.html"), 403

    valid, error_message = authenticate_openai_key(api_key)
    if not valid:
        if is_ajax:
            return jsonify({"error": error_message}), 403
        else:
            flash(error_message)
            return render_template("landing.html"), 403
    else:
        encrypted_key = encrypt_key(api_key)
        session["encrypted_api_key"] = encrypted_key
        session.modified = True

        if g.user and consent_logged:
            try:
                save_api_key()
            except ValueError as e:
                print("API key save error:", e)
                if is_ajax:
                    return jsonify({"error": str(e)}), 400
                else:
                    flash(str(e))
                    return render_template("landing.html"), 400

    if is_ajax:
        return (
            jsonify({"success": "API key stored successfully.", "has_api_key": True, "api_key_preview": model.mask_api_key(api_key)}),
            200,
        )
    else:
        return redirect(url_for("ecocircuit.prompt"))

def log_user_consent():
    consent_given = request.form.get("consent") == "on"

    if not consent_given:
        return False  # Consent explicitly not given

    user_id = g.user["id"] if g.user else None
    user_ip = request.remote_addr

    model.log_user_consent(user_id, user_ip)
    return True  # Consent given and logged

def save_api_key():
    api_key = request.form.get("api_key")

    if not api_key:
        raise ValueError("No API key provided.")

    encrypted_key = encrypt_key(api_key)

    if not g.user:
        raise ValueError("User not logged in.")

    user_id = g.user["id"]
    model.save_user_api_key(user_id, encrypted_key)
