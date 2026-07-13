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

# Decisão do PM (2026-07-07): 3 puzzles/dia no plano Grátis. Conta puzzles
# RESOLVIDOS no dia (solved_at) — tentativa falha não consome a cota, e é o
# único carimbo de data confiável no UserPuzzleProgress (created_at só marca
# a primeira tentativa; re-resolver puzzle antigo não re-conta).
FREE_DAILY_PUZZLE_LIMIT = 3


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


def puzzles_solved_today(profile):
    from apps.puzzles.models import UserPuzzleProgress

    return UserPuzzleProgress.objects.filter(
        user=profile.user,
        solved=True,
        solved_at__date=timezone.localdate(),
    ).count()


def can_solve_puzzle(profile):
    """(permitido, restantes_hoje) — restantes é None para plano pago
    (ilimitado). Item 0.2: consultado pela tela de puzzles (pré-gate no
    next/) e pelo registro de progresso (defesa em profundidade)."""
    if has_paid_access(profile):
        return True, None
    remaining = max(0, FREE_DAILY_PUZZLE_LIMIT - puzzles_solved_today(profile))
    return remaining > 0, remaining
