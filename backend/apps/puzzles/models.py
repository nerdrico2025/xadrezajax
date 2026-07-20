from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Puzzle(models.Model):
    DIFFICULTY_EASY = "easy"
    DIFFICULTY_MEDIUM = "medium"
    DIFFICULTY_HARD = "hard"
    DIFFICULTY_CHOICES = [
        ("easy", "Fácil"),
        ("medium", "Médio"),
        ("hard", "Difícil"),
    ]

    CATEGORY_CHOICES = [
        ("mate_in_1", "Mate em 1"),
        ("mate_in_2", "Mate em 2"),
        ("fork", "Garfo"),
        ("pin", "Cravada"),
        ("skewer", "Espeto"),
        ("promotion", "Promoção"),
        ("tactic", "Tática"),
        ("endgame", "Final"),
    ]

    title = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    fen = models.CharField(max_length=200)
    solution = models.JSONField()  # list of UCI strings: ["e2e4", "e7e5", ...]
    difficulty = models.CharField(
        max_length=10, choices=DIFFICULTY_CHOICES, default=DIFFICULTY_MEDIUM
    )
    category = models.CharField(
        max_length=20, choices=CATEGORY_CHOICES, default="tactic"
    )
    rating = models.IntegerField(default=1200)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Problema"
        verbose_name_plural = "Problemas"
        ordering = ["rating", "id"]

    def __str__(self):
        return f"[{self.difficulty}] {self.title}"


class UserPuzzleProgress(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="puzzle_progress"
    )
    puzzle = models.ForeignKey(
        Puzzle, on_delete=models.CASCADE, related_name="user_progress"
    )
    solved = models.BooleanField(default=False)
    attempts = models.IntegerField(default=0)
    solved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "puzzle")
        verbose_name = "Progresso de Problema"
        verbose_name_plural = "Progressos de Problema"

    def __str__(self):
        status = "✓" if self.solved else "✗"
        return f"{status} {self.user.email} — {self.puzzle.title}"
