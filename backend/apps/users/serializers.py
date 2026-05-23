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
        fields = [
            "id",
            "email",
            "full_name",
            "date_joined",
            "theme_preference",
        ]


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(write_only=True)

    def validate_email(self, value):
        normalized = value.lower()
        if not User.objects.filter(email=normalized).exists():
            raise serializers.ValidationError("E-mail não cadastrado.")
        return normalized


class PasswordResetConfirmSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)
    codigo = serializers.CharField(write_only=True, required=True, max_length=6)
    new_password = serializers.CharField(write_only=True, required=True)
    password_confirm = serializers.CharField(write_only=True, required=True)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "As senhas não coincidem."}
            )
        validate_password(attrs["new_password"])
        attrs["email"] = attrs["email"].lower()
        return attrs


class ThemePreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["theme_preference"]


class TokenBlacklistSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)


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
            "theme_preference": self.user.theme_preference,
        }
        return data


class GoogleAuthSerializer(serializers.Serializer):
    """Recebe o id_token gerado pelo SDK do Google no app mobile."""

    id_token = serializers.CharField(required=True, write_only=True)
