from flask import session
from flaskr import socketio
from flaskr.account import models as account_models


@socketio.on('update_username', namespace='/account')
def handle_update_username(data):
    user = session.get('user')
    if not user:
        return {"error": "Not authenticated"}

    if not isinstance(data, dict):
        return {"error": "Invalid request"}
    name = data.get('name', '')
    try:
        saved = account_models.update_user_name(user.get('id'), name)
    except ValueError as e:
        return {"error": str(e)}
    except Exception:
        return {"error": "Failed to update username"}

    # Update session copy so UI shows new name without reload
    session['user']['name'] = saved
    session.modified = True

    return {"status": "ok", "name": saved}

