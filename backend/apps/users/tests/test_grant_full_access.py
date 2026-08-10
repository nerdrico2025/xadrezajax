"""Testes do comando `grant_full_access`.

Rodam contra o banco de TESTE do Django (criado e destruído pelo runner) —
nada aqui toca produção.

O que importa provar: o acesso concedido é o que `has_paid_access` de fato
aceita (não só "tem uma linha de Subscription"), rodar duas vezes não duplica
nem quebra, e-mail inexistente não escreve nada, e uma assinatura real do
Stripe não perde os ids ao ser promovida.
"""

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from apps.payments.access import has_paid_access
from apps.payments.models import Subscription
from apps.users.models import Profile

User = get_user_model()


def make_user(email="tester@chess.com"):
    return User.objects.create_user(
        email=email, full_name="Tester", password="Xadrez@2024"
    )


class GrantFullAccessTests(TestCase):
    def run_command(self, *args):
        out = StringIO()
        call_command("grant_full_access", *args, stdout=out)
        return out.getvalue()

    # ── caminho feliz ────────────────────────────────────────────────────

    def test_grants_admin_and_paid_annual_subscription(self):
        user = make_user()

        output = self.run_command("tester@chess.com")

        user.refresh_from_db()
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)

        subscription = Subscription.objects.get(profile__user=user)
        self.assertEqual(subscription.plan, Subscription.PLAN_ANNUAL)
        self.assertEqual(subscription.status, Subscription.STATUS_ACTIVE)
        self.assertIn("tester@chess.com", output)

    def test_granted_access_is_what_has_paid_access_accepts(self):
        """O teste que justifica a escolha de `annual`/`active`.

        Conferir plan/status contra as constantes é tautológico: o que precisa
        valer é que o GATE real (`has_paid_access`, consultado por todas as
        features pagas) enxergue a conta como pagante.
        """
        user = make_user()
        profile = Profile.objects.get(user=user)
        self.assertFalse(has_paid_access(profile))

        self.run_command("tester@chess.com")

        profile.refresh_from_db()
        self.assertTrue(has_paid_access(Profile.objects.get(user=user)))

    def test_report_shows_resulting_state(self):
        make_user()

        output = self.run_command("tester@chess.com")

        self.assertIn("is_staff", output)
        self.assertIn("is_superuser", output)
        self.assertIn("annual", output)
        self.assertIn("active", output)
        self.assertIn("ACESSO CONCEDIDO", output)

    # ── idempotência ─────────────────────────────────────────────────────

    def test_running_twice_does_not_duplicate_or_fail(self):
        user = make_user()

        self.run_command("tester@chess.com")
        self.run_command("tester@chess.com")

        self.assertEqual(Subscription.objects.filter(profile__user=user).count(), 1)
        user.refresh_from_db()
        self.assertTrue(user.is_superuser)

    # ── assinatura preexistente ──────────────────────────────────────────

    def test_upgrades_existing_subscription_preserving_stripe_ids(self):
        """Promove sem apagar a origem: se a conta um dia teve assinatura de
        verdade, o webhook precisa continuar achando a linha pelo
        `stripe_subscription_id`."""
        user = make_user()
        profile = Profile.objects.get(user=user)
        Subscription.objects.create(
            profile=profile,
            plan=Subscription.PLAN_MONTHLY,
            status=Subscription.STATUS_CANCELED,
            provider=Subscription.PROVIDER_STRIPE,
            stripe_customer_id="cus_123",
            stripe_subscription_id="sub_123",
        )

        self.run_command("tester@chess.com")

        subscription = Subscription.objects.get(profile=profile)
        self.assertEqual(subscription.plan, Subscription.PLAN_ANNUAL)
        self.assertEqual(subscription.status, Subscription.STATUS_ACTIVE)
        self.assertEqual(subscription.stripe_customer_id, "cus_123")
        self.assertEqual(subscription.stripe_subscription_id, "sub_123")
        self.assertEqual(subscription.provider, Subscription.PROVIDER_STRIPE)
        self.assertEqual(Subscription.objects.filter(profile=profile).count(), 1)

    def test_new_subscription_is_marked_manual_not_stripe(self):
        """Linha nova nasce como `manual`: gravar "stripe" numa assinatura que
        nunca passou pelo Stripe custa uma investigação depois."""
        make_user()

        self.run_command("tester@chess.com")

        subscription = Subscription.objects.get(profile__user__email="tester@chess.com")
        self.assertEqual(subscription.provider, "manual")
        self.assertEqual(subscription.stripe_subscription_id, "")

    # ── conta sem Profile ────────────────────────────────────────────────

    def test_autocorrects_account_without_profile(self):
        """Conta órfã de Profile é justamente a mais quebrada — o comando não
        pode ser o que falha nela."""
        user = make_user()
        Profile.objects.filter(user=user).delete()

        self.run_command("tester@chess.com")

        profile = Profile.objects.get(user=user)
        self.assertTrue(has_paid_access(profile))

    # ── e-mail inexistente ───────────────────────────────────────────────

    def test_unknown_email_errors_without_touching_anything(self):
        other = make_user("outro@chess.com")

        with self.assertRaises(CommandError) as ctx:
            self.run_command("naoexiste@chess.com")

        self.assertIn("naoexiste@chess.com", str(ctx.exception))
        other.refresh_from_db()
        self.assertFalse(other.is_staff)
        self.assertFalse(other.is_superuser)
        self.assertEqual(Subscription.objects.count(), 0)

    # ── maiúsculas ───────────────────────────────────────────────────────

    def test_falls_back_to_case_insensitive_match(self):
        user = make_user("tester@chess.com")

        output = self.run_command("Tester@Chess.com")

        user.refresh_from_db()
        self.assertTrue(user.is_superuser)
        self.assertIn("maiúsculas", output)

    def test_exact_match_wins_over_case_insensitive_one(self):
        lower = make_user("tester@chess.com")
        upper = make_user("Tester@chess.com")

        self.run_command("Tester@chess.com")

        upper.refresh_from_db()
        lower.refresh_from_db()
        self.assertTrue(upper.is_superuser)
        self.assertFalse(lower.is_superuser)

    def test_ambiguous_case_insensitive_match_refuses_to_guess(self):
        make_user("tester@chess.com")
        make_user("TESTER@chess.com")

        with self.assertRaises(CommandError) as ctx:
            self.run_command("Tester@Chess.com")

        self.assertIn("Mais de uma conta", str(ctx.exception))
        self.assertEqual(Subscription.objects.count(), 0)
