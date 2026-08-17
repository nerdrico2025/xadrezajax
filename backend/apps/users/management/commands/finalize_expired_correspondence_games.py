"""Finaliza por perda de tempo as partidas do Modo Turno com prazo vencido.

O PROBLEMA
    Modo Turno não tem relógio ativo — ninguém fica esperando com o app
    aberto. Sem ALGUÉM checando prazos vencidos, uma partida abandonada
    fica `active` para sempre, travando a cota de simultâneas do jogador
    que sumiu (ver `can_start_correspondence_game`) e nunca dando ao outro
    o rating que devia ganhar.

QUEM CHAMA
    Cron Job nativo do Easypanel, apontando pra este comando — configuração
    de painel, fora do código (passo manual, depois do deploy). Local ou
    CI, roda manual: `python manage.py finalize_expired_correspondence_games`.

IDEMPOTÊNCIA
    Rodar duas vezes seguidas no mesmo estado (ou duas instâncias do cron
    se sobrepondo, se uma execução atrasar) não aplica o resultado duas
    vezes:
      1. `select_for_update(skip_locked=True)` — se a instância A já está
         processando a linha, a instância B simplesmente PULA (não espera,
         não erra), igual à fila do matchmaking (Fase B).
      2. Cada partida é RE-CHECADA (`status=active` E prazo vencido) no
         exato momento em que a linha é travada, não só na varredura
         inicial — se um lance de última hora chegou entre a varredura e o
         lock (jogador jogou em cima da hora), a re-checagem não bate mais
         e a partida é pulada, viva.
      3. Depois de finalizada, a partida não é mais `active` — uma segunda
         passada do comando não a encontra de novo.

    Cada partida finaliza na SUA PRÓPRIA transação: um erro inesperado numa
    partida não derruba as outras que já foram processadas na mesma
    execução, e a que falhou volta pro próximo tick do cron.
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.users.correspondence import finalize_by_timeout
from apps.users.models import CorrespondenceGame


class Command(BaseCommand):
    help = (
        "Finaliza por perda de tempo as partidas do Modo Turno cujo prazo "
        "já venceu. Seguro de rodar repetidamente (idempotente)."
    )

    def handle(self, *args, **options):
        candidatas = CorrespondenceGame.objects.filter(
            status=CorrespondenceGame.STATUS_ACTIVE,
            current_deadline__lt=timezone.now(),
        ).values_list("id", flat=True)

        finalizadas = 0
        for game_id in list(candidatas):
            with transaction.atomic():
                game = (
                    CorrespondenceGame.objects.select_for_update(skip_locked=True)
                    .filter(
                        id=game_id,
                        status=CorrespondenceGame.STATUS_ACTIVE,
                        current_deadline__lt=timezone.now(),
                    )
                    .first()
                )
                if game is None:
                    # Já foi pega por outra execução em paralelo, ou deixou
                    # de estar vencida (lance chegou entre a varredura e o
                    # lock) — nos dois casos, nada a fazer aqui.
                    continue

                finalize_by_timeout(game)
                game.save()
                finalizadas += 1
                vencedor_email = (
                    game.white_player.email
                    if game.result == "white"
                    else game.black_player.email
                )
                self.stdout.write(
                    f"  · partida {game.id}: {game.white_player.email} × "
                    f"{game.black_player.email} — venceu por tempo: "
                    f"{vencedor_email}"
                )

        if finalizadas:
            self.stdout.write(
                self.style.SUCCESS(
                    f"{finalizadas} partida(s) finalizada(s) por tempo esgotado."
                )
            )
        else:
            self.stdout.write("Nenhuma partida com prazo vencido.")
