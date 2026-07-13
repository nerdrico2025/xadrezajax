# Migração de dados Elo → Glicko-2 (RF-PERF-02).
#
# Para cada Profile existente cria os 3 ModalityRating (bullet/blitz/rapid)
# com o seed uniforme do Glicko-2 — 1500/350/0.06 — igual para perfis
# existentes e novos (decisão do PM em 2026-07-12: não herdar o Elo antigo
# como seed; todos recalibram do mesmo ponto de partida, e o RD 350 faz o
# rating convergir rápido nas primeiras partidas).
#
# Todo o histórico pré-migração é blitz (decisão do PM 2026-07-07: online era
# sempre 5 min), então games_played do blitz herda o total do perfil — isso
# preserva quem já saiu do período provisório — e bullet/rapid começam em 0.
#
# Reversível: o reverso apaga os ModalityRating criados (o Elo permanece
# intacto em Profile.rating, que segue como espelho denormalizado).

from django.db import migrations

DEFAULT_RATING = 1500.0
DEFAULT_DEVIATION = 350.0
DEFAULT_VOLATILITY = 0.06

MODALITIES = ("bullet", "blitz", "rapid")


def seed_modality_ratings(apps, schema_editor):
    Profile = apps.get_model("users", "Profile")
    ModalityRating = apps.get_model("users", "ModalityRating")

    to_create = []
    for profile in Profile.objects.all().iterator():
        for modality in MODALITIES:
            to_create.append(
                ModalityRating(
                    profile=profile,
                    modality=modality,
                    rating=DEFAULT_RATING,
                    deviation=DEFAULT_DEVIATION,
                    volatility=DEFAULT_VOLATILITY,
                    games_played=(profile.games_played if modality == "blitz" else 0),
                )
            )
    ModalityRating.objects.bulk_create(to_create, ignore_conflicts=True)


def unseed_modality_ratings(apps, schema_editor):
    ModalityRating = apps.get_model("users", "ModalityRating")
    ModalityRating.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0007_gamehistory_modality_modalityrating"),
    ]

    operations = [
        migrations.RunPython(seed_modality_ratings, unseed_modality_ratings),
    ]
