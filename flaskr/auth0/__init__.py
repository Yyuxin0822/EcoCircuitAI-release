from flask import Blueprint
from authlib.integrations.flask_client import OAuth

auth0_bp = Blueprint("auth0", __name__)
oauth = OAuth()


def init_oauth(app):
    oauth.init_app(app)

    # Register Auth0 client here (AFTER OAuth is initialized with the Flask app)
    oauth.register(
        "auth0",
        client_id=app.config["AUTH0_CLIENT_ID"],
        client_secret=app.config["AUTH0_CLIENT_SECRET"],
        client_kwargs={
            "scope": "openid profile email",
        },
        server_metadata_url=f'https://{app.config["AUTH0_DOMAIN"]}/.well-known/openid-configuration',
    )

    # Attach oauth instance to Blueprint for easy access later
    auth0_bp.oauth = oauth


from flaskr.auth0 import routes
