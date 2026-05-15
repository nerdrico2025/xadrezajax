from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import (
    ChessTokenObtainPairSerializer,
    GoogleAuthSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ThemePreferenceSerializer,
    TokenBlacklistSerializer,
    UserResponseSerializer,
)
from .services import (
    GoogleTokenError,
    get_or_create_google_user,
    verify_google_id_token,
)

User = get_user_model()
password_reset_token_generator = PasswordResetTokenGenerator()


def _build_jwt_response(user, status_code):
    """
    Gera o par access/refresh via SimpleJWT e monta o payload de resposta.
    Função auxiliar reutilizável por qualquer view de autenticação OAuth.
    """
    refresh = RefreshToken.for_user(user)
    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "theme_preference": user.theme_preference,
            },
        },
        status=status_code,
    )


class GoogleAuthView(APIView):
    """
    POST /api/v1/auth/google/

    Recebe o id_token gerado pelo SDK do Google no app React Native,
    valida a assinatura criptográfica, cria ou recupera o usuário local
    e retorna os JWTs de sessão — sem redirecionamentos HTTP (mobile-first).

    RF001 — Validação do id_token
    RF002 — Geração dos JWTs de sessão
    RF003 — Criação/Recuperação do usuário
    RF006 — Resposta JSON para o front-end gerenciar navegação
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = GoogleAuthSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = verify_google_id_token(serializer.validated_data["id_token"])
        except GoogleTokenError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            user, created = get_or_create_google_user(payload)
        except GoogleTokenError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        http_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return _build_jwt_response(user, http_status)


class RegisterView(APIView):
    """
    POST /api/v1/auth/register/
    Cadastro de novos usuários (UC02). Público.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        response_data = UserResponseSerializer(user).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class PasswordResetRequestView(APIView):
    """
    POST /api/v1/auth/password-reset/
    RF020, RF021, RF022 — solicita recuperação de senha via e-mail.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        user = User.objects.get(email=email)
        uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
        token = password_reset_token_generator.make_token(user)
        reset_url = request.build_absolute_uri("/api/v1/auth/password-reset/confirm/")
        reset_link = f"{reset_url}?uid={uidb64}&token={token}"
        subject = "Recuperação de senha - Xadrez AJAX"
        message = (
            "Você solicitou a recuperação de senha.\n\n"
            f"Use o link abaixo para redefinir sua senha:\n{reset_link}\n\n"
            "Caso não tenha sido você, ignore esta mensagem."
        )
        send_mail(
            subject,
            message,
            settings.DEFAULT_FROM_EMAIL,
            [email],
            fail_silently=False,
        )
        return Response(
            {
                "detail": (
                    "E-mail de recuperação enviado com instruções. "
                    "Verifique sua caixa de entrada."
                )
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """
    POST /api/v1/auth/password-reset/confirm/
    RF023, RF024, RF025 — redefine a senha usando token seguro.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uid = serializer.validated_data.get("uid")
        email = serializer.validated_data.get("email")
        token = serializer.validated_data["token"]
        if uid:
            try:
                uid = force_str(urlsafe_base64_decode(uid))
            except Exception:
                return Response(
                    {"detail": "UID inválido."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user = User.objects.filter(pk=uid).first()
        else:
            user = User.objects.filter(email=email).first()
        if not user or not password_reset_token_generator.check_token(user, token):
            return Response(
                {"detail": "Token inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response(
            {"detail": "Senha redefinida com sucesso."},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """
    POST /api/v1/auth/logout/
    UC006 — blacklist do refresh token no logout.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = TokenBlacklistSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            refresh = RefreshToken(serializer.validated_data["refresh"])
            refresh.blacklist()
        except TokenError:
            return Response(
                {"detail": "Refresh token inválido ou já expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(status=status.HTTP_205_RESET_CONTENT)


class ChessTokenObtainPairView(TokenObtainPairView):
    """
    POST /api/v1/auth/login/
    Login com e-mail e senha, retorna access + refresh token (UC03).
    """

    serializer_class = ChessTokenObtainPairSerializer
    permission_classes = [AllowAny]


class ThemePreferenceView(APIView):
    """
    PATCH /api/v1/auth/theme/
    Atualiza a preferência de tema do usuário autenticado.
    """

    permission_classes = [IsAuthenticated]

    def patch(self, request):
        serializer = ThemePreferenceSerializer(
            request.user, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            UserResponseSerializer(request.user).data,
            status=status.HTTP_200_OK,
        )


class CurrentUserView(APIView):
    """
    GET /api/v1/auth/me/
    Retorna os dados do usuário autenticado.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = UserResponseSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)
