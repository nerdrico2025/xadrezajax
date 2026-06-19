from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.core.exceptions import ValidationError as DjangoValidationError

from .models import Profile, PlayerProfile
from .serializers import (
    ProfileCreateSerializer,
    ProfileUpdateSerializer,
    ProfileResponseSerializer,
    PlayerProfileSerializer
)
from .permissions import HasProfile, HasPlayerProfile, HasAdminProfile
from . import services

User = get_user_model()

class CreateProfileView(APIView):
    """
    POST /api/v1/profiles/
    UC007 - Cria um perfil base para o usuário autenticado.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = ProfileCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        nickname = serializer.validated_data.get('nickname', '')
        
        try:
            profile = services.create_profile(request.user, nickname=nickname)
        except DjangoValidationError as e:
            return Response({"detail": list(e)}, status=status.HTTP_400_BAD_REQUEST)
        
        response_serializer = ProfileResponseSerializer(profile)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class MyProfileView(APIView):
    """
    GET, PUT, PATCH /api/v1/profiles/me/
    UC009 - Lê e atualiza o próprio perfil.
    """
    permission_classes = [IsAuthenticated, HasProfile]

    def get(self, request, *args, **kwargs):
        profile = request.user.profile
        serializer = ProfileResponseSerializer(profile)
        return Response(serializer.data)

    def put(self, request, *args, **kwargs):
        return self._update(request)

    def patch(self, request, *args, **kwargs):
        return self._update(request)
        
    def _update(self, request):
        profile = request.user.profile
        serializer = ProfileUpdateSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        
        nickname = serializer.validated_data.get('nickname')
        services.update_profile(profile, nickname=nickname)
        
        response_serializer = ProfileResponseSerializer(profile)
        return Response(response_serializer.data)


class PlayerProfileView(APIView):
    """
    GET, POST /api/v1/profiles/player/
    UC010 - Obtém dados de jogador, ou ativa o acesso ao jogo manualmente.
    """
    permission_classes = [IsAuthenticated, HasProfile]

    def get(self, request, *args, **kwargs):
        # Apenas quem já é player consegue ler seus dados de player
        if not request.user.profile.is_player:
            return Response(
                {"detail": "Você ainda não possui um perfil de jogador."},
                status=status.HTTP_403_FORBIDDEN
            )
        serializer = PlayerProfileSerializer(request.user.profile.player_profile)
        return Response(serializer.data)

    def post(self, request, *args, **kwargs):
        # Se for chamado sob demanda (ex: botão "Quero Jogar")
        profile = request.user.profile
        player_profile = services.create_player_profile(profile)
        serializer = PlayerProfileSerializer(player_profile)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class PromoteToAdminView(APIView):
    """
    POST /api/v1/profiles/promote/<int:user_id>/
    UC011 - Promove outro usuário a admin.
    """
    permission_classes = [IsAuthenticated, HasAdminProfile]

    def post(self, request, user_id, *args, **kwargs):
        target_user = get_object_or_404(User, id=user_id)
        
        try:
            services.promote_to_admin(promoter=request.user, target_user=target_user)
            return Response({"detail": f"Usuário {target_user.email} promovido a Admin."}, status=status.HTTP_200_OK)
        except DjangoValidationError as e:
            return Response({"detail": list(e)}, status=status.HTTP_400_BAD_REQUEST)


class WhoAmIView(APIView):
    """
    GET /api/v1/profiles/whoami/
    Endpoint de conveniência para o front-end saber o estado da sessão atual.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        user = request.user
        has_profile = hasattr(user, 'profile')
        is_player = False
        is_admin = False

        if has_profile:
            is_player = user.profile.is_player
            is_admin = user.profile.is_admin

        data = {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "has_profile": has_profile,
            "is_player": is_player,
            "is_admin": is_admin,
            "is_staff": user.is_staff,
        }
        return Response(data)


class ProtectedGameExampleView(APIView):
    """
    GET /api/v1/profiles/game-example/
    Exemplo de endpoint protegido (UC012) acessível apenas para jogadores.
    """
    permission_classes = [IsAuthenticated, HasPlayerProfile]

    def get(self, request, *args, **kwargs):
        return Response({
            "message": "Parabéns! Se você está lendo isso, você tem um PlayerProfile e pode jogar."
        })
