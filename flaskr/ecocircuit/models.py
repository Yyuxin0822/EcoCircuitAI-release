from flaskr.db import get_db
from werkzeug.exceptions import abort
from flask import g, flash, session
import json

import uuid
import sqlite3
from flaskr.ecocircuit.utils import *

# TABLE user - lightweight functions for ecocircuit use
def get_username_by_id(id):
    """Get username from db by id"""
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT name FROM user WHERE id = ?", (id,))
    user = cursor.fetchone()
    if user is None:
        return None
    return user["name"]


# TABLE project
def create_or_update_project(
    project_id=None,
    author_id=None,
    title=None,
    request_type=None,
    info=None,
    img_url=None,
    system=None,
    access=None,
    max_retries=5,
):
    """Create or update project in db, handling UUID conflicts."""
    db = get_db()
    cursor = db.cursor()

    if project_id is None:
        retries = 0
        while retries < max_retries:
            new_project_id = str(uuid.uuid4())
            try:
                cursor.execute(
                    """
                    INSERT INTO project (id, author_id, title, type, info, img_url, system, access) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_project_id,
                        author_id,
                        title,
                        request_type,
                        info,
                        img_url,
                        system,
                        access,
                    ),
                )
                db.commit()
                return new_project_id

            except sqlite3.IntegrityError as e:
                print(f"UUID conflict detected: {new_project_id}, retrying...")
                retries += 1

        raise Exception("Maximum retries reached: could not generate a unique UUID.")
    else:
        if access is not None:
            cursor.execute(
                """
                UPDATE project SET author_id = ?, title = ?, type = ?, info = ?, img_url = ?, system = ?, access = ?
                WHERE id = ?
                """,
                (
                    author_id,
                    title,
                    request_type,
                    info,
                    img_url,
                    system,
                    access,
                    project_id,
                ),
            )
        else:
            cursor.execute(
                """
                UPDATE project SET author_id = ?, title = ?, type = ?, info = ?, img_url = ?, system = ?
                WHERE id = ?
                """,
                (author_id, title, request_type, info, img_url, system, project_id),
            )

        db.commit()

        return project_id

def can_mutate_project(project_id):
    """Trust the live session and stored ownership, never client author IDs."""
    if not isinstance(project_id, str) or not project_id:
        return False
    project = get_db().execute(
        "SELECT author_id, access FROM project WHERE id = ?", (project_id,)
    ).fetchone()
    if project is None:
        return False
    if project["access"] == "temporary":
        return (project["author_id"] is None
                and session.get("claim_project_id") == project_id)
    user = session.get("user") or {}
    user_id = user.get("id")
    return bool(user_id and user_id == project["author_id"]
                and get_db().execute("SELECT id FROM user WHERE id = ?", (user_id,)).fetchone())


def delete_project(project_id=None, author_id=None, temporary=False):
    """Delete project and related rows atomically after checking ownership."""
    if not can_mutate_project(project_id):
        return None
    db = get_db()
    project = db.execute("SELECT author_id, access FROM project WHERE id = ?", (project_id,)).fetchone()
    if temporary:
        if project["access"] != "temporary" or project["author_id"] is not None:
            return None
    elif not author_id or project["author_id"] != author_id:
        return None
    with db:
        for table in ("iodata", "metabolism", "prompt"):
            db.execute(f"DELETE FROM {table} WHERE project_id = ?", (project_id,))
        db.execute("DELETE FROM project WHERE id = ?", (project_id,))
    return project_id

def update_project_system(project_id=None, system=None):
    """Update project system in db"""
    db = get_db()
    cursor = db.cursor()
    if project_id is None:
        return
    else:
        cursor.execute(
            "UPDATE project SET system = ? WHERE id = ?",
            (system, project_id),
        )
    db.commit()
    return cursor.lastrowid

def update_project_access(project_id=None, author_id=None, access=None):
    """Change visibility or claim this session's temporary project."""
    user_id = (session.get("user") or {}).get("id")
    if (not user_id or author_id != user_id or access not in ("private", "public")
            or not can_mutate_project(project_id)):
        return False
    db = get_db()
    if not db.execute("SELECT id FROM user WHERE id = ?", (user_id,)).fetchone():
        return False
    result = db.execute(
        """UPDATE project SET access = ?, author_id = ?
           WHERE id = ? AND (author_id = ? OR (author_id IS NULL AND access = 'temporary'))""",
        (access, user_id, project_id, user_id),
    )
    db.commit()
    return result.rowcount == 1

def get_project_by_id(id, return_access_level=False):
    """Fetch project and optionally compute access level."""
    project = get_db().execute("SELECT * FROM project WHERE id = ?", (id,)).fetchone()

    if project is None:
        flash("Sorry! No information found for this project.")
        abort(404)

    if return_access_level:
        access = project["access"]
        author_id = project["author_id"]
        user_id = g.user["id"] if g.get("user") else None
        # print("User ID: ", user_id)
        # print("Author ID: ", author_id)
        # print("Access: ", access)
        if access == "public":
            level = ("public", "edit") if user_id == author_id else ("public", "view")
        elif access == "private":
            if user_id == author_id and author_id is not None:
                level = ("private", "edit")
            else:
                level = ("private", "forbidden")
        elif access == "temporary":
            level = ("temporary", "forbidden")
        else:
            level = ("unknown", "forbidden")
        return project, level

    return project

def get_or_update_img_url_and_expires_at_by_id(id, img_url=None, expires_at=None):
    db = get_db()
    cursor = db.cursor()

    if img_url is not None and expires_at is not None:
        cursor.execute(
            """
            UPDATE project
            SET img_url = ?, img_url_expires_at = ?
            WHERE id = ?
            """,
            (img_url, expires_at, id),
        )
        db.commit()

    # Always return the current values from the database
    cursor.execute(
        "SELECT img_url, img_url_expires_at FROM project WHERE id = ?",
        (id,),
    )
    result = cursor.fetchone()
    return result if result else (None, None)

def get_or_update_thumbnails_and_expires_at_by_id(id, thumbnails=None, expires_at=None):
    """Get or update project thumbnails and expiration time"""
    db = get_db()
    cursor = db.cursor()
    if thumbnails is not None and expires_at is not None:
        cursor.execute(
            """
            UPDATE project 
            SET thumbnails = ?, thumbnails_expires_at = ? 
            WHERE id = ?
            """,
            (thumbnails, expires_at, id),
        )
        db.commit()
    # Always return the current values from the database
    cursor.execute(
        "SELECT thumbnails, thumbnails_expires_at FROM project WHERE id = ?",
        (id,),
    )
    result = cursor.fetchone()
    return result if result else (None, None)

# TABLE iodata
def find_or_create_or_update_iodata(project_id=None, iodata=None):
    """Create or find or updata iodata in db"""

    if project_id is None:
        return

    # here is the couple of conditions:
    # if not iodata -> find
    # if iodata->create / update

    if project_id:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT * FROM iodata WHERE project_id = ?", (project_id,))
        iodata_db = cursor.fetchone()
        if not iodata:
            if iodata_db:
                iodata = iodata_db["iodata"]
            else:
                return None
        else:
            if iodata_db:
                cursor.execute(
                    "UPDATE iodata SET iodata = ? WHERE project_id = ?",
                    (iodata, project_id),
                )
            else:
                cursor.execute(
                    "INSERT INTO iodata (project_id, iodata) VALUES (?, ?)",
                    (project_id, iodata),
                )
        db.commit()

    return iodata

# TABLE metabolism
def find_or_create_or_update_metabolism(project_id=None, metabolism=None):
    """Create or find or updata metabolism in db"""

    if project_id is None:
        return

    # here is the couple of conditions:
    # if not metabolism -> find
    # if metabolism->create / update

    if project_id:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT * FROM metabolism WHERE project_id = ?", (project_id,))
        metabolism_db = cursor.fetchone()
        if not metabolism:
            if metabolism_db:
                metabolism = metabolism_db["metabolism"]
            else:
                return None
        else:
            if metabolism_db:
                cursor.execute(
                    "UPDATE metabolism SET metabolism = ? WHERE project_id = ?",
                    (metabolism, project_id),
                )
            else:
                cursor.execute(
                    "INSERT INTO metabolism (project_id, metabolism) VALUES (?, ?)",
                    (project_id, metabolism),
                )
        db.commit()

    return metabolism

def get_project(id, check_author=True):
    """Get project from db by id including all related prompt details aggregated"""
    project = (
        get_db()
        .execute(
            "SELECT p.id, p.author_id, p.created, p.title, p.type, p.info, p.img_url, p.system,"  # Added comma here
            'GROUP_CONCAT(pr.flow, ";") AS flow, '  # Ensure column names match your table definition
            'GROUP_CONCAT(pr.feedbackflow, ";") AS feedbackflow, '  # Ensure column names match your table definition
            'GROUP_CONCAT(pr.node, ";") AS node, '  # Same here
            'GROUP_CONCAT(pr.id, ";") AS prompt_id, '  # And here
            'GROUP_CONCAT(pr.userinfo, ";") AS userinfo '  # And here
            "FROM project p "
            "JOIN user u ON p.author_id = u.id "
            "LEFT JOIN prompt pr ON p.id = pr.project_id "
            "WHERE p.id = ? "
            "GROUP BY p.id",  # Necessary to aggregate prompt details
            (id,),
        )
        .fetchone()
    )

    if project is None or project["prompt_id"] is None:
        flash("Sorry! No information found for this project.")
        abort(404, f"Project id {id} doesn't exist.")

    if check_author and project["author_id"] != session.get("user", {}).get("id"):
        abort(403)

    return project
