from .settings import REST_FRAMEWORK
from .settings import *  # noqa: F401, F403

# Troca Redis por cache em memória — sem precisar de container redis nos testes
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# Desliga rate-limiting nos testes: a suíte completa excede 20 req/min
# anônimas e o AnonRateThrottle devolve 429 em testes legítimos.
# Os escopos precisam continuar existindo (taxa None = sem limite):
# escopo ausente faz o ScopedRateThrottle das views levantar ImproperlyConfigured.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {
        scope: None for scope in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    },
}
