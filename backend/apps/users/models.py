from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from .managers import UserManager


def avatar_upload_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1]
    return f"avatars/{instance.user_id}.{ext}"


class User(AbstractBaseUser, PermissionsMixin):
    """
    Modelo de usuário customizado.
    Autenticação via e-mail em vez de username (UC02 / UC03).
    """

    email = models.EmailField(unique=True, verbose_name="E-mail")
    full_name = models.CharField(max_length=150, verbose_name="Nome completo")

    is_active = models.BooleanField(default=True, verbose_name="Ativo")
    is_staff = models.BooleanField(default=False, verbose_name="Staff")
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        verbose_name = "Usuário"
        verbose_name_plural = "Usuários"
        ordering = ["-date_joined"]

    def __str__(self):
        return self.email


class Profile(models.Model):
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="profile"
    )
    username = models.CharField(
        max_length=30, unique=True, null=True, blank=True, verbose_name="Nome de usuário"
    )
    avatar = models.ImageField(
        upload_to=avatar_upload_path, null=True, blank=True, verbose_name="Avatar"
    )
    bio = models.TextField(max_length=200, blank=True, default="", verbose_name="Bio")
    rating = models.IntegerField(default=1200, verbose_name="Rating ELO")
    games_played = models.IntegerField(default=0, verbose_name="Partidas jogadas")
    wins = models.IntegerField(default=0, verbose_name="Vitórias")
    losses = models.IntegerField(default=0, verbose_name="Derrotas")
    draws = models.IntegerField(default=0, verbose_name="Empates")

    class Meta:
        verbose_name = "Perfil"
        verbose_name_plural = "Perfis"

    def __str__(self):
        return f"Perfil de {self.user.email}"


class GameHistory(models.Model):
    RESULT_WIN = "win"
    RESULT_LOSS = "loss"
    RESULT_DRAW = "draw"
    RESULT_CHOICES = [
        ("win", "Vitória"),
        ("loss", "Derrota"),
        ("draw", "Empate"),
    ]

    MODE_AI = "ai"
    MODE_ONLINE = "online"
    MODE_CHOICES = [
        ("ai", "vs IA"),
        ("online", "Online"),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="game_history"
    )
    opponent_name = models.CharField(max_length=150, blank=True, default="")
    result = models.CharField(max_length=4, choices=RESULT_CHOICES)
    mode = models.CharField(max_length=6, choices=MODE_CHOICES)
    rating_before = models.IntegerField()
    rating_after = models.IntegerField()
    played_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Histórico de partida"
        verbose_name_plural = "Histórico de partidas"
        ordering = ["-played_at"]

    def __str__(self):
        return f"{self.user.email} {self.result} ({self.mode}) — {self.played_at:%Y-%m-%d}"


class Friendship(models.Model):
    STATUS_PENDING = "pending"
    STATUS_ACCEPTED = "accepted"
    STATUS_CHOICES = [
        ("pending", "Pendente"),
        ("accepted", "Aceito"),
    ]
    requester = models.ForeignKey(
        User, related_name="sent_requests", on_delete=models.CASCADE
    )
    receiver = models.ForeignKey(
        User, related_name="received_requests", on_delete=models.CASCADE
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("requester", "receiver")
        verbose_name = "Amizade"
        verbose_name_plural = "Amizades"

    def __str__(self):
        return f"{self.requester.email} → {self.receiver.email} ({self.status})"
