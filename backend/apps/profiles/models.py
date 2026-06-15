from django.conf import settings
from django.db import models


class Profile(models.Model):
    """
    Perfil do jogador no Clube de Xadrez AJAX (UC007).
    Relação 1:1 com o modelo de usuário.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
        verbose_name="Usuário",
    )
    nickname = models.CharField(
        max_length=50,
        blank=True,
        default="",
        verbose_name="Apelido",
        help_text="Apelido do jogador no clube.",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Atualizado em")

    class Meta:
        verbose_name = "Perfil"
        verbose_name_plural = "Perfis"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Perfil de {self.user.email}"

    @property
    def is_player(self):
        """
        UC010 - Liberar acesso às funcionalidades do jogo.
        Retorna True se o usuário possuir um PlayerProfile associado.
        """
        return hasattr(self, "player_profile")

    @property
    def is_admin(self):
        """
        UC011 - Verifica se o usuário tem privilégios de AdminProfile.
        """
        return hasattr(self, "admin_profile")


class PlayerProfile(models.Model):
    """
    Perfil específico para o jogo (UC010).
    Relação 1:1 com o Profile principal.
    """

    profile = models.OneToOneField(
        Profile,
        on_delete=models.CASCADE,
        related_name="player_profile",
        verbose_name="Perfil Base",
    )
    rating = models.IntegerField(default=settings.DEFAULT_STARTING_ELO, verbose_name="Rating (Elo)")
    games_played = models.IntegerField(default=0, verbose_name="Partidas Jogadas")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Criado em")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Atualizado em")

    class Meta:
        verbose_name = "Perfil de Jogador"
        verbose_name_plural = "Perfis de Jogadores"

    def __str__(self):
        return f"Jogador: {self.profile.user.email} (Elo: {self.rating})"


class AdminProfile(models.Model):
    """
    Perfil administrativo (UC011).
    Relação 1:1 com o Profile principal.
    """

    profile = models.OneToOneField(
        Profile,
        on_delete=models.CASCADE,
        related_name="admin_profile",
        verbose_name="Perfil Base",
    )
    promoted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Promovido por",
        related_name="promotions_made",
    )
    promoted_at = models.DateTimeField(auto_now_add=True, verbose_name="Promovido em")

    class Meta:
        verbose_name = "Perfil Administrativo"
        verbose_name_plural = "Perfis Administrativos"

    def __str__(self):
        return f"Admin: {self.profile.user.email}"
