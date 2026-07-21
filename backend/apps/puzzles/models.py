from datetime import date as date_type

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

User = get_user_model()

# ⚠️ CARGA DE PROBLEMAS — PENDÊNCIA DE LANÇAMENTO ⚠️
#
# O banco tem apenas 7 problemas (migration 0002_seed_puzzles). A arquitetura
# abaixo funciona igual para 7 ou 700, mas com 7:
#   - o "Problema do dia" repete o ciclo A CADA 7 DIAS;
#   - o "Treino ilimitado", que é o benefício pago, se esgota numa sessão.
#
# TODO(lançamento): carregar um banco de problemas real antes de abrir ao
# público. Decisão de 2026-07-21 (Rafael): não entra nesta rodada, e NÃO
# gerar problemas sintéticos para inflar o número.

# Tentativas do Problema do dia antes de esgotar. Só vale para o diário —
# o Treino é ilimitado por problema (a diferenciação do plano pago é o
# volume de problemas, não a dificuldade de cada tentativa).
DAILY_PUZZLE_MAX_ATTEMPTS = 4


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


class DailyPuzzle(models.Model):
    """
    Problema do dia — o MESMO para todos os usuários, fixado por data.

    Existe como tabela (em vez de só calcular `dias_desde_a_época % total`) para
    ESTABILIDADE: escolhido o problema do dia, ele não muda mais, nem que um
    problema seja adicionado, desativado ou reordenado no meio do dia. Também
    deixa o histórico auditável e abre espaço para curadoria manual no admin
    (basta editar a linha do dia) sem tocar em código.

    on_delete=CASCADE de propósito: apagar um Puzzle apaga a marcação do dia, e
    a próxima requisição escolhe outro — auto-recuperável. PROTECT impediria
    apagar um problema ruim que já tivesse sido o do dia.
    """

    date = models.DateField(unique=True, verbose_name="Data")
    puzzle = models.ForeignKey(
        Puzzle, on_delete=models.CASCADE, related_name="daily_appearances"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        verbose_name = "Problema do dia"
        verbose_name_plural = "Problemas do dia"

    def __str__(self):
        return f"{self.date:%Y-%m-%d} — {self.puzzle.title}"


# Origem da contagem determinística. Mudar esta data desloca a rotação
# inteira — não mexer sem motivo.
DAILY_PUZZLE_EPOCH = date_type(2026, 1, 1)


def get_daily_puzzle(today=None):
    """Problema do dia (o mesmo para todos), criando a marcação na primeira
    requisição do dia. Retorna None se não houver problema ativo no banco.

    O índice é determinístico pela data sobre os problemas ativos ordenados
    por `id` — `id` é imutável, enquanto `rating` é editável e reordenaria a
    fila. Depois de gravado em DailyPuzzle, o cálculo não é refeito.

    NÃO usa a dificuldade adaptativa por rating: sendo o mesmo problema para
    todos, variar por Glicko-2 seria contraditório. A adaptação por rating
    continua valendo apenas no Treino.
    """
    today = today or timezone.localdate()

    existing = DailyPuzzle.objects.filter(date=today).select_related("puzzle").first()
    if existing:
        return existing.puzzle

    active_ids = list(
        Puzzle.objects.filter(is_active=True)
        .order_by("id")
        .values_list("id", flat=True)
    )
    if not active_ids:
        return None

    index = (today - DAILY_PUZZLE_EPOCH).days % len(active_ids)
    daily, _ = DailyPuzzle.objects.get_or_create(
        date=today, defaults={"puzzle_id": active_ids[index]}
    )
    return daily.puzzle


class UserPuzzleProgress(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="puzzle_progress"
    )
    puzzle = models.ForeignKey(
        Puzzle, on_delete=models.CASCADE, related_name="user_progress"
    )
    solved = models.BooleanField(default=False)
    # Total acumulado de tentativas em todas as sessões — alimenta o `stats/`.
    attempts = models.IntegerField(default=0)
    solved_at = models.DateTimeField(null=True, blank=True)
    # Momento em que o usuário gastou as tentativas do dia neste problema.
    # Carimbado SEMPRE pelo servidor (nunca pelo cliente) e comparado por data:
    # na virada do dia o esgotamento deixa de valer sozinho, sem job de limpeza.
    exhausted_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Tentativas esgotadas em"
    )
    # Tentativas gastas no Problema do dia, com a data a que se referem. Sem
    # esses dois campos o contador viveria só na memória do app e fechar/abrir
    # zeraria as tentativas — o limite de 4 nunca seria atingido. `attempts`
    # acima não serve para isso: é acumulativo e sem data, então um problema
    # que reaparece num ciclo futuro já começaria com tentativas gastas.
    daily_attempts = models.PositiveSmallIntegerField(
        default=0, verbose_name="Tentativas de hoje"
    )
    daily_attempts_date = models.DateField(
        null=True, blank=True, verbose_name="Data das tentativas"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "puzzle")
        verbose_name = "Progresso de Problema"
        verbose_name_plural = "Progressos de Problema"

    def is_exhausted_today(self, today=None):
        """True se as tentativas deste problema se esgotaram HOJE."""
        if not self.exhausted_at:
            return False
        today = today or timezone.localdate()
        return timezone.localtime(self.exhausted_at).date() == today

    def attempts_used_today(self, today=None):
        """Tentativas já gastas hoje — zero se o carimbo é de outro dia."""
        today = today or timezone.localdate()
        return self.daily_attempts if self.daily_attempts_date == today else 0

    def __str__(self):
        status = "✓" if self.solved else "✗"
        return f"{status} {self.user.email} — {self.puzzle.title}"
