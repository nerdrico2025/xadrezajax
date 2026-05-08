from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

REGISTER_URL = reverse("users:register")
LOGIN_URL = reverse("users:login")


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
