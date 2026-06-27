from django.db import migrations


PUZZLES = [
    {
        "title": "Mate de Retaguarda",
        "description": "Quando as peças do próprio rei bloqueiam sua fuga, uma torre na última fileira encerra o jogo!",
        "fen": "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
        "solution": ["a1a8"],
        "difficulty": "easy",
        "category": "mate_in_1",
        "rating": 800,
    },
    {
        "title": "Mate do Pastor",
        "description": "Um dos golpes mais conhecidos do xadrez. A dama ataca f7 com o apoio do bispo!",
        "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
        "solution": ["h5f7"],
        "difficulty": "easy",
        "category": "mate_in_1",
        "rating": 900,
    },
    {
        "title": "Xeque-mate de Canto",
        "description": "Torre e rei trabalham juntos para encurralar o rei adversário no canto do tabuleiro.",
        "fen": "7k/6K1/8/8/8/8/8/7R w - - 0 1",
        "solution": ["h1h8"],
        "difficulty": "easy",
        "category": "mate_in_1",
        "rating": 800,
    },
    {
        "title": "Promoção Vitoriosa",
        "description": "Um peão a um passo de se tornar rainha — e de dar xeque-mate!",
        "fen": "7k/5P2/6K1/8/8/8/8/8 w - - 0 1",
        "solution": ["f7f8q"],
        "difficulty": "easy",
        "category": "promotion",
        "rating": 750,
    },
    {
        "title": "Sentinela na 8ª Fileira",
        "description": "A torre domina a última fileira enquanto o rei corta as fugas. Xeque-mate em 1!",
        "fen": "7k/R7/6K1/8/8/8/8/8 w - - 0 1",
        "solution": ["a7a8"],
        "difficulty": "easy",
        "category": "mate_in_1",
        "rating": 800,
    },
    {
        "title": "Garfo de Cavalo",
        "description": "O cavalo é a única peça que pode 'saltar' por cima das outras e atacar duas peças simultaneamente!",
        "fen": "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1",
        "solution": ["d5c7"],
        "difficulty": "medium",
        "category": "fork",
        "rating": 1200,
    },
    {
        "title": "Espeto com Torre",
        "description": "Ataque o rei para forçá-lo a recuar e revelar a torre valiosa atrás dele!",
        "fen": "8/8/8/k2r4/8/8/8/K6R w - - 0 1",
        "solution": ["h1h5", "a5a4", "h5d5"],
        "difficulty": "medium",
        "category": "skewer",
        "rating": 1300,
    },
]


def seed_puzzles(apps, schema_editor):
    Puzzle = apps.get_model("puzzles", "Puzzle")
    for data in PUZZLES:
        Puzzle.objects.get_or_create(
            title=data["title"],
            defaults=data,
        )


def unseed_puzzles(apps, schema_editor):
    Puzzle = apps.get_model("puzzles", "Puzzle")
    Puzzle.objects.filter(title__in=[p["title"] for p in PUZZLES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("puzzles", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_puzzles, reverse_code=unseed_puzzles),
    ]
