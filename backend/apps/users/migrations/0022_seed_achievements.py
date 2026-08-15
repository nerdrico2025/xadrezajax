from django.db import migrations

# Primeiro corte de conquistas (lista fechada).
#
# O LIMIAR MORA AQUI, EM DADO — não em constante de código. É o ponto do
# desenho: acrescentar "100 partidas" amanhã é INSERIR UMA LINHA, sem
# migration e sem deploy, porque `games_played` já existe como regra.
#
# Repare que 3 e 4 (`games_10` e `games_50`) compartilham o mesmo `rule_type`
# e diferem só no `params` — são 7 conquistas sobre 6 regras.
#
# `code` é a identidade estável: o app casa ícone e texto por ele. Nome e
# descrição podem ser reescritos depois sem quebrar cliente nenhum.
ACHIEVEMENTS = [
    {
        "code": "first_win",
        "name": "Primeira vitória",
        "description": "Vença a sua primeira partida, contra a IA ou contra gente.",
        "icon": "trophy-outline",
        "category": "partidas",
        "trigger": "game_finished",
        "rule_type": "win_count",
        "params": {"threshold": 1},
        "order": 10,
    },
    {
        "code": "first_rated_win",
        "name": "Valeu rating",
        "description": "Vença uma partida contra outra pessoa valendo rating.",
        "icon": "ribbon-outline",
        "category": "partidas",
        "trigger": "game_finished",
        "rule_type": "rated_win_count",
        "params": {"threshold": 1},
        "order": 20,
    },
    {
        "code": "games_10",
        "name": "Dez partidas",
        "description": "Jogue 10 partidas, com qualquer resultado.",
        "icon": "grid-outline",
        "category": "partidas",
        "trigger": "game_finished",
        "rule_type": "games_played",
        "params": {"threshold": 10},
        "order": 30,
    },
    {
        "code": "games_50",
        "name": "Cinquenta partidas",
        "description": "Jogue 50 partidas. O tabuleiro já é a sua casa.",
        "icon": "layers-outline",
        "category": "partidas",
        "trigger": "game_finished",
        "rule_type": "games_played",
        "params": {"threshold": 50},
        "order": 40,
    },
    {
        "code": "win_streak_3",
        "name": "Três seguidas",
        "description": "Vença 3 partidas seguidas, sem perder nem empatar no meio.",
        "icon": "flame-outline",
        "category": "partidas",
        "trigger": "game_finished",
        "rule_type": "win_streak",
        "params": {"threshold": 3},
        "order": 50,
    },
    {
        "code": "fast_mate_10",
        "name": "Mate relâmpago",
        "description": "Dê xeque-mate em 10 lances ou menos.",
        "icon": "flash-outline",
        "category": "partidas",
        "trigger": "game_finished",
        # 10 lances de cada lado = 20 meios-lances (plies), que é a unidade
        # de `Game.ply_count`.
        "rule_type": "fast_checkmate",
        "params": {"max_plies": 20},
        "order": 60,
    },
    {
        "code": "puzzle_streak_7",
        "name": "Sete dias de problema",
        "description": "Resolva problemas em 7 dias seguidos.",
        "icon": "extension-puzzle-outline",
        "category": "puzzles",
        "trigger": "puzzle_solved",
        "rule_type": "puzzle_streak",
        "params": {"threshold": 7},
        "order": 70,
    },
]


def seed(apps, schema_editor):
    AchievementDefinition = apps.get_model("users", "AchievementDefinition")
    for data in ACHIEVEMENTS:
        # `get_or_create` por `code`: reaplicar a migration não duplica, e
        # uma definição já editada no admin não é sobrescrita.
        AchievementDefinition.objects.get_or_create(code=data["code"], defaults=data)


def unseed(apps, schema_editor):
    """Remove só as definições que NINGUÉM conquistou.

    `UserAchievement.achievement` é PROTECT: apagar uma definição já
    conquistada levantaria e, pior, apagaria a conquista de alguém. Reverter
    esta migration é uma operação de limpeza, não de destruição de histórico.
    """
    AchievementDefinition = apps.get_model("users", "AchievementDefinition")
    UserAchievement = apps.get_model("users", "UserAchievement")

    em_uso = set(UserAchievement.objects.values_list("achievement_id", flat=True))
    AchievementDefinition.objects.filter(
        code__in=[a["code"] for a in ACHIEVEMENTS]
    ).exclude(id__in=em_uso).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0021_gamehistory_user_played_at_index"),
    ]

    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
