"""
Avaliação e concessão de conquistas.

UM ponto de entrada (`check_achievements`) chamado de três lugares do produto,
e um registro de avaliadores por tipo de regra — em vez de um `if` por
conquista espalhado pelas views.

DISCIPLINA DESTE MÓDULO: nada aqui levanta para o chamador. Conquista é bônus
em cima do jogo; falhar ao conceder não pode derrubar o registro do resultado
da partida ou do problema, que é o que de fato importa. Mesmo contrato de
`enqueue_analysis`.
"""

import logging

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import AchievementDefinition, GameHistory, UserAchievement

logger = logging.getLogger(__name__)


# ───────────────────────────── avaliadores ──────────────────────────────────
#
# Assinatura comum: (user, params, context) -> bool ("já merece?").
#
# Todos são idempotentes e sem efeito colateral: podem rodar quantas vezes for
# preciso. Quem impede a concessão em duplicidade é o unique_together de
# UserAchievement, não estes.


def _threshold(params, default=1):
    value = (params or {}).get("threshold", default)
    return value if isinstance(value, int) and value > 0 else default


def _eval_win_count(user, params, context):
    """Vitórias em qualquer modo — inclusive vs IA."""
    total = GameHistory.objects.filter(user=user, result=GameHistory.RESULT_WIN).count()
    return total >= _threshold(params)


def _eval_rated_win_count(user, params, context):
    """Vitórias que valeram rating.

    `rated=True` já é exatamente "humano vs humano com relógio": a view do
    resultado online grava a constante True, e a de IA grava False sempre
    (decisão D1 — partida vs IA nunca mexe no Glicko-2). Não é preciso filtrar
    por `mode` além disso.
    """
    total = GameHistory.objects.filter(
        user=user, result=GameHistory.RESULT_WIN, rated=True
    ).count()
    return total >= _threshold(params)


def _eval_games_played(user, params, context):
    """Partidas jogadas, com qualquer desfecho."""
    return GameHistory.objects.filter(user=user).count() >= _threshold(params)


def _eval_win_streak(user, params, context):
    """N vitórias SEGUIDAS, na ordem em que as partidas foram jogadas.

    Lê só as N últimas: a sequência é sobre o fim do histórico, então trazer o
    extrato inteiro para contar seria desperdício. É o índice
    ("user", "-played_at") que torna isto uma leitura barata.
    """
    n = _threshold(params, 3)
    ultimos = list(
        GameHistory.objects.filter(user=user)
        .order_by("-played_at", "-id")
        .values_list("result", flat=True)[:n]
    )
    return len(ultimos) == n and all(r == GameHistory.RESULT_WIN for r in ultimos)


def _eval_fast_checkmate(user, params, context):
    """Xeque-mate em até `max_plies` meios-lances, com o usuário VENCENDO.

    Avaliada contra a partida que ACABOU de terminar (vem no `context`), e não
    por consulta ao histórico: o dado já está em memória, e perguntar ao banco
    "existe alguma partida assim" daria o mesmo resultado custando uma query.

    Três condições, e a terceira é a que costuma ser esquecida: não basta ter
    havido mate na partida — o mate tem de ter sido DADO pelo usuário.
    """
    game = (context or {}).get("game")
    if game is None:
        return False

    # `termination` é campo ADITIVO: partida registrada por app/node-api
    # antigos vem com "" e não pode ser confundida com xeque-mate.
    if game.termination != "checkmate":
        return False

    max_plies = (params or {}).get("max_plies")
    if not isinstance(max_plies, int) or max_plies <= 0:
        return False
    # `ply_count` é o tamanho REAL da partida (pode passar de len(moves)
    # quando houve truncamento) — é o número honesto para comparar.
    if not game.ply_count or game.ply_count > max_plies:
        return False

    # O vencedor é o usuário? `result` é a cor que ganhou.
    if game.result == "white":
        return game.white_player_id == user.id
    if game.result == "black":
        return game.black_player_id == user.id
    return False


def _eval_puzzle_streak(user, params, context):
    """Dias consecutivos resolvendo problema.

    Reaproveita `_current_streak` do app de puzzles em vez de reimplementar —
    decisão confirmada. Vale registrar o que ela mede, porque o nome sugere
    mais do que entrega: conta dias com pelo menos uma resolução NOVA (usa
    `solved_at`, gravado só na primeira vez que cada problema é resolvido) e
    NÃO separa Problema do dia de Treino.
    """
    from apps.puzzles.views import _current_streak

    return _current_streak(user) >= _threshold(params, 7)


RULE_EVALUATORS = {
    AchievementDefinition.RULE_WIN_COUNT: _eval_win_count,
    AchievementDefinition.RULE_RATED_WIN_COUNT: _eval_rated_win_count,
    AchievementDefinition.RULE_GAMES_PLAYED: _eval_games_played,
    AchievementDefinition.RULE_WIN_STREAK: _eval_win_streak,
    AchievementDefinition.RULE_FAST_CHECKMATE: _eval_fast_checkmate,
    AchievementDefinition.RULE_PUZZLE_STREAK: _eval_puzzle_streak,
}


# ─────────────────────────── progresso (leitura) ────────────────────────────

# Regras cujo progresso parcial faz sentido mostrar ("7/10 partidas"). As
# outras são binárias: não existe "meio xeque-mate rápido".
PROGRESS_EVALUATORS = {
    AchievementDefinition.RULE_WIN_COUNT: lambda user: GameHistory.objects.filter(
        user=user, result=GameHistory.RESULT_WIN
    ).count(),
    AchievementDefinition.RULE_RATED_WIN_COUNT: lambda user: (
        GameHistory.objects.filter(
            user=user, result=GameHistory.RESULT_WIN, rated=True
        ).count()
    ),
    AchievementDefinition.RULE_GAMES_PLAYED: lambda user: GameHistory.objects.filter(
        user=user
    ).count(),
}


def current_progress(user, definition):
    """(atual, alvo) para a barra de progresso, ou None quando não se aplica."""
    evaluator = PROGRESS_EVALUATORS.get(definition.rule_type)
    if evaluator is None:
        return None
    target = _threshold(definition.params)
    try:
        return min(evaluator(user), target), target
    except Exception:  # noqa: BLE001 - progresso é enfeite, nunca quebra a tela
        logger.warning("[conquistas] falha ao calcular progresso", exc_info=True)
        return None


# ────────────────────────────── concessão ───────────────────────────────────


def check_achievements(user, trigger, context=None):
    """Avalia as conquistas ATIVAS daquele gatilho e concede o que couber.

    Devolve a lista de `UserAchievement` criados NESTA chamada — é o que a
    resposta do fim de partida usa para o app celebrar na hora, em vez de o
    cliente ter de descobrir sozinho comparando estados.

    NUNCA levanta. Um avaliador quebrado, uma definição com `params` torto ou
    o banco fora do ar não podem impedir o resultado da partida de ser
    gravado. Cada conquista é avaliada de forma isolada, então uma regra ruim
    também não derruba as outras.
    """
    if user is None:
        return []

    try:
        definitions = list(
            AchievementDefinition.objects.filter(is_active=True, trigger=trigger)
        )
    except Exception:  # noqa: BLE001
        logger.exception("[conquistas] falha ao carregar definições")
        return []

    if not definitions:
        return []

    try:
        ja_tem = set(
            UserAchievement.objects.filter(
                user=user, achievement__in=definitions
            ).values_list("achievement_id", flat=True)
        )
    except Exception:  # noqa: BLE001
        logger.exception("[conquistas] falha ao ler conquistas do usuário")
        return []

    context = context or {}
    source = context.get("history")
    novas = []

    for definition in definitions:
        if definition.id in ja_tem:
            continue

        evaluator = RULE_EVALUATORS.get(definition.rule_type)
        if evaluator is None:
            # Definição no banco apontando para uma regra que este deploy não
            # conhece (ex.: banco à frente do código). Ignorar é o certo:
            # conceder às cegas seria pior.
            logger.warning(
                "[conquistas] regra desconhecida: %s (%s)",
                definition.rule_type,
                definition.code,
            )
            continue

        try:
            merece = bool(evaluator(user, definition.params, context))
        except Exception:  # noqa: BLE001 - uma regra ruim não derruba as outras
            logger.exception("[conquistas] avaliador falhou: %s", definition.code)
            continue

        if not merece:
            continue

        try:
            # `get_or_create` + unique_together: se duas requisições
            # concorrentes avaliarem a mesma conquista, uma cria e a outra
            # recebe a existente. O `atomic` isola o IntegrityError para ele
            # não abortar a transação externa (a que gravou a partida).
            with transaction.atomic():
                obj, created = UserAchievement.objects.get_or_create(
                    user=user,
                    achievement=definition,
                    defaults={"source_history": source},
                )
            if created:
                novas.append(obj)
        except IntegrityError:
            # Corrida perdida: a outra requisição criou primeiro. Não é erro —
            # é exatamente a constraint fazendo o trabalho dela.
            continue
        except Exception:  # noqa: BLE001
            logger.exception("[conquistas] falha ao conceder: %s", definition.code)
            continue

    return novas


def serialize_new(achievements):
    """Payload enxuto das conquistas recém-desbloqueadas, para a resposta do
    fim de partida. Só o que a comemoração precisa desenhar."""
    return [
        {
            "code": a.achievement.code,
            "nome": a.achievement.name,
            "descricao": a.achievement.description,
            "icone": a.achievement.icon,
        }
        for a in achievements
    ]


def mark_seen(user, codes=None):
    """Carimba `seen_at` — "já comemorei isto".

    Sem `codes`, marca tudo o que está pendente. Só escreve onde ainda está
    nulo: recarimbar apagaria a informação de QUANDO a comemoração aconteceu.
    """
    qs = UserAchievement.objects.filter(user=user, seen_at__isnull=True)
    if codes:
        qs = qs.filter(achievement__code__in=codes)
    return qs.update(seen_at=timezone.now())
