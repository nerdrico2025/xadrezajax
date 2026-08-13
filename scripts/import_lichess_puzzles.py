#!/usr/bin/env python3
"""
Importa um subconjunto de qualidade do banco público de problemas do Lichess
(licença CC0) e gera uma migration Django de seed para o app `puzzles`.

O script NÃO toca no banco: ele só lê o CSV e escreve um arquivo de migration.
Aplicar a migration é um passo separado e manual (`manage.py migrate`).

Uso típico:

    python scripts/import_lichess_puzzles.py \
        --csv scripts/data/lichess_puzzles_completo.csv \
        --out backend/apps/puzzles/migrations/0007_seed_lichess_puzzles.py

Detalhe importante do formato do Lichess (fonte de erro silencioso):
o campo `FEN` é a posição ANTES do lance do adversário. O primeiro lance de
`Moves` é esse lance de preparação; o problema de fato começa DEPOIS dele.
Portanto, para o nosso modelo:

    fen      = FEN + Moves[0] aplicado
    solution = Moves[1:]

Usar o FEN cru deixaria o lado errado no lance e tornaria o primeiro lance da
solução impossível.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import chess
import pandas as pd

# ─────────────────────────── filtros de qualidade ───────────────────────────

# Escala de popularidade do Lichess vai de -100 a 100.
MIN_POPULARITY = 80
MIN_NB_PLAYS = 500

# Temas didáticos desta primeira leva. Um problema precisa ter PELO MENOS um.
DIDACTIC_THEMES = {
    "fork",
    "pin",
    "skewer",
    "discoveredAttack",
    "hangingPiece",
    "mate",
    "mateIn1",
    "mateIn2",
    "backRankMate",
    "doubleCheck",
}

# Temas de estudo de final muito específico — fora desta leva mesmo que o
# problema também carregue um tema didático.
EXCLUDED_THEMES = {
    "rookEndgame",
    "pawnEndgame",
    "queenEndgame",
    "bishopEndgame",
    "knightEndgame",
    "queenRookEndgame",
}

# Guarda didática: mates longos ("mate" cobre até mateIn5+) viram exercícios de
# cálculo, não de reconhecimento de padrão. Conta lances do SOLUCIONADOR.
MAX_SOLUTION_MOVES = 4

# ────────────────────────── níveis de dificuldade ───────────────────────────

# Faixas de rating Lichess → níveis do AJAX. `limite` é o teto exclusivo.
LEVELS = [
    ("beginner", "Iniciante", 1200),
    ("easy", "Fácil", 1600),
    ("medium", "Médio", 2000),
    ("hard", "Difícil", 2400),
    ("master", "Mestre", 10_000),
]

# O modelo Puzzle só aceita easy/medium/hard (e NextPuzzleView filtra
# estritamente por esses três valores), então os 5 níveis do enunciado colapsam
# para os 3 do schema. O rating exato do Lichess é gravado em `rating`, então a
# faixa original continua recuperável sem alterar o modelo.
LEVEL_TO_DIFFICULTY = {
    "beginner": "easy",
    "easy": "easy",
    "medium": "medium",
    "hard": "hard",
    "master": "hard",
}


def level_for_rating(rating: int) -> str:
    for key, _label, ceiling in LEVELS:
        if rating < ceiling:
            return key
    return "master"


# ──────────────────────────── mapa de categorias ────────────────────────────

# Ordem = prioridade. O Lichess marca vários temas por problema; ficamos com o
# mais específico. Só existem as categorias já declaradas em
# Puzzle.CATEGORY_CHOICES — nada de inventar valor novo.
THEME_TO_CATEGORY = [
    ("mateIn1", "mate_in_1"),
    ("mateIn2", "mate_in_2"),
    ("backRankMate", "mate_in_2"),
    ("fork", "fork"),
    ("pin", "pin"),
    ("skewer", "skewer"),
    ("promotion", "promotion"),
    ("underPromotion", "promotion"),
    ("advancedPawn", "promotion"),
    ("doubleCheck", "tactic"),
    ("discoveredAttack", "tactic"),
    ("hangingPiece", "tactic"),
    ("mate", "tactic"),
]

CATEGORY_LABELS = {
    "mate_in_1": "Mate em 1",
    "mate_in_2": "Mate em 2",
    "fork": "Garfo",
    "pin": "Cravada",
    "skewer": "Espeto",
    "promotion": "Promoção",
    "tactic": "Tática",
}

CATEGORY_DESCRIPTIONS = {
    "mate_in_1": "Existe um único lance que encerra a partida. Encontre o mate!",
    "mate_in_2": "O mate está a dois lances. Calcule a resposta do adversário.",
    "fork": "Uma peça ataca dois alvos de uma vez — não dá para salvar os dois.",
    "pin": "Prenda uma peça contra outra mais valiosa: ela não pode sair da linha.",
    "skewer": "Ataque a peça mais valiosa primeiro; ao fugir, ela entrega a de trás.",
    "promotion": "O peão está perto da promoção. Conduza-o e transforme a vantagem.",
    "tactic": "Há um golpe tático escondido nesta posição. Ache o melhor lance!",
}


def category_for_themes(themes: set[str]) -> str:
    for theme, category in THEME_TO_CATEGORY:
        if theme in themes:
            return category
    return "tactic"


# ─────────────────────────────── parsing ────────────────────────────────────

# Este dump traz Themes como lista em repr do Python, separada por espaços:
#   ['crushing' 'hangingPiece' 'long' 'middlegame']
# O dump padrão do Lichess usa string simples separada por espaço. Aceitamos
# as duas formas.
# Os dígitos fazem parte do nome do tema (`mateIn1`, `mateIn2`): um padrão só
# de letras devolveria "mateIn" e nenhum mate seria reconhecido.
_THEME_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9]*")


def parse_themes(raw: object) -> set[str]:
    if not isinstance(raw, str) or not raw:
        return set()
    return set(_THEME_TOKEN.findall(raw))


def load_filtered(csv_path: Path, chunksize: int, max_rows: int | None):
    """Lê o CSV em chunks e devolve (df_filtrado, estatísticas).

    O arquivo tem ~6,4 milhões de linhas (~1 GB), então nada de carregar tudo
    em memória: filtramos chunk a chunk e só concatenamos o que sobrou.
    """
    stats = Counter()
    kept_chunks = []

    reader = pd.read_csv(
        csv_path,
        usecols=[
            "PuzzleId",
            "FEN",
            "Moves",
            "Rating",
            "Popularity",
            "NbPlays",
            "Themes",
        ],
        dtype={
            "PuzzleId": "string",
            "FEN": "string",
            "Moves": "string",
            "Themes": "string",
        },
        chunksize=chunksize,
    )

    for chunk in reader:
        stats["total"] += len(chunk)

        chunk = chunk.dropna(subset=["PuzzleId", "FEN", "Moves", "Rating"])
        numeric = ["Rating", "Popularity", "NbPlays"]
        for col in numeric:
            chunk[col] = pd.to_numeric(chunk[col], errors="coerce")
        chunk = chunk.dropna(subset=numeric)

        quality = chunk[
            (chunk["Popularity"] >= MIN_POPULARITY) & (chunk["NbPlays"] >= MIN_NB_PLAYS)
        ]
        stats["quality"] += len(quality)

        if quality.empty:
            if max_rows and stats["total"] >= max_rows:
                break
            continue

        theme_sets = quality["Themes"].map(parse_themes)
        didactic = theme_sets.map(lambda t: bool(t & DIDACTIC_THEMES))
        clean = theme_sets.map(lambda t: not (t & EXCLUDED_THEMES))

        selected = quality[didactic & clean].copy()
        selected["ThemeSet"] = theme_sets[didactic & clean]
        stats["themes"] += len(selected)

        if not selected.empty:
            kept_chunks.append(selected)

        if max_rows and stats["total"] >= max_rows:
            break

    if not kept_chunks:
        return pd.DataFrame(), stats

    df = pd.concat(kept_chunks, ignore_index=True)
    df["Rating"] = df["Rating"].astype(int)
    df["Level"] = df["Rating"].map(level_for_rating)
    return df, stats


# ────────────────────────────── validação ───────────────────────────────────


def build_puzzle(row) -> tuple[dict | None, str | None]:
    """Valida um problema e devolve (dados, motivo_da_recusa)."""
    moves = str(row.Moves).split()
    if len(moves) < 2:
        return None, "sequência com menos de 2 lances"

    try:
        board = chess.Board(str(row.FEN))
    except ValueError:
        return None, "FEN inválido"

    if not board.is_valid():
        return None, "FEN é posição ilegal"

    # Lance de preparação do adversário: define a posição real do problema.
    try:
        board.push_uci(moves[0])
    except (ValueError, chess.IllegalMoveError):
        return None, "lance de preparação ilegal"

    puzzle_fen = board.fen()
    solution = moves[1:]

    if len(solution) > MAX_SOLUTION_MOVES * 2 - 1:
        return None, "solução longa demais"

    for uci in solution:
        try:
            board.push_uci(uci)
        except (ValueError, chess.IllegalMoveError):
            return None, "lance da solução ilegal"

    themes = row.ThemeSet
    category = category_for_themes(themes)
    level = row.Level
    label = CATEGORY_LABELS[category]

    return {
        "title": f"{label} #{row.PuzzleId}",
        "description": CATEGORY_DESCRIPTIONS[category],
        "fen": puzzle_fen,
        "solution": solution,
        "difficulty": LEVEL_TO_DIFFICULTY[level],
        "category": category,
        "rating": int(row.Rating),
        "_level": level,
    }, None


def sample_balanced(df: pd.DataFrame, target: int, seed: int) -> pd.DataFrame:
    """Cota IGUAL por nível, não proporcional ao dataset.

    Proporcional reproduziria a concentração do Lichess na faixa 1500–2200 —
    exatamente o que o enunciado pede para evitar. Se um nível não tem
    candidatos suficientes, a sobra é redistribuída entre os demais.
    """
    levels = [key for key, _label, _ceiling in LEVELS]
    available = {lv: df[df["Level"] == lv] for lv in levels}

    quotas = {lv: target // len(levels) for lv in levels}
    # Sobra da divisão inteira vai para os níveis com mais candidatos.
    leftover = target - sum(quotas.values())
    for lv in sorted(levels, key=lambda x: -len(available[x]))[:leftover]:
        quotas[lv] += 1

    # Redistribui o que níveis escassos não conseguem preencher.
    for _ in range(len(levels)):
        deficit = 0
        for lv in levels:
            short = quotas[lv] - len(available[lv])
            if short > 0:
                deficit += short
                quotas[lv] = len(available[lv])
        if not deficit:
            break
        expandable = [lv for lv in levels if len(available[lv]) > quotas[lv]]
        if not expandable:
            break
        for i, lv in enumerate(expandable):
            extra = deficit // len(expandable) + (
                1 if i < deficit % len(expandable) else 0
            )
            quotas[lv] = min(len(available[lv]), quotas[lv] + extra)

    parts = []
    for lv in levels:
        pool = available[lv]
        n = min(quotas[lv], len(pool))
        if n:
            parts.append(pool.sample(n=n, random_state=seed))
    if not parts:
        return pd.DataFrame()
    return pd.concat(parts, ignore_index=True)


# ─────────────────────────── geração da migration ───────────────────────────

MIGRATION_TEMPLATE = """from django.db import migrations

# Problemas importados do banco público do Lichess (https://database.lichess.org/
# #puzzles), distribuído sob licença CC0 (domínio público).
#
# Gerado por scripts/import_lichess_puzzles.py — não editar à mão; reexecutar o
# script e substituir este arquivo.
#
# Filtros aplicados: Popularity >= {min_popularity}, NbPlays >= {min_nb_plays},
# pelo menos um tema didático, sem temas de final específico, e solução de no
# máximo {max_moves} lances do solucionador. Temas aceitos:
# {didactic}.
# Cada posição e cada lance foram revalidados com python-chess antes de entrar
# aqui.
#
# `fen` já é a posição EM QUE O JOGADOR MOVE: o lance de preparação do
# adversário (primeiro lance do campo Moves do Lichess) já está aplicado, e
# `solution` começa no lance do solucionador — mesma convenção da 0002.

PUZZLES = [
{rows}
]


def seed_puzzles(apps, schema_editor):
    Puzzle = apps.get_model("puzzles", "Puzzle")
    existing = set(
        Puzzle.objects.filter(title__in=[p["title"] for p in PUZZLES]).values_list(
            "title", flat=True
        )
    )
    novos = [Puzzle(**data) for data in PUZZLES if data["title"] not in existing]
    Puzzle.objects.bulk_create(novos, batch_size=200)


def unseed_puzzles(apps, schema_editor):
    Puzzle = apps.get_model("puzzles", "Puzzle")
    Puzzle.objects.filter(title__in=[p["title"] for p in PUZZLES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("puzzles", "{dependency}"),
    ]

    operations = [
        migrations.RunPython(seed_puzzles, reverse_code=unseed_puzzles),
    ]
"""


def literal(value) -> str:
    """Literal Python no estilo do black: aspas DUPLAS.

    `repr()` devolve aspas simples, e a CI roda `black --check backend/` — que,
    ao contrário do flake8, não exclui `migrations/`. Gerar com repr fazia a
    migration inteira falhar no lint. `ensure_ascii=False` preserva os
    acentos das descrições em vez de virar `\\uXXXX`.
    """
    return json.dumps(value, ensure_ascii=False)


def render_row(data: dict) -> str:
    return (
        "    {\n"
        f'        "title": {literal(data["title"])},\n'
        f'        "description": {literal(data["description"])},\n'
        f'        "fen": {literal(data["fen"])},\n'
        f'        "solution": {literal(data["solution"])},\n'
        f'        "difficulty": {literal(data["difficulty"])},\n'
        f'        "category": {literal(data["category"])},\n'
        f'        "rating": {data["rating"]:d},\n'
        "    },"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--target", type=int, default=900)
    parser.add_argument("--seed", type=int, default=20260813)
    parser.add_argument("--chunksize", type=int, default=250_000)
    parser.add_argument(
        "--max-rows",
        type=int,
        default=None,
        help="Só para teste rápido: para de ler depois de N linhas.",
    )
    parser.add_argument(
        "--dependency", default="0006_userpuzzleprogress_daily_solved_date"
    )
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"ERRO: CSV não encontrado em {args.csv}", file=sys.stderr)
        return 1

    random.seed(args.seed)

    print(f"Lendo {args.csv} em chunks de {args.chunksize:,}…")
    df, stats = load_filtered(args.csv, args.chunksize, args.max_rows)

    print(f"  Problemas no arquivo original ...... {stats['total']:,}")
    print(
        f"  Passaram no filtro de qualidade .... {stats['quality']:,} "
        f"(Popularity>={MIN_POPULARITY}, NbPlays>={MIN_NB_PLAYS})"
    )
    print(f"  Após o filtro de temas ............. {stats['themes']:,}")

    if df.empty:
        print("ERRO: nada sobrou após os filtros.", file=sys.stderr)
        return 1

    print("\n  Candidatos por nível:")
    for key, label, _ in LEVELS:
        print(f"    {label:<10} {int((df['Level'] == key).sum()):,}")

    # Amostra com folga: parte é descartada na validação, e queremos chegar
    # perto do alvo mesmo assim.
    oversample = min(len(df), int(args.target * 1.5))
    candidates = sample_balanced(df, oversample, args.seed)

    puzzles: list[dict] = []
    rejected = Counter()
    seen_fens: set[str] = set()
    per_level: dict[str, int] = defaultdict(int)
    quota = {key: args.target // len(LEVELS) for key, _l, _c in LEVELS}

    for row in candidates.itertuples():
        data, reason = build_puzzle(row)
        if data is None:
            rejected[reason] += 1
            continue
        if data["fen"] in seen_fens:
            rejected["posição duplicada"] += 1
            continue
        level = data.pop("_level")
        if per_level[level] >= quota[level]:
            continue
        seen_fens.add(data["fen"])
        per_level[level] += 1
        puzzles.append(data)

    print(f"\n  Descartados na validação ........... {sum(rejected.values()):,}")
    for reason, count in rejected.most_common():
        print(f"    {reason}: {count:,}")

    print(f"\n  Entraram na migration .............. {len(puzzles):,}")
    print("\n  Distribuição final por nível:")
    for key, label, _ in LEVELS:
        n = per_level[key]
        mapped = LEVEL_TO_DIFFICULTY[key]
        print(f"    {label:<10} {n:>4}  (difficulty={mapped})")

    print("\n  Distribuição por categoria:")
    for category, count in Counter(p["category"] for p in puzzles).most_common():
        print(f"    {CATEGORY_LABELS[category]:<12} {count:>4}")

    puzzles.sort(key=lambda p: (p["rating"], p["title"]))

    rows = "\n".join(render_row(p) for p in puzzles)
    content = MIGRATION_TEMPLATE.format(
        rows=rows,
        dependency=args.dependency,
        min_popularity=MIN_POPULARITY,
        min_nb_plays=MIN_NB_PLAYS,
        didactic=", ".join(sorted(DIDACTIC_THEMES)),
        max_moves=MAX_SOLUTION_MOVES,
    )
    args.out.write_text(content, encoding="utf-8")
    print(f"\n  Migration escrita em {args.out}")

    print("\n  Amostra de 5 problemas:")
    for p in random.sample(puzzles, min(5, len(puzzles))):
        print(f"    - {p['title']} [{p['difficulty']}, rating {p['rating']}]")
        print(f"      FEN: {p['fen']}")
        print(f"      Solução: {' '.join(p['solution'])}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
