import logging
from datetime import datetime, timezone as dt_timezone

import stripe
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.urls import reverse
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.models import get_or_create_profile, get_or_create_profile_by_user_id

from .access import FREE_DAILY_GAME_LIMIT, can_play_game, has_paid_access
from .models import PaymentEvent, Subscription

logger = logging.getLogger(__name__)

TRIAL_PERIOD_DAYS = 7

# Deep link de volta ao app (scheme "ajax" do app.json / Expo Router)
APP_RETURN_DEEP_LINK = "ajax://subscription-return"

# Mapa status Stripe → status interno. Statuses transitórios de checkout
# (incomplete/incomplete_expired) não geram acesso; unpaid vira past_due.
STRIPE_STATUS_MAP = {
    "trialing": Subscription.STATUS_TRIALING,
    "active": Subscription.STATUS_ACTIVE,
    "past_due": Subscription.STATUS_PAST_DUE,
    "unpaid": Subscription.STATUS_PAST_DUE,
    "canceled": Subscription.STATUS_CANCELED,
    "incomplete": Subscription.STATUS_PAST_DUE,
    "incomplete_expired": Subscription.STATUS_CANCELED,
}


def _dt_from_epoch(value):
    if not value:
        return None
    return datetime.fromtimestamp(int(value), tz=dt_timezone.utc)


def _plan_from_price_id(price_id):
    for plan, configured in settings.STRIPE_PRICE_IDS.items():
        if configured and configured == price_id:
            return plan
    return None


def _period_end_from_subscription(sub):
    """current_period_end saiu do topo da Subscription nas versões de API
    2025+ do Stripe (foi para o item) — lê nos dois lugares."""
    top_level = sub.get("current_period_end")
    if top_level:
        return _dt_from_epoch(top_level)
    items = (sub.get("items") or {}).get("data") or []
    if items:
        return _dt_from_epoch(items[0].get("current_period_end"))
    return None


def _price_id_from_subscription(sub):
    items = (sub.get("items") or {}).get("data") or []
    if items:
        price = items[0].get("price") or {}
        return price.get("id")
    return None


def _subscription_id_from_invoice(invoice):
    """invoice.subscription também mudou de lugar nas versões novas da API
    (parent.subscription_details.subscription) — lê nos dois."""
    direct = invoice.get("subscription")
    if direct:
        return direct
    parent = invoice.get("parent") or {}
    details = parent.get("subscription_details") or {}
    return details.get("subscription")


class CheckoutSessionView(APIView):
    """
    POST /api/v1/payments/stripe/checkout/
    Cria a Checkout Session do Stripe (cartão) para o plano pedido
    (monthly/annual), com trial de 7 dias via subscription_data —
    decisão de escopo: trial é parâmetro do checkout, não do Price.
    Retorna a URL da sessão para o app abrir no navegador.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        plan = request.data.get("plan")
        if plan not in dict(Subscription.PLAN_CHOICES):
            return Response(
                {"detail": "plan deve ser 'monthly' ou 'annual'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not settings.STRIPE_SECRET_KEY:
            return Response(
                {"detail": "Stripe não configurado (STRIPE_SECRET_KEY ausente)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        price_id = settings.STRIPE_PRICE_IDS.get(plan)
        if not price_id:
            return Response(
                {"detail": f"Price do plano '{plan}' não configurado no ambiente."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        stripe.api_key = settings.STRIPE_SECRET_KEY
        profile = get_or_create_profile(request.user)

        subscription = getattr(profile, "subscription", None)
        if subscription and subscription.is_paid:
            return Response(
                {"detail": "Você já tem uma assinatura ativa."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Reusa o Customer salvo no perfil para não duplicar em compras
            # futuras; cria (e persiste) na primeira vez.
            customer_id = profile.stripe_customer_id
            if not customer_id:
                customer = stripe.Customer.create(
                    email=request.user.email,
                    name=request.user.full_name,
                    metadata={"user_id": str(request.user.id)},
                )
                customer_id = customer["id"]
                profile.stripe_customer_id = customer_id
                profile.save(update_fields=["stripe_customer_id"])

            # success/cancel apontam para uma página mínima do backend que
            # redireciona ao deep link do app (o Stripe exige URLs http/https
            # — scheme customizado direto não é aceito no Checkout).
            return_url = request.build_absolute_uri(reverse("payments:stripe-return"))
            session = stripe.checkout.Session.create(
                customer=customer_id,
                mode="subscription",
                line_items=[{"price": price_id, "quantity": 1}],
                subscription_data={
                    "trial_period_days": TRIAL_PERIOD_DAYS,
                    "metadata": {"user_id": str(request.user.id), "plan": plan},
                },
                metadata={"user_id": str(request.user.id), "plan": plan},
                success_url=(
                    f"{return_url}?outcome=success" "&session_id={CHECKOUT_SESSION_ID}"
                ),
                cancel_url=f"{return_url}?outcome=cancel",
            )
        except stripe.StripeError as exc:
            logger.error("Stripe checkout falhou: %s", exc)
            return Response(
                {"detail": "Não foi possível iniciar o checkout. Tente novamente."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({"checkout_url": session["url"]}, status=status.HTTP_200_OK)


class StripeReturnView(APIView):
    """
    GET /api/v1/payments/stripe/return/?outcome=success|cancel
    Página mínima de retorno do Checkout: redireciona ao deep link do app
    (scheme ajax://). Existe porque o Stripe só aceita http/https nas URLs
    de retorno da sessão.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        outcome = request.query_params.get("outcome", "cancel")
        if outcome not in ("success", "cancel"):
            outcome = "cancel"
        deep_link = f"{APP_RETURN_DEEP_LINK}?outcome={outcome}"
        message = (
            "Pagamento confirmado! Voltando ao app..."
            if outcome == "success"
            else "Checkout encerrado. Voltando ao app..."
        )
        html = f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url={deep_link}">
<title>Clube de Xadrez AJAX</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:40px">
<p>{message}</p>
<p><a href="{deep_link}">Toque aqui se não voltar automaticamente</a></p>
<script>window.location.href = "{deep_link}";</script>
</body></html>"""
        return HttpResponse(html)


class StripeWebhookView(APIView):
    """
    POST /api/v1/payments/stripe/webhook/
    Chamado pelo Stripe (sem sessão) — valida a assinatura contra
    STRIPE_WEBHOOK_SECRET e processa o conjunto completo de eventos do
    ciclo de vida da assinatura. Idempotente via PaymentEvent.event_id
    unique (reenvio do mesmo evento é no-op).
    Sem throttle: tráfego do Stripe, com retries em rajada.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    HANDLED_EVENTS = (
        "checkout.session.completed",
        "invoice.payment_succeeded",
        "invoice.payment_failed",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    )

    def post(self, request):
        secret = settings.STRIPE_WEBHOOK_SECRET
        if not secret:
            # Erro claro, sem crash de boot: a variável só passa a existir
            # depois de cadastrar este endpoint no Dashboard do Stripe.
            return Response(
                {
                    "detail": (
                        "STRIPE_WEBHOOK_SECRET não configurado — cadastre o "
                        "endpoint no Dashboard do Stripe e defina a variável."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        signature = request.headers.get("Stripe-Signature", "")
        try:
            event = stripe.Webhook.construct_event(request.body, signature, secret)
        except (ValueError, stripe.SignatureVerificationError):
            return Response(
                {"detail": "Assinatura do webhook inválida."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        event_type = event["type"]
        if event_type not in self.HANDLED_EVENTS:
            return Response({"detail": f"Evento {event_type} ignorado."})

        with transaction.atomic():
            _, created = PaymentEvent.objects.get_or_create(
                event_id=event["id"], defaults={"event_type": event_type}
            )
            if not created:
                return Response({"detail": "Evento já processado."})

            handler = {
                "checkout.session.completed": self._handle_checkout_completed,
                "invoice.payment_succeeded": self._handle_payment_succeeded,
                "invoice.payment_failed": self._handle_payment_failed,
                "customer.subscription.updated": self._handle_subscription_updated,
                "customer.subscription.deleted": self._handle_subscription_deleted,
            }[event_type]
            handler(event["data"]["object"])

        return Response({"detail": "ok"})

    # ── handlers ─────────────────────────────────────────────────────────

    def _handle_checkout_completed(self, session):
        """Checkout concluído: cria/atualiza a Subscription do perfil."""
        user_id = (session.get("metadata") or {}).get("user_id")
        plan = (session.get("metadata") or {}).get("plan")
        stripe_subscription_id = session.get("subscription") or ""
        # Perfil ausente para um user_id válido se autocorrige
        # (get_or_create_profile_by_user_id); só desiste se o user_id nem
        # corresponder a um User real.
        profile = get_or_create_profile_by_user_id(user_id)
        if profile is None:
            logger.error("Webhook: perfil não encontrado (user_id=%s)", user_id)
            return

        defaults = {
            "plan": plan or Subscription.PLAN_MONTHLY,
            # Com trial de 7 dias a assinatura nasce trialing; o evento
            # customer.subscription.updated ajusta status e datas na sequência.
            "status": Subscription.STATUS_TRIALING,
            "provider": Subscription.PROVIDER_STRIPE,
            "stripe_customer_id": session.get("customer") or "",
            "stripe_subscription_id": stripe_subscription_id,
        }
        Subscription.objects.update_or_create(profile=profile, defaults=defaults)

    def _find_subscription(self, stripe_subscription_id):
        if not stripe_subscription_id:
            return None
        return Subscription.objects.filter(
            stripe_subscription_id=stripe_subscription_id
        ).first()

    def _handle_subscription_updated(self, stripe_sub):
        subscription = self._find_subscription(stripe_sub.get("id"))
        if subscription is None:
            # Checkout pode ainda não ter sido processado (ordem de entrega
            # de webhooks não é garantida) — tenta pelo metadata.
            user_id = (stripe_sub.get("metadata") or {}).get("user_id")
            profile = get_or_create_profile_by_user_id(user_id) if user_id else None
            if profile is None:
                logger.warning(
                    "Webhook: assinatura desconhecida %s", stripe_sub.get("id")
                )
                return
            subscription, _ = Subscription.objects.get_or_create(
                profile=profile,
                defaults={
                    "plan": Subscription.PLAN_MONTHLY,
                    "status": Subscription.STATUS_TRIALING,
                    "stripe_subscription_id": stripe_sub.get("id") or "",
                    "stripe_customer_id": stripe_sub.get("customer") or "",
                },
            )

        new_status = STRIPE_STATUS_MAP.get(stripe_sub.get("status"))
        if new_status:
            subscription.status = new_status
        plan = _plan_from_price_id(_price_id_from_subscription(stripe_sub))
        if plan:
            subscription.plan = plan
        subscription.current_period_end = _period_end_from_subscription(stripe_sub)
        subscription.trial_end = _dt_from_epoch(stripe_sub.get("trial_end"))
        subscription.save()

    def _handle_subscription_deleted(self, stripe_sub):
        subscription = self._find_subscription(stripe_sub.get("id"))
        if subscription is None:
            return
        subscription.status = Subscription.STATUS_CANCELED
        subscription.save(update_fields=["status", "updated_at"])

    def _handle_payment_succeeded(self, invoice):
        """Renovação/cobrança confirmada — garante acesso ativo."""
        subscription = self._find_subscription(_subscription_id_from_invoice(invoice))
        if subscription is None:
            return
        subscription.status = Subscription.STATUS_ACTIVE
        subscription.save(update_fields=["status", "updated_at"])

    def _handle_payment_failed(self, invoice):
        subscription = self._find_subscription(_subscription_id_from_invoice(invoice))
        if subscription is None:
            return
        subscription.status = Subscription.STATUS_PAST_DUE
        subscription.save(update_fields=["status", "updated_at"])


def _can_play_payload(profile):
    """Payload compartilhado pelos dois endpoints de gating pré-jogo."""
    allowed, remaining = can_play_game(profile)
    paid = has_paid_access(profile)
    return {
        "can_play": allowed,
        "daily_game_limit": None if paid else FREE_DAILY_GAME_LIMIT,
        "remaining_games_today": remaining,
        "code": None if allowed else "daily_limit_reached",
    }


class CanPlayView(APIView):
    """
    GET /api/v1/payments/can-play/
    Gating pré-jogo para o app: consultado antes de abrir o tabuleiro
    vs IA com relógio (partidas rateadas). O AiGameResultView mantém a
    mesma checagem como defesa em profundidade.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_or_create_profile(request.user)
        return Response(_can_play_payload(profile))


class InternalCanPlayView(APIView):
    """
    GET /api/v1/payments/internal/can-play/?user_id=N
    Consulta barata do node-api antes de colocar o jogador na fila de
    matchmaking (bloqueio ANTES do pareamento — nunca depois). Mesmo
    padrão de segredo compartilhado do GameResultView (X-Internal-Secret);
    sem throttle por ser tráfego interno.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        secret = request.headers.get("X-Internal-Secret", "")
        expected = getattr(settings, "INTERNAL_API_SECRET", "")
        if not expected or secret != expected:
            return Response(
                {"detail": "Não autorizado."}, status=status.HTTP_403_FORBIDDEN
            )

        user_id = request.query_params.get("user_id")
        if not user_id:
            return Response(
                {"detail": "user_id é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        profile = get_or_create_profile_by_user_id(user_id)
        if profile is None:
            return Response(
                {"detail": "Perfil não encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_can_play_payload(profile))


class MySubscriptionView(APIView):
    """
    GET /api/v1/payments/subscription/
    Estado do plano do usuário autenticado — fonte de verdade para o app
    (o mobile não guarda plano só localmente). Perfil sem registro é free.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_or_create_profile(request.user)
        subscription = getattr(profile, "subscription", None)
        paid = has_paid_access(profile)
        _, remaining = can_play_game(profile)

        return Response(
            {
                "plan": subscription.plan if paid else "free",
                "status": subscription.status if subscription else None,
                "current_period_end": (
                    subscription.current_period_end.isoformat()
                    if subscription and subscription.current_period_end
                    else None
                ),
                "trial_end": (
                    subscription.trial_end.isoformat()
                    if subscription and subscription.trial_end
                    else None
                ),
                "daily_game_limit": None if paid else FREE_DAILY_GAME_LIMIT,
                "remaining_games_today": remaining,
            }
        )
