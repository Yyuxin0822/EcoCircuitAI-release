from flaskr.db import get_db
from flaskr.account.api_utils import decrypt_key

# TABLE user
def get_username_by_id(id):
    """Get username from db by id"""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT name FROM user WHERE id = ?", (id,))
    user = cursor.fetchone()
    if user is None:
        return None
    return user["name"]

def update_user_name(user_id, name):
    """Update display name for a user and return the saved value."""
    if not user_id:
        raise ValueError("Missing user id")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Username cannot be empty")
    if len(name) > 64:
        raise ValueError("Username is too long")

    db = get_db()
    db.execute("UPDATE user SET name = ? WHERE id = ?", (name.strip(), user_id))
    db.commit()
    row = db.execute("SELECT name FROM user WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise ValueError("Account no longer exists. Sign in again.")
    return row["name"]

def get_user_api_key(user_id):
    """Get only API key for a user"""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT api_key FROM user_api_key WHERE user_id = ?", (user_id,))
    result = cursor.fetchone()
    if result:
        return decrypt_key(result["api_key"])
    return None

def get_user_projects(user_id):
    """List owned projects with the data required by the project page."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        SELECT id, title, type, info, system, access, thumbnails, thumbnails_expires_at 
        FROM project
        WHERE author_id = ?
          AND EXISTS (
              SELECT 1 FROM iodata
              WHERE iodata.project_id = project.id
                AND iodata.iodata IS NOT NULL
          )
          AND EXISTS (
              SELECT 1 FROM metabolism
              WHERE metabolism.project_id = project.id
                AND metabolism.metabolism IS NOT NULL
          )
    """, (user_id,))
    projects = [dict(row) for row in cursor.fetchall()]
    
    # Thumbnail failures are recovered lazily by the browser, not during page rendering.
    return projects


def delete_user_account(user_id):
    """Remove this account's database records in one transaction."""
    if not user_id:
        return False
    db = get_db()
    with db:
        for table in ("iodata", "metabolism", "prompt"):
            db.execute(f"DELETE FROM {table} WHERE project_id IN (SELECT id FROM project WHERE author_id = ?)", (user_id,))
        db.execute("DELETE FROM project WHERE author_id = ?", (user_id,))
        db.execute("DELETE FROM user_api_key WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM user_consent WHERE user_id = ?", (user_id,))
        result = db.execute("DELETE FROM user WHERE id = ?", (user_id,))
    return result.rowcount == 1


def has_user_api_key(user_id):
    return get_db().execute(
        "SELECT 1 FROM user_api_key WHERE user_id = ? LIMIT 1", (user_id,)
    ).fetchone() is not None


# TABLE user_api_key
def delete_user_api_key(user_id):
    """
    Delete all API keys for the given user_id.
    Returns True if any rows were deleted, False otherwise.
    """
    if not user_id:
        return False

    db = get_db()
    cur = db.cursor()

    # Perform the delete by user_id only
    cur.execute(
        "DELETE FROM user_api_key WHERE user_id = ?",
        (user_id,)
    )
    deleted = cur.rowcount

    db.commit()
    return deleted > 0

def save_user_api_key(user_id, encrypted_key):
    """
    Save or update API key for user
    """
    if not user_id or not encrypted_key:
        raise ValueError("User ID and API key are required.")

    db = get_db()

    existing_record = db.execute(
        "SELECT id FROM user_api_key WHERE user_id = ?", (user_id,)
    ).fetchone()

    if existing_record:
        db.execute(
            "UPDATE user_api_key SET api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
            (encrypted_key, user_id),
        )
    else:
        db.execute(
            "INSERT INTO user_api_key (user_id, api_key) VALUES (?, ?)",
            (user_id, encrypted_key),
        )

    db.commit()

def log_user_consent(user_id, ip_address):
    """
    Log user consent to terms and privacy policy
    """
    db = get_db()
    db.execute(
        "INSERT INTO user_consent (user_id, consent_given, ip_address) VALUES (?, ?, ?)",
        (user_id, True, ip_address),
    )
    db.commit()
    return True

def mask_api_key(key):
    """Return only a fixed-length identifying preview."""
    if not key:
        return None
    if len(key) <= 7:
        return "xxxxxxxx"
    return key[:3] + "..." + key[-4:]


def get_user_api_key_preview(user_id):
    return mask_api_key(get_user_api_key(user_id))
