# Registro da cor jogada por partida (GAP 3 do diagnóstico).
#
# Até aqui nada no Django guardava quem jogou de brancas e quem jogou de
# pretas: a informação só existia no hash `game:{id}` do Redis (TTL 2h) e,
# embora chegasse ao backend no payload de resultado (white_id/black_id), era
# descartada na hora de gravar o GameHistory.
#
# Nullable de propósito: o histórico anterior a esta migration não tem como
# ser preenchido (o dado expirou junto com o Redis) e partidas vs IA não
# informam cor. Null = "cor desconhecida" e simplesmente não entra em
# nenhuma contagem.
#
# Escopo: SOMENTE REGISTRAR. O consumo (balancear a cor no pareamento da
# busca rápida) é PR futura — mas sem começar a gravar agora, ela nasceria
# sem nenhum dado histórico de onde partir.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0015_backfill_campaign_progress"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamehistory",
            name="color",
            field=models.CharField(
                blank=True,
                choices=[("w", "Brancas"), ("b", "Pretas")],
                max_length=1,
                null=True,
                verbose_name="Cor jogada",
            ),
        ),
    ]
