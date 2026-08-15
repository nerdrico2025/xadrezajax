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


def _puzzle_payload(puzzle, *, include_solution=False):
    """Payload de um problema. `include_solution` é OPT-IN de propósito.

    O default era `True`, e os três endpoints que servem problema chamavam sem
    argumento — ou seja, a solução ia em texto plano no GET, antes de qualquer
    tentativa. Bastava ler a resposta do `daily/` para ter o lance.

    Quem decide revelar é `_solution_revealed()`; um default `False` garante
    que um call site novo erre para o lado seguro.
    """
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


def _normalize_uci(move):
    """Normaliza um lance UCI para comparação. Devolve "" se não for plausível.

    Só aceita o formato que a solução usa: 4 caracteres (casa de origem +
    destino) ou 5 com a peça da promoção. Comparar strings cruas deixaria
    "A1A8" e " a1a8 " falharem contra "a1a8" — erro de digitação do cliente
    virando "lance errado" e custando uma tentativa ao usuário.
    """
    if not isinstance(move, str):
        return ""
    normalized = move.strip().lower()
    if len(normalized) not in (4, 5):
        return ""
    return normalized


def _solution_revealed(progress, *, is_daily, today=None):
    """REGRA ÚNICA de revelação da solução, para todos os endpoints.

    Estado terminal: o usuário resolveu (revisão) ou esgotou as tentativas do
    diário (aprendizado, decisão de produto). Fora disso a solução não sai do
    servidor.

    A regra do DIÁRIO é por DATA, não pelo `solved` permanente. Com o ciclo
    curto de problemas, um problema já resolvido num ciclo anterior volta a ser
    o do dia e é jogável de novo (ver DailyReciclagemTests) — usar `solved` ali
    entregaria a solução de um problema que o usuário ainda vai jogar hoje.

    No TREINO vale `solved` permanente: a progressão do treino é permanente por
    (usuário, problema), e reabrir um problema já resolvido mostra a solução.
    """
    if not progress:
        return False
    if is_daily:
        return progress.is_solved_today(today) or progress.is_exhausted_today(today)
    return progress.solved


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
        # `is_solved_today()`, não `solved`: o segundo é permanente e pertence
        # à progressão do Treino. Com o ciclo de 7 dias do diário, todo
        # problema que voltava já tinha solved=True de um ciclo anterior e o
        # usuário ficava preso em "volte amanhã" indefinidamente.
        solved = bool(progress and progress.is_solved_today())
        attempts_used = progress.attempts_used_today() if progress else 0

        # A solução SÓ acompanha o payload no estado terminal (resolvido hoje
        # ou esgotado hoje) — é o que permite reabrir um diário esgotado e
        # rever o lance. Enquanto o problema está jogável ela não sai daqui: a
        # validação do lance é do servidor, via `check-move/`.
        payload = _puzzle_payload(
            puzzle,
            include_solution=_solution_revealed(progress, is_daily=True),
        )
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
        # Mesma regra do daily/: solução só no estado terminal. Quando o pk
        # pedido É o problema do dia, valem as regras por data do diário.
        payload = _puzzle_payload(
            puzzle,
            include_solution=_solution_revealed(prog, is_daily=is_daily),
        )
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
        # Treino: revela ao já-resolvido (progressão permanente). O `next/`
        # normalmente devolve problema não resolvido, mas o fallback de "tudo
        # resolvido" pode repetir um antigo — aí a solução acompanha.
        payload = _puzzle_payload(
            puzzle,
            include_solution=_solution_revealed(progress, is_daily=False),
        )
        payload["already_solved"] = progress.solved if progress else False
        return Response(payload)


class PuzzleCheckMoveView(APIView):
    """
    POST /api/v1/puzzles/{pk}/check-move/
    Body: { "move": "a1a8", "index": 0 }
          ou { "from": "a1", "to": "a8", "promotion": "q", "index": 0 }

    Valida UM lance da sequência contra a solução — sem devolver a solução.

    POR QUE ESTE ENDPOINT EXISTE: até aqui a validação era 100% client-side, e
    para isso o `daily/` precisava entregar `solution` no GET. Quem quisesse a
    resposta lia o corpo da requisição. Movendo a comparação para cá, a solução
    deixa de sair do servidor enquanto o problema está jogável.

    NÃO conta tentativa e NÃO grava progresso: quem faz isso continua sendo o
    `progress/`, que é onde o esgotamento é carimbado. Este endpoint é uma
    função pura sobre (problema, índice, lance).

    Formato UCI ("e2e4", "e7e8q"), que é como a solução está gravada. SAN
    exigiria um motor de xadrez no backend (não há python-chess nas
    dependências) e o cliente já trabalha em casas de origem/destino.
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

        # Mesmo gating do progress/, pelo MESMO critério (o pk é o problema do
        # dia?). Sem isto o check-move viraria a porta dos fundos do Treino:
        # um usuário grátis resolveria problema pago lance a lance.
        profile = get_or_create_profile(request.user)
        daily = get_daily_puzzle()
        is_daily = bool(daily and daily.id == puzzle.id)
        if not is_daily and not can_train_puzzles(profile):
            return _premium_required_response()

        solution = puzzle.solution or []

        played = _normalize_uci(
            request.data.get("move")
            or f"{request.data.get('from', '')}{request.data.get('to', '')}"
            f"{request.data.get('promotion') or ''}"
        )
        if not played:
            return Response(
                {"detail": "Lance ausente ou malformado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            index = int(request.data.get("index", 0))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Índice inválido."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Índice fora da faixa é erro de cliente, não "lance errado": responder
        # `correct: false` esconderia um dessincronismo real entre tela e
        # servidor atrás de um feedback de xadrez.
        if index < 0 or index >= len(solution):
            return Response(
                {"detail": "Índice fora da sequência da solução."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if played != _normalize_uci(solution[index]):
            # Resposta mínima: só o booleano. Nada aqui pode deixar escapar
            # qual era o lance certo, nem por omissão (tamanho da sequência,
            # lance seguinte, etc.).
            return Response(
                {
                    "correct": False,
                    "next_index": index,
                    "solved": False,
                    "reply": None,
                }
            )

        # Acertou. A sequência alterna jogador/oponente, então o próximo item
        # (se houver) é a resposta do oponente — que o cliente precisa receber
        # para animar no tabuleiro. Não é vazamento: é a consequência de um
        # lance que o usuário já encontrou.
        after_player = index + 1
        if after_player >= len(solution):
            return Response(
                {"correct": True, "next_index": None, "solved": True, "reply": None}
            )

        reply = solution[after_player]
        next_index = after_player + 1
        finished = next_index >= len(solution)
        return Response(
            {
                "correct": True,
                "next_index": None if finished else next_index,
                "solved": finished,
                "reply": reply,
            }
        )


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
            if solved:
                # ÚNICO lugar que carimba o diário como resolvido. O Treino
                # nunca passa por aqui, mesmo resolvendo o mesmo puzzle_id no
                # mesmo dia — diário e treino são estados independentes.
                #
                # Incondicional (não é `if not progress.daily_solved_date`):
                # um problema que volta pelo ciclo de 7 dias precisa poder ser
                # marcado de novo, com a data de hoje.
                progress.daily_solved_date = today
            else:
                progress.daily_attempts += 1
                if progress.daily_attempts >= DAILY_PUZZLE_MAX_ATTEMPTS:
                    progress.exhausted_at = timezone.now()

        # `solved`/`solved_at` seguem sendo a PRIMEIRA resolução, por qualquer
        # fluxo: é progressão de Treino e fonte do streak. Não são reescritos
        # numa re-resolução — e é por isso que o diário precisa do carimbo
        # próprio acima.
        if solved and not progress.solved:
            progress.solved = True
            progress.solved_at = timezone.now()

        progress.save()

        # Conquistas de problema. Só quando resolveu — o streak conta dias com
        # resolução, e tentativa errada não muda nada nele. Import local para
        # não criar ciclo entre os apps `puzzles` e `users` no carregamento.
        if solved:
            from apps.users.achievements import check_achievements
            from apps.users.models import AchievementDefinition

            check_achievements(request.user, AchievementDefinition.TRIGGER_PUZZLE)

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
        # Revela a solução SÓ no estado terminal, pela MESMA regra dos demais
        # endpoints. Este é o canal por onde a tela recebe a solução para
        # desenhar a seta no tabuleiro — o payload inicial não a traz mais.
        #
        # `_solution_revealed` em vez do antigo `progress.solved or exhausted`:
        # no diário, `solved` é permanente e um problema resolvido num ciclo
        # anterior, hoje jogável de novo, revelaria a solução já na primeira
        # tentativa errada de hoje.
        if _solution_revealed(progress, is_daily=is_daily, today=today):
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
        # Estado do DIÁRIO (por data), não a progressão do Treino — é este
        # campo que vira o "Resolvido hoje — volte amanhã" no card da Home.
        # `solved` logo acima continua permanente de propósito: ele conta
        # quantos problemas o usuário já resolveu na vida.
        daily_solved = bool(daily_progress and daily_progress.is_solved_today())
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
