from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Puzzle, UserPuzzleProgress


class PuzzleMapView(APIView):
    """
    GET /api/v1/puzzles/map/
    Returns all puzzles ordered by rating with solved/available status per user.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
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
    Returns full puzzle data for a specific puzzle by ID.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            puzzle = Puzzle.objects.get(pk=pk, is_active=True)
        except Puzzle.DoesNotExist:
            return Response(
                {"detail": "Puzzle não encontrado."}, status=status.HTTP_404_NOT_FOUND
            )

        prog = UserPuzzleProgress.objects.filter(
            user=request.user, puzzle=puzzle
        ).first()
        return Response(
            {
                "id": puzzle.id,
                "title": puzzle.title,
                "description": puzzle.description,
                "fen": puzzle.fen,
                "solution": puzzle.solution,
                "difficulty": puzzle.difficulty,
                "category": puzzle.category,
                "rating": puzzle.rating,
                "already_solved": bool(prog and prog.solved),
            }
        )


class NextPuzzleView(APIView):
    """
    GET /api/v1/puzzles/next/?difficulty=easy
    Returns the next unsolved puzzle for the authenticated user.
    Query param `difficulty` is optional (easy/medium/hard).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        difficulty = request.query_params.get("difficulty")
        solved_ids = UserPuzzleProgress.objects.filter(
            user=request.user, solved=True
        ).values_list("puzzle_id", flat=True)

        qs = Puzzle.objects.filter(is_active=True).exclude(id__in=solved_ids)
        if difficulty in ("easy", "medium", "hard"):
            qs = qs.filter(difficulty=difficulty)

        puzzle = qs.order_by("rating", "id").first()
        if not puzzle:
            # All puzzles solved — return any random puzzle
            qs_all = Puzzle.objects.filter(is_active=True)
            if difficulty in ("easy", "medium", "hard"):
                qs_all = qs_all.filter(difficulty=difficulty)
            puzzle = qs_all.order_by("?").first()

        if not puzzle:
            return Response(
                {"detail": "Nenhum puzzle disponível."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if user has an existing progress entry
        progress = UserPuzzleProgress.objects.filter(
            user=request.user, puzzle=puzzle
        ).first()

        return Response(
            {
                "id": puzzle.id,
                "title": puzzle.title,
                "description": puzzle.description,
                "fen": puzzle.fen,
                "solution": puzzle.solution,
                "difficulty": puzzle.difficulty,
                "category": puzzle.category,
                "rating": puzzle.rating,
                "already_solved": progress.solved if progress else False,
            }
        )


class PuzzleProgressView(APIView):
    """
    POST /api/v1/puzzles/{pk}/progress/
    Body: { "solved": true, "attempts": 3 }
    Records or updates the user's attempt on a puzzle.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            puzzle = Puzzle.objects.get(id=pk, is_active=True)
        except Puzzle.DoesNotExist:
            return Response(
                {"detail": "Puzzle não encontrado."}, status=status.HTTP_404_NOT_FOUND
            )

        solved = bool(request.data.get("solved", False))
        attempts = max(1, int(request.data.get("attempts", 1)))

        progress, created = UserPuzzleProgress.objects.get_or_create(
            user=request.user,
            puzzle=puzzle,
            defaults={"solved": solved, "attempts": attempts},
        )

        if not created:
            progress.attempts += attempts
            if solved and not progress.solved:
                progress.solved = True
                progress.solved_at = timezone.now()
            progress.save(update_fields=["attempts", "solved", "solved_at"])

        elif solved:
            progress.solved_at = timezone.now()
            progress.save(update_fields=["solved_at"])

        return Response(
            {
                "puzzle_id": puzzle.id,
                "solved": progress.solved,
                "attempts": progress.attempts,
            }
        )


class PuzzleStatsView(APIView):
    """
    GET /api/v1/puzzles/stats/
    Returns the user's overall puzzle stats.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        progress_qs = UserPuzzleProgress.objects.filter(user=request.user)
        solved = progress_qs.filter(solved=True).count()
        total = Puzzle.objects.filter(is_active=True).count()
        attempts = progress_qs.aggregate(total=Sum("attempts"))["total"] or 0

        return Response(
            {
                "solved": solved,
                "total": total,
                "attempts": attempts,
            }
        )
