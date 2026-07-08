#!/bin/bash
set -e

echo "⏳ Aguardando PostgreSQL em ${DB_HOST}:${DB_PORT}..."
until python -c "
import psycopg2, os, sys
try:
    psycopg2.connect(
        dbname=os.environ['DB_NAME'],
        user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'],
        host=os.environ['DB_HOST'],
        port=os.environ['DB_PORT'],
    )
except Exception as e:
    sys.exit(1)
" 2>/dev/null; do
  echo "  banco não disponível ainda, tentando novamente em 2s..."
  sleep 2
done

echo "✅ PostgreSQL pronto!"

echo "🔄 Aplicando migrações..."
python manage.py migrate --noinput

echo "📦 Coletando arquivos estáticos..."
python manage.py collectstatic --noinput --clear 2>/dev/null || true

echo "🚀 Iniciando Django..."
exec "$@"
