"""
Testes de assinaturas via Stripe (item 0.1).

Cobre: criação de Checkout Session (Stripe mockado), processamento de cada
evento do webhook com idempotência, gating de 5 partidas/dia do plano Grátis
(bloqueando a 6ª e liberando para trialing/active) e a regressão de que
perfil sem Subscription é tratado como grátis sem erro.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.payments.access import can_play_game, has_paid_access
from apps.payments.models import PaymentEvent, Subscription
from apps.users.models import GameHistory, Profile

User = get_user_model()

CHECKOUT_URL = reverse("payments:stripe-checkout")
WEBHOOK_URL = reverse("payments:stripe-webhook")
SUBSCRIPTION_URL = reverse("payments:subscription")
AI_RESULT_URL = reverse("users:game-ai-result")

STRIPE_TEST_SETTINGS = {
    "STRIPE_SECRET_KEY": "sk_test_x",
    "STRIPE_WEBHOOK_SECRET": "whsec_test",
    "STRIPE_PRICE_IDS": {"monthly": "price_monthly", "annual": "price_annual"},
}


def make_user(email="pagante@chess.com"):
    return User.objects.create_user(
        email=email, full_name="Pagante", password="Xadrez@2024"
    )


def make_subscription(profile, **overrides):
    defaults = {
        "plan": Subscription.PLAN_MONTHLY,
        "status": Subscription.STATUS_ACTIVE,
        "stripe_customer_id": "cus_1",
        "stripe_subscription_id": "sub_1",
    }
    defaults.update(overrides)
    return Subscription.objects.create(profile=profile, **defaults)


# ── Checkout ─────────────────────────────────────────────────────────


@override_settings(**STRIPE_TEST_SETTINGS)
class CheckoutSessionTests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    @patch("apps.payments.views.stripe.checkout.Session.create")
    @patch("apps.payments.views.stripe.Customer.create")
    def test_creates_customer_once_and_returns_checkout_url(
        self, customer_create, session_create
    ):
        customer_create.return_value = {"id": "cus_novo"}
        session_create.return_value = {"url": "https://checkout.stripe.com/x"}

        response = self.client.post(CHECKOUT_URL, {"plan": "monthly"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["checkout_url"], "https://checkout.stripe.com/x")

        # Customer salvo no perfil para reuso
        profile = Profile.objects.get(user=self.user)
        self.assertEqual(profile.stripe_customer_id, "cus_novo")

        # Sessão com price do env, trial de 7 dias e metadata de plano/usuário
        kwargs = session_create.call_args.kwargs
        self.assertEqual(kwargs["customer"], "cus_novo")
        self.assertEqual(kwargs["mode"], "subscription")
        self.assertEqual(
            kwargs["line_items"], [{"price": "price_monthly", "quantity": 1}]
        )
        self.assertEqual(kwargs["subscription_data"]["trial_period_days"], 7)
        self.assertEqual(kwargs["metadata"]["plan"], "monthly")
        self.assertIn("{CHECKOUT_SESSION_ID}", kwargs["success_url"])
        self.assertIn("/api/v1/payments/stripe/return/", kwargs["cancel_url"])

        # Segunda compra: customer do perfil é reusado, não recriado
        self.client.post(CHECKOUT_URL, {"plan": "annual"}, format="json")
        customer_create.assert_called_once()
        self.assertEqual(
            session_create.call_args.kwargs["line_items"][0]["price"],
            "price_annual",
        )

    def test_invalid_plan_returns_400(self):
        response = self.client.post(CHECKOUT_URL, {"plan": "elite"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(STRIPE_SECRET_KEY="")
    def test_missing_stripe_key_returns_503_without_crash(self):
        response = self.client.post(CHECKOUT_URL, {"plan": "monthly"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_active_subscriber_cannot_open_new_checkout(self):
        make_subscription(Profile.objects.get(user=self.user))
        response = self.client.post(CHECKOUT_URL, {"plan": "monthly"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(CHECKOUT_URL, {"plan": "monthly"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


# ── Webhook ──────────────────────────────────────────────────────────


@override_settings(**STRIPE_TEST_SETTINGS)
class StripeWebhookTests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.profile = Profile.objects.get(user=self.user)

    def post_event(self, event):
        """Posta com a validação de assinatura mockada (testada à parte)."""
        with patch(
            "apps.payments.views.stripe.Webhook.construct_event",
            return_value=event,
        ):
            return self.client.post(
                WEBHOOK_URL,
                event,
                format="json",
                headers={"Stripe-Signature": "t=1,v1=mock"},
            )

    def checkout_completed_event(self, event_id="evt_1"):
        return {
            "id": event_id,
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "customer": "cus_1",
                    "subscription": "sub_1",
                    "metadata": {"user_id": str(self.user.id), "plan": "annual"},
                }
            },
        }

    def test_missing_webhook_secret_returns_clear_400(self):
        with override_settings(STRIPE_WEBHOOK_SECRET=None):
            response = self.client.post(WEBHOOK_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("STRIPE_WEBHOOK_SECRET", response.data["detail"])

    def test_invalid_signature_returns_400(self):
        response = self.client.post(
            WEBHOOK_URL, {}, format="json", headers={"Stripe-Signature": "lixo"}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_checkout_completed_creates_trialing_subscription(self):
        response = self.post_event(self.checkout_completed_event())
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscription = Subscription.objects.get(profile=self.profile)
        self.assertEqual(subscription.plan, "annual")
        self.assertEqual(subscription.status, "trialing")
        self.assertEqual(subscription.stripe_subscription_id, "sub_1")
        self.assertTrue(has_paid_access(self.profile))

    def test_same_event_reprocessed_is_noop(self):
        """Idempotência: o Stripe pode reenviar o mesmo evento."""
        self.post_event(self.checkout_completed_event(event_id="evt_dup"))
        response = self.post_event(self.checkout_completed_event(event_id="evt_dup"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("já processado", response.data["detail"])
        self.assertEqual(Subscription.objects.count(), 1)
        self.assertEqual(PaymentEvent.objects.count(), 1)

    def test_subscription_updated_syncs_status_dates_and_plan(self):
        make_subscription(self.profile, status="trialing", plan="monthly")
        response = self.post_event(
            {
                "id": "evt_2",
                "type": "customer.subscription.updated",
                "data": {
                    "object": {
                        "id": "sub_1",
                        "status": "active",
                        "trial_end": 1800000000,
                        # API 2025+: current_period_end mora no item
                        "items": {
                            "data": [
                                {
                                    "current_period_end": 1900000000,
                                    "price": {"id": "price_annual"},
                                }
                            ]
                        },
                        "metadata": {"user_id": str(self.user.id)},
                    }
                },
            }
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        subscription = Subscription.objects.get(profile=self.profile)
        self.assertEqual(subscription.status, "active")
        self.assertEqual(subscription.plan, "annual")
        self.assertEqual(int(subscription.current_period_end.timestamp()), 1900000000)
        self.assertEqual(int(subscription.trial_end.timestamp()), 1800000000)

    def test_subscription_deleted_cancels_access(self):
        make_subscription(self.profile)
        self.post_event(
            {
                "id": "evt_3",
                "type": "customer.subscription.deleted",
                "data": {"object": {"id": "sub_1"}},
            }
        )
        self.profile.refresh_from_db()
        self.assertEqual(
            Subscription.objects.get(profile=self.profile).status, "canceled"
        )
        self.assertFalse(has_paid_access(self.profile))

    def test_payment_failed_marks_past_due_and_blocks_access(self):
        make_subscription(self.profile)
        self.post_event(
            {
                "id": "evt_4",
                "type": "invoice.payment_failed",
                "data": {"object": {"subscription": "sub_1"}},
            }
        )
        self.assertEqual(
            Subscription.objects.get(profile=self.profile).status, "past_due"
        )
        # Perfil fresco: a relação reversa fica cacheada na instância antiga
        self.assertFalse(has_paid_access(Profile.objects.get(pk=self.profile.pk)))

    def test_payment_succeeded_reactivates_after_past_due(self):
        make_subscription(self.profile, status="past_due")
        # Formato novo da API: subscription dentro de parent.subscription_details
        self.post_event(
            {
                "id": "evt_5",
                "type": "invoice.payment_succeeded",
                "data": {
                    "object": {
                        "parent": {"subscription_details": {"subscription": "sub_1"}}
                    }
                },
            }
        )
        self.assertEqual(
            Subscription.objects.get(profile=self.profile).status, "active"
        )
        self.assertTrue(has_paid_access(Profile.objects.get(pk=self.profile.pk)))

    def test_unhandled_event_is_acknowledged_without_side_effects(self):
        response = self.post_event(
            {"id": "evt_6", "type": "customer.created", "data": {"object": {}}}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(PaymentEvent.objects.count(), 0)


# ── Gating do plano Grátis ───────────────────────────────────────────


class FreePlanGatingTests(APITestCase):
    def setUp(self):
        self.user = make_user("gratis@chess.com")
        self.profile = Profile.objects.get(user=self.user)
        self.client.force_authenticate(user=self.user)

    def play_games_today(self, count):
        for i in range(count):
            GameHistory.objects.create(
                user=self.user,
                opponent_name="IA Médio",
                result="win",
                mode="ai",
                rating_before=1500,
                rating_after=1500,
            )

    def post_ai_result(self):
        return self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": "medium", "time_control": 300},
            format="json",
        )

    def test_profile_without_subscription_is_free_without_error(self):
        """Regressão: ausência de Subscription = plano Grátis, nunca erro."""
        self.assertFalse(has_paid_access(self.profile))
        allowed, remaining = can_play_game(self.profile)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 5)
        self.assertEqual(self.post_ai_result().status_code, status.HTTP_200_OK)

    def test_sixth_game_of_the_day_is_blocked_for_free_plan(self):
        self.play_games_today(5)
        response = self.post_ai_result()
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "daily_limit_reached")
        # Nada foi gravado além das 5 já existentes
        self.assertEqual(GameHistory.objects.filter(user=self.user).count(), 5)

    def test_fifth_game_still_allowed_for_free_plan(self):
        self.play_games_today(4)
        self.assertEqual(self.post_ai_result().status_code, status.HTTP_200_OK)

    def test_trialing_subscription_is_unlimited(self):
        make_subscription(self.profile, status="trialing")
        self.play_games_today(7)
        self.assertEqual(self.post_ai_result().status_code, status.HTTP_200_OK)

    def test_active_subscription_is_unlimited(self):
        make_subscription(self.profile, status="active")
        self.play_games_today(9)
        self.assertEqual(self.post_ai_result().status_code, status.HTTP_200_OK)

    def test_canceled_subscription_back_to_free_limit(self):
        make_subscription(self.profile, status="canceled")
        self.play_games_today(5)
        self.assertEqual(self.post_ai_result().status_code, status.HTTP_403_FORBIDDEN)


# ── Estado do plano (fonte de verdade p/ o app) ──────────────────────


class MySubscriptionViewTests(APITestCase):
    def setUp(self):
        self.user = make_user("estado@chess.com")
        self.profile = Profile.objects.get(user=self.user)
        self.client.force_authenticate(user=self.user)

    def test_free_profile_reports_free_plan_and_remaining_games(self):
        response = self.client.get(SUBSCRIPTION_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["plan"], "free")
        self.assertIsNone(response.data["status"])
        self.assertEqual(response.data["daily_game_limit"], 5)
        self.assertEqual(response.data["remaining_games_today"], 5)

    def test_paid_profile_reports_plan_and_unlimited_games(self):
        make_subscription(
            self.profile,
            plan="annual",
            status="trialing",
            trial_end=timezone.now(),
        )
        response = self.client.get(SUBSCRIPTION_URL)
        self.assertEqual(response.data["plan"], "annual")
        self.assertEqual(response.data["status"], "trialing")
        self.assertIsNone(response.data["daily_game_limit"])
        self.assertIsNone(response.data["remaining_games_today"])
        self.assertIsNotNone(response.data["trial_end"])

    def test_canceled_subscription_reports_free(self):
        make_subscription(self.profile, status="canceled")
        response = self.client.get(SUBSCRIPTION_URL)
        self.assertEqual(response.data["plan"], "free")
        self.assertEqual(response.data["status"], "canceled")
