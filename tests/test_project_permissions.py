"""Offline handler/SQLite tests: python -m unittest discover -s tests -p test_project_permissions.py"""
import ast
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
ROOT = Path(__file__).resolve().parents[1]

def definitions(path, namespace):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    for f in functions:
        f.decorator_list = []
    exec(compile(ast.Module(body=functions, type_ignores=[]), path, "exec"), namespace)

class PermissionsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript("""
            CREATE TABLE user(id TEXT);
            INSERT INTO user VALUES ('A'), ('B');
            CREATE TABLE project(id TEXT PRIMARY KEY, author_id TEXT, access TEXT, system TEXT);
            INSERT INTO project VALUES ('private','A','private','old'), ('public','A','public','old'),
                ('guest',NULL,'temporary','old'), ('other_guest',NULL,'temporary','old');
            CREATE TABLE iodata(project_id TEXT, iodata TEXT);
            CREATE TABLE metabolism(project_id TEXT, metabolism TEXT);
            CREATE TABLE prompt(project_id TEXT);
            INSERT INTO iodata VALUES ('private','old'), ('guest','old');
            INSERT INTO metabolism VALUES ('private','old'), ('guest','old');
            INSERT INTO prompt VALUES ('private'), ('guest');
        """)
        self.session = {}
        ns = {"get_db": lambda: self.db, "session": self.session, "json": json}
        definitions("flaskr/ecocircuit/models.py", ns)
        self.model = SimpleNamespace(**{k:v for k,v in ns.items() if callable(v)})
        self.emit = Mock()
        self.image = Mock()
        self.metabolism = Mock()
        self.events = {"model": self.model, "session": self.session,
            "request": SimpleNamespace(sid="socket-A"), "emit": self.emit,
            "ImageTask": self.image, "Metabolism": self.metabolism,
            "json": json, "decrypt_key": Mock(), "get_user_async_client": Mock()}
        definitions("flaskr/ecocircuit/events.py", self.events)

    def state(self):
        return list(self.db.iterdump())

    def test_all_mutations_deny_other_accounts_and_guests_before_side_effects(self):
        handlers = ["handle_save_project", "handle_update_system_cosmetic", "handle_iterate",
                    "handle_save_thumbnails", "update_project_access", "handle_delete_temporary_project"]
        for user in (None, "B"):
            for project in ("private", "public", "other_guest", "missing"):
                for handler in handlers:
                    with self.subTest(user=user, project=project, handler=handler):
                        self.session.clear()
                        if user:
                            self.session["user"] = {"id": user}
                        data = {"projectId": project, "project_id": project, "author_id": "A",
                            "access": "public", "sysColor": {"x": "new"}, "ioData": ["new"],
                            "metabolism": ["new"], "thumbnails": {"matrix_io": "data:image/jpeg;base64,eA=="}}
                        before = self.state()
                        self.emit.reset_mock()
                        self.events[handler](data)
                        self.assertEqual(before, self.state())
                        self.assertEqual(self.emit.call_args.args[1]["status"], "error")
                        self.assertEqual(self.emit.call_args.kwargs["to"], "socket-A")
        self.image.assert_not_called()
        self.assertEqual(self.image.mock_calls, [])
        self.metabolism.assert_not_called()
        self.events["decrypt_key"].assert_not_called()

    def test_bad_payloads_rejected(self):
        for data in (None, [], {}, {"projectId": []}):
            self.events["handle_save_project"](data)
            self.assertEqual(self.emit.call_args.args[1]["status"], "error")

    def test_owner_save_and_cosmetics_work(self):
        self.session["user"] = {"id": "A"}
        self.events["handle_save_project"]({"projectId": "private", "sysColor": {"a":"red"},
            "ioData": ["new"], "metabolism": ["flow"]})
        self.assertEqual(self.db.execute("SELECT iodata FROM iodata WHERE project_id='private'").fetchone()[0], '["new"]')
        self.events["handle_update_system_cosmetic"]({"projectId":"private", "sysColor":{"a":"blue"}})
        self.assertEqual(self.db.execute("SELECT system FROM project WHERE id='private'").fetchone()[0], '{"a": "blue"}')

    def test_visibility_ignores_forged_author_and_rejects_invalid_access(self):
        self.session["user"] = {"id": "A"}
        self.events["update_project_access"]({"project_id":"private", "author_id":"B", "access":"public"})
        row = self.db.execute("SELECT author_id,access FROM project WHERE id='private'").fetchone()
        self.assertEqual(tuple(row), ("A", "public"))
        before = self.state()
        self.events["update_project_access"]({"project_id":"private", "access":"temporary"})
        self.assertEqual(before, self.state())

    def test_guest_save_claim_and_delete(self):
        self.session["claim_project_id"] = "guest"
        self.events["handle_save_project"]({"projectId":"guest", "ioData":["guest edit"]})
        self.assertEqual(self.emit.call_args.args[0], "save_project_success")
        self.events["update_project_access"]({"project_id":"guest", "access":"public"})
        self.assertEqual(self.emit.call_args.args[1]["status"], "error")
        self.session["user"] = {"id":"B"}
        self.events["update_project_access"]({"project_id":"guest", "author_id":"A", "access":"private"})
        row = self.db.execute("SELECT author_id,access FROM project WHERE id='guest'").fetchone()
        self.assertEqual(tuple(row), ("B","private"))
        self.assertNotIn("claim_project_id", self.session)

    def test_temporary_deletion_removes_related_rows(self):
        self.session["claim_project_id"] = "guest"
        # Only the lookup function needs Flask for its not-found path; row exists here.
        self.events["handle_delete_temporary_project"]({"project_id":"guest"})
        self.assertIsNone(self.db.execute("SELECT id FROM project WHERE id='guest'").fetchone())
        for table in ("iodata","metabolism","prompt"):
            self.assertEqual(self.db.execute(f"SELECT count(*) FROM {table} WHERE project_id='guest'").fetchone()[0],0)
        self.assertIsNotNone(self.db.execute("SELECT id FROM project WHERE id='private'").fetchone())
        self.assertNotIn("claim_project_id",self.session)

    def test_owner_delete_and_cross_account_delete(self):
        self.session["user"] = {"id":"B"}
        self.assertIsNone(self.model.delete_project("private", author_id="A"))
        self.session["user"] = {"id":"A"}
        self.assertEqual(self.model.delete_project("private", author_id="A"),"private")
        self.assertEqual(self.db.execute("SELECT count(*) FROM iodata WHERE project_id='private'").fetchone()[0],0)

    def test_logout_account_switch_and_deleted_user_deny(self):
        self.session["user"] = {"id":"A"}
        self.assertTrue(self.model.can_mutate_project("private"))
        self.session.clear()
        self.assertFalse(self.model.can_mutate_project("private"))
        self.session["user"] = {"id":"B"}
        self.assertFalse(self.model.can_mutate_project("private"))
        self.session["user"] = {"id":"A"}
        self.db.execute("DELETE FROM user WHERE id='A'")
        self.assertFalse(self.model.can_mutate_project("private"))

if __name__ == "__main__":
    unittest.main()
