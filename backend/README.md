python -m venv .venv
.venv\Scripts\activate

cd backend
pip install django psycopg2-binary python-dotenv djangorestframework

pip freeze > requirements.txt


pip install -r requirements.txt
django-admin startproject core .
