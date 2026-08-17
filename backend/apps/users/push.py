"""
Envio de push via Expo — ponto ÚNICO de saída.

Fase de FUNDAÇÃO: nada no produto chama `send_push` ainda. Existe para as
fases seguintes (a partir do Modo Turno) terem um lugar só para mandar
notificação, em vez de cada feature reimplementar a chamada à API da Expo —
é o mesmo motivo de `check_achievements` ser um módulo próprio em vez de
espalhado pelas views.

DISCIPLINA: `send_push` NUNCA levanta para o chamador. Falha de push não pode
derrubar o fluxo que a originou (registrar um lance, por exemplo) — mesmo
contrato de `check_achievements` e `enqueue_analysis`.
"""

import logging

import requests
from django.conf import settings

from .models import DeviceToken

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Teto de destinatários por chamada HTTP à Expo — documentado por eles como
# 100. Relevante quando um usuário tiver vários devices (fase futura, hoje
# `send_push` manda para um usuário por vez).
EXPO_BATCH_LIMIT = 100


def send_push(user, title, body, data=None):
    """Manda push para TODOS os devices do usuário. Nunca levanta.

    Devolve a lista de tokens que a Expo aceitou para entrega — não confirma
    que o device recebeu (a Expo entrega o "recibo" depois, num endpoint
    separado que esta fundação não implementa; ver nota de fase futura no
    fim do arquivo). É o suficiente para saber se a CHAMADA funcionou.

    `data` vai no payload como está — cabe ao chamador mandar algo
    serializável em JSON.
    """
    tokens = list(DeviceToken.objects.filter(user=user).values_list("token", flat=True))
    if not tokens:
        return []

    mensagens = [
        {"to": token, "title": title, "body": body, "data": data or {}}
        for token in tokens
    ]

    aceitos = []
    for inicio in range(0, len(mensagens), EXPO_BATCH_LIMIT):
        lote = mensagens[inicio : inicio + EXPO_BATCH_LIMIT]
        try:
            response = requests.post(
                EXPO_PUSH_URL,
                json=lote,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                timeout=getattr(settings, "PUSH_TIMEOUT_S", 10),
            )
        except requests.RequestException:
            logger.warning("[push] falha de rede ao chamar a Expo", exc_info=True)
            continue

        if response.status_code >= 400:
            logger.warning(
                "[push] Expo respondeu %s: %s",
                response.status_code,
                response.text[:500],
            )
            continue

        try:
            resultado = response.json()
        except ValueError:
            logger.warning("[push] resposta da Expo não é JSON válido")
            continue

        # Formato da Expo: {"data": [{"status": "ok"|"error", ...}, ...]},
        # um item por mensagem do lote, na MESMA ordem.
        itens = (resultado or {}).get("data") or []
        for token, item in zip([m["to"] for m in lote], itens):
            if isinstance(item, dict) and item.get("status") == "ok":
                aceitos.append(token)
            else:
                logger.warning("[push] Expo recusou um token: %s", item)

    return aceitos


# FASE FUTURA (fora desta fundação): a Expo devolve um `id` de recibo por
# mensagem aceita, e um segundo endpoint (`/--/api/v2/push/getReceipts`)
# informa depois se o push de fato chegou ou falhou (token inválido,
# desinstalado). Quando uma feature precisar confiar em entrega — e não só
# em "a chamada não deu erro" — é ali que a poda de DeviceToken morto entra.
