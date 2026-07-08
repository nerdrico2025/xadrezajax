#!/bin/bash
# Valida que todas as variáveis obrigatórias estão definidas no .env

set -e

REQUIRED_VARS=(
  DB_NAME DB_USER DB_PASSWORD DB_HOST DB_PORT
  SECRET_KEY DEBUG ALLOWED_HOSTS
  REDIS_URL
  EXPO_PUBLIC_API_URL EXPO_PUBLIC_NODE_URL
)

MISSING=()

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌ Variáveis obrigatórias não definidas no .env:"
  for v in "${MISSING[@]}"; do
    echo "   - $v"
  done
  exit 1
fi

echo "✅ Todas as variáveis de ambiente estão configuradas."
