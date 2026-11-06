# Setup Guide

[Back to the README](../README.md)

The steps below target local development on Ubuntu with Python 3.10.
SQLite stores application data in a local file; a separate database server is
not required. Run all commands from the repository root.

The application also uses external services: Auth0 for sign-in, OpenAI for
generation, and AWS S3 for images and thumbnails. A fresh database does not
contain the projects hosted on the live website.

### 1. Create a virtual environment and install dependencies

After cloning this repository and entering its root directory:

```bash
python3.10 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip check
```

The application runs directly from the checkout; an editable installation is
not required. `requirements.txt` contains the application dependencies and
compatibility pins. For development, install `requirements-dev.txt` instead;
it includes the runtime requirements and pytest. Notebook and experiment
dependencies are not required.

### 2. Configure secrets and external services

Create an untracked `.env` file in the repository root:

```dotenv
APP_SECRET_KEY=replace-with-a-random-secret
FERNET_SECRET_KEY=replace-with-a-generated-fernet-key
OPENAI_API_KEY=replace-with-your-server-openai-api-key

AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=replace-with-your-client-id
AUTH0_CLIENT_SECRET=replace-with-your-client-secret

AWS_DEFAULT_REGION=replace-with-your-bucket-region
```

Generate the application secret and Fernet key separately, then copy the
respective outputs into `.env`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep the Fernet key stable: it encrypts API keys saved in the database.
The server OpenAI key is required when the application imports its API clients.
Users also save their own OpenAI API key through the account interface for
generation; the server key is used for image generation with
`gpt-image-2.5-flare` (1024 × 1024, medium quality). The server API account must
have access to this model. Generated image bytes are saved as JPEGs in S3.

Configure your Auth0 application for the local address you will use:

- Allowed callback URL: `http://127.0.0.1:8000/auth0/callback`
- Allowed logout URL: `http://127.0.0.1:8000/`
- Allowed web origin: `http://127.0.0.1:8000`

If you use `localhost` or a different forwarded port, register those exact
addresses as well.

For AWS, use an IAM role, an AWS credentials profile, or the standard
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables.
Temporary credentials also require `AWS_SESSION_TOKEN`.
The credentials must permit the image operations your deployment performs.

**S3 configuration limitation:** image uploads and presigned URLs currently
default to the bucket `ecocircuit` in
`flaskr/ecocircuit/method/_task/image.py`. The image-proxy allowlist in
`flaskr/ecocircuit/resource_safety.py` also names that bucket. To use your own
bucket, update both locations consistently; setting an `S3_BUCKET` environment
variable alone has no effect in the current code.

### 3. Prepare logs and local configuration

```bash
mkdir -p logs instance
```

The app writes logs relative to the repository root, including
`logs/test_debug_errorlog.log`, `logs/errorlog.txt`, and
`logs/ecocircuit_usage.log`. The log directory must exist before app creation.

For local HTTP development, create `instance/config.py` with:

```python
DEBUG = True
```

This sets debug mode before session configuration is created, allowing local
HTTP sessions. Passing `debug=True` later in `wsgi.py` does not recalculate the
session cookie setting. Do not use this local debug configuration for production.

The `.env`, `instance/`, `logs/`, and `flask_session/` paths are ignored by Git.

### 4. Initialize a fresh database

Only for a new installation with no existing application database:

```bash
python -m flask --app wsgi:app init-db
```

This creates `instance/flaskr.sqlite` using `flaskr/schema.sql`.
**Do not run this against an existing database:** the schema drops some tables,
and initialization is not repeatable on an already initialized database.
Back up existing data and use a separate migration procedure for upgrades.

### 5. Prepare image exports

PNG/JPEG diagram exports use pyppeteer and its Chromium browser. Download the
browser using the same environment and OS user that will run the app:

```bash
pyppeteer-install
```

Ubuntu also needs the system libraries required to launch Chromium. A successful
Python package installation alone does not verify browser availability; check an
actual diagram export on the target machine.

### 6. Start the application

```bash
python wsgi.py
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/).
The terminal stays occupied while the server runs.

For a remote machine, forward remote port `8000` through SSH or VS Code and
open the forwarded local address. The server binds to the remote machine's
loopback address; a browser on your laptop needs that forwarding connection.

No frontend build is required for the current templates. Frontend libraries
are loaded from CDNs, so browser access to those services is needed.

### 7. Check the setup

In a second terminal on the server:

```bash
curl -L --max-time 15 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/
```

A completed `200` response verifies that the landing page is served. Also check
Auth0 sign-in, saving an API key, generating a project, uploading an image, and
exporting a diagram to verify the external-service and browser integrations.

These instructions are based on the checked-in code. Full Auth0, OpenAI, S3,
and Chromium validation requires a configured target environment.
