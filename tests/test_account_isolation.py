"""Offline account checks: python -m unittest discover -s tests -p test_account_isolation.py"""
import ast
import json
import sqlite3
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]

def load(path, namespace):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    for f in functions:
        f.decorator_list = []
    exec(compile(ast.Module(body=functions, type_ignores=[]), path, "exec"), namespace)

class Session(dict):
    modified = False

class AccountTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript("""
            CREATE TABLE user(id TEXT,auth0_id TEXT,email TEXT,name TEXT);
            INSERT INTO user VALUES ('A','auth0|A','a@example.test','Alice'),('B','auth0|B','b@example.test','Bob');
            CREATE TABLE user_api_key(id INTEGER PRIMARY KEY,user_id TEXT,api_key TEXT,updated_at TEXT);
            INSERT INTO user_api_key(user_id,api_key) VALUES ('A','encrypted-A');
            CREATE TABLE user_consent(user_id TEXT,consent_given INTEGER,ip_address TEXT);
            INSERT INTO user_consent VALUES ('A',1,'test'),('B',1,'test');
            CREATE TABLE project(id TEXT,author_id TEXT);
            INSERT INTO project VALUES ('pA','A'),('pB','B');
            CREATE TABLE iodata(project_id TEXT);
            CREATE TABLE metabolism(project_id TEXT);
            CREATE TABLE prompt(project_id TEXT);
            INSERT INTO iodata VALUES ('pA'),('pB');
            INSERT INTO metabolism VALUES ('pA'),('pB');
            INSERT INTO prompt VALUES ('pA'),('pB');
        """)
        self.session = Session(user={"id":"A", "sub":"auth0|A"}, encrypted_api_key="encrypted-A")
        ns = {"get_db":lambda:self.db, "decrypt_key":lambda key:"sk-private-middle-YFwA"}
        load("flaskr/account/models.py",ns)
        self.model = SimpleNamespace(**{k:v for k,v in ns.items() if callable(v)})
        self.req = SimpleNamespace(method="DELETE",form={},headers={},remote_addr="test")
        self.g = SimpleNamespace(user=self.session["user"])
        class RequestException(Exception):
            pass
        self.requests = SimpleNamespace(RequestException=RequestException,delete=Mock())
        self.requests.delete.return_value = SimpleNamespace(status_code=204,raise_for_status=Mock())
        self.authutil = SimpleNamespace(get_auth0_mgmt_token=Mock(return_value="secret-token"))
        self.ns = {"model":self.model,"g":self.g,"session":self.session,"request":self.req,
            "jsonify":lambda data:data,"render_template":lambda name,**kw:kw,
            "encrypt_key":lambda key:"encrypted:"+key,
            "authenticate_openai_key":Mock(return_value=(True,"")),
            "requests":self.requests,"auth0_util":self.authutil,
            "current_app":SimpleNamespace(config={"AUTH0_DOMAIN":"example.test"},logger=Mock()),
            "url_for":lambda name,**kw:name,"redirect":lambda url:url,"flash":Mock()}
        load("flaskr/account/routes.py",self.ns)

    def test_key_page_only_sends_preview(self):
        self.assertEqual(self.ns["api_key"](),{"api_key":"sk-...YFwA"})
        self.g.user = {"id":"B"}
        self.assertEqual(self.ns["api_key"](),{"api_key":None})

    def test_key_delete_is_scoped_and_clears_session_even_if_absent(self):
        self.ns["api_key_crud"]()
        self.assertNotIn("encrypted_api_key",self.session)
        self.assertFalse(self.model.has_user_api_key("A"))
        self.assertEqual(self.ns["api_key_crud"]()[1],200)

    def test_key_save_no_secret_response_and_ignores_submitted_user(self):
        self.req.form = {"api_key":"fake-key","consent":"on","user_id":"B","from_401":"true"}
        response,status = self.ns["store_key"]()
        self.assertEqual(status,200)
        self.assertNotIn("fake-key",json.dumps(response))
        self.assertFalse(self.model.has_user_api_key("B"))
        self.assertEqual(self.db.execute("SELECT api_key FROM user_api_key WHERE user_id='A'").fetchone()[0],"encrypted:fake-key")

    def test_missing_key_does_not_call_provider(self):
        self.assertEqual(self.ns["store_key"]()[1],400)
        self.ns["authenticate_openai_key"].assert_not_called()

    def test_callback_switch_clears_previous_key(self):
        auth = Mock()
        auth.userinfo.return_value = {"sub":"auth0|B","name":"Bob","email":"b@example.test"}
        ns = {"__package__":"flaskr.auth0","auth0_bp":SimpleNamespace(oauth=SimpleNamespace(create_client=lambda name:auth)),
            "session":self.session,"get_db":lambda:self.db,"uuid":uuid,
            "redirect":lambda url:url,"url_for":lambda name,**kw:name}
        load("flaskr/auth0/routes.py",ns)
        with patch.dict(sys.modules,{"flaskr.auth0.utils":SimpleNamespace(is_safe_url=lambda url:True)}):
            ns["callback"]()
        self.assertEqual(self.session["user"]["id"],"B")
        self.assertNotIn("encrypted_api_key",self.session)

    def test_delete_provider_failure_preserves_local_data(self):
        self.requests.delete.side_effect=self.requests.RequestException()
        result,status=self.ns["delete_account"]()
        self.assertEqual(status,502)
        self.assertIsNotNone(self.db.execute("SELECT id FROM user WHERE id='A'").fetchone())
        self.assertTrue(self.model.has_user_api_key("A"))

    def test_delete_success_cleans_only_owner_records(self):
        self.req.form={"user_id":"B"}
        result,status=self.ns["delete_account"]()
        self.assertEqual(status,200)
        self.assertEqual(self.session,{})
        self.assertIsNone(self.db.execute("SELECT id FROM user WHERE id='A'").fetchone())
        self.assertIsNotNone(self.db.execute("SELECT id FROM user WHERE id='B'").fetchone())
        for table in ("iodata","metabolism","prompt"):
            self.assertEqual([r[0] for r in self.db.execute(f"SELECT project_id FROM {table}")],["pB"])
        self.assertTrue(self.requests.delete.call_args.kwargs["timeout"])

    def test_username_scoped_validated_and_deleted_account_denied(self):
        ns={"session":self.session,"account_models":self.model}
        load("flaskr/account/events.py",ns)
        self.assertEqual(ns["handle_update_username"]({"name":"Updated","id":"B"})["status"],"ok")
        self.assertEqual(self.db.execute("SELECT name FROM user WHERE id='B'").fetchone()[0],"Bob")
        self.assertIn("error",ns["handle_update_username"]([]))
        self.assertIn("error",ns["handle_update_username"]({"name":[]}))
        self.db.execute("DELETE FROM user WHERE id='A'")
        self.assertIn("error",ns["handle_update_username"]({"name":"Again"}))

    def test_local_delete_failure_rolls_back_related_rows(self):
        self.db.executescript("""
            CREATE TRIGGER prevent_user_delete BEFORE DELETE ON user
            BEGIN SELECT RAISE(ABORT, 'test failure'); END;
        """)
        result,status=self.ns["delete_account"]()
        self.assertEqual(status,500)
        self.assertTrue(self.model.has_user_api_key("A"))
        self.assertIsNotNone(self.db.execute("SELECT project_id FROM iodata WHERE project_id='pA'").fetchone())
        self.assertIn("user",self.session)

if __name__ == "__main__":
    unittest.main()
