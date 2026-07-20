"""Correção 1 (Rodada 2): backfill de Profile para Users órfãos + helpers
get_or_create_profile / get_or_create_profile_by_user_id, que substituem os
`Profile.objects.get(...)` que davam 500/404 quando o Profile faltava."""

import importlib

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.users.models import ModalityRating, Profile
from apps.users.models import (
    get_or_create_profile,
    get_or_create_profile_by_user_id,
)

User = get_user_model()

backfill_module = importlib.import_module(
    "apps.users.migrations.0013_backfill_missing_profiles"
)


def make_orphan_user(email="orfao@chess.com"):
    """Cria um User e remove o Profile que o signal post_save gerou —
    simula uma conta das criadas entre 08/mai e 27/jun/2026 (antes do
    modelo Profile/signal existirem)."""
    user = User.objects.create_user(
        email=email, full_name="Órfão de Teste", password="Xadrez@2024"
    )
    Profile.objects.filter(user=user).delete()
    return user


class BackfillMigrationTests(TestCase):
    def test_backfill_creates_profile_with_signal_defaults(self):
        orphan = make_orphan_user()
        self.assertFalse(Profile.objects.filter(user=orphan).exists())

        backfill_module.backfill_missing_profiles(django_apps, None)

        profile = Profile.objects.get(user=orphan)
        # Mesmos defaults que o signal create_user_profile geraria: um
        # Profile.objects.create(user=instance) em branco.
        self.assertIsNone(profile.username)
        self.assertEqual(profile.bio, "")
        self.assertEqual(profile.rating, 1200)
        self.assertEqual(profile.games_played, 0)
        self.assertEqual(profile.wins, 0)
        self.assertEqual(profile.losses, 0)
        self.assertEqual(profile.draws, 0)
        self.assertIsNone(profile.onboarding_completed_at)
        # O signal não semeia ModalityRating na criação — o backfill não
        # deve fazer diferente (senão essas contas nasceriam "melhor
        # equipadas" que um cadastro novo).
        self.assertFalse(ModalityRating.objects.filter(profile=profile).exists())

    def test_backfill_is_noop_for_users_with_profile(self):
        user = User.objects.create_user(
            email="normal@chess.com", full_name="Normal", password="Xadrez@2024"
        )
        before_id = Profile.objects.get(user=user).id

        backfill_module.backfill_missing_profiles(django_apps, None)

        profile = Profile.objects.get(user=user)
        self.assertEqual(profile.id, before_id)

    def test_backfill_handles_multiple_orphans(self):
        orphan_a = make_orphan_user("a@chess.com")
        orphan_b = make_orphan_user("b@chess.com")

        backfill_module.backfill_missing_profiles(django_apps, None)

        self.assertTrue(Profile.objects.filter(user=orphan_a).exists())
        self.assertTrue(Profile.objects.filter(user=orphan_b).exists())


class GetOrCreateProfileTests(TestCase):
    """Segunda camada de defesa: mesmo sem backfill, os endpoints não devem
    500/404 por Profile faltante."""

    def test_get_or_create_profile_creates_when_missing(self):
        orphan = make_orphan_user()
        profile = get_or_create_profile(orphan)
        self.assertEqual(profile.user_id, orphan.id)
        self.assertTrue(Profile.objects.filter(user=orphan).exists())

    def test_get_or_create_profile_returns_existing(self):
        user = User.objects.create_user(
            email="existente@chess.com", full_name="Existente", password="Xadrez@2024"
        )
        existing = Profile.objects.get(user=user)
        existing.bio = "bio customizada"
        existing.save(update_fields=["bio"])

        profile = get_or_create_profile(user)
        self.assertEqual(profile.id, existing.id)
        self.assertEqual(profile.bio, "bio customizada")

    def test_get_or_create_profile_by_user_id_creates_when_missing(self):
        orphan = make_orphan_user()
        profile = get_or_create_profile_by_user_id(orphan.id)
        self.assertIsNotNone(profile)
        self.assertEqual(profile.user_id, orphan.id)

    def test_get_or_create_profile_by_user_id_returns_none_for_unknown_user(self):
        profile = get_or_create_profile_by_user_id(999999)
        self.assertIsNone(profile)
        self.assertFalse(Profile.objects.filter(user_id=999999).exists())
