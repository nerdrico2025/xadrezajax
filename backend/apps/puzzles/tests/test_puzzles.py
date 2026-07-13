"""
Testes do item 0.2 — streak de puzzles e gating de 3/dia do plano Grátis.

Cobre: cálculo do streak (dias consecutivos via solved_at, tolerando o dia
corrente ainda sem solve), contador exposto no stats/, pré-gate no next/ e
defesa em profundidade no progress/ (só solve NOVO consome cota; tentativa
falha e re-registro passam livres; plano pago é ilimitado).
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.payments.models import Subscription
from apps.puzzles.models import Puzzle, UserPuzzleProgress
from apps.users.models import Profile

User = get_user_model()

NEXT_URL = reverse("puzzles:next")
STATS_URL = reverse("puzzles:stats")


def make_user(email="puzzlista@chess.com"):
    return User.objects.create_user(
        email=email, full_name="Puzzlista", password="Xadrez@2024"
    )


def make_puzzle(title, **overrides):
    defaults = {
        "fen": "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
        "solution": ["a1a8"],
        "difficulty": "easy",
        "category": "mate_in_1",
        "rating": 900,
    }
    defaults.update(overrides)
    return Puzzle.objects.create(title=title, **defaults)


def solve_puzzle(user, puzzle, days_ago=0):
    """Registra um solve com solved_at deslocado `days_ago` dias para trás."""
    return UserPuzzleProgress.objects.create(
        user=user,
        puzzle=puzzle,
        solved=True,
        attempts=1,
        solved_at=timezone.now() - timedelta(days=days_ago),
    )


class StreakTests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def get_streak(self):
        response = self.client.get(STATS_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["streak"]

    def test_streak_zero_sem_solves(self):
        self.assertEqual(self.get_streak(), 0)

    def test_streak_conta_dias_consecutivos_ate_hoje(self):
        for days_ago in (0, 1, 2):
            solve_puzzle(self.user, make_puzzle(f"P{days_ago}"), days_ago)
        self.assertEqual(self.get_streak(), 3)

    def test_streak_de_ontem_ainda_vale_hoje(self):
        # O dia corrente não quebrou o streak — ele só quebra quando o dia
        # termina sem solve.
        solve_puzzle(self.user, make_puzzle("Ontem"), days_ago=1)
        solve_puzzle(self.user, make_puzzle("Anteontem"), days_ago=2)
        self.assertEqual(self.get_streak(), 2)

    def test_streak_quebra_com_dia_sem_solve(self):
        solve_puzzle(self.user, make_puzzle("Hoje"), days_ago=0)
        solve_puzzle(self.user, make_puzzle("3 dias atrás"), days_ago=3)
        self.assertEqual(self.get_streak(), 1)

    def test_streak_zero_se_ultimo_solve_e_antigo(self):
        solve_puzzle(self.user, make_puzzle("Antigo"), days_ago=2)
        self.assertEqual(self.get_streak(), 0)

    def test_varios_solves_no_mesmo_dia_contam_um_dia(self):
        solve_puzzle(self.user, make_puzzle("A"), days_ago=0)
        solve_puzzle(self.user, make_puzzle("B"), days_ago=0)
        self.assertEqual(self.get_streak(), 1)


class PuzzleGatingTests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.profile = Profile.objects.get(user=self.user)
        self.client.force_authenticate(user=self.user)

    def use_daily_quota(self):
        for i in range(3):
            solve_puzzle(self.user, make_puzzle(f"Resolvido {i}"), days_ago=0)

    def progress_url(self, puzzle):
        return reverse("puzzles:progress", args=[puzzle.id])

    def test_stats_expoe_contador_do_plano_gratis(self):
        solve_puzzle(self.user, make_puzzle("Um"), days_ago=0)
        response = self.client.get(STATS_URL)
        self.assertEqual(response.data["daily_puzzle_limit"], 3)
        self.assertEqual(response.data["remaining_puzzles_today"], 2)

    def test_solves_de_ontem_nao_consomem_cota_de_hoje(self):
        solve_puzzle(self.user, make_puzzle("Ontem"), days_ago=1)
        response = self.client.get(STATS_URL)
        self.assertEqual(response.data["remaining_puzzles_today"], 3)

    def test_next_bloqueia_apos_limite_diario(self):
        self.use_daily_quota()
        response = self.client.get(NEXT_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "daily_limit_reached")
        self.assertEqual(response.data["remaining_puzzles_today"], 0)

    def test_progress_bloqueia_quarto_solve_do_dia(self):
        self.use_daily_quota()
        novo = make_puzzle("Quarto")
        response = self.client.post(
            self.progress_url(novo), {"solved": True, "attempts": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "daily_limit_reached")
        self.assertFalse(
            UserPuzzleProgress.objects.filter(user=self.user, puzzle=novo).exists()
        )

    def test_tentativa_falha_nao_consome_cota(self):
        self.use_daily_quota()
        novo = make_puzzle("Só tentativa")
        response = self.client.post(
            self.progress_url(novo), {"solved": False, "attempts": 2}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["solved"])

    def test_reregistro_de_puzzle_ja_resolvido_passa_livre(self):
        self.use_daily_quota()
        ja_resolvido = Puzzle.objects.filter(title="Resolvido 0").get()
        response = self.client.post(
            self.progress_url(ja_resolvido),
            {"solved": True, "attempts": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["solved"])

    def test_plano_pago_e_ilimitado(self):
        Subscription.objects.create(
            profile=self.profile,
            plan=Subscription.PLAN_MONTHLY,
            status=Subscription.STATUS_ACTIVE,
            stripe_customer_id="cus_1",
            stripe_subscription_id="sub_1",
        )
        self.use_daily_quota()

        stats = self.client.get(STATS_URL)
        self.assertIsNone(stats.data["daily_puzzle_limit"])
        self.assertIsNone(stats.data["remaining_puzzles_today"])

        self.assertEqual(self.client.get(NEXT_URL).status_code, status.HTTP_200_OK)

        novo = make_puzzle("Ilimitado")
        response = self.client.post(
            self.progress_url(novo), {"solved": True, "attempts": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
