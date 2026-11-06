import os
from flask import (
    Flask,
    abort,
    app,
    flash,
    session,
    request,
    redirect,
    url_for,
    current_app,
    g,
    jsonify,
)
from flask_socketio import SocketIO, emit, disconnect
from flask_cors import CORS
from flask_session import Session
from werkzeug.middleware.proxy_fix import ProxyFix

socketio = SocketIO(
    cors_allowed_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://www.ecocircuitai.com",
    ],
    ping_timeout=600,
    ping_interval=250,
    transports=["websocket", "polling"],
    manage_session=False,
    async_mode="eventlet",
    max_http_buffer_size=20 * 1024 * 1024,
)  # Allow all origins for SocketIO


def create_app(test_config=None):
    # create and configure the app
    app = Flask(
        __name__,
        instance_relative_config=True,
        static_folder="static",
        template_folder="templates",
    )
    
    # Configure app to trust proxy headers from nginx
    # This fixes HTTPS detection for Auth0 callbacks
    app.wsgi_app = ProxyFix(
        app.wsgi_app, 
        x_for=1, 
        x_proto=1, 
        x_host=1, 
        x_prefix=1
    )

    if test_config:
        app.config.update(test_config)

    app.config.from_mapping(
        SECRET_KEY=os.getenv("APP_SECRET_KEY"),
        DATABASE=os.path.join(app.instance_path, "flaskr.sqlite"),
        # Auth0 Configuration
        AUTH0_CLIENT_ID=os.getenv("AUTH0_CLIENT_ID"),
        AUTH0_CLIENT_SECRET=os.getenv("AUTH0_CLIENT_SECRET"),
        AUTH0_DOMAIN=os.getenv("AUTH0_DOMAIN"),
    )

    app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MiB per HTTP request

    if test_config is None:
        # load the instance config, if it exists, when not testing
        app.config.from_pyfile("config.py", silent=True)
    else:
        # load the test config if passed in
        app.config.from_mapping(test_config)

    # ensure the instance folder exists
    try:
        os.makedirs(app.instance_path)
    except OSError:
        pass

    app.config["SESSION_TYPE"] = "filesystem"
    app.config["SESSION_PERMANENT"] = False
    app.config["SESSION_USE_SIGNER"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SECURE"] = not app.debug  # True in production, False in development
    app.config["PERMANENT_SESSION_LIFETIME"] = 1800  # 30 minutes session timeout
    app.config["CACHE_MAX_AGE"] = 3600  # 1 hour
    app.config["PRESIGNED_TTL_SECONDS"] = 518400  # 6 days
    app.config["SAFE_BUFFER"] = 300  # 5 minutes
    # Apply CORS to your Flask app with support for all origins
    CORS(app, supports_credentials=True)  # Enable CORS for all routes
    Session(app)
    socketio.init_app(app)

    @app.before_request
    def store_prev_url():
        # Don't store auth0 routes to prevent circular redirects after login
        if not request.path.startswith('/auth0'):
            session["prev_url"] = request.url

    @app.before_request
    def set_test_user():
        # Only set test user if in testing mode AND no real user is logged in
        if current_app.config.get("TESTING", False) and not session.get("user"):
            session["user"] = {"id": "test_user_uuid", "username": "testuser"}

    import logging

    logging.basicConfig(
        level=logging.DEBUG,
        filename="./logs/test_debug_errorlog.log",
        filemode="a",
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    # # Handling 400 error (Bad Request)
    # @app.errorhandler(400)
    # def bad_request(error):
    #     # Redirecting back to the previous page
    #     if session.get('prev_url') == request.url:
    #         return redirect(url_for('index'))  # Redirect to homepage if current and prev URLs match
    #     return redirect(session.get('prev_url', url_for('index')))

    @app.errorhandler(404)
    def handle_not_found(error):
        # A fixed public destination avoids login and previous-URL redirect loops.
        return redirect(url_for("ecocircuit.index", skip_redirect=1), code=303)

    # @app.errorhandler(413)
    # def file_size_too_large(error):
    #     # Redirecting back to the previous page
    #     if session.get('prev_url') == request.url:
    #         return redirect(url_for('index'))  # Redirect to homepage if current and prev URLs match
    #     return redirect(session.get('prev_url', url_for('index')))

    # @app.errorhandler(504)
    # def handle_504_error(e):
    #     flash('The server was timed out. Please try again')
    #     # Redirect to previous page or to a default one if referrer is not set
    #     if session.get('prev_url') == request.url:
    #         return redirect(url_for('index'))  # Redirect to homepage if current and prev URLs match
    #     return redirect(session.get('prev_url', url_for('index')))

    if not app.debug:
        import logging
        from logging import FileHandler

        # set filemode to append
        file_handler = FileHandler("./logs/errorlog.txt", mode="a")
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(
            logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
        )
        app.logger.addHandler(file_handler)

    from . import db

    db.init_app(app)



    from flaskr.ecocircuit import ecocircuit_bp

    app.register_blueprint(ecocircuit_bp, url_prefix="/ecocircuit")



    from flaskr.auth0 import auth0_bp, init_oauth

    app.register_blueprint(auth0_bp, url_prefix="/auth0")
    init_oauth(app)

    from flaskr.account import account_bp

    app.register_blueprint(account_bp, url_prefix="/account")

    from flask import g, session

    @app.before_request
    def load_logged_in_user():
        g.user = session.get("user") or None
        
        
    @app.after_request
    def add_security_headers(response):
        # Add cache control headers for authenticated routes
        if session.get('user'):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        
        # Add general security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        
        return response

    @app.route("/")
    def index():
        print("DEBUG: going through the index route")
        print("DEBUG: current user:", g.user)
        # If user is not logged in, add skip_redirect to prevent redirect loops after logout
        if not g.user:
            print("DEBUG: user not logged in, adding skip_redirect")
            return redirect(url_for("ecocircuit.index", skip_redirect=1))
        return redirect(url_for("ecocircuit.index"))


    return app

