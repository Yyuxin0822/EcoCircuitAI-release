"""Offline tests: python -m unittest discover -s tests -p test_thumbnail_refresh.py"""
import ast
import json
import logging
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]

def load_function(path, name, namespace):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    function = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
    function.decorator_list = []
    exec(compile(ast.Module(body=[function], type_ignores=[]), path, "exec"), namespace)
    return namespace[name]

class ThumbnailTests(unittest.TestCase):
    def test_each_thumbnail_is_freshly_signed_without_database_or_http(self):
        s3 = Mock()
        s3.generate_presigned_url.side_effect = ["fresh-io", "fresh-metabolism"]
        model = Mock()
        http = Mock()
        function = load_function("flaskr/ecocircuit/method/_task/image.py", "s3_genurl", {
            "s3": s3, "model": model, "requests": http, "logging": logging,
            "current_app": SimpleNamespace(config={"PRESIGNED_TTL_SECONDS": 518400})})
        self.assertEqual(function("p_matrix_io.jpg", isThumbnails=True), "fresh-io")
        self.assertEqual(function("p_matrix_metabolism.jpg", isThumbnails=True), "fresh-metabolism")
        self.assertEqual(s3.generate_presigned_url.call_count, 2)
        self.assertEqual(s3.generate_presigned_url.call_args.kwargs["ExpiresIn"], 900)
        self.assertEqual(model.mock_calls, [])
        self.assertEqual(http.mock_calls, [])

    def test_invalid_thumbnail_name_not_signed(self):
        s3 = Mock()
        function = load_function("flaskr/ecocircuit/method/_task/image.py", "s3_genurl", {"s3": s3})
        self.assertIsNone(function("p_other.jpg", isThumbnails=True))
        s3.generate_presigned_url.assert_not_called()

    def test_access_matrix_before_signing(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE project (id TEXT, author_id TEXT, access TEXT)")
        db.executemany("INSERT INTO project VALUES (?, ?, ?)", [
            ("private", "A", "private"), ("public", "A", "public"),
            ("temp", None, "temporary")])
        class G(dict):
            @property
            def user(self):
                return self.get("user")
        class Response:
            def __init__(self, data):
                self.data, self.headers = data, {}
        g, session = G(), {}
        signer = Mock(return_value="signed-url")
        module = SimpleNamespace(ImageTask=SimpleNamespace(s3_genurl=signer))
        function = load_function("flaskr/ecocircuit/routes.py", "regenerate_thumbnail", {
            "get_db": lambda: db, "g": g, "session": session, "jsonify": Response})
        cases = [
            ("private", "A", None, 200), ("private", "B", None, 403),
            ("private", None, None, 403), ("public", None, None, 200),
            ("temp", None, "temp", 200), ("temp", None, None, 403),
            ("missing", "A", None, 404)]
        with patch.dict(sys.modules, {"flaskr.ecocircuit.method": module}):
            for project, user, claim, expected in cases:
                with self.subTest(project=project, user=user, claim=claim):
                    signer.reset_mock()
                    g["user"] = {"id": user} if user else None
                    session.clear()
                    if claim:
                        session["claim_project_id"] = claim
                    response, status = function(project)
                    self.assertEqual(status, expected)
                    self.assertEqual(signer.call_count, 2 if expected == 200 else 0)
                    if expected == 200:
                        self.assertEqual(response.headers["Cache-Control"], "private, no-store")

    def test_listing_has_no_network_refresh(self):
        tree = ast.parse((ROOT / "flaskr/account/models.py").read_text(encoding="utf-8"))
        f = next(n for n in tree.body if getattr(n, "name", "") == "get_user_projects")
        self.assertNotIn("s3_genurl", ast.unparse(f))

if __name__ == "__main__":
    unittest.main()
