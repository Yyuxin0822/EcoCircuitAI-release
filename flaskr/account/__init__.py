from flask import Blueprint

account_bp = Blueprint("account", __name__, template_folder="templates", static_folder="static")

from flaskr.account import routes, events
