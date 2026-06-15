from rest_framework import serializers

from .models import Profile, PlayerProfile


class ProfileCreateSerializer(serializers.ModelSerializer):
    """Serializer para criação de perfil (UC007). Input apenas."""

    class Meta:
        model = Profile
        fields = ["nickname"]
        extra_kwargs = {
            "nickname": {"required": False},
        }


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Serializer para atualização de perfil (UC009)."""

    class Meta:
        model = Profile
        fields = ["nickname"]
        extra_kwargs = {
            "nickname": {"required": False},
        }

    def validate_nickname(self, value):
        """Valida o apelido. Impede uso de nomes reservados ou ofensivos."""
        import re

        if not value:
            return value

        # Lista básica de prefixos/nomes reservados
        reserved_pattern = r"^(admin|root|system|staff|moderator|support).*$"

        if re.match(reserved_pattern, value.lower()):
            raise serializers.ValidationError(
                "Este apelido não é permitido ou é reservado."
            )
        return value


class ProfileResponseSerializer(serializers.ModelSerializer):
    """Serializer de leitura do perfil. Inclui dados do usuário associado."""

    user_id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = Profile
        fields = [
            "id",
            "user_id",
            "email",
            "full_name",
            "nickname",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class PlayerProfileSerializer(serializers.ModelSerializer):
    """Serializer de leitura do PlayerProfile (UC010)."""

    class Meta:
        model = PlayerProfile
        fields = [
            "id",
            "rating",
            "games_played",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields
