"""Minimal fixtures for database lifecycle tests; no external services."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def db_module():
    spec = importlib.util.spec_from_file_location("ecocircuit_test_db", ROOT / "flaskr/db.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def app(tmp_path, db_module):
    from flask import Flask
    app = Flask("database_tests")
    app.config.update(TESTING=True, DATABASE=str(tmp_path / "test.sqlite"))
    db_module.init_app(app)
    yield app


@pytest.fixture
def runner(app):
    return app.test_cli_runner()
