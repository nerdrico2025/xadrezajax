from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.profiles.models import Profile, AdminProfile

User = get_user_model()


def create_test_user(**kwargs):
    defaults = {
        "email": "tal@chess.com",
        "full_name": "Mikhail Tal",
        "password": "Xadrez@2024",
    }
    defaults.update(kwargs)
    return User.objects.create_user(**defaults)


def create_admin_user(**kwargs):
    defaults = {
        "email": "admin@chess.com",
        "full_name": "Admin User",
        "password": "Xadrez@2024",
    }
    defaults.update(kwargs)
    user = User.objects.create_superuser(**defaults)
    profile = Profile.objects.create(user=user, nickname="Admin")
    AdminProfile.objects.create(profile=profile)
    return user


class AdminProfileTests(APITestCase):
    """UC011 — Testes de AdminProfile e promoção."""

    def setUp(self):
        self.admin = create_admin_user()
        self.common_user = create_test_user(email="common@chess.com")
        self.profile = Profile.objects.create(user=self.common_user, nickname="Common")
        self.promote_url = reverse(
            "profiles:promote-admin", kwargs={"user_id": self.common_user.id}
        )

    def test_post_promote_success_returns_201(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(self.promote_url)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.data["detail"], "Usuário promovido a administrador com sucesso."
        )

        self.common_user.refresh_from_db()
        self.assertTrue(self.common_user.is_staff)
        self.assertTrue(self.common_user.profile.is_admin)
        self.assertEqual(self.common_user.profile.admin_profile.promoted_by, self.admin)

    def test_post_promote_idempotent_returns_200(self):
        self.client.force_authenticate(user=self.admin)

        # Primeira vez
        response1 = self.client.post(self.promote_url)
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)

        # Segunda vez
        response2 = self.client.post(self.promote_url)
        self.assertEqual(response2.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response2.data["detail"],
            "O usuário já possui privilégios de administrador.",
        )

    def test_post_promote_forbidden_for_common_user(self):
        self.client.force_authenticate(user=self.common_user)
        response = self.client.post(self.promote_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_post_promote_not_found_returns_404(self):
        self.client.force_authenticate(user=self.admin)
        bad_url = reverse("profiles:promote-admin", kwargs={"user_id": 9999})
        response = self.client.post(bad_url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    @patch("apps.profiles.services.AdminProfile.objects.get_or_create")
    def test_post_handles_unexpected_error_returns_500(self, mock_get_or_create):
        mock_get_or_create.side_effect = Exception("Simulated DB Error")
        self.client.force_authenticate(user=self.admin)

        response = self.client.post(self.promote_url)
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(
            response.data["detail"], "Ocorreu um erro interno ao promover o usuário."
        )
