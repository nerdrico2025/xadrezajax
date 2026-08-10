"""Concede acesso administrativo e de plano pago a uma conta, por e-mail.

PARA QUE SERVE
    Destravar uma conta de teste sem passar pelo Stripe: dá o admin nativo do
    Django (até o painel próprio existir) e uma Subscription que
    `has_paid_access` aceita, que é o que abre as features de plano pago
    (análise pós-jogo, treino de problemas, partidas sem o teto diário).

    Não é um comando de emergência de uso único: é a forma de fazer isto em
    qualquer conta, sempre que precisar.

O QUE ESCREVE
    1. `is_staff=True` e `is_superuser=True` no User.
    2. Subscription do perfil: plano ANUAL, status `active`.

    `annual`/`active` não são escolha estética. `annual` é o plano mais
    completo dos dois que existem (`Subscription.PLAN_CHOICES` — "mensal" e
    "anual" são só os RÓTULOS; os valores gravados são `monthly`/`annual`).
    `active` é um dos dois status de `Subscription.PAID_STATUSES`, o par que
    `has_paid_access` considera pago; o outro é `trialing`, que expira e não
    serve para um acesso concedido à mão.

SEM CONTA, SEM ESCRITA
    E-mail que não existe é `CommandError` antes de qualquer save — não
    adianta criar conta aqui, o cadastro passa por senha e onboarding.

O QUE NÃO DESTRÓI
    `stripe_customer_id`/`stripe_subscription_id` de uma assinatura que já
    exista são PRESERVADOS: só `plan` e `status` são reescritos. Isso mantém
    o webhook capaz de reencontrar a linha (`_find_subscription` casa pelo
    `stripe_subscription_id`) se um dia a conta virar pagante de verdade.

    Numa linha NOVA esses campos ficam vazios e o `provider` vira `manual`,
    não `stripe`: registrar "stripe" numa assinatura que nunca passou pelo
    Stripe é mentira que depois custa uma investigação. Como o webhook ignora
    `stripe_subscription_id` vazio, a linha manual nunca é confundida com uma
    assinatura real — e uma compra futura a sobrescreve pelo
    `update_or_create(profile=...)` do próprio webhook.

IDEMPOTENTE
    A Subscription é OneToOne com o Profile, e a escrita é
    `update_or_create(profile=...)`. Rodar de novo no mesmo e-mail reescreve
    os mesmos valores e não cria segunda linha.

USO
    python manage.py grant_full_access alguem@exemplo.com
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.payments.models import Subscription
from apps.users.models import get_or_create_profile

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Concede acesso completo (admin do Django + assinatura Anual ativa) "
        "à conta do e-mail informado. Idempotente."
    )

    def add_arguments(self, parser):
        parser.add_argument("email", help="E-mail da conta que recebe o acesso.")

    def handle(self, *args, **options):
        email = options["email"].strip()
        user = self._find_user(email)

        with transaction.atomic():
            # `update_fields` explícito: nada mais deste User é assunto do
            # comando, e um save cheio sobrescreveria alterações concorrentes.
            user.is_staff = True
            user.is_superuser = True
            user.save(update_fields=["is_staff", "is_superuser"])

            # Conta autenticada sem Profile é estado que o sistema autocorrige
            # (ver o docstring do helper) — aqui vale o mesmo, senão o comando
            # falharia justamente na conta mais quebrada.
            profile = get_or_create_profile(user)

            subscription, created = Subscription.objects.update_or_create(
                profile=profile,
                defaults={
                    "plan": Subscription.PLAN_ANNUAL,
                    "status": Subscription.STATUS_ACTIVE,
                },
                # Só numa linha NOVA: reescrever o provider de uma assinatura
                # real do Stripe apagaria a origem dela.
                create_defaults={
                    "plan": Subscription.PLAN_ANNUAL,
                    "status": Subscription.STATUS_ACTIVE,
                    "provider": "manual",
                },
            )

        self._report(user, subscription, created)

    def _find_user(self, email):
        """Busca exata e, se falhar, sem diferenciar maiúsculas.

        `User.email` é unique e case-SENSITIVE no Postgres, então
        'Alguem@x.com' e 'alguem@x.com' podem coexistir. A busca ampla só
        entra como segunda tentativa, e desiste se houver empate — escolher
        uma conta no lugar de quem digitou seria pior do que pedir de novo.
        """
        user = User.objects.filter(email=email).first()
        if user is not None:
            return user

        candidates = list(User.objects.filter(email__iexact=email))
        if len(candidates) == 1:
            self.stdout.write(
                self.style.WARNING(
                    f"Nenhuma conta com o e-mail exato '{email}'; usando "
                    f"'{candidates[0].email}', que difere só em maiúsculas."
                )
            )
            return candidates[0]
        if len(candidates) > 1:
            found = ", ".join(sorted(c.email for c in candidates))
            raise CommandError(
                f"Mais de uma conta casa com '{email}' ignorando maiúsculas "
                f"({found}). Rode de novo com o e-mail exato."
            )

        raise CommandError(f"Nenhuma conta com o e-mail '{email}'. Nada foi alterado.")

    def _report(self, user, subscription, created):
        verbo = "criada" if created else "atualizada"
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING(f"Conta: {user.email}"))
        self.stdout.write(f"  is_staff .......... {user.is_staff}")
        self.stdout.write(f"  is_superuser ...... {user.is_superuser}")
        self.stdout.write(
            f"  assinatura ........ {subscription.plan} / {subscription.status} "
            f"({verbo}, provider={subscription.provider})"
        )
        self.stdout.write(f"  acesso pago ....... {subscription.is_paid}")
        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                "ACESSO CONCEDIDO — admin do Django e plano pago liberados. "
                "O app relê o plano no próximo GET /api/v1/payments/subscription/."
            )
        )
