import logging
import secrets
import threading

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django_redis import get_redis_connection
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .glicko2 import (
    DRAW,
    LOSS,
    WIN,
    Rating as GlickoRating,
    rate as glicko2_rate,
)
from .models import ModalityRating
from .serializers import (
    ChessTokenObtainPairSerializer,
    ProfileSerializer,
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
    profile = getattr(user, "profile", None)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "date_joined": user.date_joined.isoformat(),
            "username": profile.username if profile else None,
            "rating": profile.rating if profile else 1200,
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


class ProfileView(APIView):
    """
    GET  /api/v1/profile/  → retorna o perfil do usuário autenticado
    PATCH /api/v1/profile/ → atualiza full_name, username, bio, avatar
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = request.user.profile
        serializer = ProfileSerializer(profile, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        profile = request.user.profile
        serializer = ProfileSerializer(
            profile, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


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


AI_RATING = {"easy": 800, "medium": 1200, "hard": 1600}

# A IA vira um oponente Glicko-2 de rating fixo por dificuldade (mesma escala
# do Elo antigo) e deviation baixo constante: ela joga com força conhecida e
# consistente, e não tem rating próprio a atualizar.
AI_DEVIATION = 60.0
AI_VOLATILITY = 0.06


def _modality_from_time_control(seconds):
    """Bullet < 3 min, Blitz 3–10 min, Rápido > 10 min (PLANO_FASE0 §0.4).

    Sem relógio (None) conta como Rápido — é o jogo sem pressão de tempo.
    """
    if seconds is None:
        return ModalityRating.MODALITY_RAPID
    if seconds < 180:
        return ModalityRating.MODALITY_BULLET
    if seconds <= 600:
        return ModalityRating.MODALITY_BLITZ
    return ModalityRating.MODALITY_RAPID


def _modality_from_request(data):
    """Extrai a modalidade do payload; retorna None se time_control for inválido.

    Payload sem a chave `time_control` (clientes/node-api antigos) cai em
    blitz — todo o histórico pré-Glicko-2 era 5 min (decisão do PM).
    """
    if "time_control" not in data:
        return ModalityRating.MODALITY_BLITZ
    value = data.get("time_control")
    if value is None:
        return _modality_from_time_control(None)
    try:
        return _modality_from_time_control(int(value))
    except (TypeError, ValueError):
        return None


def _locked_modality_rating(profile, modality):
    rating, _ = ModalityRating.objects.select_for_update().get_or_create(
        profile=profile, modality=modality
    )
    return rating


def _apply_glicko2_result(modality_rating, opponent, score):
    """Atualiza um ModalityRating in-place com o resultado de uma partida."""
    new = glicko2_rate(
        GlickoRating(
            modality_rating.rating,
            modality_rating.deviation,
            modality_rating.volatility,
        ),
        [(opponent, score)],
    )
    modality_rating.rating = new.rating
    modality_rating.deviation = new.deviation
    modality_rating.volatility = new.volatility
    modality_rating.games_played += 1
    modality_rating.save()


def _sync_rating_mirror(profile, modality_rating):
    """Profile.rating segue como espelho denormalizado do rating blitz
    (arredondado) para não quebrar leaderboard/app antigo na transição."""
    if modality_rating.modality == ModalityRating.MODALITY_BLITZ:
        profile.rating = round(modality_rating.rating)


class GameResultView(APIView):
    """
    POST /api/v1/auth/game/result/
    Chamado internamente pelo node-api ao fim de cada partida.
    Atualiza wins/losses/draws/games_played e recalcula ELO dos dois jogadores.
    Autenticado por INTERNAL_API_SECRET no header X-Internal-Secret.
    Sem throttle: é tráfego interno do node-api — o AnonRateThrottle global
    (20/min por IP) descartaria resultados em horário de pico de partidas.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def post(self, request):
        secret = request.headers.get("X-Internal-Secret", "")
        expected = getattr(settings, "INTERNAL_API_SECRET", "")
        if not expected or secret != expected:
            return Response(
                {"detail": "Não autorizado."}, status=status.HTTP_403_FORBIDDEN
            )

        white_id = request.data.get("white_id")
        black_id = request.data.get("black_id")
        # result: "white" | "black" | "draw"
        result = request.data.get("result")
        modality = _modality_from_request(request.data)

        if (
            not white_id
            or not black_id
            or result not in ("white", "black", "draw")
            or modality is None
        ):
            return Response(
                {"detail": "Dados inválidos."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            from .models import GameHistory, Profile

            with transaction.atomic():
                white_profile = Profile.objects.select_for_update().get(
                    user_id=white_id
                )
                black_profile = Profile.objects.select_for_update().get(
                    user_id=black_id
                )
                white_rating = _locked_modality_rating(white_profile, modality)
                black_rating = _locked_modality_rating(black_profile, modality)

                w_before = round(white_rating.rating)
                b_before = round(black_rating.rating)
                # Snapshot pré-partida: os dois updates usam os valores
                # antigos do oponente, nunca os recém-calculados.
                white_pre = GlickoRating(
                    white_rating.rating,
                    white_rating.deviation,
                    white_rating.volatility,
                )
                black_pre = GlickoRating(
                    black_rating.rating,
                    black_rating.deviation,
                    black_rating.volatility,
                )

                if result == "white":
                    score_white, score_black = WIN, LOSS
                    white_profile.wins += 1
                    black_profile.losses += 1
                    w_result, b_result = "win", "loss"
                elif result == "black":
                    score_white, score_black = LOSS, WIN
                    white_profile.losses += 1
                    black_profile.wins += 1
                    w_result, b_result = "loss", "win"
                else:
                    score_white = score_black = DRAW
                    white_profile.draws += 1
                    black_profile.draws += 1
                    w_result = b_result = "draw"

                _apply_glicko2_result(white_rating, black_pre, score_white)
                _apply_glicko2_result(black_rating, white_pre, score_black)

                _sync_rating_mirror(white_profile, white_rating)
                _sync_rating_mirror(black_profile, black_rating)
                white_profile.games_played += 1
                black_profile.games_played += 1

                white_profile.save(
                    update_fields=["rating", "wins", "losses", "draws", "games_played"]
                )
                black_profile.save(
                    update_fields=["rating", "wins", "losses", "draws", "games_played"]
                )

                w_name = (
                    getattr(black_profile, "username", None)
                    or black_profile.user.full_name
                )
                b_name = (
                    getattr(white_profile, "username", None)
                    or white_profile.user.full_name
                )
                GameHistory.objects.create(
                    user=white_profile.user,
                    opponent_name=w_name,
                    result=w_result,
                    mode=GameHistory.MODE_ONLINE,
                    modality=modality,
                    rating_before=w_before,
                    rating_after=round(white_rating.rating),
                )
                GameHistory.objects.create(
                    user=black_profile.user,
                    opponent_name=b_name,
                    result=b_result,
                    mode=GameHistory.MODE_ONLINE,
                    modality=modality,
                    rating_before=b_before,
                    rating_after=round(black_rating.rating),
                )

        except Profile.DoesNotExist:
            return Response(
                {"detail": "Perfil não encontrado."}, status=status.HTTP_404_NOT_FOUND
            )

        return Response(
            {
                "modality": modality,
                "white": {
                    "rating": round(white_rating.rating),
                    "deviation": round(white_rating.deviation),
                    "provisional": white_rating.is_provisional,
                },
                "black": {
                    "rating": round(black_rating.rating),
                    "deviation": round(black_rating.deviation),
                    "provisional": black_rating.is_provisional,
                },
            },
            status=status.HTTP_200_OK,
        )


class AiGameResultView(APIView):
    """
    POST /api/v1/auth/game/ai-result/
    Registra resultado de partida contra IA para o usuário autenticado.
    Atualiza stats, recalcula ELO e salva no histórico.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        result = request.data.get("result")
        difficulty = request.data.get("difficulty", "medium")
        modality = _modality_from_request(request.data)

        if result not in ("win", "loss", "draw"):
            return Response(
                {"detail": "result deve ser 'win', 'loss' ou 'draw'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if difficulty not in AI_RATING:
            return Response(
                {"detail": "difficulty deve ser 'easy', 'medium' ou 'hard'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if modality is None:
            return Response(
                {"detail": "time_control deve ser um número de segundos ou null."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .models import GameHistory, Profile

        try:
            with transaction.atomic():
                profile = Profile.objects.select_for_update().get(user=request.user)
                modality_rating = _locked_modality_rating(profile, modality)
                rating_before = round(modality_rating.rating)

                if result == "win":
                    score, profile.wins = WIN, profile.wins + 1
                elif result == "loss":
                    score, profile.losses = LOSS, profile.losses + 1
                else:
                    score, profile.draws = DRAW, profile.draws + 1

                ai_opponent = GlickoRating(
                    AI_RATING[difficulty], AI_DEVIATION, AI_VOLATILITY
                )
                _apply_glicko2_result(modality_rating, ai_opponent, score)

                _sync_rating_mirror(profile, modality_rating)
                profile.games_played += 1
                profile.save(
                    update_fields=["rating", "wins", "losses", "draws", "games_played"]
                )

                difficulty_label = {
                    "easy": "IA Fácil",
                    "medium": "IA Médio",
                    "hard": "IA Difícil",
                }
                GameHistory.objects.create(
                    user=request.user,
                    opponent_name=difficulty_label[difficulty],
                    result=result,
                    mode=GameHistory.MODE_AI,
                    modality=modality,
                    rating_before=rating_before,
                    rating_after=round(modality_rating.rating),
                )
        except Profile.DoesNotExist:
            return Response(
                {"detail": "Perfil não encontrado."}, status=status.HTTP_404_NOT_FOUND
            )

        return Response(
            {
                "rating": round(modality_rating.rating),
                "deviation": round(modality_rating.deviation),
                "provisional": modality_rating.is_provisional,
                "modality": modality,
            },
            status=status.HTTP_200_OK,
        )


class GameHistoryView(APIView):
    """
    GET /api/v1/auth/game/history/?limit=20&offset=0
    Retorna histórico de partidas do usuário autenticado.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import GameHistory

        limit = min(int(request.query_params.get("limit", 20)), 100)
        offset = int(request.query_params.get("offset", 0))

        qs = GameHistory.objects.filter(user=request.user)[offset : offset + limit]
        data = [
            {
                "id": g.id,
                "opponent_name": g.opponent_name,
                "result": g.result,
                "mode": g.mode,
                "modality": g.modality,
                "rating_before": g.rating_before,
                "rating_after": g.rating_after,
                "rating_delta": g.rating_after - g.rating_before,
                "played_at": g.played_at.isoformat(),
            }
            for g in qs
        ]
        return Response(data)


class LeaderboardView(APIView):
    """
    GET /api/v1/auth/leaderboard/?limit=50&modality=blitz
    Top jogadores por rating Glicko-2 na modalidade (default blitz). Público.
    Só entram jogadores com ao menos 1 partida na modalidade.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        limit = min(int(request.query_params.get("limit", 50)), 100)
        modality = request.query_params.get("modality", ModalityRating.MODALITY_BLITZ)
        if modality not in dict(ModalityRating.MODALITY_CHOICES):
            return Response(
                {"detail": "modality deve ser 'bullet', 'blitz' ou 'rapid'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ratings = (
            ModalityRating.objects.select_related("profile__user")
            .filter(modality=modality, games_played__gt=0)
            .order_by("-rating")[:limit]
        )
        data = [
            {
                "rank": i + 1,
                "user_id": r.profile.user_id,
                "username": r.profile.username or r.profile.user.full_name,
                "full_name": r.profile.user.full_name,
                "rating": round(r.rating),
                "provisional": r.is_provisional,
                "modality": modality,
                "games_played": r.profile.games_played,
                "wins": r.profile.wins,
            }
            for i, r in enumerate(ratings)
        ]
        return Response(data)


# ─── Account management ───────────────────────────────────────────────────────


class ChangePasswordView(APIView):
    """
    POST /api/v1/auth/password/change/
    Troca a senha do usuário autenticado. Exige senha atual + nova senha.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        old_password = request.data.get("old_password", "")
        new_password = request.data.get("new_password", "")

        if not old_password or not new_password:
            return Response(
                {"detail": "old_password e new_password são obrigatórios."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not request.user.check_password(old_password):
            return Response(
                {"detail": "Senha atual incorreta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from django.contrib.auth.password_validation import validate_password

            validate_password(new_password, request.user)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])
        return Response(
            {"detail": "Senha alterada com sucesso."}, status=status.HTTP_200_OK
        )


class DeleteAccountView(APIView):
    """
    DELETE /api/v1/auth/account/
    Exclui permanentemente a conta do usuário autenticado.
    Requer confirmação com senha.
    """

    permission_classes = [IsAuthenticated]

    def delete(self, request):
        password = request.data.get("password", "")
        if not password:
            return Response(
                {"detail": "Confirmação de senha é obrigatória."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not request.user.check_password(password):
            return Response(
                {"detail": "Senha incorreta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ─── Friends ──────────────────────────────────────────────────────────────────


def _get_online_status(user_ids):
    """Returns dict {user_id: bool} from Redis `online:{id}` keys set by node-api."""
    if not user_ids:
        return {}
    try:
        redis_conn = get_redis_connection("default")
        pipeline = redis_conn.pipeline()
        for uid in user_ids:
            pipeline.exists(f"online:{uid}")
        results = pipeline.execute()
        return {uid: bool(r) for uid, r in zip(user_ids, results)}
    except Exception:
        return {uid: False for uid in user_ids}


def _friend_avatar_url(request, profile):
    avatar = getattr(profile, "avatar", None)
    if avatar:
        try:
            return request.build_absolute_uri(avatar.url)
        except Exception:
            pass
    return None


class FriendListView(APIView):
    """
    GET /api/v1/auth/friends/
    Lista amigos aceitos + status online.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import Friendship

        user = request.user
        friendships = Friendship.objects.filter(
            Q(requester=user) | Q(receiver=user),
            status=Friendship.STATUS_ACCEPTED,
        ).select_related("requester__profile", "receiver__profile")

        friend_rows = []
        friend_ids = []
        for f in friendships:
            friend = f.receiver if f.requester_id == user.id else f.requester
            profile = getattr(friend, "profile", None)
            friend_ids.append(friend.id)
            friend_rows.append(
                {
                    "friendship_id": f.id,
                    "id": friend.id,
                    "full_name": friend.full_name,
                    "username": getattr(profile, "username", None),
                    "avatar": _friend_avatar_url(request, profile),
                    "rating": getattr(profile, "rating", 1200),
                }
            )

        online = _get_online_status(friend_ids)
        for row in friend_rows:
            row["is_online"] = online.get(row["id"], False)

        friend_rows.sort(
            key=lambda r: (
                not r["is_online"],
                (r["username"] or r["full_name"]).lower(),
            )
        )
        return Response(friend_rows)


class SendFriendRequestView(APIView):
    """
    POST /api/v1/auth/friends/request/
    Envia pedido de amizade pelo username do alvo.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .models import Friendship, Profile

        username = request.data.get("username", "").strip()
        if not username:
            return Response(
                {"detail": "username é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            target_profile = Profile.objects.select_related("user").get(
                username=username
            )
        except Profile.DoesNotExist:
            return Response(
                {"detail": "Usuário não encontrado."}, status=status.HTTP_404_NOT_FOUND
            )

        target_user = target_profile.user
        if target_user == request.user:
            return Response(
                {"detail": "Você não pode se adicionar como amigo."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing = Friendship.objects.filter(
            Q(requester=request.user, receiver=target_user)
            | Q(requester=target_user, receiver=request.user)
        ).first()

        if existing:
            if existing.status == Friendship.STATUS_ACCEPTED:
                return Response(
                    {"detail": "Vocês já são amigos."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {"detail": "Pedido já enviado ou recebido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        friendship = Friendship.objects.create(
            requester=request.user, receiver=target_user
        )
        return Response(
            {"detail": "Pedido enviado.", "id": friendship.id},
            status=status.HTTP_201_CREATED,
        )


class PendingRequestsView(APIView):
    """
    GET /api/v1/auth/friends/requests/
    Lista pedidos de amizade recebidos e pendentes.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import Friendship

        pending = Friendship.objects.filter(
            receiver=request.user,
            status=Friendship.STATUS_PENDING,
        ).select_related("requester__profile")

        data = []
        for f in pending:
            req = f.requester
            profile = getattr(req, "profile", None)
            data.append(
                {
                    "id": f.id,
                    "requester_id": req.id,
                    "username": getattr(profile, "username", None),
                    "full_name": req.full_name,
                    "avatar": _friend_avatar_url(request, profile),
                    "created_at": f.created_at.isoformat(),
                }
            )

        return Response(data)


class FriendRequestActionView(APIView):
    """
    POST   /api/v1/auth/friends/{id}/  → aceitar pedido recebido
    DELETE /api/v1/auth/friends/{id}/  → rejeitar ou remover amizade
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from .models import Friendship

        try:
            friendship = Friendship.objects.get(
                id=pk, receiver=request.user, status=Friendship.STATUS_PENDING
            )
        except Friendship.DoesNotExist:
            return Response(
                {"detail": "Pedido não encontrado."}, status=status.HTTP_404_NOT_FOUND
            )

        friendship.status = Friendship.STATUS_ACCEPTED
        friendship.save(update_fields=["status"])
        return Response({"detail": "Pedido aceito."})

    def delete(self, request, pk):
        from .models import Friendship

        try:
            friendship = Friendship.objects.get(
                Q(requester=request.user) | Q(receiver=request.user),
                id=pk,
            )
        except Friendship.DoesNotExist:
            return Response(
                {"detail": "Amizade não encontrada."}, status=status.HTTP_404_NOT_FOUND
            )

        friendship.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
