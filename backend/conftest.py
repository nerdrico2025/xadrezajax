import django

# Aplica SECRET_KEY longa globalmente para evitar InsecureKeyLengthWarning
# do PyJWT ao gerar tokens. Funciona tanto para testes pytest quanto unittest.
_STRONG_SECRET = "t3st-s3cr3t-k3y-l0ng-3n0ugh-f0r-jwt-32byt3s!"

django.conf.settings.SECRET_KEY = _STRONG_SECRET
