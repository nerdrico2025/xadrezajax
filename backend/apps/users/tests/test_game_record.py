"""
Testes do registro da PARTIDA (model `Game`) — Fase 1 da persistência.

`GameHistory` é o extrato de um jogador; `Game` é o tabuleiro (lances, posição
final, motivo do fim). Aqui se cobre o que a Fase 1 promete:

  - partida online e vs IA criam um `Game` e o amarram ao(s) extrato(s);
  - idempotência por `external_id` (dois fins de partida concorrentes, ou um
    retry do node-api, não podem duplicar histórico nem aplicar Glicko-2 duas
    vezes);
  - partida longa é TRUNCADA, nunca rejeitada;
  - retrocompatibilidade: payload sem nenhum dos campos novos continua
    funcionando exatamente como antes.
"""

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.models import Game, GameHistory, ModalityRating, Profile

User = get_user_model()

GAME_RESULT_URL = reverse("users:game-result")
AI_RESULT_URL = reverse("users:game-ai-result")

INTERNAL_SECRET = "test-internal-secret"

# Uma abertura curta de verdade, para os lances gravados terem cara de partida.
SCHOLARS_MATE = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]
MATE_FEN = "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4"


@override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET)
class OnlineGameRecordTests(APITestCase):
    """Partida online: POST /game/result/ chamado pelo node-api."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="white@chess.com", full_name="Branca da Silva", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="black@chess.com", full_name="Preto Souza", password="Xadrez@2024"
        )

    def post_result(self, **extra):
        payload = {
            "white_id": self.white.id,
            "black_id": self.black.id,
            "result": "white",
            "time_control": 300,
            **extra,
        }
        return self.client.post(
            GAME_RESULT_URL,
            payload,
            format="json",
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )

    def test_creates_game_and_links_both_history_rows(self):
        response = self.post_result(
            external_id="ABC123XYZ789",
            moves=SCHOLARS_MATE,
            termination="checkmate",
            final_fen=MATE_FEN,
            started_at="2026-08-07T18:30:00Z",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        game = Game.objects.get()
        self.assertEqual(game.mode, Game.MODE_ONLINE)
        self.assertEqual(game.modality, ModalityRating.MODALITY_BLITZ)
        self.assertEqual(game.external_id, "ABC123XYZ789")
        self.assertEqual(game.moves, SCHOLARS_MATE)
        self.assertEqual(game.ply_count, len(SCHOLARS_MATE))
        self.assertFalse(game.moves_truncated)
        self.assertEqual(game.result, Game.RESULT_WHITE)
        self.assertEqual(game.termination, "checkmate")
        self.assertEqual(game.final_fen, MATE_FEN)
        self.assertEqual(game.time_control, 300)
        self.assertIsNotNone(game.started_at)
        # public_id é gerado sozinho e é diferente da PK.
        self.assertIsNotNone(game.public_id)

        self.assertEqual(game.white_player, self.white)
        self.assertEqual(game.black_player, self.black)
        # Snapshot de texto: é o que sobrevive à exclusão de conta.
        self.assertEqual(game.white_name, "Branca da Silva")
        self.assertEqual(game.black_name, "Preto Souza")

        # As DUAS linhas de extrato apontam para a MESMA partida.
        entries = GameHistory.objects.all()
        self.assertEqual(entries.count(), 2)
        self.assertEqual({e.game_id for e in entries}, {game.id})

    def test_deleting_one_account_keeps_the_game_for_the_other(self):
        """Decisão travada: SET_NULL + nome em snapshot. A partida continua na
        biblioteca de quem ficou, com o nome de quem saiu ainda legível."""
        self.post_result(external_id="KEEPME000001", moves=SCHOLARS_MATE)

        self.black.delete()

        game = Game.objects.get()
        self.assertIsNone(game.black_player)
        self.assertEqual(game.black_name, "Preto Souza")
        self.assertEqual(game.white_player, self.white)
        # O extrato de quem ficou continua apontando para a partida.
        self.assertEqual(GameHistory.objects.get(user=self.white).game_id, game.id)

    def test_same_external_id_twice_is_a_no_op(self):
        """Idempotência: dois fins de partida concorrentes (ex.: desistência no
        mesmo instante do timer de abandono) reportam o MESMO external_id."""
        first = self.post_result(external_id="DUP123456789", moves=SCHOLARS_MATE)
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        rating_after_first = first.data["white"]["rating"]
        self.assertNotEqual(first.data["white"]["delta"], 0)

        second = self.post_result(external_id="DUP123456789", moves=SCHOLARS_MATE)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertTrue(second.data["duplicate"])
        self.assertEqual(second.data["white"]["delta"], 0)

        self.assertEqual(Game.objects.count(), 1)
        self.assertEqual(GameHistory.objects.count(), 2)

        # Nada de Glicko-2 aplicado duas vezes, nada de contador dobrado.
        self.assertEqual(second.data["white"]["rating"], rating_after_first)
        white_profile = Profile.objects.get(user=self.white)
        self.assertEqual((white_profile.wins, white_profile.games_played), (1, 1))
        black_profile = Profile.objects.get(user=self.black)
        self.assertEqual((black_profile.losses, black_profile.games_played), (1, 1))

    def test_different_games_are_recorded_separately(self):
        """Contraprova da idempotência: external_id diferente é partida
        diferente, e nada é deduplicado por engano."""
        self.post_result(external_id="GAME00000001")
        self.post_result(external_id="GAME00000002")

        self.assertEqual(Game.objects.count(), 2)
        self.assertEqual(GameHistory.objects.count(), 4)
        self.assertEqual(Profile.objects.get(user=self.white).games_played, 2)

    def test_long_game_is_truncated_never_rejected(self):
        moves = ["e4"] * (Game.MAX_PLIES + 250)
        response = self.post_result(external_id="LONG00000001", moves=moves)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        game = Game.objects.get()
        self.assertTrue(game.moves_truncated)
        self.assertEqual(len(game.moves), Game.MAX_PLIES)
        # ply_count guarda o tamanho REAL da partida, não o da lista cortada.
        self.assertEqual(game.ply_count, Game.MAX_PLIES + 250)
        # O extrato e o rating não são afetados pelo corte.
        self.assertEqual(GameHistory.objects.count(), 2)

    def test_legacy_payload_without_new_fields_still_works(self):
        """node-api antigo: sem external_id, sem lances, sem nada. A partida é
        registrada assim mesmo — só sem o tabuleiro."""
        response = self.post_result()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("duplicate", response.data)
        game = Game.objects.get()
        self.assertIsNone(game.external_id)
        self.assertEqual(game.moves, [])
        self.assertEqual(game.ply_count, 0)
        self.assertEqual(game.termination, "")
        self.assertEqual(game.final_fen, "")
        self.assertIsNone(game.started_at)
        self.assertEqual(GameHistory.objects.count(), 2)

    def test_two_legacy_payloads_are_not_deduplicated(self):
        """Sem external_id não HÁ como deduplicar — e o comportamento tem de
        continuar sendo o de antes (duas partidas), não uma falha."""
        self.post_result()
        self.post_result()
        self.assertEqual(Game.objects.count(), 2)

    def test_garbage_move_list_does_not_break_the_result(self):
        """Perder os lances é ruim; perder a partida por causa deles seria
        pior. Payload torto vira lista vazia e o resultado passa."""
        response = self.post_result(
            external_id="JUNK00000001", moves={"nao": "e uma lista"}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Game.objects.get().moves, [])

    def test_unknown_termination_is_dropped_not_stored_raw(self):
        response = self.post_result(
            external_id="TERM00000001", termination="motivo-inventado"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Game.objects.get().termination, "")

    def test_black_win_and_draw_map_to_board_result(self):
        self.post_result(external_id="BLK000000001", result="black")
        self.assertEqual(Game.objects.get().result, Game.RESULT_BLACK)

        Game.objects.all().delete()
        self.post_result(external_id="DRW000000001", result="draw")
        self.assertEqual(Game.objects.get().result, Game.RESULT_DRAW)


class AiGameRecordTests(APITestCase):
    """Partida vs IA: POST /game/ai-result/ pelo app autenticado."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="player@chess.com", full_name="Jogador Teste", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=self.user)

    def post_ai(self, **extra):
        payload = {"result": "win", "difficulty": "hard", **extra}
        return self.client.post(AI_RESULT_URL, payload, format="json")

    def test_creates_game_with_the_ai_on_the_other_side(self):
        response = self.post_ai(
            player_color="w",
            moves=SCHOLARS_MATE,
            termination="checkmate",
            final_fen=MATE_FEN,
            time_control=300,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        game = Game.objects.get()
        self.assertEqual(game.mode, Game.MODE_AI)
        self.assertEqual(game.ai_difficulty, "hard")
        self.assertEqual(game.ai_color, Game.COLOR_BLACK)
        self.assertEqual(game.white_player, self.user)
        self.assertIsNone(game.black_player)
        self.assertEqual(game.white_name, "Jogador Teste")
        self.assertEqual(game.black_name, "IA Difícil")
        self.assertEqual(game.moves, SCHOLARS_MATE)
        self.assertEqual(game.termination, "checkmate")
        self.assertEqual(game.final_fen, MATE_FEN)
        # Vitória do humano jogando de brancas = vitória das BRANCAS.
        self.assertEqual(game.result, Game.RESULT_WHITE)
        # Nenhum external_id neste fluxo: não existe partida no node-api.
        self.assertIsNone(game.external_id)

        history = GameHistory.objects.get(user=self.user)
        self.assertEqual(history.game_id, game.id)
        self.assertEqual(history.color, Game.COLOR_WHITE)

    def test_player_as_black_flips_every_side(self):
        response = self.post_ai(player_color="b", moves=["e4", "e5"])
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        game = Game.objects.get()
        self.assertEqual(game.ai_color, Game.COLOR_WHITE)
        self.assertEqual(game.black_player, self.user)
        self.assertIsNone(game.white_player)
        self.assertEqual(game.white_name, "IA Difícil")
        # Vitória do humano jogando de pretas = vitória das PRETAS.
        self.assertEqual(game.result, Game.RESULT_BLACK)

    def test_loss_and_draw_map_to_board_result(self):
        self.post_ai(result="loss", player_color="w")
        self.assertEqual(Game.objects.get().result, Game.RESULT_BLACK)

        Game.objects.all().delete()
        self.post_ai(result="draw", player_color="b")
        self.assertEqual(Game.objects.get().result, Game.RESULT_DRAW)

    def test_long_game_is_truncated_never_rejected(self):
        moves = ["e4"] * (Game.MAX_PLIES + 1)
        response = self.post_ai(player_color="w", moves=moves)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        game = Game.objects.get()
        self.assertTrue(game.moves_truncated)
        self.assertEqual(len(game.moves), Game.MAX_PLIES)
        self.assertEqual(game.ply_count, Game.MAX_PLIES + 1)

    def test_legacy_payload_records_the_statement_without_the_board(self):
        """App antigo (sem player_color): sem saber de que lado a IA jogou não
        há partida a montar — o extrato entra igual, com `game` null, como
        todo o histórico anterior a esta feature."""
        response = self.post_ai()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Game.objects.count(), 0)
        history = GameHistory.objects.get(user=self.user)
        self.assertIsNone(history.game)
        self.assertIsNone(history.color)
        # E o que já funcionava continua funcionando.
        self.assertEqual(history.mode, GameHistory.MODE_AI)
        self.assertFalse(history.rated)

    def test_invalid_player_color_falls_back_to_legacy_behaviour(self):
        response = self.post_ai(player_color="verde", moves=SCHOLARS_MATE)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Game.objects.count(), 0)

    def test_difficulty_error_message_lists_the_five_real_levels(self):
        """A mensagem citava três níveis ('easy', 'medium' ou 'hard') desde
        antes de a IA ter cinco. Agora ela é derivada de AI_RATING."""
        response = self.post_ai(difficulty="impossivel")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        detail = response.data["detail"]
        for level in ("beginner", "easy", "medium", "hard", "master"):
            self.assertIn(level, detail)
