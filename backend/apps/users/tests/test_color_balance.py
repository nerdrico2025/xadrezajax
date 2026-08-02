"""Endpoint interno de balanço de cor (Item 6) e o comando que devolve ao
onboarding as contas com rating não conquistado (Item 4).

O endpoint existe porque o pareamento roda no node-api, que não fala com o
banco. A alternativa barata — o cliente mandar os próprios contadores de cor
no `join_queue` — seria spoofável, o mesmo furo já fechado na identidade do
socket. Contagem de cor é do servidor.
"""

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.models import GameHistory, ModalityRating, Profile

User = get_user_model()

COLOR_BALANCE_URL = reverse("users:internal-color-balance")
INTERNAL_SECRET = "test-internal-secret"


@override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET)
class InternalColorBalanceViewTests(APITestCase):
    def setUp(self):
        self.a = User.objects.create_user(
            email="a@chess.com", full_name="A", password="Xadrez@2024"
        )
        self.b = User.objects.create_user(
            email="b@chess.com", full_name="B", password="Xadrez@2024"
        )

    def history(self, user, color, mode=GameHistory.MODE_ONLINE):
        GameHistory.objects.create(
            user=user,
            opponent_name="X",
            result="win",
            mode=mode,
            modality="blitz",
            rating_before=1500,
            rating_after=1500,
            rated=mode == GameHistory.MODE_ONLINE,
            color=color,
        )

    def get(self, *user_ids, secret=INTERNAL_SECRET):
        query = "&".join(f"user_id={uid}" for uid in user_ids)
        return self.client.get(
            f"{COLOR_BALANCE_URL}?{query}", headers={"X-Internal-Secret": secret}
        )

    def test_counts_colors_for_both_players_in_one_call(self):
        """Uma chamada só para o par — o pareamento precisa dos dois ao mesmo
        tempo e duas idas ao Django dobrariam a latência do join_queue."""
        for _ in range(3):
            self.history(self.a, GameHistory.COLOR_WHITE)
        self.history(self.a, GameHistory.COLOR_BLACK)
        self.history(self.b, GameHistory.COLOR_BLACK)

        response = self.get(self.a.id, self.b.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["players"],
            {
                str(self.a.id): {"white": 3, "black": 1},
                str(self.b.id): {"white": 0, "black": 1},
            },
        )

    def test_player_without_history_comes_back_zeroed(self):
        """Jogador novo aparece com 0/0 em vez de sumir da resposta — o
        node-api trata isso como "nada a balancear" e sorteia."""
        response = self.get(self.a.id)
        self.assertEqual(
            response.data["players"], {str(self.a.id): {"white": 0, "black": 0}}
        )

    def test_ai_games_and_null_color_are_ignored(self):
        """Só partida online com cor registrada entra na conta: vs IA não tem
        cor no payload e o histórico anterior à migration 0016 tem color
        nulo (o dado morreu junto com o Redis)."""
        self.history(self.a, GameHistory.COLOR_WHITE, mode=GameHistory.MODE_AI)
        self.history(self.a, None)
        self.history(self.a, GameHistory.COLOR_BLACK)

        response = self.get(self.a.id)
        self.assertEqual(
            response.data["players"], {str(self.a.id): {"white": 0, "black": 1}}
        )

    def test_wrong_secret_returns_403(self):
        self.assertEqual(
            self.get(self.a.id, secret="wrong").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_missing_user_id_returns_400(self):
        response = self.client.get(
            COLOR_BALANCE_URL, headers={"X-Internal-Secret": INTERNAL_SECRET}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_numeric_user_id_returns_400(self):
        response = self.client.get(
            f"{COLOR_BALANCE_URL}?user_id=abc",
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ResetUnearnedRatingsCommandTests(APITestCase):
    """Item 4: contas grandfathered pela 0010 nunca passaram pelo onboarding
    e ficaram no default 1500 do Glicko-2 sem ter jogado nada."""

    def make_user(self, email, ranked_games=0):
        user = User.objects.create_user(
            email=email, full_name=email.split("@")[0], password="Xadrez@2024"
        )
        profile = user.profile
        # Estado pós-migrations 0008 + 0010: rating semeado, onboarding
        # marcado como concluído sem nunca ter acontecido.
        profile.onboarding_completed_at = "2026-07-01T00:00:00Z"
        profile.rating = 1500
        profile.save(update_fields=["onboarding_completed_at", "rating"])
        for modality, _ in ModalityRating.MODALITY_CHOICES:
            ModalityRating.objects.create(
                profile=profile,
                modality=modality,
                games_played=ranked_games if modality == "blitz" else 0,
            )
        return user

    def run_command(self, *args):
        out = StringIO()
        call_command("reset_unearned_ratings", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_reports_but_writes_nothing(self):
        user = self.make_user("never@chess.com")

        output = self.run_command()

        self.assertIn("never@chess.com", output)
        self.assertIn("DRY-RUN", output)
        profile = Profile.objects.get(user=user)
        self.assertIsNotNone(profile.onboarding_completed_at)
        self.assertEqual(profile.modality_ratings.count(), 3)

    def test_apply_deletes_ratings_and_returns_account_to_onboarding(self):
        """As linhas são APAGADAS, não zeradas: o seed do onboarding usa
        get_or_create(defaults=...), que não sobrescreve linha existente — se
        elas ficassem, o onboarding rodaria e o rating continuaria 1500."""
        user = self.make_user("never@chess.com")

        output = self.run_command("--apply")

        profile = Profile.objects.get(user=user)
        self.assertIsNone(profile.onboarding_completed_at)
        self.assertEqual(profile.modality_ratings.count(), 0)
        self.assertEqual(profile.rating, 1500)
        self.assertIn("APLICADO", output)

    def test_account_with_ranked_games_is_preserved(self):
        """Rating conquistado jogando nunca é apagado — não há como saber
        qual seria o seed "certo" de quem já jogou, e o Glicko-2 já convergiu
        a partir do valor real."""
        played = self.make_user("played@chess.com", ranked_games=4)

        output = self.run_command("--apply")

        profile = Profile.objects.get(user=played)
        self.assertIsNotNone(profile.onboarding_completed_at)
        self.assertEqual(profile.modality_ratings.count(), 3)
        self.assertIn("PRESERVADAS", output)

    def test_is_idempotent(self):
        self.make_user("never@chess.com")

        self.run_command("--apply")
        second = self.run_command("--apply")

        # Sem linhas de rating, a conta continua elegível (0 partidas
        # ranqueadas) — rodar de novo é inofensivo, não há o que apagar.
        self.assertEqual(ModalityRating.objects.count(), 0)
        self.assertIn("APLICADO", second)
