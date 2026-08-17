import logging
import secrets
import threading
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils.dateparse import parse_datetime
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
from .achievements import check_achievements, serialize_new
from .models import (
    AchievementDefinition,
    CorrespondenceGame,
    Game,
    GameAnalysis,
    GameLLMFeedback,
    ModalityRating,
    claim_llm_feedback,
    enqueue_analysis,
    get_or_create_profile,
    llm_feedback_enabled,
    normalize_analysis_moves,
    normalize_moves,
    normalize_termination,
)
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
            # Gate do onboarding em 3 toques (item 0.4): contas antigas foram
            # grandfathered pela migration 0010, então isso só é False para
            # contas novas que ainda não responderam às 3 perguntas.
            "onboarding_completed": (
                profile.onboarding_completed_at is not None if profile else True
            ),
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
        profile = get_or_create_profile(request.user)
        serializer = ProfileSerializer(profile, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        profile = get_or_create_profile(request.user)
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


# Níveis de dificuldade aceitos no payload de partida vs IA (PR C: 5 níveis).
# A partir do PR B (decisão D1) a IA NUNCA afeta o Glicko-2, então não há mais
# oponente-IA com rating/deviation próprios — o dicionário serve só para
# validar o nível recebido e como Elo aproximado exibido na UI.
AI_RATING = {
    "beginner": 800,
    "easy": 1100,
    "medium": 1400,
    "hard": 1700,
    "master": 2000,
}


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


def _is_clockless_request(data):
    """Partida sem relógio: chave `time_control` presente com valor None.

    ATENÇÃO — isto NÃO decide mais se a partida vale rating. Quem decide é o
    MODO da partida, explicitamente (ver GameResultView/AiGameResultView):
    humano-vs-humano SEMPRE vale, vs IA NUNCA vale. "Sem relógio" sobrou
    apenas como critério do gating do plano Grátis em partidas vs IA, que
    continua contando só as partidas COM relógio (regra de monetização
    existente, RF-MON-05).

    Chave ausente (clientes/node-api antigos) não é "sem relógio" — cai no
    default blitz de `_modality_from_request`.
    """
    return "time_control" in data and data.get("time_control") is None


def _locked_modality_rating(profile, modality):
    rating, _ = ModalityRating.objects.select_for_update().get_or_create(
        profile=profile, modality=modality
    )
    return rating


def _modality_rating_snapshot(profile, modality):
    """Leitura do estado atual sem lock nem criação de linha — para partidas
    não rateadas, que só precisam do valor vigente para preencher histórico
    e resposta (rating_before == rating_after)."""
    rating = ModalityRating.objects.filter(profile=profile, modality=modality).first()
    # Instância não salva carrega os defaults (1500/350/0.06, 0 jogos)
    return rating or ModalityRating(profile=profile, modality=modality)


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


def _display_name(profile):
    """Nome a ser gravado como SNAPSHOT no `Game` (nunca lido da FK depois)."""
    return getattr(profile, "username", None) or profile.user.full_name


def _parse_started_at(raw):
    """Início da partida vindo do payload (ISO-8601), ou None.

    Nunca levanta: data torta vira None e a partida é registrada mesmo assim
    (`ended_at` sempre existe). Naive vira aware no fuso do projeto — o
    node-api manda UTC com `Z`, mas um cliente futuro pode esquecer.
    """
    if not isinstance(raw, str) or not raw:
        return None
    try:
        parsed = parse_datetime(raw)
    except ValueError:
        return None
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_default_timezone())
    return parsed


def _opt_int(value):
    """Inteiro do payload, ou None. Usado nos campos opcionais da análise."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _opt_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _time_control_seconds(data):
    """Base do relógio em segundos, ou None (sem relógio / valor inválido).

    A MODALIDADE já é derivada disto em `_modality_from_request`; aqui o valor
    é guardado cru no `Game`, que é o registro da partida.
    """
    value = data.get("time_control")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _unchanged_rating_block(user_id, modality_rating):
    """Bloco de rating para uma resposta que NÃO alterou nada (resultado
    duplicado): delta 0 e `rating_before` == rating atual."""
    current = round(modality_rating.rating)
    return {
        "id": user_id,
        "rating": current,
        "rating_before": current,
        "delta": 0,
        "deviation": round(modality_rating.deviation),
        "provisional": modality_rating.is_provisional,
    }


def _game_payload_fields(data):
    """Campos do `Game` que vêm do payload — TODOS opcionais.

    Aditivo por construção: node-api/app antigos, que não mandam nada disto,
    continuam registrando a partida (sem os lances). Nada aqui pode recusar um
    resultado — inclusive o teto de lances, que TRUNCA em vez de rejeitar.

    `initial_fen` de propósito NÃO vem do payload: toda partida do produto
    começa na posição inicial (o default do model), e aceitar uma FEN
    arbitrária do cliente só abriria espaço para registro inconsistente.
    """
    moves, ply_count, truncated = normalize_moves(data.get("moves"))
    final_fen = data.get("final_fen")
    return {
        "moves": moves,
        "ply_count": ply_count,
        "moves_truncated": truncated,
        "final_fen": final_fen[:100] if isinstance(final_fen, str) else "",
        "termination": normalize_termination(data.get("termination")),
        "started_at": _parse_started_at(data.get("started_at")),
    }


class GameResultView(APIView):
    """
    POST /api/v1/auth/game/result/
    Chamado internamente pelo node-api ao fim de cada partida.
    Atualiza wins/losses/draws/games_played e recalcula ELO dos dois jogadores.
    Autenticado por INTERNAL_API_SECRET no header X-Internal-Secret.
    Sem throttle: é tráfego interno do node-api — o AnonRateThrottle global
    (20/min por IP) descartaria resultados em horário de pico de partidas.

    TODA partida que chega aqui é humano-vs-humano, e TODA partida
    humano-vs-humano vale rating — sem exceção, sem "amistosa humana"
    (decisão de produto, 2026-08-02). `rated=True` é constante deste
    endpoint, nunca derivado de `time_control` nem aceito do cliente; o
    `time_control` só escolhe a MODALIDADE (bullet/blitz/rápido).

    Antes disto o valor vinha de `time_control is None`, o que fazia o
    relógio decidir se a partida contava — mesma classe de problema do furo
    de spoofing fechado em node-api/src/socket/index.js (cliente decidindo
    coisa que é do servidor).

    IDEMPOTENTE por `external_id` (o id da partida no node-api), quando ele
    vem no payload: o mesmo fim de partida reportado duas vezes registra a
    partida, o histórico e o Glicko-2 UMA vez só. Ver o bloco de idempotência
    no corpo para os cenários concorrentes que motivam isso.
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
        # Id da partida no node-api. Opcional: node-api antigo não manda, e aí
        # não há idempotência possível — o comportamento é o de sempre.
        external_id = request.data.get("external_id") or None
        if external_id is not None:
            external_id = str(external_id)[:64]

        if (
            not white_id
            or not black_id
            or result not in ("white", "black", "draw")
            or modality is None
        ):
            return Response(
                {"detail": "Dados inválidos."}, status=status.HTTP_400_BAD_REQUEST
            )

        from .models import GameHistory, get_or_create_profile_by_user_id

        with transaction.atomic():
            # Um usuário sem Profile se autocorrige (get_or_create), nunca
            # 404 — mas só quando white_id/black_id de fato existem como
            # User (a checagem de existência mora no helper, ver models.py).
            white_profile = get_or_create_profile_by_user_id(white_id, for_update=True)
            black_profile = get_or_create_profile_by_user_id(black_id, for_update=True)
            if white_profile is None or black_profile is None:
                return Response(
                    {"detail": "Perfil não encontrado."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            white_rating = _locked_modality_rating(white_profile, modality)
            black_rating = _locked_modality_rating(black_profile, modality)

            # ── Idempotência ────────────────────────────────────────────────
            # A PARTIDA é registrada ANTES de qualquer mutação, e o unique de
            # `external_id` é o que garante que ela seja registrada UMA vez.
            # Dois finais concorrentes da mesma partida (desistência no mesmo
            # instante do timer de abandono, xeque-mate junto com aceite de
            # empate, duplo toque em "Desistir") chegam aqui com o mesmo
            # external_id: o primeiro cria, o segundo encontra e sai sem
            # mexer em rating, contador nem histórico.
            #
            # A checagem tem de vir DEPOIS do lock dos perfis: é o lock que
            # serializa as duas requisições concorrentes até aqui.
            game_defaults = {
                "mode": Game.MODE_ONLINE,
                "modality": modality,
                "white_player": white_profile.user,
                "black_player": black_profile.user,
                "white_name": _display_name(white_profile),
                "black_name": _display_name(black_profile),
                "result": result,
                "time_control": _time_control_seconds(request.data),
                **_game_payload_fields(request.data),
            }
            if external_id:
                game, created = Game.objects.get_or_create(
                    external_id=external_id, defaults=game_defaults
                )
                if not created:
                    # `duplicate` avisa o node-api para NÃO reemitir o
                    # `game_rated` — o delta verdadeiro já foi transmitido
                    # pela primeira chamada, e um segundo evento com delta 0
                    # sobrescreveria o número certo na tela dos jogadores.
                    return Response(
                        {
                            "duplicate": True,
                            "modality": modality,
                            "rated": True,
                            "white": _unchanged_rating_block(
                                white_profile.user_id, white_rating
                            ),
                            "black": _unchanged_rating_block(
                                black_profile.user_id, black_rating
                            ),
                        },
                        status=status.HTTP_200_OK,
                    )
            else:
                game = Game.objects.create(**game_defaults)

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
                getattr(black_profile, "username", None) or black_profile.user.full_name
            )
            b_name = (
                getattr(white_profile, "username", None) or white_profile.user.full_name
            )
            # `color`: a informação de quem jogou de brancas/pretas já chegava
            # no payload (white_id/black_id) e era descartada. Registrar aqui
            # é o passo barato que permite, numa PR futura, balancear a cor no
            # pareamento a partir do histórico de cada jogador.
            # As DUAS linhas apontam para a MESMA partida: é o que permite
            # abrir o mesmo tabuleiro a partir do histórico de qualquer um dos
            # dois jogadores.
            white_history = GameHistory.objects.create(
                user=white_profile.user,
                game=game,
                opponent_name=w_name,
                result=w_result,
                mode=GameHistory.MODE_ONLINE,
                modality=modality,
                rating_before=w_before,
                rating_after=round(white_rating.rating),
                # Constante, não derivada: partida humano-vs-humano SEMPRE
                # vale rating (ver docstring da view).
                rated=True,
                color=GameHistory.COLOR_WHITE,
            )
            black_history = GameHistory.objects.create(
                user=black_profile.user,
                game=game,
                opponent_name=b_name,
                result=b_result,
                mode=GameHistory.MODE_ONLINE,
                modality=modality,
                rating_before=b_before,
                rating_after=round(black_rating.rating),
                rated=True,
                color=GameHistory.COLOR_BLACK,
            )

            # Fila de análise pós-jogo (Fase 2). Basta UM dos dois ser
            # pagante — a partida é um tabuleiro só e a análise roda uma vez;
            # quem não paga recebe "indisponível" na leitura. No-op com a
            # flag desligada.
            enqueue_analysis(game, [white_profile, black_profile])

            # Conquistas dos DOIS jogadores. Uma chamada por jogador porque a
            # partida gera um extrato para cada um, e cada um pode desbloquear
            # coisas diferentes — avaliar só quem fez a requisição (o
            # node-api) não daria conquista a ninguém.
            white_novas = check_achievements(
                white_profile.user,
                AchievementDefinition.TRIGGER_GAME,
                {"game": game, "history": white_history},
            )
            black_novas = check_achievements(
                black_profile.user,
                AchievementDefinition.TRIGGER_GAME,
                {"game": game, "history": black_history},
            )

        # `rated`/`rating_before`/`delta` na resposta: o node-api repassa isto
        # aos dois jogadores para a tela de resultado mostrar o delta REAL do
        # Glicko-2 (+X/-Y) em vez de um texto genérico. O app nunca calcula o
        # delta por conta própria — quem rateia é o servidor.
        return Response(
            {
                "modality": modality,
                "rated": True,
                # Endereço da partida para a tela de análise. O node-api
                # repassa isto aos dois jogadores no evento `game_rated` — sem
                # ele o app não teria como pedir a análise da partida que
                # acabou de jogar.
                "game_public_id": str(game.public_id),
                "white": {
                    "id": white_profile.user_id,
                    "rating": round(white_rating.rating),
                    "rating_before": w_before,
                    "delta": round(white_rating.rating) - w_before,
                    "deviation": round(white_rating.deviation),
                    "provisional": white_rating.is_provisional,
                    # Conquistas de CADA jogador: o node-api repassa a cada um
                    # a sua, para o app celebrar na hora do fim de partida.
                    "conquistas_novas": serialize_new(white_novas),
                },
                "black": {
                    "id": black_profile.user_id,
                    "rating": round(black_rating.rating),
                    "rating_before": b_before,
                    "delta": round(black_rating.rating) - b_before,
                    "deviation": round(black_rating.deviation),
                    "provisional": black_rating.is_provisional,
                    "conquistas_novas": serialize_new(black_novas),
                },
            },
            status=status.HTTP_200_OK,
        )


class AiGameResultView(APIView):
    """
    POST /api/v1/auth/game/ai-result/
    Registra resultado de partida contra IA para o usuário autenticado.
    Atualiza stats, recalcula ELO e salva no histórico.

    Sem idempotência por `external_id`, ao contrário do GameResultView: neste
    fluxo a partida acontece DENTRO do app (não existe partida no node-api,
    logo não existe id de servidor para deduplicar). O app reporta uma vez, no
    fim da partida.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        result = request.data.get("result")
        difficulty = request.data.get("difficulty", "medium")
        modality = _modality_from_request(request.data)
        # Cor jogada pelo humano. Opcional: app antigo não manda — e sem ela
        # não dá para montar o `Game` (o resultado dele é do TABULEIRO:
        # brancas/pretas/empate, não "ganhei/perdi"). Nesse caso a partida
        # entra só como extrato, com `GameHistory.game` null, exatamente como
        # todo o histórico anterior a esta feature.
        player_color = request.data.get("player_color")
        if player_color not in (Game.COLOR_WHITE, Game.COLOR_BLACK):
            player_color = None
        # TODA partida vs IA é congelada para efeito de rating — nunca altera
        # o Glicko-2, tenha relógio ou não. `no_clock` fica só para o gating
        # do plano Grátis (que continua contando as partidas COM relógio,
        # preservando a regra de monetização existente).
        no_clock = _is_clockless_request(request.data)

        if result not in ("win", "loss", "draw"):
            return Response(
                {"detail": "result deve ser 'win', 'loss' ou 'draw'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if difficulty not in AI_RATING:
            return Response(
                {
                    "detail": (
                        "difficulty deve ser um de: "
                        f"{', '.join(repr(level) for level in AI_RATING)}."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if modality is None:
            return Response(
                {"detail": "time_control deve ser um número de segundos ou null."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.payments.access import FREE_DAILY_GAME_LIMIT, can_play_game

        from .models import GameHistory, Profile, record_campaign_win

        with transaction.atomic():
            # Autenticado sem Profile se autocorrige (get_or_create), nunca
            # 404 — era a causa real de partidas vs IA sumirem para contas
            # órfãs. `user=request.user` sempre existe, então não há FK
            # inválida a temer aqui (diferente do GameResultView, que recebe
            # ids crus do node-api).
            profile, _ = Profile.objects.select_for_update().get_or_create(
                user=request.user
            )

            # Gating do plano Grátis (RF-MON-05, item 0.1): 5 partidas/dia
            # (IA + online somadas). Plano pago (trialing/active) é
            # ilimitado. Defesa em profundidade: a checagem principal é
            # pré-jogo (GET /payments/can-play/, consultado pelo app antes
            # de abrir o tabuleiro) — aqui é a rede de segurança contra
            # clients que burlem o início. Partidas sem relógio (unrated,
            # decisão do PR #68) não são gateadas, mas continuam contando
            # no GameHistory (a regra de contagem não muda).
            allowed, remaining = can_play_game(profile)
            if not no_clock and not allowed:
                return Response(
                    {
                        "detail": (
                            "Limite diário do plano Grátis atingido "
                            f"({FREE_DAILY_GAME_LIMIT} partidas/dia). "
                            "Assine o Premium para jogar sem limites."
                        ),
                        "code": "daily_limit_reached",
                        "remaining_games_today": remaining,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Rating SEMPRE congelado numa partida vs IA — leitura sem
            # lock/criação, só para preencher histórico e resposta. Nada de
            # Glicko-2 nem de espelho Profile.rating aqui.
            modality_rating = _modality_rating_snapshot(profile, modality)
            rating_before = round(modality_rating.rating)

            if result == "win":
                profile.wins += 1
            elif result == "loss":
                profile.losses += 1
            else:
                profile.draws += 1

            profile.games_played += 1
            profile.save(update_fields=["wins", "losses", "draws", "games_played"])

            difficulty_label = {
                "beginner": "IA Iniciante",
                "easy": "IA Fácil",
                "medium": "IA Médio",
                "hard": "IA Difícil",
                "master": "IA Mestre",
            }
            ai_label = difficulty_label[difficulty]

            game = None
            if player_color is not None:
                ai_color = (
                    Game.COLOR_BLACK
                    if player_color == Game.COLOR_WHITE
                    else Game.COLOR_WHITE
                )
                human_won = result == "win"
                # Resultado do tabuleiro a partir da perspectiva do humano —
                # é para isto que `player_color` é indispensável.
                if result == "draw":
                    board_result = Game.RESULT_DRAW
                elif (player_color == Game.COLOR_WHITE) == human_won:
                    board_result = Game.RESULT_WHITE
                else:
                    board_result = Game.RESULT_BLACK

                human_name = _display_name(profile)
                game = Game.objects.create(
                    mode=Game.MODE_AI,
                    modality=modality,
                    # Só um lado tem User: o outro é a IA, que fica com a FK
                    # null e apenas o nome de snapshot.
                    white_player=(
                        request.user if player_color == Game.COLOR_WHITE else None
                    ),
                    black_player=(
                        request.user if player_color == Game.COLOR_BLACK else None
                    ),
                    white_name=(
                        human_name if player_color == Game.COLOR_WHITE else ai_label
                    ),
                    black_name=(
                        human_name if player_color == Game.COLOR_BLACK else ai_label
                    ),
                    ai_difficulty=difficulty,
                    ai_color=ai_color,
                    result=board_result,
                    time_control=_time_control_seconds(request.data),
                    **_game_payload_fields(request.data),
                )

            history = GameHistory.objects.create(
                user=request.user,
                game=game,
                opponent_name=ai_label,
                result=result,
                mode=GameHistory.MODE_AI,
                modality=modality,
                rating_before=rating_before,
                rating_after=rating_before,  # rating não muda vs IA
                # Constante, igual e oposta ao GameResultView: partida vs IA
                # NUNCA vale rating, tenha relógio ou não.
                rated=False,
                color=player_color,
            )

            # Modo Campanha (épico): só vitória progride, em qualquer
            # controle de tempo (não filtra por no_clock — regra diferente
            # da de rating). Atrelado ao id do EXTRATO (GameHistory) —
            # idempotente por construção (ver record_campaign_win).
            if result == "win":
                record_campaign_win(profile, difficulty, history.id)

            # Conquistas: FORA do `if` de vitória de propósito — "10 partidas
            # jogadas" conta derrota e empate também. Nunca levanta (ver
            # check_achievements), então não precisa de try/except aqui.
            novas_conquistas = check_achievements(
                request.user,
                AchievementDefinition.TRIGGER_GAME,
                {"game": game, "history": history},
            )

            # Fila de análise pós-jogo (Fase 2). `game` é None quando o app
            # não mandou `player_color` — sem partida montada não há o que
            # analisar. No-op com a flag desligada.
            if game is not None:
                enqueue_analysis(game, [profile])

        return Response(
            {
                "rating": round(modality_rating.rating),
                "deviation": round(modality_rating.deviation),
                "provisional": modality_rating.is_provisional,
                "modality": modality,
                # Espelha o campo do GameResultView para o app não precisar
                # inferir o modo pela tela em que está (ver GameOverModal).
                "rated": False,
                "delta": 0,
                # Endereço da partida para a tela de análise
                # (GET games/<public_id>/analysis/). Null quando não houve
                # partida montada (app antigo, sem `player_color`) — e aí não
                # há análise a buscar.
                "game_public_id": str(game.public_id) if game is not None else None,
                # Conquistas desbloqueadas por ESTA partida, para o app
                # celebrar no fim de jogo sem ter de descobrir sozinho.
                "conquistas_novas": serialize_new(novas_conquistas),
            },
            status=status.HTTP_200_OK,
        )


class InternalColorBalanceView(APIView):
    """
    GET /api/v1/auth/internal/color-balance/?user_id=N&user_id=M

    Histórico de cor dos jogadores candidatos ao pareamento, para o node-api
    decidir quem joga de brancas na busca rápida (Item 6). Aceita vários
    `user_id` numa chamada só: o pareamento precisa dos DOIS jogadores ao
    mesmo tempo, e duas idas ao Django no caminho crítico dobrariam a
    latência do `join_queue`.

    Por que no servidor: a alternativa barata seria o cliente mandar os
    próprios contadores no `join_queue` — e aí ele escolheria a própria cor
    mentindo o histórico. É o mesmo furo de spoofing já fechado no
    node-api/src/socket/index.js (identidade vinda do token, não do payload).
    Contagem de cor é do servidor.

    Mesmo padrão de segredo compartilhado do GameResultView e do
    /payments/internal/can-play/ (X-Internal-Secret), sem throttle por ser
    tráfego interno.

    Resposta: {"players": {"<user_id>": {"white": 7, "black": 4}, ...}}
    Só conta partidas com cor registrada (o histórico anterior à migration
    0016 tem `color` nulo e fica de fora — ver GameHistory.color).
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        secret = request.headers.get("X-Internal-Secret", "")
        expected = getattr(settings, "INTERNAL_API_SECRET", "")
        if not expected or secret != expected:
            return Response(
                {"detail": "Não autorizado."}, status=status.HTTP_403_FORBIDDEN
            )

        raw_ids = request.query_params.getlist("user_id")
        if not raw_ids:
            return Response(
                {"detail": "user_id é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            user_ids = [int(v) for v in raw_ids]
        except (TypeError, ValueError):
            return Response(
                {"detail": "user_id deve ser numérico."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from django.db.models import Count

        from .models import GameHistory

        # Uma query só para os dois jogadores. Usuário sem histórico
        # simplesmente não aparece no agrupamento e cai no zero abaixo — o
        # node-api sorteia a cor nesse caso (nada a balancear ainda).
        rows = (
            GameHistory.objects.filter(
                user_id__in=user_ids,
                mode=GameHistory.MODE_ONLINE,
                color__isnull=False,
            )
            .values("user_id", "color")
            .annotate(n=Count("id"))
        )

        players = {str(uid): {"white": 0, "black": 0} for uid in user_ids}
        for row in rows:
            key = "white" if row["color"] == GameHistory.COLOR_WHITE else "black"
            players[str(row["user_id"])][key] = row["n"]

        return Response({"players": players})


# ─── Análise pós-jogo (Fase 2) ────────────────────────────────────────────────
#
# Três endpoints, dois públicos-alvo:
#
#   node-api  GET  internal/analysis/next/    pega trabalho (aluga)
#             POST internal/analysis/result/  devolve o resultado
#   app       GET  games/<public_id>/analysis/  lê, se o plano permitir
#
# A FILA MORA AQUI, no Postgres, e o node-api PUXA. Nenhum canal
# Django → node-api é criado — a direção continua sendo só node-api → Django,
# que é a que já existe e já tem segredo compartilhado. O ganho não é de
# elegância: o node-api reinicia a cada deploy e perde o que está em memória,
# então quem sabe que a análise está pendente precisa ser quem sobrevive.

# Quanto tempo o node-api tem para terminar uma análise antes de o trabalho
# voltar para a fila. Generoso de propósito: o pior caso (300 plies a 400ms,
# com recuo cooperativo quando há partida ao vivo) passa de 2 min, e devolver
# à fila cedo demais faria duas engines analisarem a mesma partida.
ANALYSIS_LEASE_MINUTES = 15


def _internal_secret_ok(request):
    secret = request.headers.get("X-Internal-Secret", "")
    expected = getattr(settings, "INTERNAL_API_SECRET", "")
    return bool(expected) and secret == expected


class InternalAnalysisNextView(APIView):
    """
    GET /api/v1/auth/internal/analysis/next/
    O node-api pergunta se há partida para analisar. Autenticado por
    INTERNAL_API_SECRET, sem throttle (tráfego interno, em polling).

    Entrega no máximo UMA análise por chamada e a ALUGA: marca
    `status=analisando` e `leased_until`. Aluguel vencido significa que o
    worker morreu no meio (deploy, queda) — o trabalho volta a ser elegível
    aqui mesmo, sem daemon nem cron.

    Depois de MAX_ATTEMPTS tentativas a análise vira `falhou` em vez de
    voltar para a fila: uma partida que derruba o worker toda vez ocuparia a
    engine para sempre.

    Responde 204 quando não há trabalho — o node-api trata como "dorme e
    pergunta de novo", não como erro.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        if not _internal_secret_ok(request):
            return Response(
                {"detail": "Não autorizado."}, status=status.HTTP_403_FORBIDDEN
            )

        now = timezone.now()
        with transaction.atomic():
            # `select_for_update(skip_locked=True)`: se um dia houver mais de
            # um worker, cada um pega uma linha diferente em vez de os dois
            # disputarem a mesma. Com um worker só é inofensivo.
            candidates = (
                GameAnalysis.objects.select_for_update(skip_locked=True)
                .filter(
                    Q(status=GameAnalysis.STATUS_PENDING)
                    | Q(status=GameAnalysis.STATUS_RUNNING, leased_until__lt=now)
                )
                .order_by("created_at")
            )

            for analysis in candidates:
                analysis.attempts += 1
                if analysis.attempts > GameAnalysis.MAX_ATTEMPTS:
                    analysis.status = GameAnalysis.STATUS_FAILED
                    analysis.failure_reason = (
                        f"Excedeu {GameAnalysis.MAX_ATTEMPTS} tentativas."
                    )
                    analysis.leased_until = None
                    analysis.completed_at = now
                    analysis.save(
                        update_fields=[
                            "attempts",
                            "status",
                            "failure_reason",
                            "leased_until",
                            "completed_at",
                        ]
                    )
                    continue

                analysis.status = GameAnalysis.STATUS_RUNNING
                analysis.leased_until = now + timedelta(minutes=ANALYSIS_LEASE_MINUTES)
                analysis.save(update_fields=["attempts", "status", "leased_until"])

                game = analysis.game
                return Response(
                    {
                        "analysis_id": analysis.id,
                        "game_public_id": str(game.public_id),
                        # Os lances vão no MESMO payload: sem isto o node-api
                        # precisaria de uma segunda chamada, e entre as duas a
                        # partida já estaria alugada por ele mesmo.
                        "moves": game.moves,
                        "initial_fen": game.initial_fen,
                        "result": game.result,
                        "mode": game.mode,
                        "max_plies": GameAnalysis.MAX_ANALYZED_PLIES,
                        "lease_seconds": ANALYSIS_LEASE_MINUTES * 60,
                    },
                    status=status.HTTP_200_OK,
                )

        return Response(status=status.HTTP_204_NO_CONTENT)


class InternalAnalysisResultView(APIView):
    """
    POST /api/v1/auth/internal/analysis/result/
    O node-api devolve o que calculou. Autenticado por INTERNAL_API_SECRET.

    Aceita os dois desfechos:
      sucesso  {analysis_id, moves, counts, accuracies, ...}
      falha    {analysis_id, failed: true, failure_reason}

    A falha reportada aqui é TERMINAL (partida com lance ilegal, payload
    corrompido): não adianta tentar de novo, o dado não vai melhorar. Falha
    por queda do worker é outra coisa — essa nem chega aqui, expira pelo
    aluguel e volta para a fila.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def post(self, request):
        if not _internal_secret_ok(request):
            return Response(
                {"detail": "Não autorizado."}, status=status.HTTP_403_FORBIDDEN
            )

        analysis_id = request.data.get("analysis_id")
        analysis = GameAnalysis.objects.filter(id=analysis_id).first()
        if analysis is None:
            return Response(
                {"detail": "Análise não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        now = timezone.now()

        if request.data.get("failed"):
            analysis.status = GameAnalysis.STATUS_FAILED
            analysis.failure_reason = str(request.data.get("failure_reason", ""))[:200]
            analysis.leased_until = None
            analysis.completed_at = now
            analysis.save(
                update_fields=[
                    "status",
                    "failure_reason",
                    "leased_until",
                    "completed_at",
                ]
            )
            return Response({"status": analysis.status}, status=status.HTTP_200_OK)

        moves, _total, _truncated = normalize_analysis_moves(request.data.get("moves"))
        analysis.moves = moves
        analysis.analyzed_plies = len(moves)
        analysis.counts = (
            request.data.get("counts")
            if isinstance(request.data.get("counts"), dict)
            else {}
        )
        analysis.white_accuracy = _opt_float(request.data.get("white_accuracy"))
        analysis.black_accuracy = _opt_float(request.data.get("black_accuracy"))
        analysis.white_avg_loss = _opt_int(request.data.get("white_avg_loss"))
        analysis.black_avg_loss = _opt_int(request.data.get("black_avg_loss"))
        analysis.turning_point_ply = _opt_int(request.data.get("turning_point_ply"))
        analysis.engine_depth = _opt_int(request.data.get("engine_depth"))
        analysis.engine_movetime = _opt_int(request.data.get("engine_movetime"))
        analysis.engine_id = str(request.data.get("engine_id", ""))[:60]
        analysis.params_version = (
            _opt_int(request.data.get("params_version")) or GameAnalysis.PARAMS_VERSION
        )
        analysis.status = GameAnalysis.STATUS_DONE
        analysis.failure_reason = ""
        analysis.leased_until = None
        analysis.completed_at = now
        analysis.save()

        return Response({"status": analysis.status}, status=status.HTTP_200_OK)


class GameDetailView(APIView):
    """
    GET /api/v1/auth/games/<public_id>/
    A PARTIDA em si — lances em ordem, resultado, jogadores e horários. É o
    que a tela de detalhe do histórico lê para reconstruir o jogo.

    Os MESMOS DOIS PORTÕES de GameAnalysisView, e pela mesma razão — só o
    segundo responde diferente:

      1. PARTICIPAÇÃO — quem não jogou recebe 404. Os lances são a partida
         inteira; não é dado público, e quem não jogou não precisa nem saber
         que ela existe.
      2. PLANO — `has_paid_access` do SOLICITANTE, checado DEPOIS da
         participação, para o 403 nunca virar um oráculo de "esta partida
         existe" para quem não jogou.

    Por que 403 aqui e `{"status": "indisponivel"}` com 200 lá: a análise é
    um recurso que a tela consulta em POLLING e cujo estado tem várias
    faces legítimas (pendente, pronta, inexistente) — "sem plano" é mais uma
    delas, e o app decide o que desenhar a partir do campo. A partida não tem
    estados: ou vem inteira, ou não vem. Um código HTTP é a resposta certa
    para um recurso que não é uma máquina de estados.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, public_id):
        from apps.payments.access import has_paid_access

        game = Game.objects.filter(public_id=public_id).first()
        if game is None:
            return Response(
                {"detail": "Partida não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.user.id not in (game.white_player_id, game.black_player_id):
            return Response(
                {"detail": "Partida não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        profile = get_or_create_profile(request.user)
        if not has_paid_access(profile):
            return Response(
                {"detail": "Rever a partida é exclusivo do plano pago."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # A cor de QUEM PEDIU. A tela precisa saber de que lado ler o resumo
        # (e a partida é sempre exibida da perspectiva de quem a jogou);
        # deixar o app deduzir compararia ids de usuário que ele não tem.
        player_color = (
            Game.COLOR_WHITE
            if request.user.id == game.white_player_id
            else Game.COLOR_BLACK
        )

        return Response(
            {
                "public_id": str(game.public_id),
                "mode": game.mode,
                "modality": game.modality,
                "white_name": game.white_name,
                "black_name": game.black_name,
                "player_color": player_color,
                "ai_difficulty": game.ai_difficulty,
                "ai_color": game.ai_color,
                "moves": game.moves,
                # `ply_count` é o tamanho REAL da partida e pode passar de
                # len(moves): ver Game.MAX_PLIES. A tela precisa dos dois para
                # poder dizer "guardamos os primeiros N".
                "ply_count": game.ply_count,
                "moves_truncated": game.moves_truncated,
                "initial_fen": game.initial_fen,
                "final_fen": game.final_fen,
                "result": game.result,
                "termination": game.termination,
                "time_control": game.time_control,
                "started_at": game.started_at.isoformat() if game.started_at else None,
                "ended_at": game.ended_at.isoformat() if game.ended_at else None,
            },
            status=status.HTTP_200_OK,
        )


class GameAnalysisView(APIView):
    """
    GET /api/v1/auth/games/<public_id>/analysis/
    Estado e conteúdo da análise, para o app fazer polling depois da partida.

    DOIS portões, que protegem coisas diferentes:

      1. PARTICIPAÇÃO — quem não jogou a partida recebe 404. Análise revela a
         partida inteira lance a lance; não é dado público.
      2. PLANO — `has_paid_access` do SOLICITANTE. Numa partida em que só um
         dos dois paga, a análise existe (foi enfileirada por causa dele) e o
         outro recebe `indisponivel` mesmo com o status `pronta`.

    O gating de plano é do LEITOR, não da partida: é por isso que ele não
    pode ser resolvido só no enfileiramento.
    """

    permission_classes = [IsAuthenticated]

    STATUS_UNAVAILABLE = "indisponivel"
    STATUS_NONE = "inexistente"

    def get(self, request, public_id):
        from apps.payments.access import has_paid_access

        game = Game.objects.filter(public_id=public_id).first()
        if game is None:
            return Response(
                {"detail": "Partida não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        user_id = request.user.id
        if user_id not in (game.white_player_id, game.black_player_id):
            # 404 e não 403: quem não jogou não precisa nem saber que a
            # partida existe.
            return Response(
                {"detail": "Partida não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        profile = get_or_create_profile(request.user)
        if not has_paid_access(profile):
            return Response(
                {"status": self.STATUS_UNAVAILABLE}, status=status.HTTP_200_OK
            )

        analysis = getattr(game, "analysis", None)
        if analysis is None:
            # Partida sem análise: anterior à feature, flag desligada quando
            # ela terminou, ou nenhum dos jogadores era pagante na época.
            return Response({"status": self.STATUS_NONE}, status=status.HTTP_200_OK)

        if analysis.status != GameAnalysis.STATUS_DONE:
            return Response(
                {
                    "status": analysis.status,
                    "failure_reason": analysis.failure_reason,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "status": analysis.status,
                "params_version": analysis.params_version,
                "engine": {
                    "id": analysis.engine_id,
                    "depth": analysis.engine_depth,
                    "movetime": analysis.engine_movetime,
                },
                "white": {
                    "accuracy": analysis.white_accuracy,
                    "avg_loss": analysis.white_avg_loss,
                    "counts": (analysis.counts or {}).get("white", {}),
                },
                "black": {
                    "accuracy": analysis.black_accuracy,
                    "avg_loss": analysis.black_avg_loss,
                    "counts": (analysis.counts or {}).get("black", {}),
                },
                "turning_point_ply": analysis.turning_point_ply,
                "analyzed_plies": analysis.analyzed_plies,
                # Menor que o total quando a partida passou do teto de
                # análise — a tela precisa poder dizer "analisamos até aqui".
                "total_plies": analysis.game.ply_count,
                "moves": analysis.moves,
            },
            status=status.HTTP_200_OK,
        )


class GameLLMFeedbackView(APIView):
    """
    GET  /api/v1/auth/games/<public_id>/analysis/feedback/  → estado + conteúdo
    POST /api/v1/auth/games/<public_id>/analysis/feedback/  → gera (sob demanda)

    Comentário humanizado da partida (Fase 3), em cima da análise que o
    Stockfish já produziu. COMPLEMENTA a Fase 2 e não altera nada dela.

    OS MESMOS DOIS PORTÕES de GameAnalysisView, na mesma ordem e pela mesma
    razão: participação primeiro (404, quem não jogou não fica sabendo que a
    partida existe), plano depois (403, para o 403 não virar oráculo de
    existência). Aqui a reverificação de plano deixa de ser só higiene e vira
    controle de GASTO: cada geração custa dinheiro de verdade.

    O texto é NEUTRO ("as brancas"/"as pretas") porque é UM comentário para os
    DOIS jogadores — 1 geração por partida (decisão de custo). Quem rotula a
    perspectiva ("você jogou de brancas") é o app, que já sabe a cor pelo
    `player_color` do GameDetailView.

    O POST é idempotente: se já está pronto, devolve o mesmo texto sem chamar
    o provedor de novo.
    """

    permission_classes = [IsAuthenticated]
    throttle_scope = "llm_feedback"

    STATUS_UNAVAILABLE = "indisponivel"
    STATUS_NONE = "inexistente"
    STATUS_BLOCKED = "bloqueado"
    STATUS_DISABLED = "desligado"

    def _resolve(self, request, public_id):
        """Portões comuns ao GET e ao POST.

        Devolve `(game, analysis, resposta_de_erro)` — com resposta preenchida,
        o handler devolve ela e não segue.
        """
        from apps.payments.access import has_paid_access

        game = Game.objects.filter(public_id=public_id).first()
        if game is None:
            return (
                None,
                None,
                Response(
                    {"detail": "Partida não encontrada."},
                    status=status.HTTP_404_NOT_FOUND,
                ),
            )

        if request.user.id not in (game.white_player_id, game.black_player_id):
            return (
                None,
                None,
                Response(
                    {"detail": "Partida não encontrada."},
                    status=status.HTTP_404_NOT_FOUND,
                ),
            )

        profile = get_or_create_profile(request.user)
        if not has_paid_access(profile):
            return (
                game,
                None,
                Response(
                    {"status": self.STATUS_UNAVAILABLE}, status=status.HTTP_200_OK
                ),
            )

        analysis = getattr(game, "analysis", None)
        return game, analysis, None

    def _payload(self, feedback):
        """Estado do comentário para o app. `sections` só quando pronto."""
        if feedback.status == GameLLMFeedback.STATUS_DONE:
            return {
                "status": feedback.status,
                "sections": feedback.sections,
                "prompt_version": feedback.prompt_version,
            }
        body = {
            "status": feedback.status,
            "attempts": feedback.attempts,
            "max_attempts": GameLLMFeedback.MAX_ATTEMPTS,
            # O app não precisa inventar cadência de polling: só há motivo
            # para perguntar de novo enquanto está gerando.
            "can_retry": not feedback.is_terminal,
        }
        if feedback.status == GameLLMFeedback.STATUS_FAILED:
            body["failure_reason"] = feedback.failure_reason
        return body

    def get(self, request, public_id):
        game, analysis, early = self._resolve(request, public_id)
        if early is not None:
            return early

        # A flag vale para a LEITURA também, não só para o POST. Sem isto, com
        # a feature desligada o GET respondia `inexistente`, o app desenhava o
        # botão "Gerar comentário" e o toque no botão fazia a seção SUMIR (o
        # POST responde `desligado`). Como a flag nasce desligada, esse era o
        # comportamento padrão em produção — e não o silêncio combinado.
        #
        # Já existe um comentário PRONTO? Ele continua sendo entregue mais
        # abaixo: desligar a geração não pode apagar o que o usuário já pediu,
        # viu e, no fim das contas, pagou.
        if not llm_feedback_enabled():
            existing = getattr(analysis, "llm_feedback", None) if analysis else None
            if existing is None or existing.status != GameLLMFeedback.STATUS_DONE:
                return Response(
                    {"status": self.STATUS_DISABLED}, status=status.HTTP_200_OK
                )
            return Response(self._payload(existing), status=status.HTTP_200_OK)

        if analysis is None or analysis.status != GameAnalysis.STATUS_DONE:
            # Sem análise Stockfish pronta não há matéria-prima. O app mostra
            # o botão desabilitado em vez de deixar o usuário gastar um toque.
            return Response({"status": self.STATUS_BLOCKED}, status=status.HTTP_200_OK)

        feedback = getattr(analysis, "llm_feedback", None)
        if feedback is None:
            return Response({"status": self.STATUS_NONE}, status=status.HTTP_200_OK)

        return Response(self._payload(feedback), status=status.HTTP_200_OK)

    def post(self, request, public_id):
        game, analysis, early = self._resolve(request, public_id)
        if early is not None:
            return early

        if not llm_feedback_enabled():
            return Response({"status": self.STATUS_DISABLED}, status=status.HTTP_200_OK)

        if analysis is None or analysis.status != GameAnalysis.STATUS_DONE:
            return Response(
                {
                    "status": self.STATUS_BLOCKED,
                    "detail": "A análise da partida ainda não ficou pronta.",
                },
                status=status.HTTP_409_CONFLICT,
            )

        existing = getattr(analysis, "llm_feedback", None)
        if existing is not None and existing.status == GameLLMFeedback.STATUS_DONE:
            # Idempotente: já foi gerado, devolve o MESMO texto. Não chama o
            # provedor e não gasta nada.
            return Response(self._payload(existing), status=status.HTTP_200_OK)

        feedback, claimed = claim_llm_feedback(analysis, user=request.user)
        if not claimed:
            # Outra requisição está gerando agora, ou as tentativas acabaram.
            # Nos dois casos o estado atual já diz tudo ao app.
            return Response(self._payload(feedback), status=status.HTTP_200_OK)

        _spawn_llm_feedback(feedback.pk)
        return Response(self._payload(feedback), status=status.HTTP_202_ACCEPTED)


def _spawn_llm_feedback(feedback_id):
    """Dispara a geração fora do ciclo da requisição.

    Thread, e não chamada síncrona, por uma razão de infra: o Django roda em
    gunicorn SÍNCRONO com 4 workers, então uma chamada de 10-15s seguraria um
    quarto da capacidade do backend inteiro — login e partidas incluídos.

    Thread, e não Celery, porque não há Celery no projeto. A rede de segurança
    para a thread morrer no meio (deploy, queda) é o `leased_until`: lease
    vencido volta a ser reivindicável, exatamente como na fila da Fase 2. A
    recuperação é o próprio usuário tocando de novo — sem daemon, sem cron.
    """
    from .llm_feedback import generate_feedback

    def runner():
        # `close_old_connections` dos dois lados: a thread não herda o ciclo
        # de conexão da requisição, e deixar conexão pendurada no pool é o
        # jeito clássico de uma thread de background derrubar o Postgres.
        from django.db import close_old_connections

        close_old_connections()
        try:
            generate_feedback(feedback_id)
        finally:
            close_old_connections()

    threading.Thread(
        target=runner, name=f"llm-feedback-{feedback_id}", daemon=True
    ).start()


class AchievementListView(APIView):
    """
    GET /api/v1/auth/achievements/
    Catálogo de conquistas ATIVAS com o estado do usuário autenticado.

    Devolve todas — inclusive as ainda não conquistadas — porque a tela mostra
    o que há a perseguir, não só o que já foi feito. `progresso` só vem nas
    regras cumulativas e enquanto a conquista não foi desbloqueada: "7/10
    partidas" ajuda; "10/10" depois de conquistada é ruído.

    Conquista aposentada (`is_active=False`) que o usuário JÁ ganhou continua
    aparecendo: tirar de circulação não pode apagar o que alguém conquistou.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .achievements import current_progress
        from .models import AchievementDefinition, UserAchievement

        unlocked = {
            ua.achievement_id: ua
            for ua in UserAchievement.objects.filter(user=request.user).select_related(
                "achievement"
            )
        }
        definitions = list(AchievementDefinition.objects.filter(is_active=True))
        # As aposentadas que o usuário tem entram junto, ao fim da lista.
        inativas_conquistadas = [
            ua.achievement for ua in unlocked.values() if not ua.achievement.is_active
        ]

        data = []
        for definition in definitions + inativas_conquistadas:
            ua = unlocked.get(definition.id)
            item = {
                "code": definition.code,
                "nome": definition.name,
                "descricao": definition.description,
                "icone": definition.icon,
                "categoria": definition.category,
                "conquistada": ua is not None,
                "conquistada_em": ua.unlocked_at.isoformat() if ua else None,
                # "nova" = conquistada mas ainda não comemorada. É o servidor
                # que decide, para a comemoração não repetir ao trocar de
                # aparelho nem sumir ao reinstalar o app.
                "nova": bool(ua and ua.seen_at is None),
            }
            if ua is None:
                progresso = current_progress(request.user, definition)
                if progresso is not None:
                    atual, alvo = progresso
                    item["progresso"] = {"atual": atual, "alvo": alvo}
            data.append(item)

        return Response(data)


class AchievementSeenView(APIView):
    """
    POST /api/v1/auth/achievements/seen/
    Marca conquistas como já comemoradas. Corpo opcional: {"codes": [...]}.
    Sem corpo, marca todas as pendentes.

    É o que impede a celebração dupla: o fim de partida comemora a partir do
    `conquistas_novas` da resposta e chama isto em seguida; o que sobrar
    aparece na tela de conquistas com `nova: true` até ser visto lá.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .achievements import mark_seen

        codes = request.data.get("codes") if isinstance(request.data, dict) else None
        if codes is not None and not isinstance(codes, list):
            return Response(
                {"detail": "`codes` deve ser uma lista."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        marcadas = mark_seen(request.user, codes)
        return Response({"marcadas": marcadas}, status=status.HTTP_200_OK)


class CampaignProgressView(APIView):
    """
    GET /api/v1/auth/campaign/
    Estado dos 5 níveis do Modo Campanha vs IA para o perfil autenticado —
    consumido pelo wizard (cadeado + progresso) e pelo Perfil (selos).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import CampaignProgress, ensure_campaign_progress

        profile = get_or_create_profile(request.user)
        # Defensivo: perfis anteriores ao backfill (migration 0015) ou
        # criados fora do signal (não deveria ocorrer) ganham as 5 linhas
        # na hora — mesmo padrão do get_or_create_profile().
        ensure_campaign_progress(profile)

        progress_by_level = {
            p.level: p for p in CampaignProgress.objects.filter(profile=profile)
        }
        data = [
            {
                "nivel": level,
                "desbloqueado": progress_by_level[level].unlocked,
                "vitorias": progress_by_level[level].wins,
                "vitorias_para_desbloquear": CampaignProgress.WINS_TO_UNLOCK,
                "selo_concedido": progress_by_level[level].badge_awarded,
            }
            for level in CampaignProgress.LEVEL_ORDER
        ]
        return Response(data)


# ─── Onboarding em 3 toques (item 0.4) ────────────────────────────────────────

# Seed de rating por nível — mesma escala do AI_RATING (easy/medium/hard),
# com deviation 350 / volatility 0.06 (defaults do Glicko-2, iguais ao seed
# uniforme das migrations do item 0.3). O RD alto faz o rating convergir
# rápido nas primeiras partidas mesmo se o nível autodeclarado errar.
ONBOARDING_SEED_RATING = {"beginner": 800, "intermediate": 1200, "advanced": 1600}

# Pontuação simples e documentada: cada resposta soma pontos e a soma decide
# o nível. Experiência prévia e reconhecer o mate pesam mais que a frequência
# desejada (que mede intenção, não habilidade).
#   experiência: nunca=0 · casual=1 · frequente=2
#   mate em 1 reconhecido: não=0 · sim=2
#   frequência desejada: casual=0 · semanal=1 · diária=2
# Soma 0–1 → beginner · 2–4 → intermediate · 5–6 → advanced
EXPERIENCE_SCORES = {"never": 0, "casual": 1, "frequent": 2}
FREQUENCY_SCORES = {"casual": 0, "weekly": 1, "daily": 2}


def _onboarding_level(experience, found_mate, frequency):
    score = (
        EXPERIENCE_SCORES[experience]
        + (2 if found_mate else 0)
        + FREQUENCY_SCORES[frequency]
    )
    if score <= 1:
        return "beginner"
    if score <= 4:
        return "intermediate"
    return "advanced"


class OnboardingView(APIView):
    """
    POST /api/v1/auth/onboarding/
    Recebe as 3 respostas do onboarding (experience, found_mate, frequency),
    calcula o nível, semeia os ModalityRating iniciais e marca o perfil como
    onboardado. Idempotente: se onboarding_completed_at já está preenchido
    (inclusive contas grandfathered pela migration 0010), retorna 200 com o
    estado atual, sem reprocessar.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .models import Profile

        experience = request.data.get("experience")
        found_mate = request.data.get("found_mate")
        frequency = request.data.get("frequency")

        with transaction.atomic():
            profile, _ = Profile.objects.select_for_update().get_or_create(
                user=request.user
            )

            if profile.onboarding_completed_at is not None:
                blitz = _modality_rating_snapshot(
                    profile, ModalityRating.MODALITY_BLITZ
                )
                return Response(
                    {
                        "already_completed": True,
                        "level": None,
                        "rating": round(blitz.rating),
                        "provisional": blitz.is_provisional,
                    },
                    status=status.HTTP_200_OK,
                )

            if (
                experience not in EXPERIENCE_SCORES
                or frequency not in FREQUENCY_SCORES
                or not isinstance(found_mate, bool)
            ):
                return Response(
                    {
                        "detail": (
                            "Payload inválido: experience (never/casual/frequent), "
                            "found_mate (bool) e frequency (casual/weekly/daily) "
                            "são obrigatórios."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            level = _onboarding_level(experience, found_mate, frequency)
            seed = ONBOARDING_SEED_RATING[level]

            blitz_rating = None
            for modality in ModalityRating.ONBOARDING_MODALITIES:
                # get_or_create: se o perfil já tem rating na modalidade (caso
                # raro de quem jogou antes de onboardar), não sobrescreve —
                # rating conquistado vale mais que o seed autodeclarado.
                rating, _created = ModalityRating.objects.get_or_create(
                    profile=profile,
                    modality=modality,
                    defaults={"rating": float(seed)},
                )
                if modality == ModalityRating.MODALITY_BLITZ:
                    blitz_rating = rating

            # Espelho legado segue o blitz (mesma regra do _sync_rating_mirror)
            profile.rating = round(blitz_rating.rating)
            profile.onboarding_completed_at = timezone.now()
            profile.save(update_fields=["rating", "onboarding_completed_at"])

        return Response(
            {
                "already_completed": False,
                "level": level,
                "rating": round(blitz_rating.rating),
                "provisional": blitz_rating.is_provisional,
            },
            status=status.HTTP_200_OK,
        )


class GameHistoryView(APIView):
    """
    GET /api/v1/auth/game/history/?limit=20&offset=0&filter=all|ranked|ai
    Retorna histórico de partidas do usuário autenticado.

    filter (decisão D2):
      all    → todas (padrão)
      ranked → só ranqueadas (rated=True)
      ai     → só partidas vs IA (mode="ai")
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import GameHistory

        limit = min(int(request.query_params.get("limit", 20)), 100)
        offset = int(request.query_params.get("offset", 0))
        filt = request.query_params.get("filter", "all")

        # `select_related("game")` porque cada linha lê `game.public_id`
        # abaixo — sem isso são N queries para uma página de 20.
        qs = GameHistory.objects.filter(user=request.user).select_related("game")
        if filt == "ranked":
            qs = qs.filter(rated=True)
        elif filt == "ai":
            qs = qs.filter(mode=GameHistory.MODE_AI)

        data = [
            {
                "id": g.id,
                # Endereço da PARTIDA (tabuleiro + lances), para a tela de
                # detalhe. Null em todo o histórico anterior à migration que
                # criou `Game`, e em qualquer linha cujo `Game` tenha sido
                # apagado: são partidas de que não restaram lances, e a lista
                # não deve oferecer "rever" nelas.
                "game_public_id": str(g.game.public_id) if g.game_id else None,
                "opponent_name": g.opponent_name,
                "result": g.result,
                "mode": g.mode,
                "modality": g.modality,
                "rated": g.rated,
                "rating_before": g.rating_before,
                "rating_after": g.rating_after,
                "rating_delta": g.rating_after - g.rating_before,
                "played_at": g.played_at.isoformat(),
            }
            for g in qs[offset : offset + limit]
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
                # EXIBE O MESMO CAMPO QUE FILTRA. Antes vinha de
                # `r.profile.games_played` — o total do perfil, que soma
                # partidas vs IA e todas as modalidades — ao lado de um
                # rating que só considera as ranqueadas DESTA modalidade.
                # "1500 · 30 partidas" para quem tinha 1 partida ranqueada.
                "games_played": r.games_played,
                # `wins` NÃO tem equivalente por modalidade (ModalityRating
                # guarda rating/RD/volatilidade/nº de partidas, não vitórias),
                # então segue vindo do perfil e continua sendo um total
                # global. Fica explícito no nome para o cliente não somar
                # maçã com laranja; unificar exigiria coluna nova.
                "wins_total": r.profile.wins,
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


class DeviceTokenView(APIView):
    """
    POST /api/v1/auth/device-token/
    Registra (ou reassocia) o token Expo push do device atual.

    Body: {"token": "ExponentPushToken[...]", "platform": "ios"|"android"}

    IDEMPOTENTE por `token`: chamar de novo com o mesmo token só atualiza
    `last_seen_at` (é o que o app faz a cada abertura, sem custo). Chamar com
    um token que pertencia a OUTRO usuário reassocia — é o caminho de logout
    de A / login de B no mesmo aparelho. Ver `register_device_token`.

    FUNDAÇÃO do Modo Turno: nenhuma feature dispara push ainda. Este endpoint
    só grava o token para quando alguma existir.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .models import DeviceToken, register_device_token

        token = str(request.data.get("token", "")).strip()
        platform = request.data.get("platform")

        if not token:
            return Response(
                {"detail": "token é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if platform not in (DeviceToken.PLATFORM_IOS, DeviceToken.PLATFORM_ANDROID):
            return Response(
                {"detail": "platform deve ser 'ios' ou 'android'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        register_device_token(request.user, token, platform)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ─────────────────────────────────────────────────────────────────────────────
# MODO TURNO (correspondência)
# ─────────────────────────────────────────────────────────────────────────────


_VALID_TIME_CONTROL_DAYS = (1, 3, 7)


def _serialize_correspondence_game(game, user):
    """Sempre da PERSPECTIVA de quem pediu — `opponent`/`my_color`/
    `is_my_turn` poupam o app de comparar ids de usuário que ele não tem.

    `my_color`/`is_my_turn` vêm `None` enquanto `pending`: a cor gravada
    nesse status é só o valor provisório que satisfaz o campo obrigatório
    (ver `CorrespondenceGame.challenger`) — mostrá-la como se fosse
    definitiva confundiria o app antes do sorteio de verdade no aceite.
    """
    opponent = (
        game.black_player if user.id == game.white_player_id else game.white_player
    )
    opponent_profile = getattr(opponent, "profile", None)
    pending = game.status == CorrespondenceGame.STATUS_PENDING
    my_color = None if pending else game.player_color(user.id)

    return {
        "id": game.id,
        "status": game.status,
        "time_control_days": game.time_control_days,
        "fen": game.fen,
        "moves": game.moves,
        "my_color": my_color,
        "is_my_turn": None if pending else my_color == game.turn,
        "is_challenger": user.id == game.challenger_id,
        "opponent": {
            "id": opponent.id,
            "username": getattr(opponent_profile, "username", None),
            "full_name": opponent.full_name,
        },
        "result": game.result,
        "termination": game.termination,
        "last_move_at": game.last_move_at.isoformat() if game.last_move_at else None,
        "current_deadline": (
            game.current_deadline.isoformat() if game.current_deadline else None
        ),
        "created_at": game.created_at.isoformat(),
        "ended_at": game.ended_at.isoformat() if game.ended_at else None,
    }


# Código de erro de negócio → status HTTP. `not_participant`/`not_found`
# viram 404 (esconder existência de algo que não é seu, mesmo padrão de
# GameDetailView); os demais são 400/403 conforme a origem.
_CORRESPONDENCE_ERROR_STATUS = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "not_participant": status.HTTP_404_NOT_FOUND,
    "self": status.HTTP_400_BAD_REQUEST,
    "not_pending": status.HTTP_400_BAD_REQUEST,
    "not_target": status.HTTP_403_FORBIDDEN,
    "limit": status.HTTP_403_FORBIDDEN,
    "not_active": status.HTTP_400_BAD_REQUEST,
    "not_your_turn": status.HTTP_400_BAD_REQUEST,
    "illegal": status.HTTP_400_BAD_REQUEST,
}


def _correspondence_error_response(exc):
    return Response(
        {"detail": exc.message, "code": exc.code},
        status=_CORRESPONDENCE_ERROR_STATUS.get(exc.code, status.HTTP_400_BAD_REQUEST),
    )


class CorrespondenceChallengeView(APIView):
    """
    POST /api/v1/auth/correspondence/challenge/
    Desafia um amigo pelo username. Body: {"username", "time_control_days"}.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from . import correspondence

        username = str(request.data.get("username", "")).strip()
        try:
            time_control_days = int(request.data.get("time_control_days"))
        except (TypeError, ValueError):
            time_control_days = None

        if not username:
            return Response(
                {"detail": "username é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if time_control_days not in _VALID_TIME_CONTROL_DAYS:
            return Response(
                {"detail": "time_control_days deve ser 1, 3 ou 7."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            game = correspondence.create_challenge(
                request.user, username, time_control_days
            )
        except correspondence.ChallengeError as exc:
            return _correspondence_error_response(exc)

        return Response(
            _serialize_correspondence_game(game, request.user),
            status=status.HTTP_201_CREATED,
        )


class CorrespondenceChallengeRespondView(APIView):
    """
    POST /api/v1/auth/correspondence/{id}/respond/
    Body: {"accept": true|false}. Só o alvo do desafio pode responder.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from . import correspondence

        game = CorrespondenceGame.objects.filter(
            id=pk, status=CorrespondenceGame.STATUS_PENDING
        ).first()
        if game is None or request.user.id not in (
            game.white_player_id,
            game.black_player_id,
        ):
            return Response(
                {"detail": "Desafio não encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        accept = bool(request.data.get("accept"))
        try:
            game = correspondence.respond_to_challenge(game, request.user, accept)
        except correspondence.ChallengeError as exc:
            return _correspondence_error_response(exc)

        if not accept:
            return Response({"detail": "Desafio recusado."})
        return Response(_serialize_correspondence_game(game, request.user))


class CorrespondenceMatchmakingView(APIView):
    """
    POST   /api/v1/auth/correspondence/matchmaking/ → entra na fila (ou
           pareia na hora se já houver alguém esperando).
    DELETE /api/v1/auth/correspondence/matchmaking/ → sai da fila.
    Body/query em ambos: {"time_control_days"}.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from . import correspondence

        try:
            time_control_days = int(request.data.get("time_control_days"))
        except (TypeError, ValueError):
            time_control_days = None
        if time_control_days not in _VALID_TIME_CONTROL_DAYS:
            return Response(
                {"detail": "time_control_days deve ser 1, 3 ou 7."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            game, queued = correspondence.join_matchmaking(
                request.user, time_control_days
            )
        except correspondence.ChallengeError as exc:
            return _correspondence_error_response(exc)

        if queued:
            return Response({"detail": "Na fila.", "queued": True})
        return Response(
            {
                **_serialize_correspondence_game(game, request.user),
                "queued": False,
            },
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request):
        from . import correspondence

        try:
            time_control_days = int(
                request.data.get("time_control_days")
                or request.query_params.get("time_control_days")
            )
        except (TypeError, ValueError):
            time_control_days = None
        if time_control_days not in _VALID_TIME_CONTROL_DAYS:
            return Response(
                {"detail": "time_control_days deve ser 1, 3 ou 7."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        correspondence.leave_matchmaking(request.user, time_control_days)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CorrespondenceMoveView(APIView):
    """
    POST /api/v1/auth/correspondence/{id}/move/
    Body: {"move": "e2e4"} (UCI). Validado 100% no servidor via python-chess.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from . import correspondence

        uci_move = str(request.data.get("move", "")).strip()
        if not uci_move:
            return Response(
                {"detail": "move é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # Lock de linha: dois lances concorrentes na mesma partida (duplo
            # toque em "confirmar") serializam aqui — o segundo vê o turno já
            # trocado pelo primeiro e cai em `not_your_turn`.
            game = CorrespondenceGame.objects.select_for_update().filter(id=pk).first()
            if game is None or request.user.id not in (
                game.white_player_id,
                game.black_player_id,
            ):
                return Response(
                    {"detail": "Partida não encontrada."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            try:
                game = correspondence.submit_move(game, request.user, uci_move)
            except correspondence.MoveError as exc:
                return Response(
                    {"detail": exc.message, "code": exc.code},
                    status=_CORRESPONDENCE_ERROR_STATUS.get(
                        exc.code, status.HTTP_400_BAD_REQUEST
                    ),
                )

        return Response(_serialize_correspondence_game(game, request.user))


class CorrespondenceListView(APIView):
    """
    GET /api/v1/auth/correspondence/
    Minhas partidas (desafios pendentes, em andamento e terminadas),
    prazo mais urgente primeiro — segue `CorrespondenceGame.Meta.ordering`.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        games = CorrespondenceGame.objects.filter(
            Q(white_player=request.user) | Q(black_player=request.user)
        ).select_related("white_player__profile", "black_player__profile")
        return Response(
            [_serialize_correspondence_game(g, request.user) for g in games]
        )


class CorrespondenceDetailView(APIView):
    """
    GET /api/v1/auth/correspondence/{id}/
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        game = (
            CorrespondenceGame.objects.select_related(
                "white_player__profile", "black_player__profile"
            )
            .filter(id=pk)
            .first()
        )
        if game is None or request.user.id not in (
            game.white_player_id,
            game.black_player_id,
        ):
            return Response(
                {"detail": "Partida não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_serialize_correspondence_game(game, request.user))
