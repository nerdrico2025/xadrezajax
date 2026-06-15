from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.profiles.models import AdminProfile, PlayerProfile, Profile

User = get_user_model()

WHOAMI_URL = reverse("profiles:whoami")
GAME_EXAMPLE_URL = reverse("profiles:game-example")


def create_test_user(**kwargs):
    defaults = {
        "email": "fischer@chess.com",
        "full_name": "Bobby Fischer",
        "password": "Xadrez@2024",
    }
    defaults.update(kwargs)
    return User.objects.create_user(**defaults)


# ---------------------------------------------------------------------------
# UC012 — WhoAmI (Identificar usuário autenticado)
# ---------------------------------------------------------------------------


class WhoAmITests(APITestCase):
    """UC012 - Testes do endpoint WhoAmI."""

    def test_whoami_unauthenticated_returns_401(self):
        response = self.client.get(WHOAMI_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_whoami_user_without_profile(self):
        user = create_test_user()
        self.client.force_authenticate(user=user)
        response = self.client.get(WHOAMI_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["has_profile"])
        self.assertFalse(response.data["is_player"])
        self.assertFalse(response.data["is_admin"])

    def test_whoami_user_with_profile_only(self):
        user = create_test_user()
        Profile.objects.create(user=user)
        self.client.force_authenticate(user=user)
        response = self.client.get(WHOAMI_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["has_profile"])
        self.assertFalse(response.data["is_player"])
        self.assertFalse(response.data["is_admin"])

    def test_whoami_user_with_player_profile(self):
        user = create_test_user()
        profile = Profile.objects.create(user=user)
        PlayerProfile.objects.create(profile=profile)
        self.client.force_authenticate(user=user)
        response = self.client.get(WHOAMI_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_player"])
        self.assertFalse(response.data["is_admin"])

    def test_whoami_user_with_admin_profile(self):
        user = create_test_user()
        user.is_staff = True
        user.save()
        profile = Profile.objects.create(user=user)
        AdminProfile.objects.create(profile=profile)
        self.client.force_authenticate(user=user)
        response = self.client.get(WHOAMI_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_admin"])
        self.assertTrue(response.data["is_staff"])

    def test_whoami_user_with_both_profiles(self):
        user = create_test_user()
        user.is_staff = True
        user.save()
        profile = Profile.objects.create(user=user)
        PlayerProfile.objects.create(profile=profile)
        AdminProfile.objects.create(profile=profile)
        self.client.force_authenticate(user=user)
        response = self.client.get(WHOAMI_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_player"])
        self.assertTrue(response.data["is_admin"])


# ---------------------------------------------------------------------------
# UC012 — HasProfile (Perfil inexistente → redirecionamento UC007)
# ---------------------------------------------------------------------------


class HasProfilePermissionTests(APITestCase):
    """UC012 - Testes de HasProfile e redirecionamento ao UC007."""

    def test_game_example_denied_without_profile(self):
        """Sem perfil base, retorna 403 com mensagem de redirecionamento."""
        user = create_test_user()
        self.client.force_authenticate(user=user)
        response = self.client.get(GAME_EXAMPLE_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Perfil", str(response.data["detail"]))

    def test_game_example_denied_without_player_profile(self):
        """Com perfil base mas sem PlayerProfile, retorna 403."""
        user = create_test_user()
        Profile.objects.create(user=user)
        self.client.force_authenticate(user=user)
        response = self.client.get(GAME_EXAMPLE_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("jogador", str(response.data["detail"]))


# ---------------------------------------------------------------------------
# UC012 — HasPlayerProfile (Acesso ao jogo)
# ---------------------------------------------------------------------------


class HasPlayerProfilePermissionTests(APITestCase):
    """UC012 - Testes de HasPlayerProfile."""

    def test_game_example_allowed_with_player_profile(self):
        user = create_test_user()
        profile = Profile.objects.create(user=user)
        PlayerProfile.objects.create(profile=profile)
        self.client.force_authenticate(user=user)
        response = self.client.get(GAME_EXAMPLE_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["detail"], "Acesso liberado! Você é um jogador autenticado."
        )


# ---------------------------------------------------------------------------
# UC012 — HasAdminProfile (Acesso administrativo - via promote)
# ---------------------------------------------------------------------------


class HasAdminProfilePermissionTests(APITestCase):
    """UC012 - Testes de HasAdminProfile via rota de promoção."""

    def setUp(self):
        self.target = create_test_user(email="target@chess.com")
        Profile.objects.create(user=self.target)

    def test_promote_denied_for_common_user(self):
        """Usuário comum tentando promover → 403."""
        common = create_test_user(email="common@chess.com")
        Profile.objects.create(user=common)
        self.client.force_authenticate(user=common)
        url = reverse("profiles:promote-admin", kwargs={"user_id": self.target.id})
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_promote_denied_for_staff_without_admin_profile(self):
        """Staff sem AdminProfile → 403 (camada 2 da segurança)."""
        staff_user = create_test_user(email="staff@chess.com")
        staff_user.is_staff = True
        staff_user.save()
        Profile.objects.create(user=staff_user)
        self.client.force_authenticate(user=staff_user)
        url = reverse("profiles:promote-admin", kwargs={"user_id": self.target.id})
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_promote_allowed_for_full_admin(self):
        """Admin completo (is_staff + AdminProfile) → 201."""
        admin = create_test_user(email="admin@chess.com")
        admin.is_staff = True
        admin.save()
        admin_profile = Profile.objects.create(user=admin)
        AdminProfile.objects.create(profile=admin_profile)
        self.client.force_authenticate(user=admin)
        url = reverse("profiles:promote-admin", kwargs={"user_id": self.target.id})
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
