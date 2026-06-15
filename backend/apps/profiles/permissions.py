"""
UC012 - Controlar acesso baseado em permissões (permissions.py).

Este módulo centraliza toda a lógica de autorização da aplicação de perfis.
As permissões são modulares e compostas: cada View pode combinar múltiplas
classes via `permission_classes = [IsAuthenticated, HasProfile, HasPlayerProfile]`.

O DRF avalia as permissões em sequência (AND lógico). Se qualquer uma falhar,
a requisição é rejeitada com 403 Forbidden e a mensagem customizada é enviada
ao front-end para que ele possa redirecionar o usuário adequadamente.

Hierarquia de Perfis:
    User (Django Auth)
    └── Profile (UC007 - Perfil base, obrigatório)
        ├── PlayerProfile (UC010 - Acesso ao jogo)
        └── AdminProfile  (UC011 - Acesso administrativo)
"""

import logging

from rest_framework.permissions import BasePermission

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: Extração segura de perfis associados ao usuário
# ---------------------------------------------------------------------------


def get_user_profile(user):
    """
    UC012 - Recuperar perfil do usuário de forma segura.

    Retorna a instância de Profile associada ao request.user,
    ou None caso o perfil base ainda não exista.

    Args:
        user: Instância do modelo User (de request.user).

    Returns:
        Profile | None
    """
    if hasattr(user, "profile"):
        return user.profile
    return None


# ---------------------------------------------------------------------------
# Permissão: Perfil base obrigatório
# ---------------------------------------------------------------------------


class HasProfile(BasePermission):
    """
    UC012 - Verificar existência do Perfil base (UC007).

    Se o perfil não existir, retorna 403 com uma mensagem direcionada
    para que o front-end redirecione o usuário à tela de criação de perfil.
    """

    message = "Perfil não encontrado. Crie seu perfil antes de continuar."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False

        profile = get_user_profile(request.user)
        if profile is None:
            # UC012 - Tratar perfil inexistente → sinaliza redirecionamento ao UC007
            logger.info(
                "UC012 - Acesso negado: perfil inexistente para %s. "
                "Front-end deve redirecionar para criação de perfil (UC007).",
                request.user.email,
            )
            return False

        return True


# ---------------------------------------------------------------------------
# Permissão: PlayerProfile (Acesso ao jogo)
# ---------------------------------------------------------------------------


class HasPlayerProfile(BasePermission):
    """
    UC012 - Verificar PlayerProfile.

    Garante que o usuário autenticado possui um Perfil de Jogador ativo.
    Substitui a antiga classe IsPlayer, adicionando tratamento de erro
    e mensagens direcionadas ao front-end.
    """

    message = "Perfil de jogador não encontrado. Ative seu acesso ao jogo primeiro."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False

        profile = get_user_profile(request.user)
        if profile is None:
            return False

        try:
            return profile.is_player
        except Exception:
            logger.exception(
                "UC012 - Erro ao verificar PlayerProfile para %s",
                request.user.email,
            )
            return False


# ---------------------------------------------------------------------------
# Permissão: AdminProfile (Acesso administrativo)
# ---------------------------------------------------------------------------


class HasAdminProfile(BasePermission):
    """
    UC012 - Verificar AdminProfile.

    Combina a checagem da flag nativa do Django (is_staff / is_superuser)
    com a existência do nosso AdminProfile no banco, garantindo segurança
    em duas camadas. Se qualquer uma das camadas falhar, o acesso é negado.
    """

    message = "Acesso restrito a administradores."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False

        # Camada 1: Flag nativa do Django
        if not (request.user.is_staff or request.user.is_superuser):
            return False

        # Camada 2: Existência do AdminProfile na nossa arquitetura
        profile = get_user_profile(request.user)
        if profile is None:
            return False

        try:
            return profile.is_admin
        except Exception:
            logger.exception(
                "UC012 - Erro ao verificar AdminProfile para %s",
                request.user.email,
            )
            return False


# ---------------------------------------------------------------------------
# Permissão composta: Multi-perfil (Jogador OU Admin)
# ---------------------------------------------------------------------------


class IsPlayerOrAdmin(BasePermission):
    """
    UC012 - Combinar permissões (multi-perfil).

    Permite o acesso se o usuário possuir QUALQUER um dos perfis elevados:
    PlayerProfile OU AdminProfile. Útil para rotas que devem ser acessíveis
    tanto por jogadores quanto por administradores (ex: visualizar ranking).

    Nota sobre composição no DRF:
    - permission_classes = [A, B]       → A AND B (ambas devem passar)
    - permission_classes = [A | B]      → A OR B  (DRF 3.9+, bitwise OR)
    - IsPlayerOrAdmin                   → OR customizado
    (compatível com todas as versões)
    """

    message = "Acesso restrito a jogadores ou administradores."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False

        profile = get_user_profile(request.user)
        if profile is None:
            return False

        try:
            is_player = profile.is_player
            is_admin = (
                request.user.is_staff or request.user.is_superuser
            ) and profile.is_admin
            return is_player or is_admin
        except Exception:
            logger.exception(
                "UC012 - Erro ao verificar multi-perfil para %s",
                request.user.email,
            )
            return False


# ---------------------------------------------------------------------------
# Aliases de retrocompatibilidade
# As Views dos UCs anteriores importam IsPlayer e IsAdmin.
# Mantemos os nomes antigos apontando para as novas classes.
# ---------------------------------------------------------------------------

IsPlayer = HasPlayerProfile
IsAdmin = HasAdminProfile
