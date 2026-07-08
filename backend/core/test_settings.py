from .settings import *  # noqa: F401, F403

# Troca Redis por cache em memória — sem precisar de container redis nos testes
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}
