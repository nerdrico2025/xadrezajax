#!/bin/sh
set -e

# Substitui apenas ${DOMAIN} no template — as variáveis internas do nginx ($host,
# $request_uri, etc.) são preservadas porque não estão na lista de substituição.
envsubst '${DOMAIN}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
