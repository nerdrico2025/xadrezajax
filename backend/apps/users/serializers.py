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
        data["user"] = {
            "id": self.user.id,
            "email": self.user.email,
            "full_name": self.user.full_name,
            "date_joined": self.user.date_joined.isoformat(),
        }
        return data


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
