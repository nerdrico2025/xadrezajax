"""
Comentário humanizado da partida (Fase 3) — montagem do prompt, chamada ao
provedor e validação da resposta.

Isolado das views de propósito: nada aqui toca request/response, e a montagem
do digest é uma função PURA. É o que permite testar o prompt inteiro com uma
fixture fixa, sem rede e sem chave de API — que é o único jeito de um teste de
prompt ser determinístico.

Nada neste módulo levanta para o chamador: `generate_feedback` traduz TODA
falha (rede, HTTP, JSON, schema) em `status=erro` com um motivo curto, porque
falha de provedor não pode consumir a cota do usuário (decisão C).
"""

import json
import logging
import time
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings
from django.utils import timezone

from .models import GameLLMFeedback

logger = logging.getLogger(__name__)

# Quantos lances "notáveis" entram no prompt, no máximo. O teto é o que faz o
# custo de uma partida de 150 lances ser praticamente o mesmo de uma de 20:
# sem ele, o digest cresceria com a partida e pagaríamos token por lance de
# rotina — que além de caro, DILUI o que importa no meio do irrelevante.
MAX_NOTABLE_MOVES = 12

# Lances de abertura mostrados para o modelo poder nomear a abertura.
OPENING_PLIES = 8

# Classificações que interessam ao comentário, em ordem de gravidade.
NOTABLE_CLASSIFICATIONS = ("blunder", "mistake")

PT_CLASSIFICATION = {
    "brilliant": "brilhante",
    "best": "melhor",
    "good": "bom",
    "inaccuracy": "imprecisão",
    "mistake": "erro",
    "blunder": "erro grave",
}

PT_RESULT = {
    "white": "vitória das brancas",
    "black": "vitória das pretas",
    "draw": "empate",
}

SYSTEM_PROMPT = """\
Você é um treinador de xadrez de clube comentando a partida de um aluno \
amador. Responda SEMPRE em português do Brasil.

REGRAS OBRIGATÓRIAS:
1. Fale das peças pela COR — "as brancas", "as pretas". NUNCA use "você", \
"seu" ou segunda pessoa: o mesmo comentário é lido pelos DOIS jogadores.
2. Use APENAS os lances e dados fornecidos. Não invente lances, aberturas, \
variantes nem nomes de jogadores.
3. Não cite números de avaliação, "centipawns", "cp" nem profundidade de \
engine. Esses números já aparecem na tela; aqui o que se espera é a \
EXPLICAÇÃO em linguagem de clube.
4. Tom encorajador e concreto. Nada de elogio vazio nem de julgamento duro.
5. Se não houver momento decisivo informado, diga que a partida foi decidida \
aos poucos, sem um lance culpado — e NÃO invente um.

Responda SOMENTE com um objeto JSON, sem cercas de código, com exatamente \
estas quatro chaves de texto:
{"resumo": "...", "abertura": "...", "erro_decisivo": "...", \
"recomendacao": "..."}

- resumo: 1 a 2 frases sobre como a partida foi no geral.
- abertura: como os dois lados saíram da abertura.
- erro_decisivo: o momento que virou a partida, e por quê.
- recomendacao: UMA coisa concreta para treinar depois desta partida.

Cada campo deve ter no máximo 600 caracteres."""


def _side_summary(analysis, side):
    counts = (analysis.counts or {}).get(side, {}) or {}
    parts = []
    for key in ("brilliant", "blunder", "mistake", "inaccuracy"):
        value = counts.get(key)
        if value:
            parts.append(f"{value} {PT_CLASSIFICATION[key]}")
    accuracy = getattr(analysis, f"{side}_accuracy", None)
    return {
        "precisao": round(accuracy, 1) if accuracy is not None else None,
        "perda_media": getattr(analysis, f"{side}_avg_loss", None),
        "contagem": ", ".join(parts) if parts else "nenhum lance problemático",
    }


def _move_line(move):
    """Uma linha de lance no digest. Formato estável — é o que os testes fixam."""
    ply = move.get("ply")
    numero = (ply + 1) // 2 if isinstance(ply, int) else "?"
    cor = "brancas" if isinstance(ply, int) and ply % 2 == 1 else "pretas"
    rotulo = PT_CLASSIFICATION.get(move.get("classification"), "")
    linha = f"lance {numero} ({cor}): {move.get('san') or '?'}"
    if rotulo:
        linha += f" — {rotulo}"
    melhor = move.get("best_move_san")
    if melhor and melhor != move.get("san"):
        linha += f"; melhor era {melhor}"
    return linha


def select_notable_moves(moves, limit=MAX_NOTABLE_MOVES):
    """Os lances que merecem comentário, em ordem DETERMINÍSTICA.

    Todos os `brilliant` primeiro (são raros e o produto os destaca), depois
    os erros ordenados por gravidade. O desempate por `ply` existe para que
    duas execuções com a mesma entrada produzam exatamente a mesma lista —
    sem isso o prompt mudaria entre execuções e nenhum teste seria estável.
    """
    if not isinstance(moves, list):
        return []

    def cp_loss(move):
        value = move.get("cp_loss")
        return value if isinstance(value, int) else 0

    def ply(move):
        value = move.get("ply")
        return value if isinstance(value, int) else 0

    brilliants = [m for m in moves if m.get("classification") == "brilliant"]
    brilliants.sort(key=ply)

    errors = [m for m in moves if m.get("classification") in NOTABLE_CLASSIFICATIONS]
    # Gravidade desc, e ply asc no empate.
    errors.sort(key=lambda m: (-cp_loss(m), ply(m)))

    selected = brilliants[:limit]
    for move in errors:
        if len(selected) >= limit:
            break
        selected.append(move)

    # Ordem cronológica na saída: o comentário narra a partida, não um ranking.
    selected.sort(key=ply)
    return selected


def build_digest(analysis):
    """Resumo textual da análise para o prompt. Função PURA e determinística.

    Recebe um `GameAnalysis` (com `.game` carregado) e devolve string. Não
    manda os até 300 lances: manda cabeçalho, abertura, momento decisivo e no
    máximo `MAX_NOTABLE_MOVES` lances notáveis.
    """
    game = analysis.game
    moves = analysis.moves if isinstance(analysis.moves, list) else []

    white = _side_summary(analysis, "white")
    black = _side_summary(analysis, "black")

    linhas = [
        "DADOS DA PARTIDA",
        f"Resultado: {PT_RESULT.get(game.result, game.result or 'desconhecido')}",
    ]
    if game.termination:
        linhas.append(f"Fim por: {game.termination}")
    linhas.append(f"Total de lances analisados: {analysis.analyzed_plies}")
    if analysis.analyzed_plies < (game.ply_count or 0):
        linhas.append(
            f"(a partida teve {game.ply_count} lances; "
            f"a análise cobriu os {analysis.analyzed_plies} primeiros)"
        )

    for rotulo, resumo in (("Brancas", white), ("Pretas", black)):
        precisao = (
            "sem medição" if resumo["precisao"] is None else f"{resumo['precisao']}%"
        )
        linhas.append(f"{rotulo}: precisão {precisao}; {resumo['contagem']}")

    opening = [m.get("san") or "?" for m in moves[:OPENING_PLIES]]
    if opening:
        linhas += ["", "ABERTURA (primeiros lances)", " ".join(opening)]

    linhas.append("")
    linhas.append("MOMENTO DECISIVO")
    turning = None
    if analysis.turning_point_ply is not None:
        turning = next(
            (m for m in moves if m.get("ply") == analysis.turning_point_ply), None
        )
    if turning is not None:
        linhas.append(_move_line(turning))
    else:
        # Null é resultado LEGÍTIMO (ver comentário no model). Dizer isso ao
        # modelo é o que impede ele de inventar um momento decisivo.
        linhas.append(
            "Não houve um lance decisivo único — a partida foi se definindo aos poucos."
        )

    notable = select_notable_moves(moves)
    if notable:
        linhas += ["", "LANCES NOTÁVEIS"]
        linhas += [_move_line(m) for m in notable]

    return "\n".join(linhas)


def parse_sections(raw_text):
    """Valida a resposta do modelo. Devolve `(sections, erro)`.

    Rejeitar aqui é barato e reversível; gravar `pronto` com conteúdo torto
    seria permanente, porque `pronto` nunca é reivindicado de novo.
    """
    if not raw_text or not raw_text.strip():
        return None, "resposta vazia"

    texto = raw_text.strip()
    # Alguns modelos devolvem o JSON dentro de cerca de código mesmo com
    # response_format pedido. Descascar é mais barato que perder a geração.
    if texto.startswith("```"):
        texto = texto.split("```")[1] if "```" in texto[3:] else texto[3:]
        if texto.startswith("json"):
            texto = texto[4:]
        texto = texto.strip()

    try:
        data = json.loads(texto)
    except (ValueError, TypeError):
        return None, "json invalido"

    if not isinstance(data, dict):
        return None, "json nao e objeto"

    sections = {}
    for key in GameLLMFeedback.REQUIRED_SECTIONS:
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            return None, f"secao ausente: {key}"
        sections[key] = value.strip()[: GameLLMFeedback.MAX_SECTION_CHARS]

    return sections, None


def _extract_usage(payload):
    """Tokens da resposta, DEFENSIVAMENTE.

    O provedor pode renomear ou omitir campos de `usage` sem aviso. Perder a
    métrica de custo é aceitável; perder um comentário já válido por causa
    dela não é — então nada aqui levanta.
    """
    usage = {}
    try:
        raw = payload.get("usage") or {}
        if not isinstance(raw, dict):
            return usage
        for destino, origens in (
            ("prompt_tokens", ("prompt_tokens",)),
            ("completion_tokens", ("completion_tokens",)),
            # O nome do contador de cache varia entre provedores e versões.
            ("cached_tokens", ("prompt_cache_hit_tokens", "cached_tokens")),
        ):
            for origem in origens:
                value = raw.get(origem)
                if isinstance(value, int):
                    usage[destino] = value
                    break
    except Exception:  # noqa: BLE001 - custo nunca derruba o feedback
        logger.warning("[LLM] não foi possível ler `usage` da resposta", exc_info=True)
    return usage


def _estimate_cost(usage):
    """Custo em USD, congelado no momento da gravação.

    TRÊS desfechos, e a diferença entre eles importa para o relatório de gasto:

      - `Decimal("0.000000")` — rodou de graça (modelo `:free`). É INFORMAÇÃO:
        sabemos o consumo e sabemos que o preço é zero.
      - `Decimal(> 0)` — custou isso.
      - `None` — NÃO SABEMOS: ou o provedor não devolveu `usage` legível, ou o
        preço do modelo não está configurado.

    A versão anterior confundia os dois extremos, e de um jeito que só
    apareceria ao migrar de provedor: preço zero devolvia `None` (o modelo de
    graça parecia "custo desconhecido") e `usage` ilegível devolvia zero (o
    desconhecido parecia "não custou nada", somando errado no acumulado).
    """
    # Sem consumo legível não há o que calcular — nem mesmo zero.
    if not usage or ("prompt_tokens" not in usage and "completion_tokens" not in usage):
        return None

    prices = getattr(settings, "LLM_PRICE_PER_MTOK", {}) or {}
    entrada_raw = prices.get("input")
    saida_raw = prices.get("output")
    # Preço desconhecido é diferente de preço zero — ver `env_price`.
    if entrada_raw is None or saida_raw is None:
        return None

    try:
        entrada = Decimal(str(entrada_raw))
        saida = Decimal(str(saida_raw))
        prompt_tokens = Decimal(usage.get("prompt_tokens") or 0)
        completion_tokens = Decimal(usage.get("completion_tokens") or 0)
        milhao = Decimal(1_000_000)
        total = (prompt_tokens / milhao) * entrada + (
            completion_tokens / milhao
        ) * saida
        return total.quantize(Decimal("0.000001"))
    except (InvalidOperation, TypeError, ValueError, ArithmeticError):
        logger.warning("[LLM] não foi possível estimar custo", exc_info=True)
        return None


def completions_url():
    """URL do endpoint, montada a partir da BASE configurada.

    A base vem de `OPENROUTER_BASE_URL` e o caminho é acrescentado aqui — é o
    que deixa a troca de provedor compatível com a OpenAI ser uma mudança de
    variável de ambiente, sem tocar em código.
    """
    base = (getattr(settings, "OPENROUTER_BASE_URL", "") or "").rstrip("/")
    return f"{base}/chat/completions"


def call_llm(digest):
    """Chama o provedor. Devolve `(texto, payload, erro)`.

    Erro é uma string CURTA e estável (cabe em `failure_reason`, e é o que os
    testes verificam) — nunca a exceção crua, que pode carregar a chave de API
    na mensagem.
    """
    api_key = getattr(settings, "OPENROUTER_API_KEY", "")
    if not api_key:
        return None, None, "sem chave de api"

    body = {
        "model": getattr(settings, "OPENROUTER_MODEL", ""),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Comente esta partida em português do Brasil, seguindo as "
                    "regras do sistema. Responda apenas com o objeto JSON.\n\n" + digest
                ),
            },
        ],
        # Pedido em DOIS lugares de propósito: aqui, pelo parâmetro, e no texto
        # do system prompt. O suporte a `response_format` no OpenRouter depende
        # do modelo e do provedor que atender a chamada — os Llama nem sempre
        # honram o parâmetro. Com o pedido também no prompt (e o `parse_sections`
        # descascando cerca de código), o caminho continua funcionando quando o
        # parâmetro é ignorado, em vez de virar `schema_invalido` em série.
        "response_format": {"type": "json_object"},
        # Baixa de propósito: isto é análise, não criatividade. Variação alta
        # aqui vira invenção de lance que não foi jogado.
        "temperature": 0.4,
        "max_tokens": 900,
    }

    try:
        response = requests.post(
            completions_url(),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                # Atribuição no OpenRouter: identificam o app no painel deles
                # e no suporte. Opcionais na API, e inofensivos em qualquer
                # outro provedor compatível.
                "HTTP-Referer": getattr(settings, "OPENROUTER_SITE_URL", ""),
                "X-Title": getattr(settings, "OPENROUTER_APP_NAME", ""),
            },
            json=body,
            timeout=getattr(settings, "LLM_TIMEOUT_S", 45),
        )
    except requests.Timeout:
        return None, None, "timeout"
    except requests.RequestException:
        logger.warning("[LLM] falha de rede ao chamar o provedor", exc_info=True)
        return None, None, "falha de rede"

    if response.status_code == 429:
        return None, None, "http 429 (limite do provedor)"
    if response.status_code >= 400:
        return None, None, f"http {response.status_code}"

    try:
        payload = response.json()
        texto = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        return None, None, "resposta inesperada do provedor"

    return texto, payload, None


def generate_feedback(feedback_id):
    """Gera o comentário de uma linha JÁ REIVINDICADA e persiste o desfecho.

    É o corpo da thread. Recebe só o id (e não o objeto) porque a linha pode
    ter mudado entre a reivindicação e a execução — quem manda é o banco.

    NUNCA levanta: toda falha vira `status=erro` com motivo, e a linha
    continua reivindicável enquanto houver tentativa (decisão C).
    """
    feedback = (
        GameLLMFeedback.objects.select_related("analysis", "analysis__game")
        .filter(pk=feedback_id)
        .first()
    )
    if feedback is None:
        return None

    started = time.monotonic()
    try:
        digest = build_digest(feedback.analysis)
        texto, payload, erro = call_llm(digest)
        if erro:
            return _fail(feedback, erro, started)

        sections, erro = parse_sections(texto)
        if erro:
            # Guarda o cru: sem isto, "schema invalido" é um beco sem saída.
            feedback.raw_response = (texto or "")[:20000]
            return _fail(feedback, erro, started)

        usage = _extract_usage(payload or {})
        feedback.sections = sections
        feedback.raw_response = (texto or "")[:20000]
        feedback.status = GameLLMFeedback.STATUS_DONE
        feedback.model_name = str((payload or {}).get("model") or "")[:60]
        feedback.prompt_tokens = usage.get("prompt_tokens")
        feedback.completion_tokens = usage.get("completion_tokens")
        feedback.cached_tokens = usage.get("cached_tokens")
        feedback.cost_usd = _estimate_cost(usage)
        feedback.latency_ms = int((time.monotonic() - started) * 1000)
        feedback.leased_until = None
        feedback.failure_reason = ""
        feedback.completed_at = timezone.now()
        feedback.save()
        return feedback
    except Exception:  # noqa: BLE001 - a thread não pode morrer calada
        logger.exception("[LLM] erro inesperado ao gerar comentário")
        return _fail(feedback, "erro interno", started)


def _fail(feedback, reason, started):
    feedback.status = GameLLMFeedback.STATUS_FAILED
    feedback.failure_reason = reason[:200]
    feedback.latency_ms = int((time.monotonic() - started) * 1000)
    # Lease liberado na hora: o usuário pode tocar de novo sem esperar vencer.
    feedback.leased_until = None
    feedback.save()
    return feedback
