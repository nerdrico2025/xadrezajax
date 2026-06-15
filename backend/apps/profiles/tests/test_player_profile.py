from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.profiles.models import Profile, PlayerProfile

User = get_user_model()
PLAYER_PROFILE_URL = reverse("profiles:player-profile")


def create_test_user(**kwargs):
    defaults = {
        "email": "tal@chess.com",
        "full_name": "Mikhail Tal",
        "password": "Xadrez@2024",
    }
    defaults.update(kwargs)
    return User.objects.create_user(**defaults)


class PlayerProfileTests(APITestCase):
    """UC010 — Testes de PlayerProfile e controle de acesso."""

    def setUp(self):
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.profile = Profile.objects.create(user=self.user, nickname="Misha")

    def test_post_creates_player_profile_returns_201(self):
        response = self.client.post(PLAYER_PROFILE_URL)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("rating", response.data)
        self.assertEqual(response.data["rating"], 1200)
        self.assertTrue(PlayerProfile.objects.filter(profile=self.profile).exists())

    def test_post_is_idempotent_returns_200_if_exists(self):
        # Primeira chamada (cria)
        response1 = self.client.post(PLAYER_PROFILE_URL)
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)

        # Segunda chamada (reaproveita)
        response2 = self.client.post(PLAYER_PROFILE_URL)
        self.assertEqual(response2.status_code, status.HTTP_200_OK)
        self.assertEqual(response1.data["id"], response2.data["id"])

        # Garante que não duplicou no banco
        self.assertEqual(PlayerProfile.objects.filter(profile=self.profile).count(), 1)

    def test_get_returns_player_profile(self):
        PlayerProfile.objects.create(profile=self.profile, rating=1500)
        response = self.client.get(PLAYER_PROFILE_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["rating"], 1500)

    def test_get_returns_404_if_not_player(self):
        response = self.client.get(PLAYER_PROFILE_URL)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_is_player_property(self):
        self.assertFalse(self.profile.is_player)
        PlayerProfile.objects.create(profile=self.profile)
        
        # Recarregar do banco não é estritamente necessário para cached properties, 
        # mas como é um related_object (reverse OneToOne), recarregamos
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_player)

    @patch("apps.profiles.services.PlayerProfile.objects.get_or_create")
    def test_post_handles_unexpected_error_returns_500(self, mock_get_or_create):
        mock_get_or_create.side_effect = Exception("Simulated DB Error")
        response = self.client.post(PLAYER_PROFILE_URL)
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data["detail"], "Ocorreu um erro interno ao habilitar o acesso ao jogo.")
