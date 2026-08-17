from pathlib import Path
import os
from dotenv import load_dotenv
from datetime import timedelta

from core.env import env_bool, env_price

# ========================
# BASE DIR
# ========================
BASE_DIR = Path(__file__).resolve().parent.parent

# ========================
# LOAD ENV
# ========================
env_path = BASE_DIR / ".env"
load_dotenv(env_path)

# ========================
# SECURITY
# ========================
SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY:
    raise Exception("SECRET_KEY não encontrada no .env")

# NÃO passa por `env_bool` de propósito, ao contrário das flags de feature.
# `env_bool` é mais permissivo, e para DEBUG "mais permissivo" aponta para o
# lado errado: hoje um `DEBUG=true` em produção resulta em False (seguro);
# afrouxar isso faria o mesmo valor LIGAR o debug num servidor público.
DEBUG = os.getenv("DEBUG", "False") == "True"

ALLOWED_HOSTS = [
    host.strip() for host in os.getenv("ALLOWED_HOSTS", "").split(",") if host.strip()
]

# ========================
# STRIPE (item 0.1 — assinaturas)
# Sem crash de boot se ausentes: as views validam e retornam erro claro.
# STRIPE_WEBHOOK_SECRET só passa a existir depois de cadastrar o endpoint
# de webhook no Dashboard do Stripe.
# ========================
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET") or None
STRIPE_PRICE_IDS = {
    "monthly": os.getenv("STRIPE_PRICE_ID_MENSAL", ""),
    "annual": os.getenv("STRIPE_PRICE_ID_ANUAL", ""),
}

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID") or os.getenv(
    "EXPO_PUBLIC_GOOGLE_CLIENT_ID", ""
)

# ========================
# APPS
# ========================
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
]

LOCAL_APPS = [
    "apps.users",
    "apps.puzzles",
    "apps.payments",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ========================
# MIDDLEWARE
# ========================
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "core.wsgi.application"

# ========================
# DATABASE
# ========================
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME"),
        "USER": os.getenv("DB_USER"),
        "PASSWORD": os.getenv("DB_PASSWORD"),
        "HOST": os.getenv("DB_HOST", "localhost"),
        "PORT": os.getenv("DB_PORT", "5432"),
    }
}

# ========================
# AUTH
# ========================
AUTH_USER_MODEL = "users.User"

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",  # noqa: E501
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# ========================
# REDIS
# ========================
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        },
    }
}

# ========================
# DRF + JWT
# ========================
REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "core.exceptions.custom_exception_handler",
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "20/minute",
        "password_reset_req": "3/hour",
        "password_reset_verify": "15/hour",
        # Geração de comentário por LLM: cada uma custa dinheiro de verdade.
        # O teto por PARTIDA é o MAX_ATTEMPTS do model; este aqui é o outro
        # eixo — um usuário disparando geração em muitas partidas seguidas.
        "llm_feedback": "10/hour",
        # Validação de lance de problema. É teto por VELOCIDADE, não por
        # tentativa: o Treino é ilimitado por regra de produto, então a
        # contagem de tentativas sozinha não impede um script de varrer lances
        # na velocidade da rede. 30/min é folgado para quem joga com a mão
        # (um lance por ~2s) e fecha a porta para automação.
        "puzzle_check_move": "30/minute",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
}

# ========================
# INTERNATIONALIZATION
# ========================
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

# ========================
# STATIC
# ========================
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ========================
# MEDIA (avatars)
# ========================
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# O TLS termina no proxy (nginx/Cloudflare); sem honrar o X-Forwarded-Proto
# que o nginx envia, request.build_absolute_uri() monta URLs absolutas (ex.:
# avatar) com http:// — e o app recusa a imagem por mixed content.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ========================
# DEFAULT AUTO FIELD
# ========================
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ========================
# CORS
# ========================
# Em dev (DEBUG=True) aceita qualquer origem — conveniente para testar no celular.
# Em produção só aceita as origens listadas em CORS_ALLOWED_ORIGINS no .env.
CORS_ALLOW_ALL_ORIGINS = DEBUG

if not DEBUG:
    CORS_ALLOWED_ORIGINS = [
        o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]

CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "ngrok-skip-browser-warning",
]

# ========================
# INTERNAL API SECRET (node-api → backend)
# ========================
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")

# ========================
# ANÁLISE PÓS-JOGO (Fase 2)
# ========================
# DESLIGADA por padrão, de propósito. A análise divide CPU física com as
# partidas ao vivo na mesma VPS; ligar é decisão a ser tomada OLHANDO o
# `engine.queued` do /health do node-api, não no escuro. Com a flag desligada
# nenhuma GameAnalysis é criada e os endpoints internos ficam ociosos.
#
# `env_bool` (não `== "True"`) porque o node-api lê ESTA MESMA variável e
# comparava com `"true"` minúsculo: setar o mesmo valor nos dois serviços
# ligava um e deixava o outro desligado, em silêncio. Os dois lados agora
# aceitam o mesmo conjunto.
POST_GAME_ANALYSIS_ENABLED = env_bool("POST_GAME_ANALYSIS_ENABLED")

# ========================
# COMENTÁRIO HUMANIZADO / LLM (Fase 3)
# ========================
# Flag PRÓPRIA, separada da Fase 2 de propósito: a análise Stockfish gasta CPU
# nossa, esta gasta DINHEIRO por chamada. São decisões de ligar diferentes, e
# uma não pode arrastar a outra. `env_bool` pelo mesmo motivo da Fase 2.
LLM_FEEDBACK_ENABLED = env_bool("LLM_FEEDBACK_ENABLED")

# Provedor: OpenRouter (roteia para vários modelos atrás de uma API só
# compatível com a da OpenAI). Chave vazia = feature inerte, mesmo com a flag
# ligada (ver `llm_feedback_enabled()`): sem chave a chamada falharia de
# qualquer jeito, e falhar no portão é melhor do que gastar uma tentativa para
# descobrir isso.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# BASE da API, sem o caminho do endpoint — o cliente acrescenta
# `/chat/completions`. Guardar a base (e não a URL inteira, como era antes)
# é o que permite trocar de provedor compatível mexendo só nesta variável.
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

# Em variável para trocar de modelo sem deploy — que é justamente o caminho
# previsto quando o `:free` não der mais conta.
OPENROUTER_MODEL = os.getenv(
    "OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free"
)

# Atribuição no OpenRouter: aparecem no painel deles e ajudam no suporte.
# Opcionais na API; mandamos sempre porque não custam nada e identificam o app.
OPENROUTER_SITE_URL = os.getenv("OPENROUTER_SITE_URL", "https://ajaxclube.com.br")
OPENROUTER_APP_NAME = os.getenv("OPENROUTER_APP_NAME", "AJAX Chess")

# Timeout do transporte. Nome sem marca do provedor porque é do CLIENTE, não
# da DeepSeek nem do OpenRouter — trocar de provedor não deveria renomear isto
# de novo.
LLM_TIMEOUT_S = int(os.getenv("LLM_TIMEOUT_S", "45"))

# Preço por milhão de tokens, em USD. O valor gravado em `cost_usd` é
# CONGELADO na linha, de modo que mudar isto não reescreve o histórico.
#
# O default é 0.0 porque o modelo default é `:free` — e 0.0 é INFORMAÇÃO ("não
# custou nada"), gravada como 0.00. Só `None` significa "não sei o preço", e aí
# `cost_usd` fica nulo em vez de fingir um zero que somaria errado no
# acumulado. Ver `env_price`.
#
# AO MIGRAR PARA MODELO PAGO: basta setar LLM_PRICE_INPUT/LLM_PRICE_OUTPUT com
# o preço do modelo novo (o OpenRouter publica os dois por milhão de tokens).
# Nada no código muda.
LLM_PRICE_PER_MTOK = {
    "input": env_price("LLM_PRICE_INPUT", 0.0),
    "output": env_price("LLM_PRICE_OUTPUT", 0.0),
}

# ========================
# EMAIL (SendGrid)
# ========================
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "smtp.sendgrid.net"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = "apikey"
EMAIL_HOST_PASSWORD = os.getenv("SENDGRID_API_KEY", "")
DEFAULT_FROM_EMAIL = "ricwesys@gmail.com"
