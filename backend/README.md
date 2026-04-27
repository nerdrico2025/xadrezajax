python -m venv .venv
source .venv/bin/activate

pip install django psycopg2-binary python-dotenv djangorestframework

pip freeze > requirements.txt

django-admin startproject core .
