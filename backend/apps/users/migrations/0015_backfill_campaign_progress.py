# Backfill de CampaignProgress (Modo Campanha, PR 1) para todo Profile
# existente — não há usuários reais em produção ainda (só contas de teste),
# então o backfill é só o estado inicial padrão: Iniciante desbloqueado,
# Fácil/Médio/Difícil/Mestre travados, zero vitórias, nenhum selo. Perfis
# novos (a partir daqui) já nascem assim via o signal create_user_profile.
#
# Reimplementa aqui a mesma lógica de ensure_campaign_progress() (models.py)
# em vez de importá-la — migrations não devem depender do código "vivo" do
# app, só do apps.get_model histórico.

from django.db import migrations
from django.utils import timezone

LEVEL_BEGINNER = "beginner"
LEVEL_ORDER = ["beginner", "easy", "medium", "hard", "master"]


def backfill_campaign_progress(apps, schema_editor):
    Profile = apps.get_model("users", "Profile")
    CampaignProgress = apps.get_model("users", "CampaignProgress")

    now = timezone.now()
    existing = set(CampaignProgress.objects.values_list("profile_id", "level"))
    to_create = []
    for profile_id in Profile.objects.values_list("id", flat=True):
        for level in LEVEL_ORDER:
            if (profile_id, level) in existing:
                continue
            is_beginner = level == LEVEL_BEGINNER
            to_create.append(
                CampaignProgress(
                    profile_id=profile_id,
                    level=level,
                    unlocked=is_beginner,
                    unlocked_at=now if is_beginner else None,
                )
            )
    CampaignProgress.objects.bulk_create(to_create)
    print(
        f"[0015_backfill_campaign_progress] {len(to_create)} linha(s) de "
        "progresso de campanha criadas."
    )


def noop_reverse(apps, schema_editor):
    # A tabela é removida no reverse do CreateModel (migration 0014); nada a
    # desfazer aqui.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0014_campaignwinlog_campaignprogress"),
    ]

    operations = [
        migrations.RunPython(backfill_campaign_progress, noop_reverse),
    ]
