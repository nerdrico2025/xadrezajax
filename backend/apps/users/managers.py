from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    """Manager customizado: usa email no lugar de username."""

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("O campo e-mail é obrigatório.")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if not extra_fields.get("is_staff"):
            raise ValueError("Superuser deve ter is_staff=True.")
        if not extra_fields.get("is_superuser"):
            raise ValueError("Superuser deve ter is_superuser=True.")

        return self.create_user(email, password, **extra_fields)
