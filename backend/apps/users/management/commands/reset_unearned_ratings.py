"""Devolve ao onboarding as contas que nunca ganharam o rating que exibem.

O PROBLEMA
    A migration 0008 semeou TODO perfil existente com o default do Glicko-2
    (1500/350/0.06). A 0009 criou `onboarding_completed_at` e a 0010
    (grandfathering) preencheu esse campo em todas as contas já existentes,
    para que ninguém fosse forçado a re-onboardar.

    O efeito combinado é que essas contas NUNCA passaram pelo onboarding e
    NUNCA receberam o seed por nível (800/1200/1600, `ONBOARDING_SEED_RATING`
    em views.py) — ficaram paradas em 1500 sem ter jogado nada. 1500 não é um
    número que alguém conquistou nem declarou: é só o default do paper do
    Glicko-2 vazando para a UI como se fosse força real.

POR QUE UM COMANDO E NÃO UMA MIGRATION
    Migration roda sozinha no deploy. A ordem aqui é ler primeiro, conferir
    a lista, e só então escrever — então isto é um comando com dry-run por
    padrão. `--apply` é a única forma de escrever.

O QUE FAZ (com --apply)
    Para cada conta ELEGÍVEL:
      1. APAGA as linhas de ModalityRating. Apagar, não zerar: o seed do
         onboarding é aplicado por `get_or_create(defaults=...)`
         (views.py, OnboardingView), que NÃO sobrescreve linha existente —
         se as linhas continuassem lá, o onboarding rodaria de novo e o
         rating continuaria 1500. Sem linha, o serializer de perfil já cai
         nos defaults (get_ratings) e o leaderboard simplesmente não lista
         (filtra games_played__gt=0).
      2. Zera `onboarding_completed_at`, devolvendo a conta ao fluxo de
         onboarding no próximo login — é lá que ela declara o nível e recebe
         o seed correto.
      3. Devolve o espelho legado `Profile.rating` ao default do Glicko-2,
         para a Home não exibir um valor órfão até o onboarding rodar.

QUEM É ELEGÍVEL
    Só quem tem ZERO partidas ranqueadas em TODAS as modalidades
    (`ModalityRating.games_played`). Rating conquistado jogando nunca é
    apagado — não há como saber qual seria "o seed certo" de quem já jogou, e
    o Glicko-2 já convergiu a partir do valor real.

    Isto é mais estreito do que "resetar todas as contas existentes": para a
    população de hoje (nenhum usuário real em produção, ninguém com partida
    ranqueada) o resultado é o mesmo, mas a regra não destrói rating ganho se
    alguém tiver jogado entre a decisão e a execução.

USO
    python manage.py reset_unearned_ratings            # relatório, não escreve
    python manage.py reset_unearned_ratings --apply    # escreve
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.users.models import ModalityRating, Profile


class Command(BaseCommand):
    help = (
        "Devolve ao onboarding as contas que nunca jogaram partida ranqueada "
        "e ficaram com o rating default 1500 (efeito das migrations 0008+0010). "
        "Dry-run por padrão; use --apply para escrever."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Executa as escritas. Sem esta flag o comando só relata.",
        )

    def handle(self, *args, **options):
        apply_changes = options["apply"]

        profiles = (
            Profile.objects.select_related("user")
            .prefetch_related("modality_ratings")
            .order_by("user__email")
        )

        eligible = []
        skipped = []
        for profile in profiles:
            ranked_games = sum(r.games_played for r in profile.modality_ratings.all())
            if ranked_games == 0:
                eligible.append(profile)
            else:
                skipped.append((profile, ranked_games))

        self.stdout.write("")
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"Contas analisadas: {profiles.count()}  "
                f"(elegíveis: {len(eligible)} · preservadas: {len(skipped)})"
            )
        )

        if skipped:
            self.stdout.write("")
            self.stdout.write(
                "PRESERVADAS (têm partida ranqueada — rating conquistado):"
            )
            for profile, ranked_games in skipped:
                self.stdout.write(
                    f"  · {profile.user.email:<40} "
                    f"{ranked_games} partida(s) ranqueada(s)"
                )

        if not eligible:
            self.stdout.write("")
            self.stdout.write(self.style.SUCCESS("Nada a fazer."))
            return

        self.stdout.write("")
        self.stdout.write("ELEGÍVEIS (0 partidas ranqueadas):")
        for profile in eligible:
            ratings = {
                r.modality: round(r.rating) for r in profile.modality_ratings.all()
            }
            onboarded = (
                profile.onboarding_completed_at.strftime("%Y-%m-%d")
                if profile.onboarding_completed_at
                else "nunca"
            )
            self.stdout.write(
                f"  · {profile.user.email:<40} "
                f"espelho={profile.rating:<5} ratings={ratings or '{}'} "
                f"onboarding={onboarded}"
            )

        if not apply_changes:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    "DRY-RUN — nada foi escrito. Confira a lista acima e rode de "
                    "novo com --apply para executar."
                )
            )
            return

        eligible_ids = [p.id for p in eligible]
        with transaction.atomic():
            deleted, _ = ModalityRating.objects.filter(
                profile_id__in=eligible_ids
            ).delete()
            updated = Profile.objects.filter(id__in=eligible_ids).update(
                onboarding_completed_at=None,
                rating=round(ModalityRating.DEFAULT_RATING),
            )

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"APLICADO — {updated} conta(s) devolvida(s) ao onboarding, "
                f"{deleted} linha(s) de ModalityRating apagada(s). "
                "Elas recebem o seed por nível no próximo login."
            )
        )
