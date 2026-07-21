"""
Modo Campanha vs IA — PR 1 (backend): progressão por desbloqueio sequencial,
selos por nível dominado, atrelados ao registro de partida vs IA já existente
(POST /game/ai-result/, PR B + fix do #78).
"""

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.models import (
    CampaignProgress,
    CampaignWinLog,
    GameHistory,
    Profile,
    record_campaign_win,
)

User = get_user_model()

AI_RESULT_URL = reverse("users:game-ai-result")
GAME_RESULT_URL = reverse("users:game-result")
CAMPAIGN_URL = reverse("users:campaign-progress")

INTERNAL_SECRET = "test-internal-secret"


class CampaignProgressInitialStateTests(APITestCase):
    """Estado inicial: criado pelo signal create_user_profile."""

    def test_new_profile_seeds_five_levels_with_only_beginner_unlocked(self):
        user = User.objects.create_user(
            email="novo@chess.com", full_name="Novo", password="Xadrez@2024"
        )
        profile = Profile.objects.get(user=user)
        rows = {p.level: p for p in CampaignProgress.objects.filter(profile=profile)}

        self.assertEqual(set(rows.keys()), set(CampaignProgress.LEVEL_ORDER))
        for level, row in rows.items():
            self.assertEqual(row.wins, 0)
            self.assertFalse(row.badge_awarded)
            self.assertIsNone(row.badge_awarded_at)
            if level == CampaignProgress.LEVEL_BEGINNER:
                self.assertTrue(row.unlocked)
                self.assertIsNotNone(row.unlocked_at)
            else:
                self.assertFalse(row.unlocked)
                self.assertIsNone(row.unlocked_at)


class AiWinProgressionTests(APITestCase):
    """Vitória vs IA incrementando a campanha via /game/ai-result/."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="campanha@chess.com", full_name="Jogador", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=self.user)
        self.profile = Profile.objects.get(user=self.user)

    def progress(self, level):
        return CampaignProgress.objects.get(profile=self.profile, level=level)

    def win(self, difficulty, time_control=300):
        return self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": difficulty, "time_control": time_control},
            format="json",
        )

    def test_win_increments_correct_level_only(self):
        self.win("easy")
        self.assertEqual(self.progress("easy").wins, 1)
        self.assertEqual(self.progress("beginner").wins, 0)
        self.assertEqual(self.progress("medium").wins, 0)

    def test_draw_and_loss_do_not_increment(self):
        self.client.post(
            AI_RESULT_URL,
            {"result": "draw", "difficulty": "beginner", "time_control": 300},
            format="json",
        )
        self.client.post(
            AI_RESULT_URL,
            {"result": "loss", "difficulty": "beginner", "time_control": 300},
            format="json",
        )
        self.assertEqual(self.progress("beginner").wins, 0)
        self.assertFalse(self.progress("beginner").badge_awarded)

    def test_win_without_clock_counts_normally(self):
        self.win("beginner", time_control=None)
        self.assertEqual(self.progress("beginner").wins, 1)

    def test_third_win_unlocks_next_level_and_awards_badge(self):
        for _ in range(2):
            self.win("beginner")
        beginner = self.progress("beginner")
        self.assertEqual(beginner.wins, 2)
        self.assertFalse(beginner.badge_awarded)
        self.assertFalse(self.progress("easy").unlocked)

        self.win("beginner")

        beginner.refresh_from_db()
        self.assertEqual(beginner.wins, 3)
        self.assertTrue(beginner.badge_awarded)
        self.assertIsNotNone(beginner.badge_awarded_at)

        easy = self.progress("easy")
        self.assertTrue(easy.unlocked)
        self.assertIsNotNone(easy.unlocked_at)
        # Só o próximo nível é afetado — o resto continua travado.
        self.assertFalse(self.progress("medium").unlocked)

    def test_master_awards_badge_without_next_level(self):
        for _ in range(3):
            self.win("master")

        master = self.progress("master")
        self.assertEqual(master.wins, 3)
        self.assertTrue(master.badge_awarded)
        # Não deve ter criado nenhuma linha além das 5 níveis existentes.
        self.assertEqual(
            CampaignProgress.objects.filter(profile=self.profile).count(), 5
        )

    def test_campaign_win_never_changes_rating(self):
        """Reforço da regra D1 (PR B): vitória de campanha não mexe no Glicko-2
        nem no espelho de rating do Profile — mesmo ao desbloquear/conceder selo."""
        for _ in range(3):
            response = self.win("beginner")
            self.assertEqual(response.data["rating"], 1500)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.rating, 1200)  # espelho intocado


class CampaignIdempotencyTests(APITestCase):
    """Reprocessar a mesma partida (mesmo GameHistory) não pode contar duas vezes."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="idempotente@chess.com",
            full_name="Idempotente",
            password="Xadrez@2024",
        )
        self.profile = Profile.objects.get(user=self.user)
        self.game = GameHistory.objects.create(
            user=self.user,
            result=GameHistory.RESULT_WIN,
            mode=GameHistory.MODE_AI,
            rating_before=1500,
            rating_after=1500,
            rated=False,
        )

    def test_calling_record_campaign_win_twice_with_same_game_id_counts_once(self):
        record_campaign_win(self.profile, "beginner", self.game.id)
        record_campaign_win(self.profile, "beginner", self.game.id)
        record_campaign_win(self.profile, "beginner", self.game.id)

        progress = CampaignProgress.objects.get(profile=self.profile, level="beginner")
        self.assertEqual(progress.wins, 1)
        self.assertEqual(CampaignWinLog.objects.filter(game=self.game).count(), 1)

    def test_end_to_end_via_endpoint_does_not_double_count_same_history_row(self):
        """O ponto de integração real: chamar record_campaign_win de novo para
        o MESMO game_history_id (ex.: reprocessamento) é no-op, mesmo depois
        de passar pelo fluxo normal do endpoint."""
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": "easy", "time_control": 300},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        created_game = GameHistory.objects.filter(
            user=self.user, mode=GameHistory.MODE_AI
        ).latest("played_at")

        # Simula reprocessamento do MESMO registro (mesmo game id) fora do
        # ciclo HTTP normal — não deve somar de novo.
        record_campaign_win(self.profile, "easy", created_game.id)

        self.assertEqual(
            CampaignProgress.objects.get(profile=self.profile, level="easy").wins, 1
        )


@override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET)
class HumanGameDoesNotAffectCampaignTests(APITestCase):
    """Vitória contra HUMANO (GameResultView) não deve tocar na campanha."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="white-campaign@chess.com", full_name="White", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="black-campaign@chess.com", full_name="Black", password="Xadrez@2024"
        )

    def test_online_win_leaves_campaign_untouched(self):
        response = self.client.post(
            GAME_RESULT_URL,
            {
                "white_id": self.white.id,
                "black_id": self.black.id,
                "result": "white",
                "time_control": 300,
            },
            format="json",
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        white_profile = Profile.objects.get(user=self.white)
        for level in CampaignProgress.LEVEL_ORDER:
            self.assertEqual(
                CampaignProgress.objects.get(profile=white_profile, level=level).wins,
                0,
            )


class CampaignProgressViewTests(APITestCase):
    """GET /api/v1/auth/campaign/ — leitura consumida pelo wizard/perfil."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="leitura@chess.com", full_name="Leitura", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=self.user)

    def test_returns_five_levels_in_order_with_initial_state(self):
        response = self.client.get(CAMPAIGN_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 5)
        self.assertEqual(
            [row["nivel"] for row in response.data], CampaignProgress.LEVEL_ORDER
        )

        beginner = response.data[0]
        self.assertEqual(beginner["nivel"], "beginner")
        self.assertTrue(beginner["desbloqueado"])
        self.assertEqual(beginner["vitorias"], 0)
        self.assertEqual(beginner["vitorias_para_desbloquear"], 3)
        self.assertFalse(beginner["selo_concedido"])

        easy = response.data[1]
        self.assertFalse(easy["desbloqueado"])

    def test_reflects_progress_after_wins(self):
        for _ in range(3):
            self.client.post(
                AI_RESULT_URL,
                {"result": "win", "difficulty": "beginner", "time_control": 300},
                format="json",
            )

        response = self.client.get(CAMPAIGN_URL)
        by_level = {row["nivel"]: row for row in response.data}
        self.assertEqual(by_level["beginner"]["vitorias"], 3)
        self.assertTrue(by_level["beginner"]["selo_concedido"])
        self.assertTrue(by_level["easy"]["desbloqueado"])
        self.assertFalse(by_level["medium"]["desbloqueado"])

    def test_unauthenticated_request_rejected(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(CAMPAIGN_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
