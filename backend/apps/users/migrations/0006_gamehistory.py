from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0005_friendship"),
    ]

    operations = [
        migrations.CreateModel(
            name="GameHistory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("opponent_name", models.CharField(blank=True, default="", max_length=150)),
                ("result", models.CharField(
                    choices=[("win", "Vitória"), ("loss", "Derrota"), ("draw", "Empate")],
                    max_length=4,
                )),
                ("mode", models.CharField(
                    choices=[("ai", "vs IA"), ("online", "Online")],
                    max_length=6,
                )),
                ("rating_before", models.IntegerField()),
                ("rating_after", models.IntegerField()),
                ("played_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="game_history",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "verbose_name": "Histórico de partida",
                "verbose_name_plural": "Histórico de partidas",
                "ordering": ["-played_at"],
            },
        ),
    ]
