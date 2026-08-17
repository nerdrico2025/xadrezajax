"""
Modo Turno (correspondência) — desafio, matchmaking e lance.

Módulo separado das views, mesmo padrão de `achievements.py`/`push.py`/
`llm_feedback.py`: nada aqui toca request/response, o que permite testar a
lógica sem HTTP e mantém as views como adaptadores finos.

O RELÓGIO É POR DIAS, não por segundos — todo o cálculo de prazo usa
`timezone.now()` e `timedelta(days=...)`, nunca um processo em background.
Não há "tick": o prazo é reavaliado só quando alguém interage (mesmo espírito
do relógio do node-api, que também calcula decorrido sob demanda em vez de
manter um timer rodando — só que ali o horizonte é minutos, aqui é dias).
"""

import random

import chess
from django.db import transaction
from django.utils import timezone

from .models import (
    CorrespondenceGame,
    CorrespondenceQueueEntry,
    get_or_create_profile,
)
from .push import send_push

# ─────────────────────────────── desafio direto ─────────────────────────────


class ChallengeError(Exception):
    """Erro de regra de negócio do desafio — a view traduz para HTTP."""

    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def create_challenge(challenger, target_username, time_control_days):
    """Cria um desafio PENDENTE para `target_username`.

    Cor NÃO é sorteada aqui — `white_player`/`black_player` levam um valor
    provisório (challenger=branco) só para satisfazer os campos obrigatórios
    enquanto pendente; o sorteio de verdade acontece no aceite
    (`respond_to_challenge`), porque é lá que se sabe que a partida vai
    mesmo acontecer.

    Levanta `ChallengeError` para os casos que a view precisa distinguir por
    código (usuário não encontrado, limite atingido, etc.) — é o mesmo motivo
    de `GameLLMFeedbackView` ter uma função `_resolve` própria: a regra vive
    num lugar, a tradução HTTP vive em outro.
    """
    from apps.payments.access import can_start_correspondence_game
    from .models import Profile

    try:
        target_profile = Profile.objects.select_related("user").get(
            username=target_username
        )
    except Profile.DoesNotExist:
        raise ChallengeError("not_found", "Usuário não encontrado.")

    target = target_profile.user
    if target.id == challenger.id:
        raise ChallengeError("self", "Você não pode desafiar a si mesmo.")

    challenger_profile = get_or_create_profile(challenger)
    permitido, restantes = can_start_correspondence_game(challenger_profile)
    if not permitido:
        raise ChallengeError(
            "limit",
            "Você já tem 2 partidas do Modo Turno em andamento. "
            "Termine uma para desafiar de novo, ou assine o Premium "
            "para partidas ilimitadas.",
        )

    game = CorrespondenceGame.objects.create(
        white_player=challenger,
        black_player=target,
        challenger=challenger,
        time_control_days=time_control_days,
        status=CorrespondenceGame.STATUS_PENDING,
    )

    send_push(
        target,
        "Desafio do Modo Turno",
        f"{_display_name(challenger)} te desafiou para uma partida "
        f"de {time_control_days} dia(s) por lance.",
        {"type": "correspondence_challenge", "game_id": game.id},
    )
    return game


def respond_to_challenge(game, user, accept):
    """Aceitar ou recusar um desafio PENDENTE. Só o ALVO (não o desafiante)
    pode responder — decidir sobre o próprio convite não faz sentido."""
    if game.status != CorrespondenceGame.STATUS_PENDING:
        raise ChallengeError("not_pending", "Este desafio já foi respondido.")
    if user.id == game.challenger_id:
        raise ChallengeError(
            "not_target", "Quem desafiou não pode responder ao próprio convite."
        )
    if user.id not in (game.white_player_id, game.black_player_id):
        raise ChallengeError("not_participant", "Você não participa deste desafio.")

    from apps.payments.access import can_start_correspondence_game

    if accept:
        # O limite é checado nos DOIS lados no aceite: o desafiante pode ter
        # atingido o limite DEPOIS de enviar o convite (outra partida sua
        # ficou ativa nesse meio-tempo) — sem checar de novo, ele passaria do
        # teto sem nunca ter tocado em nada.
        for participante in (game.white_player, game.black_player):
            profile = get_or_create_profile(participante)
            permitido, _ = can_start_correspondence_game(profile)
            if not permitido:
                raise ChallengeError(
                    "limit",
                    "Um dos jogadores já atingiu o limite de partidas "
                    "simultâneas do Modo Turno.",
                )
        # Sorteio de cor de verdade, agora que a partida vai acontecer.
        if random.random() < 0.5:
            game.white_player, game.black_player = (
                game.black_player,
                game.white_player,
            )
        now = timezone.now()
        game.status = CorrespondenceGame.STATUS_ACTIVE
        game.last_move_at = now
        game.current_deadline = now + timezone.timedelta(days=game.time_control_days)
        game.save(
            update_fields=[
                "white_player",
                "black_player",
                "status",
                "last_move_at",
                "current_deadline",
            ]
        )
    else:
        game.delete()
    return game


# ────────────────────────────── matchmaking ──────────────────────────────────


def join_matchmaking(user, time_control_days):
    """Entra na fila, ou pareia na hora se já houver alguém esperando com o
    MESMO controle de tempo.

    `select_for_update(skip_locked=True)`: mesmo padrão de
    `InternalAnalysisNextView` (fila de análise) — se dois usuários entrarem
    ao mesmo tempo com o mesmo controle, cada requisição pega uma linha
    diferente (ou nenhuma) em vez de as duas tentarem parear com o mesmo
    bilhete.

    Devolve `(game_ou_None, entrou_na_fila)`.
    """
    from apps.payments.access import can_start_correspondence_game

    profile = get_or_create_profile(user)
    permitido, _ = can_start_correspondence_game(profile)
    if not permitido:
        raise ChallengeError(
            "limit",
            "Você já tem 2 partidas do Modo Turno em andamento. "
            "Termine uma para entrar na fila, ou assine o Premium "
            "para partidas ilimitadas.",
        )

    with transaction.atomic():
        candidato = (
            CorrespondenceQueueEntry.objects.select_for_update(skip_locked=True)
            .filter(time_control_days=time_control_days)
            .exclude(user=user)
            .order_by("created_at")
            .first()
        )
        if candidato is None:
            CorrespondenceQueueEntry.objects.get_or_create(
                user=user, time_control_days=time_control_days
            )
            return None, True

        oponente = candidato.user
        candidato.delete()
        # O bilhete do usuário ATUAL, se por acaso existisse (não deveria,
        # por unique_together, mas o clique duplo de "cancelar e procurar de
        # novo" é o tipo de corrida que vale limpar por garantia).
        CorrespondenceQueueEntry.objects.filter(
            user=user, time_control_days=time_control_days
        ).delete()

    if random.random() < 0.5:
        white, black = user, oponente
    else:
        white, black = oponente, user

    now = timezone.now()
    game = CorrespondenceGame.objects.create(
        white_player=white,
        black_player=black,
        time_control_days=time_control_days,
        status=CorrespondenceGame.STATUS_ACTIVE,
        last_move_at=now,
        current_deadline=now + timezone.timedelta(days=time_control_days),
    )
    return game, False


def leave_matchmaking(user, time_control_days):
    """Sai da fila antes de ser pareado. Idempotente: sair de novo (ou de uma
    fila em que nunca entrou) não é erro."""
    CorrespondenceQueueEntry.objects.filter(
        user=user, time_control_days=time_control_days
    ).delete()


# ────────────────────────────────── lance ────────────────────────────────────


class MoveError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


# python-chess distingue CHECKMATE/STALEMATE/INSUFFICIENT_MATERIAL de
# SEVENTYFIVE_MOVES/FIVEFOLD_REPETITION — os dois últimos são draws
# automáticos (sem CLAIM de jogador, que está fora de escopo: não há oferta
# de empate no Modo Turno ainda). Mapeados para o vocabulário JÁ EXISTENTE de
# `Game.TERMINATION_CHOICES`, para o produto ter um vocabulário só de fim de
# partida — não um dialeto novo por subsistema.
_TERMINATION_MAP = {
    chess.Termination.CHECKMATE: "checkmate",
    chess.Termination.STALEMATE: "stalemate",
    chess.Termination.INSUFFICIENT_MATERIAL: "insufficient",
    chess.Termination.FIVEFOLD_REPETITION: "repetition",
    chess.Termination.SEVENTYFIVE_MOVES: "draw",
}


def submit_move(game, user, uci_move):
    """Valida e aplica um lance. Levanta `MoveError` para toda rejeição.

    A VALIDAÇÃO é 100% do servidor: o FEN gravado é sempre o resultado de um
    lance que python-chess aceitou a partir do FEN gravado anterior — o
    cliente nunca manda FEN, só a intenção (`uci_move`).
    """
    if game.status != CorrespondenceGame.STATUS_ACTIVE:
        raise MoveError("not_active", "Esta partida não está em andamento.")

    cor = game.player_color(user.id)
    if cor is None:
        raise MoveError("not_participant", "Você não está nesta partida.")
    if cor != game.turn:
        raise MoveError("not_your_turn", "Não é sua vez.")

    board = chess.Board(game.fen)
    try:
        move = board.parse_uci(uci_move)
    except (chess.InvalidMoveError, chess.IllegalMoveError, ValueError):
        raise MoveError("illegal", "Lance inválido.")

    san = board.san(move)
    board.push(move)

    game.moves = [*game.moves, san]
    game.fen = board.fen()
    game.turn = (
        CorrespondenceGame.COLOR_BLACK
        if cor == CorrespondenceGame.COLOR_WHITE
        else CorrespondenceGame.COLOR_WHITE
    )

    outcome = board.outcome(claim_draw=False)
    if outcome is not None:
        _finish_game(game, outcome)
        game.save()
        return game

    now = timezone.now()
    game.last_move_at = now
    game.current_deadline = now + timezone.timedelta(days=game.time_control_days)
    game.save()

    oponente = (
        game.black_player
        if cor == CorrespondenceGame.COLOR_WHITE
        else game.white_player
    )
    send_push(
        oponente,
        "Sua vez no Modo Turno",
        f"{_display_name(user)} jogou {san}.",
        {"type": "correspondence_move", "game_id": game.id},
    )
    return game


def _finish_game(game, outcome):
    """Grava resultado/término e aplica Glicko-2. `game` é salvo pelo
    chamador — esta função só prepara os campos e chama o rating."""
    from .models import ModalityRating
    from .views import (
        _apply_glicko2_result,
        _locked_modality_rating,
        _sync_rating_mirror,
    )
    from .glicko2 import Rating as GlickoRating, WIN, LOSS, DRAW

    game.status = CorrespondenceGame.STATUS_FINISHED
    game.termination = _TERMINATION_MAP.get(outcome.termination, "draw")
    game.ended_at = timezone.now()

    if outcome.winner is None:
        game.result = "draw"
        score_white = score_black = DRAW
    elif outcome.winner:  # True = brancas
        game.result = "white"
        score_white, score_black = WIN, LOSS
    else:
        game.result = "black"
        score_white, score_black = LOSS, WIN

    white_profile = get_or_create_profile(game.white_player)
    black_profile = get_or_create_profile(game.black_player)

    with transaction.atomic():
        white_rating = _locked_modality_rating(
            white_profile, ModalityRating.MODALITY_CORRESPONDENCE
        )
        black_rating = _locked_modality_rating(
            black_profile, ModalityRating.MODALITY_CORRESPONDENCE
        )
        white_pre = GlickoRating(
            white_rating.rating, white_rating.deviation, white_rating.volatility
        )
        black_pre = GlickoRating(
            black_rating.rating, black_rating.deviation, black_rating.volatility
        )
        _apply_glicko2_result(white_rating, black_pre, score_white)
        _apply_glicko2_result(black_rating, white_pre, score_black)
        # MODALITY_CORRESPONDENCE nunca é blitz, então `_sync_rating_mirror`
        # é no-op aqui — chamado mesmo assim por SIMETRIA com o fluxo online,
        # para o dia em que alguém decidir mudar essa regra não precisar
        # lembrar de acrescentar a chamada num lugar novo.
        _sync_rating_mirror(white_profile, white_rating)
        _sync_rating_mirror(black_profile, black_rating)


def _display_name(user):
    profile = getattr(user, "profile", None)
    return getattr(profile, "username", None) or user.full_name
