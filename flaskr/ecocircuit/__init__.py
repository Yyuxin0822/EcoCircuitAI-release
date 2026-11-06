from flask import Blueprint
ecocircuit_bp = Blueprint("ecocircuit", __name__, template_folder="templates", static_folder="static")

from flaskr.ecocircuit import routes