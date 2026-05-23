import random
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from .managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    """
    Modelo de usuário customizado.
    Autenticação via e-mail em vez de username (UC02 / UC03).
    """

    email = models.EmailField(unique=True, verbose_name="E-mail")
    full_name = models.CharField(max_length=150, verbose_name="Nome completo")

    class ThemeChoices(models.TextChoices):
        LIGHT = "light", "Claro"
        DARK = "dark", "Escuro"
        SYSTEM = "system", "Sistema"

    theme_preference = models.CharField(
        max_length=10,
        choices=ThemeChoices.choices,
        default=ThemeChoices.SYSTEM,
        verbose_name="Preferência de tema",
    )

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


class PasswordResetCode(models.Model):
    """
    Modelo para gerenciar os códigos numéricos de recuperação de senha.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reset_codes"
    )
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)

    def is_valid(self):
        # O código expira em 15 minutos
        expiration_time = self.created_at + timedelta(minutes=15)
        return timezone.now() <= expiration_time

    @classmethod
    def generate_code(cls, user):
        # Invalida códigos anteriores gerados para este usuário
        cls.objects.filter(user=user).delete()

        # Gera PIN de 6 dígitos
        pin = str(random.randint(100000, 999999))
        return cls.objects.create(user=user, code=pin)
