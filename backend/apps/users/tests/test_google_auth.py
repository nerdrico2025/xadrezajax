from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

GOOGLE_AUTH_URL = reverse("users:google-auth")

# Deve coincidir com make_google_payload()["aud"] — isolado do .env local / CI
TEST_GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"

# Caminho exato da função a ser mockada — onde ela é *usada*, não onde é definida
VERIFY_TOKEN_PATH = "apps.users.services.id_token.verify_oauth2_token"


def make_google_payload(**kwargs) -> dict:
    """Fábrica de payload simulado retornado pelo Google após validação."""
    defaults = {
        "sub": "google-uid-123456789",
        "email": "magnus@chess.com",
        "name": "Magnus Carlsen",
        "email_verified": True,
        "aud": "test-client-id.apps.googleusercontent.com",
    }
    defaults.update(kwargs)
    return defaults


@override_settings(GOOGLE_CLIENT_ID=TEST_GOOGLE_CLIENT_ID)
class GoogleAuthNewUserTests(APITestCase):
    """RF003 — Cria novo usuário quando o e-mail ainda não existe."""

    @patch(VERIFY_TOKEN_PATH)
    def test_new_user_returns_201(self, mock_verify):
        mock_verify.return_value = make_google_payload()
        response = self.client.post(
            GOOGLE_AUTH_URL, {"id_token": "valid.token.new"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    @patch(VERIFY_TOKEN_PATH)
    def test_new_user_is_persisted_in_database(self, mock_verify):
        mock_verify.return_value = make_google_payload()
        self.client.post(
            GOOGLE_AUTH_URL, {"id_token": "valid.token.new"}, format="json"
        )
        self.assertTrue(User.objects.filter(email="magnus@chess.com").exists())

    @patch(VERIFY_TOKEN_PATH)
    def test_new_user_has_unusable_password(self, mock_verify):
        mock_verify.return_value = make_google_payload()
        self.client.post(
            GOOGLE_AUTH_URL, {"id_token": "valid.token.new"}, format="json"
        )
        user = User.objects.get(email="magnus@chess.com")
        self.assertFalse(user.has_usable_password())

    @patch(VERIFY_TOKEN_PATH)
    def test_new_user_response_contains_jwt_pair(self, mock_verify):
        mock_verify.return_value = make_google_payload()
        response = self.client.post(
            GOOGLE_AUTH_URL, {"id_token": "valid.token.new"}, format="json"
        )
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    @patch(VERIFY_TOKEN_PATH)
    def test_new_user_response_contains_user_data(self, mock_verify):
        mock_verify.return_value = make_google_payload()
        response = self.client.post(
            GOOGLE_AUTH_URL, {"id_token": "valid.token.new"}, format="json"
        )
        self.assertIn("user", response.data)
        self.assertEqual(response.data["user"]["email"], "magnus@chess.com")
        self.assertEqual(response.data["user"]["full_name"], "Magnus Carlsen")

    @patch(VERIFY_TOKEN_PATH)
    def test_full_name_is_populated_from_google_payload(self, mock_verify):
        mock_verify.return_value = make_google_payload(name="Fabiano Caruana")
        self.client.post(
            GOOGLE_AUTH_URL,
            {"id_token": "valid.token.name"},
            format="json",
        )
        user = User.objects.get(email="magnus@chess.com")
        self.assertEqual(user.full_name, "Fabiano Caruana")


@override_settings(GOOGLE_CLIENT_ID=TEST_GOOGLE_CLIENT_ID)
class GoogleAuthExistingUserTests(APITestCase):
    """RF003 — Recupera usuário existente sem criar duplicata."""

    def setUp(self):
        self.existing_user = User.objects.create_user(
            email="hikaru@chess.com",
            full_name="Hikaru Nakamura",
            password="Xadrez@2024",
        )

    @patch(VERIFY_TOKEN_PATH)
    def test_existing_user_returns_200(self, mock_verify):
        mock_verify.return_value = make_google_payload(email="hikaru@chess.com")
        response = self.client.post(
            GOOGLE_AUTH_URL,
            {"id_token": "valid.token.existing"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    @patch(VERIFY_TOKEN_PATH)
    def test_existing_user_does_not_create_duplicate(self, mock_verify):
        mock_verify.return_value = make_google_payload(email="hikaru@chess.com")
        self.client.post(
            GOOGLE_AUTH_URL,
            {"id_token": "valid.token.existing"},
            format="json",
        )
        self.assertEqual(User.objects.filter(email="hikaru@chess.com").count(), 1)

    @patch(VERIFY_TOKEN_PATH)
    def test_existing_user_receives_jwt_pair(self, mock_verify):
        mock_verify.return_value = make_google_payload(email="hikaru@chess.com")
        response = self.client.post(
            GOOGLE_AUTH_URL,
            {"id_token": "valid.token.existing"},
            format="json",
        )
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    @patch(VERIFY_TOKEN_PATH)
    def test_google_auth_does_not_make_external_requests(self, mock_verify):
        """Garante que o teste nunca chama a API real do Google."""
        mock_verify.return_value = make_google_payload(email="hikaru@chess.com")
        self.client.post(
            GOOGLE_AUTH_URL,
            {"id_token": "valid.token.existing"},
            format="json",
        )
        # Se verify_oauth2_token foi chamado, era o mock — sem I/O externo
        mock_verify.assert_called_once()


@override_settings(GOOGLE_CLIENT_ID=TEST_GOOGLE_CLIENT_ID)
class GoogleAuthFailureTests(APITestCase):
    """Cenários de falha: tokens inválidos e payload malformado."""

    @patch(VERIFY_TOKEN_PATH)
    def test_invalid_token_returns_401(self, mock_verify):
        mock_verify.side_effect = ValueError("Token inválido ou expirado.")
        response = self.client.post(
            GOOGLE_AUTH_URL, {"id_token": "token.invalido"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    @patch(VERIFY_TOKEN_PATH)
    def test_invalid_token_does_not_create_user(self, mock_verify):
        mock_verify.side_effect = ValueError("Token inválido ou expirado.")
        self.client.post(GOOGLE_AUTH_URL, {"id_token": "token.invalido"}, format="json")
        self.assertEqual(User.objects.count(), 0)

    @patch(VERIFY_TOKEN_PATH)
    def test_payload_without_email_returns_400(self, mock_verify):
        mock_verify.return_value = make_google_payload(email="")
        response = self.client.post(
            GOOGLE_AUTH_URL,
            {"id_token": "valid.token.no.email"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_id_token_field_returns_400(self):
        response = self.client.post(GOOGLE_AUTH_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_empty_id_token_returns_400(self):
        response = self.client.post(GOOGLE_AUTH_URL, {"id_token": ""}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @patch(VERIFY_TOKEN_PATH)
    def test_wrong_aud_returns_401(self, mock_verify):
        """Token emitido para outro Client ID é rejeitado."""
        mock_verify.return_value = make_google_payload(
            aud="outro-app.apps.googleusercontent.com"
        )
        # Patch no GOOGLE_CLIENT_ID para simular divergência de aud
        with patch("apps.users.services.settings") as mock_settings:
            mock_settings.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
            response = self.client.post(
                GOOGLE_AUTH_URL,
                {"id_token": "token.wrong.aud"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
