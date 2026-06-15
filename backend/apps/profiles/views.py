import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Profile
from .serializers import (
    ProfileCreateSerializer,
    ProfileResponseSerializer,
    ProfileUpdateSerializer,
    PlayerProfileSerializer,
)
from .permissions import HasAdminProfile, HasProfile, HasPlayerProfile, IsPlayerOrAdmin
from .services import ProfileService

User = get_user_model()

logger = logging.getLogger(__name__)


class CreateProfileView(APIView):
    """
    POST /api/v1/profiles/
    Cria o perfil do usuário autenticado (UC007).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ProfileCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        profile = ProfileService.create_profile(
            user=request.user,
            validated_data=serializer.validated_data,
        )

        response_data = ProfileResponseSerializer(profile).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class MyProfileView(APIView):
    """
    GET /api/v1/profiles/me/
    Retorna o perfil do usuário autenticado (UC008).
    Se não existir, aciona a criação de um perfil padrão vazio (UC007).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            profile = Profile.objects.select_related("user").get(user=request.user)
        except Profile.DoesNotExist:
            logger.info(
                "Perfil não encontrado para o usuário %s. Iniciando auto-criação (UC007).",
                request.user.email,
            )
            try:
                profile = ProfileService.create_profile(
                    user=request.user, validated_data={}
                )
            except Exception as e:
                logger.exception(
                    "Erro ao auto-criar perfil para o usuário %s: %s",
                    request.user.email,
                    str(e),
                )
                return Response(
                    {"detail": "Erro interno ao criar o perfil automaticamente."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
        except Exception as e:
            logger.exception(
                "Erro inesperado ao consultar o perfil do usuário %s: %s",
                request.user.email,
                str(e),
            )
            return Response(
                {"detail": "Erro interno ao consultar o perfil."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response_data = ProfileResponseSerializer(profile).data
        return Response(response_data, status=status.HTTP_200_OK)

    def put(self, request):
        return self._update(request)

    def patch(self, request):
        return self._update(request, partial=True)

    def _update(self, request, partial=False):
        # Substitui boilerplate por get_object_or_404 com tratativa via Exception Handler do DRF
        from django.http import Http404
        try:
            profile = get_object_or_404(Profile, user=request.user)
        except Http404:
            return Response(
                {"detail": "Perfil não encontrado. Consulte GET /me/ primeiro."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = ProfileUpdateSerializer(
            profile, data=request.data, partial=partial
        )
        serializer.is_valid(raise_exception=True)

        try:
            profile = ProfileService.update_profile(
                profile=profile, validated_data=serializer.validated_data
            )
        except Exception as e:
            logger.exception(
                "Erro interno ao atualizar perfil para %s: %s",
                request.user.email,
                str(e),
            )
            return Response(
                {"detail": "Ocorreu um erro interno ao salvar o perfil."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response_data = ProfileResponseSerializer(profile).data
        return Response(response_data, status=status.HTTP_200_OK)


class PlayerProfileView(APIView):
    """
    POST /api/v1/profiles/player/
    Cria ou retorna o PlayerProfile (UC010). Idempotente.
    GET /api/v1/profiles/player/
    Retorna o PlayerProfile.
    """

    permission_classes = [IsAuthenticated]

    def get_base_profile(self, user):
        try:
            return Profile.objects.get(user=user)
        except Profile.DoesNotExist:
            return None

    def post(self, request):
        base_profile = self.get_base_profile(request.user)
        if not base_profile:
            return Response(
                {"detail": "Perfil base não encontrado. Acesse GET /me/ primeiro."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            player_profile, created = ProfileService.get_or_create_player_profile(
                profile=base_profile
            )
        except Exception as e:
            logger.exception(
                "Erro interno ao criar PlayerProfile para %s: %s",
                request.user.email,
                str(e),
            )
            return Response(
                {"detail": "Ocorreu um erro interno ao habilitar o acesso ao jogo."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response_data = PlayerProfileSerializer(player_profile).data
        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(response_data, status=status_code)

    def get(self, request):
        base_profile = self.get_base_profile(request.user)
        if not base_profile or not base_profile.is_player:
            return Response(
                {"detail": "PlayerProfile não encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )
        
        response_data = PlayerProfileSerializer(base_profile.player_profile).data
        return Response(response_data, status=status.HTTP_200_OK)


class PromoteToAdminView(APIView):
    """
    POST /api/v1/profiles/promote/<user_id>/
    Promove um usuário a administrador (UC011).
    Apenas administradores podem chamar esta rota.
    """

    permission_classes = [IsAuthenticated, HasAdminProfile]

    def post(self, request, user_id):
        # Usa atalho recomendado do Django em vez de try/except explícito
        from django.http import Http404
        try:
            target_user = get_object_or_404(User, id=user_id)
        except Http404:
            return Response(
                {"detail": "Usuário não encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            admin_profile, created = ProfileService.promote_to_admin(
                target_user=target_user, promoted_by_user=request.user
            )
        except Exception as e:
            logger.exception(
                "Erro interno ao promover usuário %s (id: %s) a admin: %s",
                target_user.email,
                user_id,
                str(e),
            )
            return Response(
                {"detail": "Ocorreu um erro interno ao promover o usuário."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if created:
            message = "Usuário promovido a administrador com sucesso."
            status_code = status.HTTP_201_CREATED
        else:
            message = "O usuário já possui privilégios de administrador."
            status_code = status.HTTP_200_OK

        return Response(
            {"detail": message, "user_id": user_id},
            status=status_code,
        )


class WhoAmIView(APIView):
    """
    GET /api/v1/profiles/whoami/
    UC012 - Identificar usuário autenticado e recuperar perfis.
    Retorna um resumo dos perfis e permissões do usuário logado.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        try:
            profile = Profile.objects.select_related("player_profile", "admin_profile").get(user=user)
        except Profile.DoesNotExist:
            profile = None

        data = {
            "user_id": user.id,
            "email": user.email,
            "has_profile": profile is not None,
            "is_player": profile.is_player if profile else False,
            "is_admin": profile.is_admin if profile else False,
            "is_staff": user.is_staff,
            "is_superuser": user.is_superuser,
        }
        return Response(data, status=status.HTTP_200_OK)


class ProtectedGameExampleView(APIView):
    """
    GET /api/v1/profiles/game-example/
    UC012 - Exemplo prático de View protegida por composição de permissões.

    Esta View exige que o usuário:
    1. Esteja autenticado (IsAuthenticated)
    2. Possua um Perfil base (HasProfile → redireciona para UC007 se faltar)
    3. Possua um PlayerProfile (HasPlayerProfile → redireciona para UC010)

    O DRF avalia as permissões em ordem (AND lógico).
    Se HasProfile falhar, a mensagem retornada orienta o front-end
    a redirecionar para a criação de perfil.
    """

    permission_classes = [IsAuthenticated, HasProfile, HasPlayerProfile]

    def get(self, request):
        return Response(
            {"detail": "Acesso liberado! Você é um jogador autenticado."},
            status=status.HTTP_200_OK,
        )
