from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

REGISTER_URL = reverse("users:register")
LOGIN_URL = reverse("users:login")
PASSWORD_RESET_URL = reverse("users:password-reset")
PASSWORD_RESET_CONFIRM_URL = reverse("users:password-reset-confirm")
ME_URL = reverse("users:me")
GOOGLE_LOGIN_URL = reverse("users:google-login")


def build_user_payload(**kwargs):
    """Fábrica de payload para evitar repetição nos testes."""
    defaults = {
        "email": "magnus@chess.com",
        "full_name": "Magnus Carlsen",
        "password": "Xadrez@2024",
        "password_confirm": "Xadrez@2024",
    }
    defaults.update(kwargs)
    return defaults


class RegisterSuccessTests(APITestCase):
    """UC02 — Caminho feliz do cadastro."""

    def test_register_returns_201(self):
        payload = build_user_payload()
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_register_response_contains_expected_fields(self):
        payload = build_user_payload()
        response = self.client.post(REGISTER_URL, payload, format="json")
        for field in ["id", "email", "full_name", "date_joined"]:
            self.assertIn(field, response.data)

    def test_register_does_not_expose_password(self):
        payload = build_user_payload()
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertNotIn("password", response.data)

    def test_register_creates_user_in_database(self):
        payload = build_user_payload()
        self.client.post(REGISTER_URL, payload, format="json")
        self.assertTrue(User.objects.filter(email="magnus@chess.com").exists())

    def test_register_accepts_payload_without_password_confirm(self):
        payload = build_user_payload()
        payload.pop("password_confirm")

        response = self.client.post(REGISTER_URL, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(email="magnus@chess.com").exists())

    def test_email_is_normalized_to_lowercase(self):
        payload = build_user_payload(email="Magnus@CHESS.com")
        self.client.post(REGISTER_URL, payload, format="json")
        self.assertTrue(User.objects.filter(email="magnus@chess.com").exists())


class RegisterFailureTests(APITestCase):
    """UC02 — Cenários de falha no cadastro."""

    def setUp(self):
        User.objects.create_user(
            email="duplicate@chess.com",
            full_name="Already Exists",
            password="Xadrez@2024",
        )

    def test_duplicate_email_returns_400(self):
        payload = build_user_payload(email="duplicate@chess.com")
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_duplicate_email_returns_correct_error_message(self):
        payload = build_user_payload(email="duplicate@chess.com")
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertIn("email", response.data)

    def test_weak_password_too_short_returns_400(self):
        payload = build_user_payload(password="abc", password_confirm="abc")
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_numeric_only_password_returns_400(self):
        payload = build_user_payload(password="12345678", password_confirm="12345678")
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_passwords_mismatch_returns_400(self):
        payload = build_user_payload(password_confirm="SenhaErrada@1")
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_email_returns_400(self):
        payload = build_user_payload()
        payload.pop("email")
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_full_name_returns_400(self):
        payload = build_user_payload()
        payload.pop("full_name")
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class LoginSuccessTests(APITestCase):
    """UC03 — Caminho feliz do login."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="hikaru@chess.com",
            full_name="Hikaru Nakamura",
            password="Xadrez@2024",
        )

    def test_login_returns_200(self):
        payload = {"email": "hikaru@chess.com", "password": "Xadrez@2024"}
        response = self.client.post(LOGIN_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_login_returns_access_token(self):
        payload = {"email": "hikaru@chess.com", "password": "Xadrez@2024"}
        response = self.client.post(LOGIN_URL, payload, format="json")
        self.assertIn("access", response.data)

    def test_login_returns_refresh_token(self):
        payload = {"email": "hikaru@chess.com", "password": "Xadrez@2024"}
        response = self.client.post(LOGIN_URL, payload, format="json")
        self.assertIn("refresh", response.data)

    def test_login_response_includes_user_data(self):
        payload = {"email": "hikaru@chess.com", "password": "Xadrez@2024"}
        response = self.client.post(LOGIN_URL, payload, format="json")
        self.assertIn("user", response.data)
        self.assertEqual(response.data["user"]["email"], "hikaru@chess.com")


class LoginFailureTests(APITestCase):
    """UC03 — Cenários de falha no login."""

    def setUp(self):
        User.objects.create_user(
            email="hikaru@chess.com",
            full_name="Hikaru Nakamura",
            password="Xadrez@2024",
        )

    def test_wrong_password_returns_401(self):
        payload = {"email": "hikaru@chess.com", "password": "SenhaErrada"}
        response = self.client.post(LOGIN_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_nonexistent_email_returns_401(self):
        payload = {"email": "ghost@chess.com", "password": "Xadrez@2024"}
        response = self.client.post(LOGIN_URL, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_empty_credentials_returns_400(self):
        response = self.client.post(LOGIN_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_wrong_credentials_do_not_return_tokens(self):
        payload = {"email": "hikaru@chess.com", "password": "SenhaErrada"}
        response = self.client.post(LOGIN_URL, payload, format="json")
        self.assertNotIn("access", response.data)


class PasswordResetTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="reset@chess.com",
            full_name="Reset User",
            password="Xadrez@2024",
        )
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_request_password_reset_returns_200_for_existing_email(self):
        response = self.client.post(
            PASSWORD_RESET_URL, {"email": self.user.email}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    @patch("apps.users.views.threading.Thread")
    def test_password_reset_confirm_updates_password_and_allows_login(
        self, mock_thread
    ):
        self.client.post(PASSWORD_RESET_URL, {"email": self.user.email}, format="json")

        self.assertTrue(mock_thread.called)
        _, kwargs = mock_thread.call_args
        reset_code = kwargs["args"][2]

        response = self.client.post(
            PASSWORD_RESET_CONFIRM_URL,
            {
                "email": self.user.email,
                "code": reset_code,
                "new_password": "NovaSenha@2026",
                "password_confirm": "NovaSenha@2026",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NovaSenha@2026"))

        login_response = self.client.post(
            LOGIN_URL,
            {"email": self.user.email, "password": "NovaSenha@2026"},
            format="json",
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)


class AuthenticatedUserTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="me@chess.com",
            full_name="Me User",
            password="Xadrez@2024",
        )

    def test_me_returns_authenticated_user_payload(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(ME_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], self.user.email)
        self.assertEqual(response.data["full_name"], self.user.full_name)


class GoogleLoginTests(APITestCase):
    @patch("apps.users.views.verify_google_id_token")
    def test_google_login_returns_tokens_for_valid_payload(self, mock_verify):
        mock_verify.return_value = {
            "email": "google@chess.com",
            "name": "Google User",
        }

        response = self.client.post(
            GOOGLE_LOGIN_URL,
            {"id_token": "token-valido"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["email"], "google@chess.com")
        self.assertTrue(User.objects.filter(email="google@chess.com").exists())

    def test_google_login_requires_id_token(self):
        response = self.client.post(GOOGLE_LOGIN_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
