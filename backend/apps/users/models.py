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
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    username = models.CharField(
        max_length=30,
        unique=True,
        null=True,
        blank=True,
        verbose_name="Nome de usuário",
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


class ModalityRating(models.Model):
    """
    Rating Glicko-2 de um perfil em uma modalidade (RF-PERF-02).

    Três valores por rating (não só um número, como no Elo): `rating` (força),
    `deviation` (RD — incerteza) e `volatility` (consistência). O período
    provisório das 20 primeiras partidas é derivado de `games_played` — não há
    campo extra: `is_provisional` é uma property.
    """

    MODALITY_BULLET = "bullet"
    MODALITY_BLITZ = "blitz"
    MODALITY_RAPID = "rapid"
    MODALITY_CHOICES = [
        ("bullet", "Bullet"),
        ("blitz", "Blitz"),
        ("rapid", "Rápido"),
    ]

    PROVISIONAL_GAMES = 20

    # Defaults do Glicko-2 (paper de Glickman) — seed uniforme para todos os
    # perfis, existentes e novos (o Elo antigo não é herdado; decisão do PM).
    DEFAULT_RATING = 1500.0
    DEFAULT_DEVIATION = 350.0
    DEFAULT_VOLATILITY = 0.06

    profile = models.ForeignKey(
        Profile, on_delete=models.CASCADE, related_name="modality_ratings"
    )
    modality = models.CharField(max_length=6, choices=MODALITY_CHOICES)
    rating = models.FloatField(default=DEFAULT_RATING, verbose_name="Rating")
    deviation = models.FloatField(default=DEFAULT_DEVIATION, verbose_name="Desvio (RD)")
    volatility = models.FloatField(
        default=DEFAULT_VOLATILITY, verbose_name="Volatilidade"
    )
    games_played = models.IntegerField(default=0, verbose_name="Partidas jogadas")

    class Meta:
        unique_together = ("profile", "modality")
        verbose_name = "Rating por modalidade"
        verbose_name_plural = "Ratings por modalidade"

    @property
    def is_provisional(self):
        return self.games_played < self.PROVISIONAL_GAMES

    def __str__(self):
        return (
            f"{self.profile.user.email} [{self.modality}] "
            f"{self.rating:.0f} ±{self.deviation:.0f}"
        )


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
    # Default "blitz" cobre o histórico pré-Glicko-2: partidas online eram
    # sempre 5 min (blitz) e jogos vs IA antigos não têm dado de tempo
    # (decisão do PM em 2026-07-07: tudo vira blitz).
    modality = models.CharField(
        max_length=6,
        choices=ModalityRating.MODALITY_CHOICES,
        default=ModalityRating.MODALITY_BLITZ,
    )
    rating_before = models.IntegerField()
    rating_after = models.IntegerField()
    played_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Histórico de partida"
        verbose_name_plural = "Histórico de partidas"
        ordering = ["-played_at"]

    def __str__(self):
        return (
            f"{self.user.email} {self.result} ({self.mode}) — {self.played_at:%Y-%m-%d}"
        )


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
