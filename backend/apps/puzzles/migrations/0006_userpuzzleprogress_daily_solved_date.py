# Estado "resolvi o Problema do dia HOJE", separado da progressão do Treino.
#
# O bug que isto fecha: `UserPuzzleProgress.solved` é permanente por
# (usuário, problema) e não olha data. Com 7 problemas no banco, o ciclo do
# diário repete a cada 7 dias, então todo problema que voltava a ser "o de
# hoje" já tinha solved=True de um ciclo anterior — o backend respondia
# `already_solved: true` todos os dias, para um problema DIFERENTE a cada dia,
# e o app mostrava "volte amanhã" indefinidamente.
#
# POR QUE PRECISA DE COLUNA (e não dá para derivar do que já existe):
#   - `solved_at` não distingue a ORIGEM: é carimbado igual por diário e
#     Treino. Resolver o mesmo puzzle_id no Treino marcaria o diário do dia
#     como resolvido, contra a decisão de desacoplar os dois (2026-08-03).
#   - `solved_at` também só é escrito na PRIMEIRA resolução, então um problema
#     que volta pelo ciclo nunca atualizaria o carimbo.
#   - `daily_attempts_date` marca "interagiu com o diário hoje", inclusive em
#     tentativa errada — daria falso positivo para quem erra no diário e
#     acerta o mesmo problema no Treino no mesmo dia.
#
# Aditiva, nullable, SEM backfill — de propósito. Linha existente nasce com
# NULL e portanto conta como "não resolvida hoje", que é exatamente o que
# destrava os usuários presos (decisão de 2026-08-03). O efeito colateral
# aceito é que quem já tinha resolvido o diário no dia do deploy recebe o
# problema de volta como jogável uma vez; na virada do dia o comportamento já
# é o definitivo.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("puzzles", "0005_userpuzzleprogress_daily_attempts_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="userpuzzleprogress",
            name="daily_solved_date",
            field=models.DateField(
                blank=True, null=True, verbose_name="Diário resolvido em"
            ),
        ),
    ]
