from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Puzzle",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False
                    ),
                ),
                ("title", models.CharField(max_length=100)),
                ("description", models.TextField(blank=True, default="")),
                ("fen", models.CharField(max_length=200)),
                ("solution", models.JSONField()),
                (
                    "difficulty",
                    models.CharField(
                        choices=[
                            ("easy", "Fácil"),
                            ("medium", "Médio"),
                            ("hard", "Difícil"),
                        ],
                        default="medium",
                        max_length=10,
                    ),
                ),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("mate_in_1", "Mate em 1"),
                            ("mate_in_2", "Mate em 2"),
                            ("fork", "Garfo"),
                            ("pin", "Cravada"),
                            ("skewer", "Espeto"),
                            ("promotion", "Promoção"),
                            ("tactic", "Tática"),
                            ("endgame", "Final"),
                        ],
                        default="tactic",
                        max_length=20,
                    ),
                ),
                ("rating", models.IntegerField(default=1200)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "Puzzle",
                "verbose_name_plural": "Puzzles",
                "ordering": ["rating", "id"],
            },
        ),
        migrations.CreateModel(
            name="UserPuzzleProgress",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False
                    ),
                ),
                ("solved", models.BooleanField(default=False)),
                ("attempts", models.IntegerField(default=0)),
                ("solved_at", models.DateTimeField(null=True, blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "puzzle",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="user_progress",
                        to="puzzles.puzzle",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="puzzle_progress",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Progresso de Puzzle",
                "verbose_name_plural": "Progressos de Puzzle",
                "unique_together": {("user", "puzzle")},
            },
        ),
    ]
