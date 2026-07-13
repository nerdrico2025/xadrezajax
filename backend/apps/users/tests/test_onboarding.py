"""
Testes do onboarding em 3 toques (item 0.4 da Fase 0).

Cobre: cálculo do nível para as combinações de resposta, seed correto do
rating Glicko-2 por nível, idempotência (segunda chamada não reprocessa) e o
grandfathering (perfis com onboarding_completed_at preenchido pela migration
não conseguem re-onboardar).
"""

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.models import ModalityRating, Profile
from apps.users.views import _onboarding_level

User = get_user_model()

ONBOARDING_URL = reverse("users:onboarding")
LOGIN_URL = reverse("users:login")

PASSWORD = "Xadrez@2024"


def answers(experience="never", found_mate=False, frequency="casual"):
    return {
        "experience": experience,
        "found_mate": found_mate,
        "frequency": frequency,
    }


class OnboardingLevelTests(APITestCase):
    """Regra de pontuação: exp(0/1/2) + mate(0/2) + freq(0/1/2);
    0–1 beginner · 2–4 intermediate · 5–6 advanced."""

    def test_level_combinations(self):
        cases = [
            (("never", False, "casual"), "beginner"),  # 0
            (("casual", False, "casual"), "beginner"),  # 1
            (("never", True, "casual"), "intermediate"),  # 2
            (("casual", True, "weekly"), "intermediate"),  # 4
            (("frequent", False, "daily"), "intermediate"),  # 4
            (("casual", True, "daily"), "advanced"),  # 5
            (("frequent", True, "daily"), "advanced"),  # 6
        ]
        for (exp, mate, freq), expected in cases:
            self.assertEqual(
                _onboarding_level(exp, mate, freq),
                expected,
                f"({exp}, {mate}, {freq}) deveria ser {expected}",
            )


class OnboardingViewTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="novo@chess.com", full_name="Novo", password=PASSWORD
        )
        self.client.force_authenticate(user=self.user)

    def post_onboarding(self, **kwargs):
        return self.client.post(ONBOARDING_URL, answers(**kwargs), format="json")

    def test_new_profile_starts_without_onboarding(self):
        profile = Profile.objects.get(user=self.user)
        self.assertIsNone(profile.onboarding_completed_at)

    def test_beginner_seeds_800_in_all_modalities(self):
        response = self.post_onboarding()  # tudo no mínimo → beginner
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["level"], "beginner")
        self.assertEqual(response.data["rating"], 800)
        self.assertTrue(response.data["provisional"])
        self.assertFalse(response.data["already_completed"])

        ratings = ModalityRating.objects.filter(profile__user=self.user)
        self.assertEqual(ratings.count(), 3)
        for rating in ratings:
            self.assertEqual(rating.rating, 800.0)
            self.assertEqual(rating.deviation, 350.0)
            self.assertEqual(rating.volatility, 0.06)
            self.assertTrue(rating.is_provisional)

        profile = Profile.objects.get(user=self.user)
        self.assertEqual(profile.rating, 800)  # espelho segue o blitz
        self.assertIsNotNone(profile.onboarding_completed_at)

    def test_advanced_seeds_1600(self):
        response = self.post_onboarding(
            experience="frequent", found_mate=True, frequency="daily"
        )
        self.assertEqual(response.data["level"], "advanced")
        self.assertEqual(response.data["rating"], 1600)
        self.assertEqual(
            ModalityRating.objects.get(
                profile__user=self.user, modality="blitz"
            ).rating,
            1600.0,
        )

    def test_intermediate_seeds_1200(self):
        response = self.post_onboarding(
            experience="casual", found_mate=True, frequency="weekly"
        )
        self.assertEqual(response.data["level"], "intermediate")
        self.assertEqual(response.data["rating"], 1200)

    def test_idempotent_second_call_does_not_reprocess(self):
        first = self.post_onboarding()  # beginner → 800
        self.assertEqual(first.data["rating"], 800)
        completed_at = Profile.objects.get(user=self.user).onboarding_completed_at

        # Segunda chamada com respostas "avançadas" não muda nada
        second = self.post_onboarding(
            experience="frequent", found_mate=True, frequency="daily"
        )
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertTrue(second.data["already_completed"])
        self.assertIsNone(second.data["level"])
        self.assertEqual(second.data["rating"], 800)  # estado atual, sem reseed

        profile = Profile.objects.get(user=self.user)
        self.assertEqual(profile.onboarding_completed_at, completed_at)
        self.assertEqual(
            ModalityRating.objects.filter(
                profile__user=self.user, rating=800.0
            ).count(),
            3,
        )

    def test_grandfathered_profile_cannot_reonboard(self):
        """Regressão: perfis preenchidos pela migration 0010 (contas antigas)
        recebem o estado já concluído — nunca são re-semeados."""
        profile = Profile.objects.get(user=self.user)
        profile.rating = 1350  # Elo legado de quem já jogava
        profile.onboarding_completed_at = timezone.now()  # como faz a 0010
        profile.save(update_fields=["rating", "onboarding_completed_at"])

        response = self.post_onboarding(
            experience="never", found_mate=False, frequency="casual"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["already_completed"])

        # Nada foi semeado nem alterado
        self.assertFalse(
            ModalityRating.objects.filter(profile__user=self.user).exists()
        )
        profile.refresh_from_db()
        self.assertEqual(profile.rating, 1350)

    def test_existing_modality_rating_is_not_overwritten(self):
        """Quem já tem rating conquistado numa modalidade não é resetado
        pelo seed autodeclarado."""
        profile = Profile.objects.get(user=self.user)
        ModalityRating.objects.create(
            profile=profile, modality="blitz", rating=1700, games_played=30
        )

        response = self.post_onboarding()  # beginner → seed 800
        self.assertEqual(response.data["level"], "beginner")
        # Resposta reflete o blitz real (preservado), não o seed
        self.assertEqual(response.data["rating"], 1700)
        self.assertFalse(response.data["provisional"])  # 30 partidas

        blitz = ModalityRating.objects.get(profile=profile, modality="blitz")
        self.assertEqual((blitz.rating, blitz.games_played), (1700.0, 30))
        # As outras duas modalidades ganham o seed normalmente
        self.assertEqual(
            ModalityRating.objects.get(profile=profile, modality="bullet").rating,
            800.0,
        )

    def test_invalid_payload_returns_400(self):
        for bad in [
            {"experience": "master", "found_mate": True, "frequency": "daily"},
            {"experience": "never", "found_mate": "sim", "frequency": "daily"},
            {"experience": "never", "found_mate": True, "frequency": "sempre"},
            {},
        ]:
            response = self.client.post(ONBOARDING_URL, bad, format="json")
            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST, f"payload: {bad}"
            )
        # Nada semeado em nenhuma tentativa inválida
        self.assertFalse(
            ModalityRating.objects.filter(profile__user=self.user).exists()
        )

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(ONBOARDING_URL, answers(), format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class OnboardingLoginPayloadTests(APITestCase):
    """O gate do mobile lê onboarding_completed do payload de login."""

    def test_login_payload_reflects_onboarding_state(self):
        User.objects.create_user(
            email="gate@chess.com", full_name="Gate", password=PASSWORD
        )
        response = self.client.post(
            LOGIN_URL,
            {"email": "gate@chess.com", "password": PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["user"]["onboarding_completed"])

        # Depois de onboardar, o login passa a refletir concluído
        profile = Profile.objects.get(user__email="gate@chess.com")
        profile.onboarding_completed_at = timezone.now()
        profile.save(update_fields=["onboarding_completed_at"])

        response = self.client.post(
            LOGIN_URL,
            {"email": "gate@chess.com", "password": PASSWORD},
            format="json",
        )
        self.assertTrue(response.data["user"]["onboarding_completed"])
