"""Leitura de variáveis de ambiente com o mesmo contrato dos outros serviços.

Existe por causa de um bug real: `POST_GAME_ANALYSIS_ENABLED` era comparado
com `"True"` aqui e com `"true"` no node-api. A MESMA variável, setada com o
mesmo valor nos dois serviços do Easypanel, ligava um lado e deixava o outro
desligado — sem erro, sem log, sem 500. Ver `parseBooleanFlag` em
node-api/src/services/analysisQueue.js, que agora aceita exatamente o mesmo
conjunto.
"""

import os

# Deliberadamente estreito. "1"/"yes"/"on" ficam de fora: quanto mais formas
# de dizer sim, mais formas de um valor errado parecer certo — e o contrato
# precisa caber na cabeça de quem digita no painel do Easypanel.
_TRUE_VALUES = frozenset({"true"})


def env_bool(name, default=False):
    """True/False a partir de uma env var, sem diferenciar maiúsculas.

    `TRUE`, `True` e `true` valem o mesmo; espaços em volta são ignorados
    (colar valor no painel costuma trazer um). Qualquer outra coisa é False —
    inclusive vazio, que é o caso de "a variável existe mas não foi
    preenchida".
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUE_VALUES
