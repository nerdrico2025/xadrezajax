from django.db import transaction
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from .models import Profile, PlayerProfile, AdminProfile

User = get_user_model()


@transaction.atomic
def create_profile(user, nickname=None):
    """
    UC007 - Criação de Perfil Base.
    Também ativa automaticamente o PlayerProfile (UC010) por praticidade.
    """
    if hasattr(user, "profile"):
        raise ValidationError("Usuário já possui um perfil.")

    nickname = nickname or ""
    profile = Profile.objects.create(user=user, nickname=nickname)

    # Criando automaticamente o PlayerProfile para o usuário jogar de imediato.
    create_player_profile(profile)

    return profile


@transaction.atomic
def update_profile(profile, nickname=None):
    """
    UC009 - Atualiza informações do Perfil.
    """
    if nickname is not None:
        profile.nickname = nickname
        profile.save(update_fields=["nickname", "updated_at"])
    return profile


@transaction.atomic
def create_player_profile(profile):
    """
    UC010 - Liberar acesso às funcionalidades de jogo.
    Cria a entidade PlayerProfile associada ao Profile, se não existir.
    """
    player_profile, created = PlayerProfile.objects.get_or_create(profile=profile)
    return player_profile, created


@transaction.atomic
def promote_to_admin(promoter, target_user):
    """
    UC011 - Promove o target_user a administrador.
    Apenas um usuário que já seja admin ou superuser pode promover outros.
    """
    if not hasattr(target_user, "profile"):
        raise ValidationError("O usuário alvo não possui um perfil base.")

    profile = target_user.profile

    admin_profile, created = AdminProfile.objects.get_or_create(
        profile=profile, defaults={"promoted_by": promoter}
    )

    if created:
        # Ativa is_staff no modelo do Django para permitir acesso ao django-admin
        target_user.is_staff = True
        target_user.save(update_fields=["is_staff"])

    return admin_profile, created
