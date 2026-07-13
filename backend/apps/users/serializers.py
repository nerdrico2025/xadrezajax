from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import ModalityRating, Profile

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    """Serializer para cadastro de novos usuários (UC02)."""

    password = serializers.CharField(
        write_only=True,
        required=True,
        style={"input_type": "password"},
    )
    password_confirm = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        style={"input_type": "password"},
    )

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "password", "password_confirm"]
        read_only_fields = ["id"]

    def validate_email(self, value):
        normalized = value.lower()
        if User.objects.filter(email=normalized).exists():
            raise serializers.ValidationError("Este e-mail já está cadastrado.")
        return normalized

    def validate(self, attrs):
        password_confirm = attrs.get("password_confirm")

        if password_confirm is not None and password_confirm != attrs["password"]:
            raise serializers.ValidationError(
                {"password_confirm": "As senhas não coincidem."}
            )

        # Roda todos os validators configurados em AUTH_PASSWORD_VALIDATORS
        validate_password(attrs["password"])
        return attrs

    def create(self, validated_data):
        validated_data.pop("password_confirm", None)
        return User.objects.create_user(**validated_data)


class UserResponseSerializer(serializers.ModelSerializer):
    """Serializer de leitura retornado após o cadastro."""

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "date_joined"]


class ChessTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Sobrescreve o serializer padrão do SimpleJWT para incluir
    dados do usuário no payload de resposta (UC03).
    """

    def validate(self, attrs):
        data = super().validate(attrs)
        profile = getattr(self.user, "profile", None)
        data["user"] = {
            "id": self.user.id,
            "email": self.user.email,
            "full_name": self.user.full_name,
            "date_joined": self.user.date_joined.isoformat(),
            "username": profile.username if profile else None,
            "rating": profile.rating if profile else 1200,
            # Gate do onboarding em 3 toques (item 0.4) — mesmo contrato do
            # build_auth_response do login com Google.
            "onboarding_completed": (
                profile.onboarding_completed_at is not None if profile else True
            ),
        }
        return data


class ProfileSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)
    full_name = serializers.CharField(source="user.full_name")
    date_joined = serializers.DateTimeField(source="user.date_joined", read_only=True)
    avatar = serializers.ImageField(required=False, allow_null=True)
    friends_count = serializers.SerializerMethodField()
    ratings = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = [
            "email",
            "full_name",
            "username",
            "avatar",
            "bio",
            "rating",
            "ratings",
            "games_played",
            "wins",
            "losses",
            "draws",
            "date_joined",
            "friends_count",
        ]
        read_only_fields = [
            "email",
            "rating",
            "ratings",
            "games_played",
            "wins",
            "losses",
            "draws",
            "date_joined",
            "friends_count",
        ]

    def get_ratings(self, obj):
        """Ratings Glicko-2 por modalidade; modalidades ainda não jogadas
        (sem linha no banco) aparecem com os defaults do sistema."""
        stored = {r.modality: r for r in obj.modality_ratings.all()}
        result = {}
        for modality, _ in ModalityRating.MODALITY_CHOICES:
            r = stored.get(modality)
            result[modality] = {
                "rating": (
                    round(r.rating) if r else round(ModalityRating.DEFAULT_RATING)
                ),
                "deviation": round(
                    r.deviation if r else ModalityRating.DEFAULT_DEVIATION
                ),
                "games_played": r.games_played if r else 0,
                "provisional": r.is_provisional if r else True,
            }
        return result

    def get_friends_count(self, obj):
        from django.db.models import Q
        from .models import Friendship

        return Friendship.objects.filter(
            Q(requester=obj.user) | Q(receiver=obj.user),
            status=Friendship.STATUS_ACCEPTED,
        ).count()

    def validate_username(self, value):
        if not value:
            return value
        qs = Profile.objects.filter(username=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Este nome de usuário já está em uso.")
        return value

    def update(self, instance, validated_data):
        user_data = validated_data.pop("user", {})
        with transaction.atomic():
            if "full_name" in user_data:
                instance.user.full_name = user_data["full_name"]
                instance.user.save(update_fields=["full_name"])
            return super().update(instance, validated_data)


class PasswordResetRequestSerializer(serializers.Serializer):
    """Valida o e-mail para requisição de nova senha."""

    email = serializers.EmailField()

    def validate_email(self, value):
        return value.lower()


class PasswordResetVerifyCodeSerializer(serializers.Serializer):
    """Valida os dados para verificar o código de recuperação."""

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)

    def validate_email(self, value):
        return value.lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Valida os dados de confirmação para criação de nova senha."""

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)
    new_password = serializers.CharField(
        write_only=True, required=True, style={"input_type": "password"}
    )
    password_confirm = serializers.CharField(
        write_only=True, required=True, style={"input_type": "password"}
    )

    def validate(self, attrs):
        if attrs["new_password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "As senhas não coincidem."}
            )

        validate_password(attrs["new_password"])
        return attrs
