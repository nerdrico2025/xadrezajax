import logging

from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from .models import Profile, PlayerProfile, AdminProfile

logger = logging.getLogger(__name__)


class ProfileService:
    """
    Camada de serviço para o caso de uso UC007 — Criar Perfil.
    Centraliza regras de negócio, validações e tratamento de erros.
    """

    @staticmethod
    def create_profile(user, validated_data):
        """
        Cria um perfil para o usuário informado.

        Regras:
        - Verifica se o usuário já possui perfil (duplicata bloqueada).
        - Usa transação atômica para garantir rollback em caso de falha.
        - Registra falhas via logging.

        Args:
            user: Instância do usuário autenticado.
            validated_data: Dicionário com os dados validados do perfil.

        Returns:
            Profile: Instância do perfil criado.

        Raises:
            ValidationError: Se o usuário já possui um perfil.
        """
        # UC007 — Verificar existência de perfil do usuário
        if Profile.objects.filter(user=user).exists():
            logger.warning(
                "Tentativa de criação de perfil duplicado para user_id=%s (%s)",
                user.id,
                user.email,
            )
            raise ValidationError(
                {"detail": "Este usuário já possui um perfil cadastrado."}
            )

        try:
            with transaction.atomic():
                profile = Profile.objects.create(user=user, **validated_data)
                logger.info(
                    "Perfil criado com sucesso para user_id=%s (%s)",
                    user.id,
                    user.email,
                )
                return profile

        except IntegrityError:
            # Proteção contra race condition: a constraint UNIQUE no banco
            # pode ser violada se duas requisições chegarem simultaneamente.
            logger.error(
                "IntegrityError ao criar perfil para user_id=%s (%s) "
                "— possível race condition",
                user.id,
                user.email,
                exc_info=True,
            )
            raise ValidationError(
                {"detail": "Este usuário já possui um perfil cadastrado."}
            )

        except Exception:
            logger.exception(
                "Erro inesperado ao criar perfil para user_id=%s (%s)",
                user.id,
                user.email,
            )
            raise

    @staticmethod
    def update_profile(profile, validated_data):
        """
        Atualiza um perfil existente com os dados fornecidos (UC009).

        Args:
            profile: Instância do perfil a ser atualizado.
            validated_data: Dicionário com os dados validados.

        Returns:
            Profile: Instância do perfil atualizado.
        """
        try:
            with transaction.atomic():
                for attr, value in validated_data.items():
                    setattr(profile, attr, value)
                profile.save()
                
                logger.info(
                    "Perfil atualizado com sucesso para user_id=%s (%s)",
                    profile.user.id,
                    profile.user.email,
                )
                return profile
                
        except Exception:
            logger.exception(
                "Erro inesperado ao atualizar perfil para user_id=%s (%s)",
                profile.user.id,
                profile.user.email,
            )
            raise

    @staticmethod
    def get_or_create_player_profile(profile):
        """
        Cria o perfil de jogador (UC010) para o perfil informado.
        É idempotente: se já existir, retorna o existente e um boolean
        indicando se foi criado agora.

        Args:
            profile: Instância de Profile.

        Returns:
            Tuple[PlayerProfile, bool]: O perfil de jogador e o status de criação.
        """
        try:
            with transaction.atomic():
                player_profile, created = PlayerProfile.objects.get_or_create(
                    profile=profile
                )
                
                if created:
                    logger.info(
                        "PlayerProfile criado com sucesso para profile_id=%s",
                        profile.id,
                    )
                else:
                    logger.info(
                        "PlayerProfile já existia (idempotente) para profile_id=%s",
                        profile.id,
                    )
                
                return player_profile, created

        except Exception:
            logger.exception(
                "Erro inesperado no get_or_create do PlayerProfile para profile_id=%s",
                profile.id,
            )
            raise

    @staticmethod
    def promote_to_admin(target_user, promoted_by_user):
        """
        UC011 - Promove um usuário comum a administrador.
        Transação atômica que seta is_staff e cria o AdminProfile.
        
        Args:
            target_user: O User a ser promovido.
            promoted_by_user: O User que está realizando a promoção.

        Returns:
            Tuple[AdminProfile, bool]: O perfil admin e um boolean (True se criado agora).
        """
        try:
            with transaction.atomic():
                if getattr(target_user, "is_staff", False) and hasattr(target_user, "profile") and target_user.profile.is_admin:
                    logger.info("Usuário %s já é administrador (idempotente).", target_user.email)
                    return target_user.profile.admin_profile, False

                # Ativa o privilégio no Django Auth
                target_user.is_staff = True
                target_user.save(update_fields=["is_staff"])

                # Garante que o profile existe
                profile, _ = Profile.objects.get_or_create(user=target_user)

                admin_profile, created = AdminProfile.objects.get_or_create(
                    profile=profile,
                    defaults={"promoted_by": promoted_by_user}
                )

                logger.info(
                    "Usuário %s promovido a admin por %s.",
                    target_user.email,
                    promoted_by_user.email if promoted_by_user else "Sistema",
                )
                
                return admin_profile, True

        except Exception:
            logger.exception("Erro inesperado ao promover usuário %s a admin", target_user.email)
            raise
