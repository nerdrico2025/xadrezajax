from django.db import migrations, models


def classify_existing(apps, schema_editor):
    """Classifica o histórico já existente (decisão D1/D2):

    - Partidas vs IA (mode="ai") NUNCA foram ranqueadas → rated=False.
    - Partidas sem alteração de rating (rating_before == rating_after) são
      partidas sem relógio / amistosas → rated=False.
    - As demais (online com relógio, que moveram o rating) permanecem rated=True.

    É classificação determinística do dado que já existe, não backfill de
    partidas ausentes.
    """
    GameHistory = apps.get_model("users", "GameHistory")
    GameHistory.objects.filter(mode="ai").update(rated=False)
    GameHistory.objects.filter(rating_before=models.F("rating_after")).update(
        rated=False
    )


def revert(apps, schema_editor):
    # A coluna é removida no reverse do AddField; nada a desfazer aqui.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0011_profile_stripe_customer_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamehistory",
            name="rated",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "False para partidas vs IA e sem relógio — contam no "
                    "histórico e nas estatísticas, mas não alteram o rating."
                ),
            ),
        ),
        migrations.RunPython(classify_existing, revert),
    ]
