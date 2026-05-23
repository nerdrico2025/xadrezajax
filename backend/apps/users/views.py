from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import PasswordResetCode
from .serializers import (
    ChessTokenObtainPairSerializer,
    GoogleAuthSerializer,
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
    Recebe o id_token, valida, cria/recupera o usuário e retorna JWTs.
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
    RF020, RF021, RF022 — solicita recuperação de senha via e-mail gerando um PIN.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        user = User.objects.filter(email=email).first()

        if user:
            reset_obj = PasswordResetCode.generate_code(user)

            subject = "Código de Recuperação - Xadrez AJAX"
            message = (
                f"Olá, {user.full_name}.\n\n"
                "Você solicitou a recuperação de senha.\n\n"
                f"Seu código de verificação é: {reset_obj.code}\n"
                "Este código expira em 15 minutos.\n\n"
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
                    "Se o e-mail estiver cadastrado, um código de "
                    "recuperação será enviado para sua caixa de entrada."
                )
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """
    POST /api/v1/auth/password-reset/confirm/
    RF023, RF024, RF025 — redefine a senha usando o PIN numérico.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        # A validação pode ser feita por serializer, mas extraindo direto para garantir compatibilidade imediata
        email = request.data.get("email")
        code = request.data.get("codigo")
        new_password = request.data.get("new_password")

        if not all([email, code, new_password]):
            return Response(
                {"detail": "E-mail, código e nova senha são obrigatórios."},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = User.objects.filter(email=email).first()
        if not user:
            return Response(
                {"detail": "Código inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reset_obj = PasswordResetCode.objects.filter(user=user, code=code).last()

        if not reset_obj or not reset_obj.is_valid():
            return Response(
                {"detail": "Código inválido ou expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Atualiza a senha e inutiliza o código
        user.set_password(new_password)
        user.save(update_fields=["password"])
        reset_obj.delete()

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
