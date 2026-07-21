"""
Gating de acesso por plano (RF-MON-05, item 0.1).

Helpers genéricos para qualquer feature limitada por plano — o item 0.2
(puzzles) deve reaproveitar `has_paid_access` em vez de duplicar a lógica
de "é plano pago?". A trava de partidas fica aqui e é consultada pela rota
de resultado de partida existente (apps.users.views.AiGameResultView).
"""

from django.utils import timezone

# Decisão do PM (2026-07-07): 5 partidas/dia no plano Grátis, somando
# IA + online (ambas geram GameHistory).
FREE_DAILY_GAME_LIMIT = 5

# Modelo de problemas (redesenho de 2026-07-21): não existe mais cota de
# "N problemas/dia no Grátis". O antigo FREE_DAILY_PUZZLE_LIMIT = 3 foi
# REMOVIDO junto com can_solve_puzzle/puzzles_solved_today. Agora são dois
# produtos distintos:
#   - Problema do dia: 1/dia, o mesmo para todos, GRÁTIS para todos;
#   - Treino: problemas além do diário, EXCLUSIVO do plano pago, ilimitado.


def has_paid_access(profile):
    """True se o perfil tem assinatura em status pago (trialing/active).

    Perfil sem registro de Subscription é plano Grátis por definição —
    a ausência de linha nunca é erro.
    """
    subscription = getattr(profile, "subscription", None)
    return bool(subscription and subscription.is_paid)


def games_played_today(profile):
    from apps.users.models import GameHistory

    return GameHistory.objects.filter(
        user=profile.user, played_at__date=timezone.localdate()
    ).count()


def can_play_game(profile):
    """(permitido, restantes_hoje) — restantes é None para plano pago
    (ilimitado)."""
    if has_paid_access(profile):
        return True, None
    remaining = max(0, FREE_DAILY_GAME_LIMIT - games_played_today(profile))
    return remaining > 0, remaining


def can_play_daily_puzzle(profile):  # noqa: ARG001 - assinatura por simetria
    """O Problema do dia é grátis para todos, sempre.

    Existe como função (em vez de um `True` solto nas views) para que a regra
    tenha um lugar só, junto das outras de plano: se um dia o diário passar a
    ter alguma condição, muda aqui e vale para todos os pontos de uso.
    """
    return True


def can_train_puzzles(profile):
    """Treino (problemas além do diário) é exclusivo do plano pago."""
    return has_paid_access(profile)
