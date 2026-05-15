from django.conf import settings
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token


class GoogleTokenError(Exception):
    """Erro semântico para falhas na validação do token do Google."""

    pass


def verify_google_id_token(token: str) -> dict:
    """
    Valida o id_token junto à infraestrutura de chaves públicas do Google.

    Lança GoogleTokenError se o token for inválido, expirado
    ou emitido para outro Client ID (proteção contra confused deputy).
    """
    try:
        payload = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except ValueError as exc:
        raise GoogleTokenError(f"Token inválido: {exc}") from exc

    if payload.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise GoogleTokenError("Token emitido para um Client ID diferente.")

    return payload


def get_or_create_google_user(payload: dict):
    """
    Recupera ou cria o usuário local a partir do payload validado do Google.

    Usuários criados via OAuth não possuem senha utilizável — a autenticação
    é completamente delegada ao Google (set_unusable_password).

    Retorna uma tupla (user, created) seguindo o padrão do Django ORM.
    """
    from django.contrib.auth import get_user_model

    User = get_user_model()

    email = payload.get("email", "").lower()
    full_name = payload.get("name", "").strip()

    if not email:
        raise GoogleTokenError("Payload do Google não contém e-mail.")

    user, created = User.objects.get_or_create(
        email=email,
        defaults={"full_name": full_name, "is_active": True},
    )

    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])

    return user, created
