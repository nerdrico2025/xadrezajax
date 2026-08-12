"""
Testes da leitura da PARTIDA (tela de detalhe do histórico).

Endpoint irmão de `game-analysis`, com os mesmos dois portões e uma
diferença de contrato que vale fixar em teste: aqui "sem plano" é 403, não
um campo de status com 200. A análise é máquina de estados (pendente,
pronta, inexistente) e "sem plano" é mais uma face; a partida ou vem
inteira ou não vem.

O que precisa ficar garantido:
  - PARTICIPAÇÃO antes de PLANO — o 403 não pode virar oráculo de
    existência para quem não jogou a partida;
  - o histórico expõe o endereço da partida, e expõe `null` justamente
    onde não há lances (linhas anteriores ao modelo Game).
"""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.payments.models import Subscription
from apps.users.models import Game, GameHistory, Profile

User = get_user_model()

HISTORY_URL = reverse("users:game-history")

MOVES = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]


def make_paid(user):
    Subscription.objects.create(
        profile=Profile.objects.get(user=user),
        plan=Subscription.PLAN_MONTHLY,
        status="active",
    )


def detail_url(game):
    return reverse("users:game-detail", kwargs={"public_id": game.public_id})


class GameDetailGatingTests(APITestCase):
    """Os dois portões, e a ordem entre eles."""

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
            termination="checkmate",
            moves=MOVES,
            ply_count=len(MOVES),
            time_control=300,
        )

    def get_as(self, user):
        self.client.force_authenticate(user=user)
        return self.client.get(detail_url(self.game))

    def test_paying_participant_gets_the_moves(self):
        response = self.get_as(self.paying)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["moves"], MOVES)
        self.assertEqual(response.data["ply_count"], len(MOVES))
        self.assertEqual(response.data["result"], Game.RESULT_WHITE)
        self.assertEqual(response.data["termination"], "checkmate")
        self.assertEqual(response.data["white_name"], "Paga")
        self.assertEqual(response.data["black_name"], "Grátis")

    def test_player_color_is_the_requesters_side(self):
        """A tela lê o resumo do lado de quem pediu — e os dois lados da
        MESMA partida têm de receber cores diferentes."""
        make_paid(self.free)

        self.assertEqual(
            self.get_as(self.paying).data["player_color"], Game.COLOR_WHITE
        )
        self.assertEqual(self.get_as(self.free).data["player_color"], Game.COLOR_BLACK)

    def test_free_participant_gets_403(self):
        response = self.get_as(self.free)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        # Nada da partida vaza no corpo do bloqueio.
        self.assertNotIn("moves", response.data)

    def test_stranger_gets_404_even_paying(self):
        """Participação é checada ANTES do plano: quem não jogou não recebe
        403 (que confirmaria a partida), recebe 404."""
        response = self.get_as(self.stranger)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_free_stranger_also_gets_404_not_403(self):
        """O caso que prova a ORDEM dos portões. Se o plano fosse checado
        primeiro, este usuário receberia 403 — e a diferença entre 403 e 404
        diria a ele que a partida existe."""
        free_stranger = User.objects.create_user(
            email="estranho2@chess.com", full_name="Estranho2", password="Xadrez@2024"
        )

        response = self.get_as(free_stranger)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unknown_game_is_404(self):
        self.client.force_authenticate(user=self.paying)

        response = self.client.get(
            reverse(
                "users:game-detail",
                kwargs={"public_id": "00000000-0000-0000-0000-000000000000"},
            )
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_anonymous_is_401(self):
        response = self.client.get(detail_url(self.game))

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_truncated_game_reports_both_numbers(self):
        """`ply_count` é o tamanho real e pode passar de len(moves): a tela
        precisa poder dizer 'guardamos os primeiros N'."""
        self.game.moves = MOVES
        self.game.ply_count = 1200
        self.game.moves_truncated = True
        self.game.save()

        response = self.get_as(self.paying)

        self.assertEqual(len(response.data["moves"]), len(MOVES))
        self.assertEqual(response.data["ply_count"], 1200)
        self.assertTrue(response.data["moves_truncated"])


class GameDetailAiTests(APITestCase):
    """Partida vs IA: um jogador só, e o nível precisa chegar na tela."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="humano@chess.com", full_name="Humano", password="Xadrez@2024"
        )
        make_paid(self.user)
        self.game = Game.objects.create(
            mode=Game.MODE_AI,
            white_player=self.user,
            white_name="Humano",
            black_name="IA",
            ai_difficulty="medium",
            ai_color=Game.COLOR_BLACK,
            result=Game.RESULT_WHITE,
            moves=MOVES,
            ply_count=len(MOVES),
        )

    def test_ai_game_exposes_level_and_side(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.get(detail_url(self.game))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["mode"], Game.MODE_AI)
        self.assertEqual(response.data["ai_difficulty"], "medium")
        self.assertEqual(response.data["ai_color"], Game.COLOR_BLACK)
        self.assertEqual(response.data["player_color"], Game.COLOR_WHITE)


class GameHistoryPublicIdTests(APITestCase):
    """O histórico é o único caminho até a tela de detalhe: sem o endereço
    da partida na lista, não há para onde navegar."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="jogador@chess.com", full_name="Jogador", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=self.user)

    def test_entry_with_game_exposes_public_id(self):
        game = Game.objects.create(
            mode=Game.MODE_AI,
            white_player=self.user,
            white_name="Jogador",
            black_name="IA",
            result=Game.RESULT_WHITE,
            moves=MOVES,
            ply_count=len(MOVES),
        )
        GameHistory.objects.create(
            user=self.user,
            game=game,
            opponent_name="IA",
            result=GameHistory.RESULT_WIN,
            mode=GameHistory.MODE_AI,
            rating_before=1500,
            rating_after=1500,
            rated=False,
        )

        response = self.client.get(HISTORY_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]["game_public_id"], str(game.public_id))

    def test_legacy_entry_without_game_is_null(self):
        """Histórico anterior ao modelo Game: não há lances a rever, e a
        lista precisa poder distinguir isso de uma partida revisável."""
        GameHistory.objects.create(
            user=self.user,
            opponent_name="Antigo",
            result=GameHistory.RESULT_LOSS,
            mode=GameHistory.MODE_ONLINE,
            rating_before=1500,
            rating_after=1490,
        )

        response = self.client.get(HISTORY_URL)

        self.assertIsNone(response.data[0]["game_public_id"])
