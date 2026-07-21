from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile, ensure_campaign_progress

User = get_user_model()


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        profile = Profile.objects.create(user=instance)
        # Modo Campanha (épico): todo perfil novo nasce com Iniciante
        # desbloqueado e os demais 4 níveis travados.
        ensure_campaign_progress(profile)
