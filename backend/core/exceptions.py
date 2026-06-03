import math
from rest_framework.views import exception_handler
from rest_framework.exceptions import Throttled


def custom_exception_handler(exc, context):
    """
    Custom exception handler para formatar mensagens de erro do DRF.
    """
    # Chama o exception handler padrão do DRF para gerar a resposta inicial
    response = exception_handler(exc, context)

    if response is not None and isinstance(exc, Throttled):
        wait_seconds = math.ceil(exc.wait) if exc.wait else 0
        custom_detail = (
            f"Muitas tentativas feitas. Tente novamente em {wait_seconds} segundos."
        )

        # Substitui a mensagem original pelo nosso texto customizado
        if isinstance(response.data, dict) and "detail" in response.data:
            response.data["detail"] = custom_detail

    return response
