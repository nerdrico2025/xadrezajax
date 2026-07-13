# Grandfathering do onboarding (item 0.4 — decisão de produto já tomada):
# todos os perfis existentes no momento do deploy recebem
# onboarding_completed_at = agora, para que SÓ contas novas passem pelo
# fluxo de onboarding. Ninguém que já tem conta é forçado a re-onboardar.
#
# Reversível: o reverso volta o campo para NULL em todos (estado idêntico ao
# pós-0009, já que o campo acabou de nascer).

from django.db import migrations
from django.utils import timezone


def grandfather_existing_profiles(apps, schema_editor):
    Profile = apps.get_model("users", "Profile")
    Profile.objects.filter(onboarding_completed_at__isnull=True).update(
        onboarding_completed_at=timezone.now()
    )


def ungrandfather(apps, schema_editor):
    Profile = apps.get_model("users", "Profile")
    Profile.objects.update(onboarding_completed_at=None)


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0009_profile_onboarding_completed_at"),
    ]

    operations = [
        migrations.RunPython(grandfather_existing_profiles, ungrandfather),
    ]
