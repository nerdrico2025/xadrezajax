"""
Testes da análise pós-jogo (Fase 2, lado Django).

O que esta camada precisa garantir:

  - a FILA: quem entra nela (gating por plano no enfileiramento), quem sai
    (aluguel), e o que acontece quando o worker morre no meio (aluguel vence
    e o trabalho volta) ou quando a partida é problemática (desiste na 4ª);
  - a LEITURA: plano do SOLICITANTE, não da partida — numa partida em que só
    um dos dois paga, o outro não vê nada;
  - a FLAG: desligada, nada é criado.

O node-api (que de fato analisa) é a PR seguinte; aqui ele é simulado por
chamadas HTTP aos endpoints internos.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.payments.models import Subscription
from apps.users.models import Game, GameAnalysis, Profile

User = get_user_model()

GAME_RESULT_URL = reverse("users:game-result")
AI_RESULT_URL = reverse("users:game-ai-result")
NEXT_URL = reverse("users:internal-analysis-next")
RESULT_URL = reverse("users:internal-analysis-result")

INTERNAL_SECRET = "test-internal-secret"

MOVES = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]


def make_paid(user):
    """Assinatura ativa — o mesmo estado que `has_paid_access` reconhece."""
    Subscription.objects.create(
        profile=Profile.objects.get(user=user),
        plan=Subscription.PLAN_MONTHLY,
        status="active",
    )


def analysis_url(game):
    return reverse("users:game-analysis", kwargs={"public_id": game.public_id})


@override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET, POST_GAME_ANALYSIS_ENABLED=True)
class EnqueueGatingTests(APITestCase):
    """Quem entra na fila. É o gating que protege CPU: partida que ninguém
    vai poder ver não deve consumir engine."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="white@chess.com", full_name="Branca", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="black@chess.com", full_name="Preta", password="Xadrez@2024"
        )

    def post_online(self, external_id="G0001", moves=None):
        return self.client.post(
            GAME_RESULT_URL,
            {
                "white_id": self.white.id,
                "black_id": self.black.id,
                "result": "white",
                "time_control": 300,
                "external_id": external_id,
                "moves": MOVES if moves is None else moves,
            },
            format="json",
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )

    def test_both_paying_enqueues_once(self):
        make_paid(self.white)
        make_paid(self.black)

        self.post_online()

        self.assertEqual(GameAnalysis.objects.count(), 1)
        self.assertEqual(GameAnalysis.objects.get().status, GameAnalysis.STATUS_PENDING)

    def test_one_paying_one_free_still_enqueues(self):
        """Decisão de produto: a partida é um tabuleiro só. Não analisar
        puniria o pagante pelo plano do adversário."""
        make_paid(self.white)

        self.post_online()

        self.assertEqual(GameAnalysis.objects.count(), 1)

    def test_neither_paying_does_not_enqueue(self):
        self.post_online()
        self.assertEqual(GameAnalysis.objects.count(), 0)

    def test_game_without_moves_is_not_enqueued(self):
        """Sem lances não há o que analisar — nem entra na fila."""
        make_paid(self.white)

        self.post_online(moves=[])

        self.assertEqual(Game.objects.count(), 1)
        self.assertEqual(GameAnalysis.objects.count(), 0)

    def test_duplicate_result_does_not_enqueue_twice(self):
        """Idempotência da Fase 1 vale para a fila também: dois fins de
        partida concorrentes não podem gerar duas análises."""
        make_paid(self.white)

        self.post_online(external_id="DUP01")
        self.post_online(external_id="DUP01")

        self.assertEqual(GameAnalysis.objects.count(), 1)

    def test_response_carries_the_public_id_for_the_app(self):
        """Sem isto o app não teria como pedir a análise da partida que acabou
        de jogar: `GET games/<public_id>/analysis/` precisa desse id, e ele não
        chegava a lugar nenhum fora do servidor."""
        make_paid(self.white)

        response = self.post_online()

        self.assertEqual(
            response.data["game_public_id"], str(Game.objects.get().public_id)
        )

    @override_settings(POST_GAME_ANALYSIS_ENABLED=False)
    def test_flag_off_creates_nothing(self):
        """O estado do primeiro deploy: a partida é gravada normalmente e
        nenhuma análise existe."""
        make_paid(self.white)

        response = self.post_online()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Game.objects.count(), 1)
        self.assertEqual(GameAnalysis.objects.count(), 0)


@override_settings(POST_GAME_ANALYSIS_ENABLED=True)
class AiEnqueueTests(APITestCase):
    """Partida vs IA: um usuário só, e um teto diário contra amplificação de
    recurso (o app reporta lances que o servidor nunca validou)."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="player@chess.com", full_name="Jogador", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=self.user)

    def post_ai(self, **extra):
        payload = {
            "result": "win",
            "difficulty": "medium",
            "player_color": "w",
            "moves": MOVES,
            **extra,
        }
        return self.client.post(AI_RESULT_URL, payload, format="json")

    def test_paying_user_enqueues(self):
        make_paid(self.user)
        self.post_ai()
        self.assertEqual(GameAnalysis.objects.count(), 1)

    def test_free_user_does_not_enqueue(self):
        self.post_ai()
        self.assertEqual(GameAnalysis.objects.count(), 0)

    def test_response_carries_the_public_id_for_the_app(self):
        make_paid(self.user)

        response = self.post_ai()

        self.assertEqual(
            response.data["game_public_id"], str(Game.objects.get().public_id)
        )

    def test_public_id_is_null_when_there_is_no_game(self):
        """App antigo (sem `player_color`): não há partida montada, então o
        app recebe null e simplesmente não oferece análise."""
        make_paid(self.user)

        response = self.post_ai(player_color=None)

        self.assertIsNone(response.data["game_public_id"])

    def test_legacy_payload_without_color_has_no_game_to_analyse(self):
        """Sem `player_color` a Fase 1 não monta `Game` — e sem partida não
        há análise. O resultado continua sendo registrado."""
        make_paid(self.user)

        response = self.post_ai(player_color=None)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Game.objects.count(), 0)
        self.assertEqual(GameAnalysis.objects.count(), 0)

    def test_daily_limit_stops_enqueueing_but_never_the_game(self):
        """O teto protege a engine, não o registro da partida: passado o
        limite, a partida continua sendo gravada normalmente."""
        make_paid(self.user)

        from apps.users.models import ANALYSIS_DAILY_LIMIT_AI

        for _ in range(ANALYSIS_DAILY_LIMIT_AI):
            self.post_ai()
        self.assertEqual(GameAnalysis.objects.count(), ANALYSIS_DAILY_LIMIT_AI)

        response = self.post_ai()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Game.objects.count(), ANALYSIS_DAILY_LIMIT_AI + 1)
        self.assertEqual(GameAnalysis.objects.count(), ANALYSIS_DAILY_LIMIT_AI)


@override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET, POST_GAME_ANALYSIS_ENABLED=True)
class AnalysisQueueTests(APITestCase):
    """A fila vista pelo node-api: pegar trabalho, alugar, devolver — e o que
    acontece quando o worker some no meio."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="player@chess.com", full_name="Jogador", password="Xadrez@2024"
        )
        make_paid(self.user)
        self.game = Game.objects.create(
            mode=Game.MODE_AI,
            white_player=self.user,
            white_name="Jogador",
            black_name="IA Médio",
            ai_difficulty="medium",
            ai_color=Game.COLOR_BLACK,
            result=Game.RESULT_WHITE,
            moves=MOVES,
            ply_count=len(MOVES),
        )
        self.analysis = GameAnalysis.objects.create(game=self.game)

    def claim(self, secret=INTERNAL_SECRET):
        return self.client.get(NEXT_URL, headers={"X-Internal-Secret": secret})

    def report(self, payload, secret=INTERNAL_SECRET):
        return self.client.post(
            RESULT_URL, payload, format="json", headers={"X-Internal-Secret": secret}
        )

    def test_claim_returns_the_moves_and_leases(self):
        response = self.claim()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["analysis_id"], self.analysis.id)
        # Os lances vão no MESMO payload: uma segunda chamada esbarraria no
        # aluguel que a primeira acabou de criar.
        self.assertEqual(response.data["moves"], MOVES)
        self.assertEqual(response.data["max_plies"], GameAnalysis.MAX_ANALYZED_PLIES)

        self.analysis.refresh_from_db()
        self.assertEqual(self.analysis.status, GameAnalysis.STATUS_RUNNING)
        self.assertEqual(self.analysis.attempts, 1)
        self.assertIsNotNone(self.analysis.leased_until)

    def test_claimed_work_is_not_handed_out_twice(self):
        self.claim()
        self.assertEqual(self.claim().status_code, status.HTTP_204_NO_CONTENT)

    def test_no_work_returns_204_not_an_error(self):
        GameAnalysis.objects.all().delete()
        self.assertEqual(self.claim().status_code, status.HTTP_204_NO_CONTENT)

    def test_internal_endpoints_require_the_secret(self):
        self.assertEqual(
            self.claim(secret="errado").status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(
            self.report({"analysis_id": self.analysis.id}, secret="errado").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_expired_lease_reopens_the_work(self):
        """O caso do redeploy: o worker pegou o trabalho e morreu. Sem isto a
        análise ficaria em `analisando` para sempre."""
        self.claim()
        GameAnalysis.objects.filter(id=self.analysis.id).update(
            leased_until=timezone.now() - timedelta(minutes=1)
        )

        response = self.claim()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.analysis.refresh_from_db()
        self.assertEqual(self.analysis.attempts, 2)

    def test_gives_up_after_max_attempts(self):
        """Partida que derruba o worker toda vez não pode ocupar a engine em
        loop. Na 4ª tentativa vira `falhou` e some da fila."""
        for _ in range(GameAnalysis.MAX_ATTEMPTS):
            self.assertEqual(self.claim().status_code, status.HTTP_200_OK)
            GameAnalysis.objects.filter(id=self.analysis.id).update(
                leased_until=timezone.now() - timedelta(minutes=1)
            )

        response = self.claim()

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.analysis.refresh_from_db()
        self.assertEqual(self.analysis.status, GameAnalysis.STATUS_FAILED)
        self.assertIn("tentativas", self.analysis.failure_reason)

    def test_reporting_success_stores_the_analysis(self):
        self.claim()

        response = self.report(
            {
                "analysis_id": self.analysis.id,
                "moves": [
                    {
                        "ply": 1,
                        "san": "e4",
                        "eval_cp": 30,
                        "cp_loss": 0,
                        "classification": "best",
                        "best_move_san": "e4",
                        "is_only_move": False,
                        "is_book": True,
                    }
                ],
                "counts": {"white": {"best": 1}, "black": {}},
                "white_accuracy": 98.5,
                "black_accuracy": 71.2,
                "white_avg_loss": 8,
                "black_avg_loss": 62,
                "turning_point_ply": 6,
                "engine_depth": 12,
                "engine_movetime": 400,
                "engine_id": "Stockfish 16.1",
            }
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.analysis.refresh_from_db()
        self.assertEqual(self.analysis.status, GameAnalysis.STATUS_DONE)
        self.assertEqual(self.analysis.analyzed_plies, 1)
        self.assertEqual(self.analysis.white_accuracy, 98.5)
        self.assertEqual(self.analysis.turning_point_ply, 6)
        self.assertIsNone(self.analysis.leased_until)
        self.assertIsNotNone(self.analysis.completed_at)

    def test_reporting_failure_is_terminal(self):
        """Lance ilegal no replay não melhora tentando de novo: sai da fila
        de vez, com o motivo registrado."""
        self.claim()

        self.report(
            {
                "analysis_id": self.analysis.id,
                "failed": True,
                "failure_reason": "Sequência de lances ilegal no ply 7",
            }
        )

        self.analysis.refresh_from_db()
        self.assertEqual(self.analysis.status, GameAnalysis.STATUS_FAILED)
        self.assertIn("ilegal", self.analysis.failure_reason)
        self.assertEqual(self.claim().status_code, status.HTTP_204_NO_CONTENT)

    def test_garbage_move_payload_does_not_break_the_write(self):
        self.claim()

        response = self.report(
            {"analysis_id": self.analysis.id, "moves": "isto não é uma lista"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.analysis.refresh_from_db()
        self.assertEqual(self.analysis.moves, [])

    def test_result_for_unknown_analysis_is_404(self):
        self.assertEqual(
            self.report({"analysis_id": 999999}).status_code,
            status.HTTP_404_NOT_FOUND,
        )


@override_settings(POST_GAME_ANALYSIS_ENABLED=True)
class AnalysisReadGatingTests(APITestCase):
    """A leitura é gateada pelo plano de QUEM PEDE, não pelo da partida."""

    def setUp(self):
        self.paying = User.objects.create_user(
            email="paga@chess.com", full_name="Paga", password="Xadrez@2024"
        )
        self.free = User.objects.create_user(
            email="gratis@chess.com", full_name="Grátis", password="Xadrez@2024"
        )
        self.stranger = User.objects.create_user(
            email="estranho@chess.com", full_name="Estranho", password="Xadrez@2024"
        )
        make_paid(self.paying)
        make_paid(self.stranger)

        self.game = Game.objects.create(
            mode=Game.MODE_ONLINE,
            white_player=self.paying,
            black_player=self.free,
            white_name="Paga",
            black_name="Grátis",
            result=Game.RESULT_WHITE,
            moves=MOVES,
            ply_count=len(MOVES),
        )
        self.analysis = GameAnalysis.objects.create(
            game=self.game,
            status=GameAnalysis.STATUS_DONE,
            moves=[{"ply": 1, "san": "e4", "classification": "best"}],
            analyzed_plies=1,
            white_accuracy=98.5,
            counts={"white": {"best": 1}, "black": {}},
        )

    def get_as(self, user):
        self.client.force_authenticate(user=user)
        return self.client.get(analysis_url(self.game))

    def test_paying_participant_sees_the_analysis(self):
        response = self.get_as(self.paying)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], GameAnalysis.STATUS_DONE)
        self.assertEqual(len(response.data["moves"]), 1)
        self.assertEqual(response.data["white"]["accuracy"], 98.5)

    def test_free_participant_gets_unavailable_even_though_it_is_ready(self):
        """O caso que motivou separar os dois gatings: a análise EXISTE
        (foi enfileirada por causa do adversário pagante) e mesmo assim este
        usuário não recebe o conteúdo."""
        response = self.get_as(self.free)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "indisponivel")
        self.assertNotIn("moves", response.data)

    def test_stranger_gets_404_even_paying(self):
        """Análise revela a partida inteira. Quem não jogou não precisa nem
        saber que ela existe."""
        response = self.get_as(self.stranger)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_anonymous_is_rejected(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(analysis_url(self.game))
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_pending_analysis_reports_status_without_content(self):
        self.analysis.status = GameAnalysis.STATUS_PENDING
        self.analysis.save(update_fields=["status"])

        response = self.get_as(self.paying)

        self.assertEqual(response.data["status"], GameAnalysis.STATUS_PENDING)
        self.assertNotIn("moves", response.data)

    def test_failed_analysis_reports_the_reason(self):
        self.analysis.status = GameAnalysis.STATUS_FAILED
        self.analysis.failure_reason = "Sequência de lances ilegal"
        self.analysis.save(update_fields=["status", "failure_reason"])

        response = self.get_as(self.paying)

        self.assertEqual(response.data["status"], GameAnalysis.STATUS_FAILED)
        self.assertIn("ilegal", response.data["failure_reason"])

    def test_game_without_analysis_says_so(self):
        """Partida anterior à feature, ou terminada com a flag desligada."""
        self.analysis.delete()

        response = self.get_as(self.paying)

        self.assertEqual(response.data["status"], "inexistente")

    def test_unknown_game_is_404(self):
        self.client.force_authenticate(user=self.paying)
        url = reverse(
            "users:game-analysis",
            kwargs={"public_id": "00000000-0000-0000-0000-000000000000"},
        )
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)
