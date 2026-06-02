import logging
import secrets
import threading

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.mail import send_mail
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import (
    ChessTokenObtainPairSerializer,
    RegisterSerializer,
    UserResponseSerializer,
    PasswordResetRequestSerializer,
    PasswordResetVerifyCodeSerializer,
    PasswordResetConfirmSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)


def build_auth_response(user):
    refresh = RefreshToken.for_user(user)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "date_joined": user.date_joined.isoformat(),
        },
    }


def generate_reset_code():
    return f"{secrets.randbelow(1000000):06d}"


def _send_reset_email(email, full_name, code):
    """Envia o e-mail de reset em background. Erros são logados, nunca propagados."""
    try:
        send_mail(
            subject="Seu código de recuperação de senha - Clube de Xadrez AJAX",
            message=(
                f"Olá {full_name},\n\n"
                f"Seu código para redefinir a senha é: {code}\n"
                f"Ele é válido por 15 minutos."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=False,
        )
        logger.info("E-mail de reset enviado para %s", email)
    except Exception:
        logger.exception("Falha ao enviar e-mail de reset para %s", email)


def verify_google_id_token(token_value):
    google_client_id = getattr(settings, "GOOGLE_CLIENT_ID", "")
    if not google_client_id:
        raise ValueError("GOOGLE_CLIENT_ID não configurado.")

    try:
        payload = id_token.verify_oauth2_token(
            token_value,
            google_requests.Request(),
            audience=google_client_id,
        )
    except ValueError as exc:
        raise ValueError("Token do Google inválido.") from exc

    if not payload.get("email_verified"):
        raise ValueError("E-mail do Google não verificado.")

    return payload


class RegisterView(APIView):
    """
    POST /api/v1/auth/register/
    Cadastro de novos usuários (UC02). Público.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        response_data = UserResponseSerializer(user).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class ChessTokenObtainPairView(TokenObtainPairView):
    """
    POST /api/v1/auth/login/
    Login com e-mail e senha, retorna access + refresh token (UC03).
    """

    serializer_class = ChessTokenObtainPairSerializer
    authentication_classes = []
    permission_classes = [AllowAny]


class PasswordResetRequestView(APIView):
    """Solicita o envio de um código de recuperação de senha."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset_req"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        # Resposta sempre igual para evitar timing attack.
        response_msg = (
            "Se o e-mail existir em nossa base, enviaremos um código de redefinição."
        )

        user = User.objects.filter(email=email).first()
        if user is not None:
            code = generate_reset_code()
            cache.set(
                f"password_reset:{email}",
                {
                    "code": code,
                    "user_id": user.id,
                    "attempts": 0,
                },
                timeout=900,
            )

            # Dispara o e-mail em background para não bloquear a resposta.
            threading.Thread(
                target=_send_reset_email, args=(email, user.full_name, code)
            ).start()

        return Response({"detail": response_msg}, status=status.HTTP_200_OK)


class PasswordResetVerifyCodeView(APIView):
    """Verifica se o código de recuperação é válido."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset_verify"

    def post(self, request):
        serializer = PasswordResetVerifyCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"]
        code = serializer.validated_data["code"]

        reset_data = cache.get(f"password_reset:{email}")
        if not reset_data:
            return Response(
                {"detail": "Código inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if reset_data.get("attempts", 0) >= 5:
            cache.delete(f"password_reset:{email}")
            return Response(
                {"detail": "Muitas tentativas falhas. Solicite um novo código."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if reset_data.get("code") != code:
            reset_data["attempts"] = reset_data.get("attempts", 0) + 1
            cache.set(f"password_reset:{email}", reset_data, timeout=900)
            return Response(
                {"detail": "Código inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"detail": "Código válido."},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """Confirma o código e redefine a senha do usuário."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset_verify"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"]
        code = serializer.validated_data["code"]
        new_password = serializer.validated_data["new_password"]

        reset_data = cache.get(f"password_reset:{email}")
        if not reset_data:
            return Response(
                {"detail": "Código inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if reset_data.get("attempts", 0) >= 5:
            cache.delete(f"password_reset:{email}")
            return Response(
                {"detail": "Muitas tentativas falhas. Solicite um novo código."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if reset_data.get("code") != code:
            reset_data["attempts"] = reset_data.get("attempts", 0) + 1
            cache.set(f"password_reset:{email}", reset_data, timeout=900)
            return Response(
                {"detail": "Código inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = User.objects.get(id=reset_data["user_id"])
        except User.DoesNotExist:
            return Response(
                {"detail": "Código inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save(update_fields=["password"])
        cache.delete(f"password_reset:{email}")

        return Response(
            {"detail": "Senha redefinida com sucesso."},
            status=status.HTTP_200_OK,
        )


class MeView(APIView):
    """Retorna o usuário autenticado."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = UserResponseSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)


class GoogleLoginView(APIView):
    """Autentica ou cria um usuário a partir do id_token do Google."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        id_token_value = request.data.get("id_token")
        if not id_token_value:
            return Response(
                {"id_token": ["Este campo é obrigatório."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            payload = verify_google_id_token(id_token_value)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        email = (payload.get("email") or "").strip().lower()
        if not email:
            return Response(
                {"detail": "Token do Google inválido: e-mail ausente."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email,
                full_name=payload.get("name") or email.split("@", 1)[0],
                password=secrets.token_urlsafe(32),
            )
        elif not user.full_name:
            user.full_name = payload.get("name") or email.split("@", 1)[0]
            user.save(update_fields=["full_name"])

        return Response(build_auth_response(user), status=status.HTTP_200_OK)
