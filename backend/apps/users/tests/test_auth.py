from unittest.mock import patch
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

# Importe o seu novo modelo. Ajuste o caminho se necessário (ex: 'users.models')
from apps.users.models import PasswordResetCode

User = get_user_model()

REGISTER_URL = reverse("users:register")
LOGIN_URL = reverse("users:login")
ME_URL = reverse("users:current-user")
LOGOUT_URL = reverse("users:logout")
PASSWORD_RESET_REQUEST_URL = reverse("users:password-reset-request")
PASSWORD_RESET_CONFIRM_URL = reverse("users:password-reset-confirm")
THEME_PREFERENCE_URL = reverse("users:theme-preference")


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

    def test_register_default_theme_preference_is_system(self):
        payload = build_user_payload()
        response = self.client.post(REGISTER_URL, payload, format="json")
        self.assertEqual(response.data["theme_preference"], "system")

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
        self.assertEqual(response.data["user"]["theme_preference"], "system")


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


class CurrentUserEndpointTests(APITestCase):
    """Verifica o endpoint de usuário autenticado."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="hikaru@chess.com",
            full_name="Hikaru Nakamura",
            password="Xadrez@2024",
        )
        refresh = RefreshToken.for_user(self.user)
        self.access_token = str(refresh.access_token)

    def test_get_current_user_returns_200(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access_token}")
        response = self.client.get(ME_URL, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "hikaru@chess.com")
        self.assertEqual(response.data["full_name"], "Hikaru Nakamura")

    def test_get_current_user_requires_authentication(self):
        response = self.client.get(ME_URL, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class PasswordResetTests(APITestCase):
    """Cobertura dos fluxos de recuperação de senha com código numérico."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="hikaru@chess.com",
            full_name="Hikaru Nakamura",
            password="Xadrez@2024",
        )

    @patch("apps.users.views.send_mail")
    def test_password_reset_request_returns_200(self, mock_send_mail):
        response = self.client.post(
            PASSWORD_RESET_REQUEST_URL,
            {"email": "hikaru@chess.com"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_send_mail.assert_called_once()
        # Verifica se o código foi criado no banco
        self.assertTrue(PasswordResetCode.objects.filter(user=self.user).exists())

    def test_password_reset_request_returns_400_for_unknown_email(self):
        response = self.client.post(
            PASSWORD_RESET_REQUEST_URL,
            {"email": "naoexiste@xadrezajax.com"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_reset_confirm_with_valid_code(self):
        reset_obj = PasswordResetCode.generate_code(self.user)

        response = self.client.post(
            PASSWORD_RESET_CONFIRM_URL,
            {
                "email": "hikaru@chess.com",
                "codigo": reset_obj.code,
                "new_password": "SenhaNova@2026",
                "password_confirm": "SenhaNova@2026",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("SenhaNova@2026"))
        # Verifica se o código foi deletado após o uso
        self.assertFalse(PasswordResetCode.objects.filter(id=reset_obj.id).exists())

    def test_password_reset_confirm_returns_400_for_invalid_code(self):
        # Gera um código real para garantir que o erro é por estarmos enviando outro
        PasswordResetCode.generate_code(self.user)

        response = self.client.post(
            PASSWORD_RESET_CONFIRM_URL,
            {
                "email": "hikaru@chess.com",
                "codigo": "000000",  # Código que com certeza está errado
                "new_password": "SenhaNova@2026",
                "password_confirm": "SenhaNova@2026",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_reset_confirm_returns_400_for_expired_code(self):
        reset_obj = PasswordResetCode.generate_code(self.user)

        # Manipulamos o banco de dados para forçar a expiração do código
        # voltando a data de criação em 20 minutos
        PasswordResetCode.objects.filter(id=reset_obj.id).update(
            created_at=timezone.now() - timedelta(minutes=20)
        )

        response = self.client.post(
            PASSWORD_RESET_CONFIRM_URL,
            {
                "email": "hikaru@chess.com",
                "codigo": reset_obj.code,
                "new_password": "SenhaNova@2026",
                "password_confirm": "SenhaNova@2026",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ThemePreferenceTests(APITestCase):
    """Cobertura da preferência de tema do usuário."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="hikaru@chess.com",
            full_name="Hikaru Nakamura",
            password="Xadrez@2024",
        )
        refresh = RefreshToken.for_user(self.user)
        self.access_token = str(refresh.access_token)

    def test_theme_update_returns_200(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access_token}")
        response = self.client.patch(
            THEME_PREFERENCE_URL,
            {"theme_preference": "dark"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.theme_preference, "dark")

    def test_theme_update_rejects_invalid_preference(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access_token}")
        response = self.client.patch(
            THEME_PREFERENCE_URL,
            {"theme_preference": "invalid-theme"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_theme_update_requires_authentication(self):
        response = self.client.patch(
            THEME_PREFERENCE_URL,
            {"theme_preference": "light"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class LogoutTests(APITestCase):
    """UC006 — logout com blacklist de refresh token."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="hikaru@chess.com",
            full_name="Hikaru Nakamura",
            password="Xadrez@2024",
        )
        refresh = RefreshToken.for_user(self.user)
        self.access_token = str(refresh.access_token)
        self.refresh_token = str(refresh)

    def test_logout_blacklists_refresh_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access_token}")
        response = self.client.post(
            LOGOUT_URL,
            {"refresh": self.refresh_token},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_205_RESET_CONTENT)

        response = self.client.post(
            LOGOUT_URL,
            {"refresh": self.refresh_token},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_logout_with_invalid_refresh_token_returns_400(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access_token}")
        response = self.client.post(
            LOGOUT_URL,
            {"refresh": "invalid.token.here"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_logout_requires_authentication(self):
        response = self.client.post(
            LOGOUT_URL,
            {"refresh": self.refresh_token},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
