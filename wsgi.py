from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file

from flaskr import create_app, socketio

app = create_app()

if __name__ == '__main__':
    socketio.run(
        app, 
        host='127.0.0.1', 
        port=8000, 
        debug=True
    )
