from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.payments.access import (
    can_play_daily_puzzle,
    can_train_puzzles,
    has_paid_access,
)
from apps.users.models import get_or_create_profile

from .models import (
    DAILY_PUZZLE_MAX_ATTEMPTS,
    Puzzle,
    UserPuzzleProgress,
    get_daily_puzzle,
)

# Modelo de produto (redesenho de 2026-07-21):
#   - Problema do dia (`daily/`): 1 por dia, o MESMO para todos, grátis;
#     4 tentativas, esgotou vale até a virada do dia.
#   - Treino (`next/`, `map/`, `<pk>/`): problemas além do diário, exclusivo
#     do plano pago, sem limite de tentativas por problema.


def _premium_required_response():
    return Response(
        {
            "detail": (
                "O Treino é exclusivo do plano Premium. "
                "O Problema do dia continua grátis, todo dia."
            ),
            "code": "training_requires_premium",
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _current_streak(user):
    """Dias consecutivos com pelo menos um problema resolvido, terminando hoje
    ou ontem (o streak de hoje ainda não foi 'quebrado' se o dia não acabou)."""
    solved_dates = set(
        UserPuzzleProgress.objects.filter(
            user=user, solved=True, solved_at__isnull=False
        ).values_list("solved_at__date", flat=True)
    )
    today = timezone.localdate()
    day = today if today in solved_dates else today - timedelta(days=1)
    streak = 0
    while day in solved_dates:
        streak += 1
        day -= timedelta(days=1)
    return streak


def _puzzle_payload(puzzle, *, include_solution=True):
    data = {
        "id": puzzle.id,
        "title": puzzle.title,
        "description": puzzle.description,
        "fen": puzzle.fen,
        "difficulty": puzzle.difficulty,
        "category": puzzle.category,
        "rating": puzzle.rating,
    }
    if include_solution:
        data["solution"] = puzzle.solution
    return data


class DailyPuzzleView(APIView):
    """
    GET /api/v1/puzzles/daily/
    Problema do dia — o mesmo para todos, grátis para todos (sem gating).
    Devolve também o estado do usuário nele: resolvido, esgotado, e quantas
    das tentativas do dia já foram gastas.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_or_create_profile(request.user)
        # Sempre True hoje; a chamada existe para que a regra do diário passe
        # pelo mesmo lugar das demais regras de plano.
        if not can_play_daily_puzzle(profile):  # pragma: no cover
            return _premium_required_response()

        puzzle = get_daily_puzzle()
        if not puzzle:
            return Response(
                {"detail": "Nenhum problema disponível."},
                status=status.HTTP_404_NOT_FOUND,
            )

        progress = UserPuzzleProgress.objects.filter(
            user=request.user, puzzle=puzzle
        ).first()
        exhausted = bool(progress and progress.is_exhausted_today())
        solved = bool(progress and progress.solved)
        attempts_used = progress.attempts_used_today() if progress else 0

        # A solução acompanha o payload porque a validação de lance é feita no
        # cliente (ver PuzzleScreen). Quem decide MOSTRAR a solução ao usuário
        # é a tela — só ao resolver ou ao esgotar (decisão de produto). No
        # esgotamento ela é revelada de propósito, como aprendizado; por isso
        # o reabrir de um diário esgotado precisa dela aqui também.
        payload = _puzzle_payload(puzzle)
        payload.update(
            {
                "already_solved": solved,
                "exhausted": exhausted,
                "attempts_used": attempts_used,
                "max_attempts": DAILY_PUZZLE_MAX_ATTEMPTS,
                "attempts_left": max(0, DAILY_PUZZLE_MAX_ATTEMPTS - attempts_used),
            }
        )
        return Response(payload)


class PuzzleMapView(APIView):
    """
    GET /api/v1/puzzles/map/
    Mapa de problemas do Treino — exclusivo do plano pago.

    Antes do redesenho este endpoint não tinha gating nenhum e devolvia o
    banco inteiro a qualquer autenticado.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_or_create_profile(request.user)
        if not can_train_puzzles(profile):
            return _premium_required_response()

        puzzles = list(Puzzle.objects.filter(is_active=True).order_by("rating", "id"))
        progress_map = {
            p.puzzle_id: p for p in UserPuzzleProgress.objects.filter(user=request.user)
        }

        first_unsolved_found = False
        result = []
        for puzzle in puzzles:
            prog = progress_map.get(puzzle.id)
            is_solved = bool(prog and prog.solved)
            if not is_solved and not first_unsolved_found:
                is_available = True
                first_unsolved_found = True
            else:
                is_available = is_solved
            result.append(
                {
                    "id": puzzle.id,
                    "title": puzzle.title,
                    "category": puzzle.category,
                    "difficulty": puzzle.difficulty,
                    "rating": puzzle.rating,
                    "is_solved": is_solved,
                    "is_available": is_available,
                    "attempts": prog.attempts if prog else 0,
                }
            )

        return Response(result)


class PuzzleDetailView(APIView):
    """
    GET /api/v1/puzzles/<pk>/
    Detalhe de um problema (inclui a solução) — exclusivo do plano pago,
    EXCETO quando o problema pedido é o do dia.

    Antes do redesenho não havia gating: qualquer autenticado lia qualquer
    problema com a solução junto.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            puzzle = Puzzle.objects.get(pk=pk, is_active=True)
        except Puzzle.DoesNotExist:
            return Response(
                {"detail": "Problema não encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        profile = get_or_create_profile(request.user)
        daily = get_daily_puzzle()
        is_daily = bool(daily and daily.id == puzzle.id)
        if not is_daily and not can_train_puzzles(profile):
            return _premium_required_response()

        prog = UserPuzzleProgress.objects.filter(
            user=request.user, puzzle=puzzle
        ).first()
        # Solução no payload por causa da validação client-side (mesma razão
        # do daily/); a tela decide quando mostrá-la ao usuário.
        payload = _puzzle_payload(puzzle)
        payload["already_solved"] = bool(prog and prog.solved)
        return Response(payload)


class NextPuzzleView(APIView):
    """
    GET /api/v1/puzzles/next/?difficulty=easy
    Próximo problema do TREINO — exclusivo do plano pago, ilimitado.
    A dificuldade adaptativa por rating vale aqui (diferente do diário, que é
    o mesmo problema para todos).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_or_create_profile(request.user)
        if not can_train_puzzles(profile):
            return _premium_required_response()

        difficulty = request.query_params.get("difficulty")
        solved_ids = UserPuzzleProgress.objects.filter(
            user=request.user, solved=True
        ).values_list("puzzle_id", flat=True)

        qs = Puzzle.objects.filter(is_active=True).exclude(id__in=solved_ids)
        if difficulty in ("easy", "medium", "hard"):
            qs = qs.filter(difficulty=difficulty)

        puzzle = qs.order_by("rating", "id").first()
        if not puzzle:
            # Tudo resolvido na dificuldade pedida — devolve qualquer um para
            # o treino não terminar em tela vazia.
            qs_all = Puzzle.objects.filter(is_active=True)
            if difficulty in ("easy", "medium", "hard"):
                qs_all = qs_all.filter(difficulty=difficulty)
            puzzle = qs_all.order_by("?").first()

        if not puzzle:
            return Response(
                {"detail": "Nenhum problema disponível."},
                status=status.HTTP_404_NOT_FOUND,
            )

        progress = UserPuzzleProgress.objects.filter(
            user=request.user, puzzle=puzzle
        ).first()
        payload = _puzzle_payload(puzzle)
        payload["already_solved"] = progress.solved if progress else False
        return Response(payload)


class PuzzleProgressView(APIView):
    """
    POST /api/v1/puzzles/{pk}/progress/
    Body: { "solved": bool, "attempts": int }

    ⚠️ PONTO CRÍTICO DE GATING ⚠️
    Este endpoint recebe só um `pk` e precisa decidir se aquilo é o Problema
    do dia (livre para todos) ou Treino (exige plano pago). A decisão é feita
    comparando o `pk` com o problema do dia do servidor — NUNCA confiando no
    cliente informar o modo. Errar aqui tem dois lados:
      - bloquear demais → o usuário grátis resolve o diário e não consegue
        registrar (tranca o produto grátis);
      - liberar demais → registra progresso de problema pago.

    O carimbo de esgotamento também é do servidor: o cliente reporta a falha,
    quem conta e decide que acabou é aqui.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            puzzle = Puzzle.objects.get(id=pk, is_active=True)
        except Puzzle.DoesNotExist:
            return Response(
                {"detail": "Problema não encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        profile = get_or_create_profile(request.user)
        daily = get_daily_puzzle()
        is_daily = bool(daily and daily.id == puzzle.id)
        if not is_daily and not can_train_puzzles(profile):
            return _premium_required_response()

        solved = bool(request.data.get("solved", False))
        attempts = max(1, int(request.data.get("attempts", 1)))
        today = timezone.localdate()

        progress, _created = UserPuzzleProgress.objects.get_or_create(
            user=request.user, puzzle=puzzle
        )

        if is_daily and progress.is_exhausted_today():
            # Já esgotou hoje: nada muda, nem solve tardio conta. A solução vai
            # na resposta (estado terminal) — reabrir esgotado revela o lance.
            return Response(self._state(progress, puzzle, is_daily, today))

        progress.attempts += attempts

        if is_daily:
            # Reinicia a contagem quando o carimbo é de outro dia (o mesmo
            # problema pode voltar a ser o do dia num ciclo futuro).
            if progress.daily_attempts_date != today:
                progress.daily_attempts = 0
                progress.daily_attempts_date = today
            if not solved:
                progress.daily_attempts += 1
                if progress.daily_attempts >= DAILY_PUZZLE_MAX_ATTEMPTS:
                    progress.exhausted_at = timezone.now()

        if solved and not progress.solved:
            progress.solved = True
            progress.solved_at = timezone.now()

        progress.save()
        return Response(self._state(progress, puzzle, is_daily, today))

    def _state(self, progress, puzzle, is_daily, today):
        data = {
            "puzzle_id": progress.puzzle_id,
            "solved": progress.solved,
            "attempts": progress.attempts,
            "mode": "daily" if is_daily else "training",
        }
        exhausted = is_daily and progress.is_exhausted_today(today)
        if is_daily:
            used = progress.attempts_used_today(today)
            data.update(
                {
                    "attempts_used": used,
                    "max_attempts": DAILY_PUZZLE_MAX_ATTEMPTS,
                    "attempts_left": max(0, DAILY_PUZZLE_MAX_ATTEMPTS - used),
                    "exhausted": exhausted,
                }
            )
        # Revela a solução SÓ no estado terminal: ao resolver (revisão) ou ao
        # esgotar as tentativas do diário (aprendizado). Antes disso, a
        # resposta do progress/ nunca a inclui — é o canal onde a garantia
        # "não antes de resolver/esgotar" é observável e testável (a validação
        # em si usa a solução que o daily/ já entregou ao cliente).
        if progress.solved or exhausted:
            data["solution"] = puzzle.solution
        return data


class PuzzleStatsView(APIView):
    """
    GET /api/v1/puzzles/stats/
    Estatísticas do usuário + estado do Problema do dia e acesso ao Treino.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        progress_qs = UserPuzzleProgress.objects.filter(user=request.user)
        solved = progress_qs.filter(solved=True).count()
        total = Puzzle.objects.filter(is_active=True).count()
        attempts = progress_qs.aggregate(total=Sum("attempts"))["total"] or 0

        profile = get_or_create_profile(request.user)
        paid = has_paid_access(profile)

        daily = get_daily_puzzle()
        daily_progress = (
            UserPuzzleProgress.objects.filter(user=request.user, puzzle=daily).first()
            if daily
            else None
        )
        daily_solved = bool(daily_progress and daily_progress.solved)
        daily_exhausted = bool(daily_progress and daily_progress.is_exhausted_today())

        return Response(
            {
                "solved": solved,
                "total": total,
                "attempts": attempts,
                "streak": _current_streak(request.user),
                # Estado do Problema do dia (grátis para todos)
                "daily_available": bool(daily)
                and not daily_solved
                and not daily_exhausted,
                "daily_solved": daily_solved,
                "daily_exhausted": daily_exhausted,
                "daily_max_attempts": DAILY_PUZZLE_MAX_ATTEMPTS,
                # Acesso ao Treino (exclusivo do plano pago)
                "training_unlocked": paid,
            }
        )
