from django.db import models

from apps.users.models import Profile


class Subscription(models.Model):
    """
    Assinatura de um perfil (item 0.1). Agnóstica a provedor: `provider`
    deixa espaço para RevenueCat/billing nativo no futuro sem refatorar.

    Plano Grátis é a AUSÊNCIA de registro — não existe linha "free". Elite
    fica de fora por completo (Fase 2, condicional).
    """

    PLAN_MONTHLY = "monthly"
    PLAN_ANNUAL = "annual"
    PLAN_CHOICES = [
        ("monthly", "Mensal"),
        ("annual", "Anual"),
    ]

    STATUS_TRIALING = "trialing"
    STATUS_ACTIVE = "active"
    STATUS_PAST_DUE = "past_due"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = [
        ("trialing", "Em trial"),
        ("active", "Ativa"),
        ("past_due", "Pagamento pendente"),
        ("canceled", "Cancelada"),
    ]

    # Status que dão acesso pago. past_due fica de fora: o Stripe reenvia a
    # cobrança e, se ela passar, invoice.payment_succeeded reativa o acesso.
    PAID_STATUSES = (STATUS_TRIALING, STATUS_ACTIVE)

    PROVIDER_STRIPE = "stripe"

    profile = models.OneToOneField(
        Profile, on_delete=models.CASCADE, related_name="subscription"
    )
    plan = models.CharField(max_length=10, choices=PLAN_CHOICES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    provider = models.CharField(max_length=20, default=PROVIDER_STRIPE)
    stripe_customer_id = models.CharField(max_length=100, blank=True, default="")
    stripe_subscription_id = models.CharField(
        max_length=100, blank=True, default="", db_index=True
    )
    current_period_end = models.DateTimeField(null=True, blank=True)
    trial_end = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Assinatura"
        verbose_name_plural = "Assinaturas"

    @property
    def is_paid(self):
        return self.status in self.PAID_STATUSES

    def __str__(self):
        return f"{self.profile.user.email} [{self.plan}] {self.status}"


class PaymentEvent(models.Model):
    """
    Evento de webhook já processado — `event_id` unique garante idempotência:
    o Stripe pode reenviar o mesmo evento e o reprocessamento vira no-op.
    """

    provider = models.CharField(max_length=20, default=Subscription.PROVIDER_STRIPE)
    event_id = models.CharField(max_length=255, unique=True)
    event_type = models.CharField(max_length=100)
    processed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Evento de pagamento"
        verbose_name_plural = "Eventos de pagamento"

    def __str__(self):
        return f"{self.provider}:{self.event_type} ({self.event_id})"
