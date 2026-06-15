from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.profiles.models import Profile

User = get_user_model()

PROFILE_CREATE_URL = reverse("profiles:profile-create")
PROFILE_ME_URL = reverse("profiles:profile-me")


def create_test_user(**kwargs):
    """Fábrica de usuários para os testes de perfil."""
    defaults = {
        "email": "garry@chess.com",
        "full_name": "Garry Kasparov",
        "password": "Xadrez@2024",
    }
    defaults.update(kwargs)
    return User.objects.create_user(**defaults)


class CreateProfileSuccessTests(APITestCase):
    """UC007 — Caminho feliz da criação de perfil."""

    def setUp(self):
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_create_profile_returns_201(self):
        response = self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_profile_with_nickname(self):
        payload = {"nickname": "Kaspa"}
        response = self.client.post(PROFILE_CREATE_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["nickname"], "Kaspa")

    def test_create_profile_persists_in_database(self):
        self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.assertTrue(Profile.objects.filter(user=self.user).exists())

    def test_create_profile_response_contains_user_data(self):
        response = self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.assertEqual(response.data["email"], self.user.email)
        self.assertEqual(response.data["full_name"], self.user.full_name)
        self.assertEqual(response.data["user_id"], self.user.id)

    def test_create_profile_response_contains_expected_fields(self):
        response = self.client.post(PROFILE_CREATE_URL, {}, format="json")
        expected_fields = [
            "id",
            "user_id",
            "email",
            "full_name",
            "nickname",
            "created_at",
            "updated_at",
        ]
        for field in expected_fields:
            self.assertIn(field, response.data)


class CreateProfileFailureTests(APITestCase):
    """UC007 — Cenários de falha na criação de perfil."""

    def test_unauthenticated_user_returns_401(self):
        response = self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_duplicate_profile_returns_400(self):
        """Garante que não é possível criar perfil duplicado."""
        user = create_test_user()
        self.client.force_authenticate(user=user)

        # Primeira criação — sucesso
        response_1 = self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.assertEqual(response_1.status_code, status.HTTP_201_CREATED)

        # Segunda criação — bloqueada
        response_2 = self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.assertEqual(response_2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("já possui", response_2.data["detail"])

    def test_duplicate_profile_does_not_create_second_record(self):
        user = create_test_user()
        self.client.force_authenticate(user=user)
        self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.client.post(PROFILE_CREATE_URL, {}, format="json")
        self.assertEqual(Profile.objects.filter(user=user).count(), 1)


class MyProfileTests(APITestCase):
    """UC007 — Consulta do perfil do usuário autenticado."""

    def test_get_my_profile_returns_200(self):
        user = create_test_user()
        Profile.objects.create(user=user, nickname="Kaspa")
        self.client.force_authenticate(user=user)

        response = self.client.get(PROFILE_ME_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], user.email)
        self.assertEqual(response.data["nickname"], "Kaspa")

    def test_get_nonexistent_profile_triggers_auto_creation(self):
        user = create_test_user()
        self.client.force_authenticate(user=user)

        response = self.client.get(PROFILE_ME_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], user.email)
        self.assertEqual(response.data["nickname"], "")  # Auto-created empty nickname
        
        # Verify it was actually created in DB
        self.assertTrue(Profile.objects.filter(user=user).exists())

    def test_unauthenticated_get_returns_401(self):
        response = self.client.get(PROFILE_ME_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    @patch("apps.profiles.views.ProfileService.create_profile")
    def test_auto_creation_failure_returns_500(self, mock_create):
        mock_create.side_effect = Exception("Simulated creation error")
        
        user = create_test_user()
        self.client.force_authenticate(user=user)

        response = self.client.get(PROFILE_ME_URL)
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data["detail"], "Erro interno ao criar o perfil automaticamente.")

    @patch("apps.profiles.views.Profile.objects.select_related")
    def test_unexpected_database_error_returns_500(self, mock_select_related):
        mock_select_related.side_effect = Exception("Simulated DB connection error")
        
        user = create_test_user()
        self.client.force_authenticate(user=user)

        response = self.client.get(PROFILE_ME_URL)
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data["detail"], "Erro interno ao consultar o perfil.")


class UpdateProfileTests(APITestCase):
    """UC009 — Cenários de atualização do perfil."""

    def setUp(self):
        self.user = create_test_user()
        self.profile = Profile.objects.create(user=self.user, nickname="OldName")
        self.client.force_authenticate(user=self.user)

    def test_update_profile_success_put(self):
        payload = {"nickname": "NewName"}
        response = self.client.put(PROFILE_ME_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["nickname"], "NewName")
        
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.nickname, "NewName")

    def test_update_profile_success_patch(self):
        payload = {"nickname": "PatchName"}
        response = self.client.patch(PROFILE_ME_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["nickname"], "PatchName")

    def test_update_profile_validation_error_returns_400(self):
        payload = {"nickname": "admin"}
        response = self.client.patch(PROFILE_ME_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("nickname", response.data)

    @patch("apps.profiles.views.ProfileService.update_profile")
    def test_update_profile_unexpected_error_returns_500(self, mock_update):
        mock_update.side_effect = Exception("Simulated DB Update Error")
        
        payload = {"nickname": "ValidName"}
        response = self.client.patch(PROFILE_ME_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data["detail"], "Ocorreu um erro interno ao salvar o perfil.")

    def test_update_nonexistent_profile_returns_404(self):
        self.profile.delete()
        payload = {"nickname": "ValidName"}
        response = self.client.patch(PROFILE_ME_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
