# EcoCircuit AI

EcoCircuit AI is a web application that helps users go from text to integrated environmental systems.
Powered by a large language model (LLM), EcoCircuit generates an environmental mind map using a systems engineering chain / tree of thoughts. It helps users navigate the complexity of technical black boxes by following the classic systems engineering model, with inputs, outputs, processes, co-optimization, and a regeneration loop, to provide users with ideas to doodle on later.

## Test Cases

### Case 1: A floating city

[Explore the project](https://www.ecocircuitai.com/ecocircuit/b40b2ef3-43e8-4a86-a002-3190638aca54)

![Environmental systems diagram for a floating city](docs/images/matrix-io_the%20floating%20city.png)

### Case 2: English Station revitalization

A prompt developed in collaboration with a user from Grimshaw Architects.

[Explore the project](https://www.ecocircuitai.com/ecocircuit/fb64cae9-4906-4fc7-9e66-3d8a2e3b4abc)

![Environmental systems diagram for English Station revitalization](docs/images/matrix-io%20%2814%29.png)

## Application structure

- `flaskr/ecocircuit/` — environmental system generation and visualization
- `flaskr/account/` — account settings, API-key management, and projects
- `flaskr/auth0/` — authentication
- `flaskr/db.py` and `flaskr/schema.sql` — database access and schema
- `flaskr/static/` and `flaskr/templates/` — shared frontend resources
- `wsgi.py` — application entry point

The release includes EcoCircuit, accounts, and authentication only. 

## Quick start

Use Python 3.10 on Ubuntu. From the repository root:

```bash
python3.10 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
mkdir -p logs instance
```

Before starting, follow the [setup guide](docs/setup.md) to configure
`.env`, Auth0, AWS S3, local HTTP sessions, and Chromium for image exports.

For a **new installation only**, initialize the database and start the app:

```bash
python -m flask --app wsgi:app init-db
python wsgi.py
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/).
Do not run `init-db` against an existing database.

## Development

Tests are optional when running the app. To work on the code:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest
```

With Node.js 18 or newer, run the frontend checks without installing npm packages:

```bash
node --test tests/test_project_exports.cjs tests/test_project_thumbnails.cjs
```

## License

See [LICENSE](LICENSE).
