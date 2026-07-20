# Backfill de Profile para Users órfãos (causa raiz: contas criadas entre
# 08/mai e 27/jun/2026, antes do modelo Profile e do signal post_save
# existirem — ver apps/users/signals.py). Nenhuma migration anterior fez
# esse backfill; o resultado era 500/404 em cascata em todo endpoint que lê
# Profile para essas contas.
#
# Replica exatamente o que create_user_profile (signals.py) faz: cria um
# Profile em branco, só com `user` setado — deixa os defaults do modelo
# agirem (rating 1200, games_played/wins/losses/draws 0, onboarding_completed_at
# nulo). O signal NÃO semeia ModalityRating no momento da criação (isso é
# lazy, via get_or_create/_modality_rating_snapshot em primeiro uso ou no
# OnboardingView) — então o backfill também não semeia, para não deixar
# essas contas com um estado diferente do que um cadastro novo produziria.

from django.db import migrations


def backfill_missing_profiles(apps, schema_editor):
    User = apps.get_model("users", "User")
    Profile = apps.get_model("users", "Profile")

    orphans = list(User.objects.filter(profile__isnull=True).values_list("id", "email"))
    Profile.objects.bulk_create([Profile(user_id=uid) for uid, _ in orphans])

    # Impresso no output do `migrate` (aparece no log de deploy) — é o único
    # jeito de saber, no ambiente real, quantos/quais Users estavam órfãos.
    if orphans:
        emails = ", ".join(email for _, email in orphans)
        print(
            f"[0013_backfill_missing_profiles] {len(orphans)} usuário(s) "
            f"sem Profile corrigido(s): {emails}"
        )
    else:
        print("[0013_backfill_missing_profiles] nenhum usuário órfão encontrado.")


def noop_reverse(apps, schema_editor):
    # Reversão real destruiria Profiles de contas que podem já ter sido
    # usadas (jogos, amizades, etc. via FK) desde o backfill — não há como
    # distinguir com segurança quais Profiles vieram do backfill vs. de uso
    # orgânico posterior. No-op documentado: reverter esta migration não
    # remove os Profiles criados.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0012_gamehistory_rated"),
    ]

    operations = [
        migrations.RunPython(backfill_missing_profiles, noop_reverse),
    ]
