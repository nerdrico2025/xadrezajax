from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

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
        required=True,
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
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "As senhas não coincidem."}
            )
        # Roda todos os validators configurados em AUTH_PASSWORD_VALIDATORS
        validate_password(attrs["password"])
        return attrs

    def create(self, validated_data):
        validated_data.pop("password_confirm")
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
        data["user"] = {
            "id": self.user.id,
            "email": self.user.email,
            "full_name": self.user.full_name,
        }
        return data
