"""
Testes do redesenho de Problemas (2026-07-21): Problema do dia (1/dia, o mesmo
para todos, grátis) + Treino (exclusivo do plano pago, ilimitado).

O antigo modelo de 3 problemas/dia no Grátis deixou de existir — os testes de
cota daquele modelo foram substituídos pelos de gating por produto.

Cobre: determinismo e estabilidade do problema do dia, streak, tentativas
esgotadas persistindo até a virada do dia, e o ponto crítico de gating do
`progress/` nos DOIS sentidos (não trava o diário grátis, não vaza o treino).
"""

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.payments.models import Subscription
from apps.puzzles.models import (
    DAILY_PUZZLE_MAX_ATTEMPTS,
    DailyPuzzle,
    Puzzle,
    UserPuzzleProgress,
    get_daily_puzzle,
)
from apps.users.models import Profile

User = get_user_model()

DAILY_URL = reverse("puzzles:daily")
NEXT_URL = reverse("puzzles:next")
MAP_URL = reverse("puzzles:map")
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


def make_paid(user):
    """Assinatura ativa — libera o Treino."""
    profile = Profile.objects.get(user=user)
    Subscription.objects.create(
        profile=profile,
        plan=Subscription.PLAN_MONTHLY,
        status=Subscription.STATUS_ACTIVE,
    )
    return profile


def progress_url(puzzle):
    return reverse("puzzles:progress", args=[puzzle.id])


def detail_url(puzzle):
    return reverse("puzzles:detail", args=[puzzle.id])


class CleanPuzzleBankMixin:
    """Zera o banco semeado pela migration 0002 para que o problema do dia
    seja previsível nos testes."""

    def setUp(self):
        Puzzle.objects.all().delete()
        super().setUp()


class DailyPuzzleSelectionTests(CleanPuzzleBankMixin, APITestCase):
    """Determinismo e estabilidade do problema do dia."""

    def setUp(self):
        super().setUp()
        self.p1 = make_puzzle("Um", rating=100)
        self.p2 = make_puzzle("Dois", rating=200)
        self.p3 = make_puzzle("Três", rating=300)

    def test_mesmo_problema_para_todos_no_mesmo_dia(self):
        a, b = make_user("a@chess.com"), make_user("b@chess.com")
        self.client.force_authenticate(user=a)
        first = self.client.get(DAILY_URL).data["id"]
        self.client.force_authenticate(user=b)
        second = self.client.get(DAILY_URL).data["id"]
        self.assertEqual(first, second)

    def test_problema_muda_na_virada_do_dia(self):
        hoje = get_daily_puzzle(date(2026, 3, 10))
        amanha = get_daily_puzzle(date(2026, 3, 11))
        self.assertNotEqual(hoje.id, amanha.id)

    def test_mesma_data_sempre_devolve_o_mesmo_problema(self):
        d = date(2026, 5, 20)
        self.assertEqual(get_daily_puzzle(d).id, get_daily_puzzle(d).id)

    def test_marcacao_do_dia_e_gravada_uma_vez(self):
        d = date(2026, 6, 1)
        get_daily_puzzle(d)
        get_daily_puzzle(d)
        self.assertEqual(DailyPuzzle.objects.filter(date=d).count(), 1)

    def test_adicionar_problema_nao_muda_o_diario_ja_escolhido(self):
        """A razão de existir a tabela: estabilidade dentro do dia."""
        d = date(2026, 7, 1)
        escolhido = get_daily_puzzle(d)
        make_puzzle("Novo problema", rating=50)  # entraria antes na ordenação
        self.assertEqual(get_daily_puzzle(d).id, escolhido.id)

    def test_sem_problemas_ativos_devolve_404(self):
        Puzzle.objects.all().delete()
        self.client.force_authenticate(user=make_user())
        response = self.client.get(DAILY_URL)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class DailyPuzzleAccessTests(CleanPuzzleBankMixin, APITestCase):
    """O diário é grátis para todos — nunca pode ser trancado."""

    def setUp(self):
        super().setUp()
        self.puzzle = make_puzzle("Diário")
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_usuario_gratis_acessa_o_diario(self):
        response = self.client.get(DAILY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], self.puzzle.id)
        self.assertIn("solution", response.data)
        self.assertEqual(response.data["max_attempts"], DAILY_PUZZLE_MAX_ATTEMPTS)
        self.assertEqual(response.data["attempts_left"], DAILY_PUZZLE_MAX_ATTEMPTS)

    def test_usuario_pago_tambem_acessa_o_diario(self):
        make_paid(self.user)
        self.assertEqual(self.client.get(DAILY_URL).status_code, status.HTTP_200_OK)

    def test_nao_autenticado_e_rejeitado(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.get(DAILY_URL).status_code, status.HTTP_401_UNAUTHORIZED
        )


class TrainingGatingTests(CleanPuzzleBankMixin, APITestCase):
    """Treino é exclusivo do pago — em todos os endpoints que o servem."""

    def setUp(self):
        super().setUp()
        self.daily = make_puzzle("Diário", rating=100)
        self.other = make_puzzle("Outro", rating=200)
        self.user = make_user()
        self.client.force_authenticate(user=self.user)
        # Fixa o diário do dia corrente para os testes de fronteira.
        self.today_puzzle = get_daily_puzzle()

    def test_gratis_recebe_403_no_next(self):
        response = self.client.get(NEXT_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "training_requires_premium")

    def test_gratis_recebe_403_no_map(self):
        self.assertEqual(
            self.client.get(MAP_URL).status_code, status.HTTP_403_FORBIDDEN
        )

    def test_gratis_recebe_403_no_detalhe_de_problema_que_nao_e_o_do_dia(self):
        outro = self.other if self.today_puzzle.id == self.daily.id else self.daily
        response = self.client.get(detail_url(outro))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_gratis_acessa_o_detalhe_do_problema_do_dia(self):
        response = self.client.get(detail_url(self.today_puzzle))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_pago_acessa_next_e_map(self):
        make_paid(self.user)
        self.assertEqual(self.client.get(NEXT_URL).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(MAP_URL).status_code, status.HTTP_200_OK)


class ProgressGatingTests(CleanPuzzleBankMixin, APITestCase):
    """
    ⚠️ O PONTO CRÍTICO ⚠️
    O progress/ decide pelo DADO (o pk é o problema do dia?), nunca pelo que o
    cliente diz. Os dois sentidos precisam valer ao mesmo tempo:
      - não travar o diário do usuário grátis;
      - não deixar o grátis registrar progresso em problema de treino.
    """

    def setUp(self):
        super().setUp()
        self.a = make_puzzle("Um", rating=100)
        self.b = make_puzzle("Dois", rating=200)
        self.user = make_user()
        self.client.force_authenticate(user=self.user)
        self.daily = get_daily_puzzle()
        self.training = self.b if self.daily.id == self.a.id else self.a

    # ── sentido 1: não travar o diário grátis ────────────────────────────
    def test_gratis_registra_solve_do_diario(self):
        response = self.client.post(
            progress_url(self.daily), {"solved": True, "attempts": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["solved"])
        self.assertEqual(response.data["mode"], "daily")
        self.assertTrue(
            UserPuzzleProgress.objects.get(user=self.user, puzzle=self.daily).solved
        )

    def test_gratis_registra_falha_do_diario(self):
        response = self.client.post(
            progress_url(self.daily), {"solved": False, "attempts": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["attempts_used"], 1)

    # ── sentido 2: não vazar o treino ────────────────────────────────────
    def test_gratis_e_bloqueado_no_progresso_de_problema_de_treino(self):
        response = self.client.post(
            progress_url(self.training), {"solved": True, "attempts": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "training_requires_premium")
        self.assertFalse(
            UserPuzzleProgress.objects.filter(
                user=self.user, puzzle=self.training
            ).exists()
        )

    def test_cliente_nao_escolhe_o_modo(self):
        """Mandar 'mode: daily' no corpo não convence o servidor: quem decide
        é a comparação com o problema do dia."""
        response = self.client.post(
            progress_url(self.training),
            {"solved": True, "attempts": 1, "mode": "daily"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_pago_registra_progresso_no_treino(self):
        make_paid(self.user)
        response = self.client.post(
            progress_url(self.training), {"solved": True, "attempts": 2}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["mode"], "training")

    def test_treino_nao_tem_limite_de_tentativas(self):
        make_paid(self.user)
        for _ in range(DAILY_PUZZLE_MAX_ATTEMPTS + 3):
            response = self.client.post(
                progress_url(self.training),
                {"solved": False, "attempts": 1},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("exhausted", response.data)
        # Sem esgotamento, sem revelação: no treino a solução só sai ao acertar.
        self.assertNotIn("solution", response.data)
        progress = UserPuzzleProgress.objects.get(user=self.user, puzzle=self.training)
        self.assertIsNone(progress.exhausted_at)

    def test_treino_revela_solucao_ao_acertar(self):
        make_paid(self.user)
        response = self.client.post(
            progress_url(self.training), {"solved": True, "attempts": 1}, format="json"
        )
        self.assertTrue(response.data["solved"])
        self.assertIn("solution", response.data)


class DailyExhaustionTests(CleanPuzzleBankMixin, APITestCase):
    """4 tentativas no diário, esgotamento persistindo até a virada do dia."""

    def setUp(self):
        super().setUp()
        make_puzzle("Único")
        self.user = make_user()
        self.client.force_authenticate(user=self.user)
        self.daily = get_daily_puzzle()

    def fail_once(self):
        return self.client.post(
            progress_url(self.daily), {"solved": False, "attempts": 1}, format="json"
        )

    def test_contador_decrementa_a_cada_falha(self):
        for expected_used in range(1, DAILY_PUZZLE_MAX_ATTEMPTS):
            response = self.fail_once()
            self.assertEqual(response.data["attempts_used"], expected_used)
            self.assertFalse(response.data["exhausted"])

    def test_quarta_falha_esgota_e_o_servidor_carimba(self):
        for _ in range(DAILY_PUZZLE_MAX_ATTEMPTS):
            response = self.fail_once()
        self.assertTrue(response.data["exhausted"])
        self.assertEqual(response.data["attempts_left"], 0)
        progress = UserPuzzleProgress.objects.get(user=self.user, puzzle=self.daily)
        self.assertIsNotNone(progress.exhausted_at)

    def test_progress_nao_revela_a_solucao_antes_de_esgotar(self):
        """A resposta do progress/ NÃO traz a solução enquanto ainda há
        tentativas (canal onde a garantia 'não antes' é observável)."""
        for _ in range(DAILY_PUZZLE_MAX_ATTEMPTS - 1):
            response = self.fail_once()
            self.assertFalse(response.data["exhausted"])
            self.assertNotIn("solution", response.data)

    def test_esgotar_revela_a_solucao_na_resposta_do_progress(self):
        """Decisão de produto: esgotar as 4 tentativas sem acertar REVELA a
        solução (aprendizado, padrão de sites de xadrez)."""
        for _ in range(DAILY_PUZZLE_MAX_ATTEMPTS - 1):
            self.fail_once()
        final = self.fail_once()
        self.assertTrue(final.data["exhausted"])
        self.assertIn("solution", final.data)
        self.assertEqual(
            final.data["solution"],
            Puzzle.objects.get(id=self.daily.id).solution,
        )

    def test_acertar_tambem_revela_a_solucao_para_revisao(self):
        response = self.client.post(
            progress_url(self.daily), {"solved": True, "attempts": 1}, format="json"
        )
        self.assertTrue(response.data["solved"])
        self.assertIn("solution", response.data)

    def test_daily_esgotado_revela_a_solucao_ao_reabrir(self):
        """Reabrir o diário esgotado (nova sessão) mostra a solução — por isso
        o daily/ precisa incluí-la no estado esgotado."""
        for _ in range(DAILY_PUZZLE_MAX_ATTEMPTS):
            self.fail_once()
        response = self.client.get(DAILY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["exhausted"])
        self.assertIn("solution", response.data)

    def test_esgotamento_persiste_entre_sessoes_no_mesmo_dia(self):
        """Fechar e reabrir o app não devolve tentativas — o estado é do
        servidor, não da memória da tela."""
        for _ in range(DAILY_PUZZLE_MAX_ATTEMPTS):
            self.fail_once()
        response = self.client.get(DAILY_URL)
        self.assertTrue(response.data["exhausted"])
        self.assertEqual(response.data["attempts_left"], 0)

    def test_solve_apos_esgotar_nao_conta(self):
        for _ in range(DAILY_PUZZLE_MAX_ATTEMPTS):
            self.fail_once()
        self.client.post(
            progress_url(self.daily), {"solved": True, "attempts": 1}, format="json"
        )
        self.assertFalse(
            UserPuzzleProgress.objects.get(user=self.user, puzzle=self.daily).solved
        )

    def test_esgotamento_de_ontem_nao_vale_hoje(self):
        progress = UserPuzzleProgress.objects.create(
            user=self.user,
            puzzle=self.daily,
            exhausted_at=timezone.now() - timedelta(days=1),
            daily_attempts=DAILY_PUZZLE_MAX_ATTEMPTS,
            daily_attempts_date=timezone.localdate() - timedelta(days=1),
        )
        self.assertFalse(progress.is_exhausted_today())
        response = self.client.get(DAILY_URL)
        self.assertFalse(response.data["exhausted"])
        self.assertEqual(response.data["attempts_left"], DAILY_PUZZLE_MAX_ATTEMPTS)
        self.assertIn("solution", response.data)


class StatsTests(CleanPuzzleBankMixin, APITestCase):
    def setUp(self):
        super().setUp()
        make_puzzle("Único")
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_gratis_ve_treino_bloqueado(self):
        data = self.client.get(STATS_URL).data
        self.assertFalse(data["training_unlocked"])
        self.assertTrue(data["daily_available"])
        self.assertEqual(data["daily_max_attempts"], DAILY_PUZZLE_MAX_ATTEMPTS)

    def test_pago_ve_treino_liberado(self):
        make_paid(self.user)
        self.assertTrue(self.client.get(STATS_URL).data["training_unlocked"])

    def test_stats_reflete_diario_resolvido(self):
        daily = get_daily_puzzle()
        self.client.post(
            progress_url(daily), {"solved": True, "attempts": 1}, format="json"
        )
        data = self.client.get(STATS_URL).data
        self.assertTrue(data["daily_solved"])
        self.assertFalse(data["daily_available"])

    def test_nao_expoe_mais_a_cota_antiga(self):
        data = self.client.get(STATS_URL).data
        self.assertNotIn("daily_puzzle_limit", data)
        self.assertNotIn("remaining_puzzles_today", data)


class StreakTests(CleanPuzzleBankMixin, APITestCase):
    """Streak segue valendo — agora alimentado pelo diário."""

    def setUp(self):
        super().setUp()
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def get_streak(self):
        response = self.client.get(STATS_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["streak"]

    def test_streak_zero_sem_solves(self):
        make_puzzle("P")
        self.assertEqual(self.get_streak(), 0)

    def test_streak_conta_dias_consecutivos_ate_hoje(self):
        for days_ago in (0, 1, 2):
            solve_puzzle(self.user, make_puzzle(f"P{days_ago}"), days_ago)
        self.assertEqual(self.get_streak(), 3)

    def test_streak_de_ontem_ainda_vale_hoje(self):
        solve_puzzle(self.user, make_puzzle("Ontem"), days_ago=1)
        solve_puzzle(self.user, make_puzzle("Anteontem"), days_ago=2)
        self.assertEqual(self.get_streak(), 2)

    def test_streak_quebra_com_dia_sem_solve(self):
        solve_puzzle(self.user, make_puzzle("Hoje"), days_ago=0)
        solve_puzzle(self.user, make_puzzle("Antigo"), days_ago=2)
        self.assertEqual(self.get_streak(), 1)

    def test_streak_zero_se_ultimo_solve_e_antigo(self):
        solve_puzzle(self.user, make_puzzle("Antigo"), days_ago=5)
        self.assertEqual(self.get_streak(), 0)

    def test_varios_solves_no_mesmo_dia_contam_um_dia(self):
        solve_puzzle(self.user, make_puzzle("A"), days_ago=0)
        solve_puzzle(self.user, make_puzzle("B"), days_ago=0)
        self.assertEqual(self.get_streak(), 1)
