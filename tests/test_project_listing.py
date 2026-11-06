"""Run with: python -m unittest discover -s tests -p test_project_listing.py"""
import ast
import sqlite3
import unittest
from pathlib import Path


class ProjectListingTests(unittest.TestCase):
    def setUp(self):
        # Exercise the actual listing SQL without Flask, S3, or live credentials.
        source = (Path(__file__).resolve().parents[1] / "flaskr/account/models.py").read_text(encoding="utf-8")
        function = next(n for n in ast.parse(source).body
                        if isinstance(n, ast.FunctionDef) and n.name == "get_user_projects")
        query_call = next(n for n in ast.walk(function)
                          if isinstance(n, ast.Call)
                          and isinstance(n.func, ast.Attribute)
                          and n.func.attr == "execute")
        self.query = ast.literal_eval(query_call.args[0])
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript("""
            CREATE TABLE project (
                id TEXT, author_id TEXT, title TEXT, type TEXT, info TEXT,
                system TEXT, access TEXT, thumbnails TEXT, thumbnails_expires_at INTEGER
            );
            CREATE TABLE iodata (project_id TEXT, iodata TEXT);
            CREATE TABLE metabolism (project_id TEXT, metabolism TEXT);
        """)

    def add(self, identifier, owner="A", io=True, metabolism=True):
        self.db.execute("INSERT INTO project (id, author_id) VALUES (?, ?)", (identifier, owner))
        if io:
            self.db.execute("INSERT INTO iodata VALUES (?, ?)", (identifier, "[]"))
        if metabolism:
            self.db.execute("INSERT INTO metabolism VALUES (?, ?)", (identifier, "[]"))

    def ids(self, owner="A"):
        return [row[0] for row in self.db.execute(self.query, (owner,))]

    def test_completed_project_visible_and_other_owner_excluded(self):
        self.add("a")
        self.add("b", owner="B")
        self.assertEqual(self.ids(), ["a"])
        self.assertEqual(self.ids("B"), ["b"])

    def test_incomplete_and_null_data_hidden_without_deleting(self):
        self.add("neither", io=False, metabolism=False)
        self.add("no_io", io=False)
        self.add("no_metabolism", metabolism=False)
        self.add("null_io", io=False)
        self.db.execute("INSERT INTO iodata VALUES ('null_io', NULL)")
        self.add("null_metabolism", metabolism=False)
        self.db.execute("INSERT INTO metabolism VALUES ('null_metabolism', NULL)")
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.db.execute("SELECT count(*) FROM project").fetchone()[0], 5)

    def test_project_appears_after_generation_finishes(self):
        self.add("pending", metabolism=False)
        self.assertEqual(self.ids(), [])
        self.db.execute("INSERT INTO metabolism VALUES ('pending', '[]')")
        self.assertEqual(self.ids(), ["pending"])

    def test_duplicate_related_rows_do_not_duplicate_cards(self):
        self.add("a")
        self.db.execute("INSERT INTO iodata VALUES ('a', '[]')")
        self.db.execute("INSERT INTO metabolism VALUES ('a', '[]')")
        self.assertEqual(self.ids(), ["a"])


if __name__ == "__main__":
    unittest.main()
