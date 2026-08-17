"""
Testes do Modo Turno (correspondência).

Cobre o critério de aceite: desafio → aceite → lance → finalização com
rating aplicado; pareamento de matchmaking; limite de partidas simultâneas;
os dois pushes (convite recebido, sua vez) disparando — `send_push` mockado
em todos os testes, sem tocar a Expo de verdade.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.payments.models import Subscription
from apps.users.correspondence import (
    ChallengeError,
    MoveError,
    create_challenge,
    join_matchmaking,
    respond_to_challenge,
    submit_move,
)
from apps.users.models import (
    CorrespondenceGame,
    CorrespondenceQueueEntry,
    ModalityRating,
    Profile,
)

User = get_user_model()

CHALLENGE_URL = reverse("users:correspondence-challenge")
MATCHMAKING_URL = reverse("users:correspondence-matchmaking")
LIST_URL = reverse("users:correspondence-list")


def make_user(email, username):
    user = User.objects.create_user(
        email=email, full_name=username.title(), password="Xadrez@2024"
    )
    Profile.objects.filter(user=user).update(username=username)
    return user


def make_paid(user):
    Subscription.objects.create(
        profile=Profile.objects.get(user=user),
        plan=Subscription.PLAN_MONTHLY,
        status="active",
    )


def respond_url(pk):
    return reverse("users:correspondence-respond", kwargs={"pk": pk})


def move_url(pk):
    return reverse("users:correspondence-move", kwargs={"pk": pk})


def detail_url(pk):
    return reverse("users:correspondence-detail", kwargs={"pk": pk})


PUSH_PATCH = "apps.users.correspondence.send_push"


class ChallengeFlowTests(APITestCase):
    """Função pura, sem HTTP: desafio → aceite → recusa."""

    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")

    def test_desafio_cria_partida_pendente(self):
        with patch(PUSH_PATCH) as push:
            game = create_challenge(self.alice, "bob", 3)
        self.assertEqual(game.status, CorrespondenceGame.STATUS_PENDING)
        self.assertEqual(game.challenger_id, self.alice.id)
        self.assertEqual(game.time_control_days, 3)
        push.assert_called_once()
        self.assertEqual(push.call_args.args[0], self.bob)

    def test_desafiar_a_si_mesmo_e_erro(self):
        with self.assertRaises(ChallengeError) as ctx:
            create_challenge(self.alice, "alice", 1)
        self.assertEqual(ctx.exception.code, "self")

    def test_desafiar_usuario_inexistente_e_erro(self):
        with self.assertRaises(ChallengeError) as ctx:
            create_challenge(self.alice, "ninguem", 1)
        self.assertEqual(ctx.exception.code, "not_found")

    def test_challenger_nao_pode_responder_o_proprio_convite(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        with self.assertRaises(ChallengeError) as ctx:
            respond_to_challenge(game, self.alice, True)
        self.assertEqual(ctx.exception.code, "not_target")

    def test_terceiro_nao_participante_nao_pode_responder(self):
        carol = make_user("carol@chess.com", "carol")
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        with self.assertRaises(ChallengeError) as ctx:
            respond_to_challenge(game, carol, True)
        self.assertEqual(ctx.exception.code, "not_participant")

    def test_aceite_sorteia_cor_e_ativa_partida(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        game = respond_to_challenge(game, self.bob, True)
        self.assertEqual(game.status, CorrespondenceGame.STATUS_ACTIVE)
        self.assertIsNotNone(game.last_move_at)
        self.assertIsNotNone(game.current_deadline)
        self.assertEqual(
            {game.white_player_id, game.black_player_id},
            {
                self.alice.id,
                self.bob.id,
            },
        )

    def test_recusa_apaga_a_partida(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        respond_to_challenge(game, self.bob, False)
        self.assertFalse(CorrespondenceGame.objects.filter(id=game.id).exists())

    def test_responder_desafio_ja_respondido_e_erro(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        respond_to_challenge(game, self.bob, True)
        with self.assertRaises(ChallengeError) as ctx:
            respond_to_challenge(game, self.bob, True)
        self.assertEqual(ctx.exception.code, "not_pending")


class ChallengeEndpointTests(APITestCase):
    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")
        self.client.force_authenticate(self.alice)

    def test_cria_desafio_via_api(self):
        with patch(PUSH_PATCH):
            response = self.client.post(
                CHALLENGE_URL,
                {"username": "bob", "time_control_days": 7},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], "pending")
        self.assertEqual(response.data["opponent"]["username"], "bob")

    def test_time_control_invalido_e_400(self):
        response = self.client.post(
            CHALLENGE_URL,
            {"username": "bob", "time_control_days": 2},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_aceite_via_api(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        self.client.force_authenticate(self.bob)
        response = self.client.post(
            respond_url(game.id), {"accept": True}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "active")

    def test_recusa_via_api(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        self.client.force_authenticate(self.bob)
        response = self.client.post(
            respond_url(game.id), {"accept": False}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(CorrespondenceGame.objects.filter(id=game.id).exists())


class MatchmakingTests(APITestCase):
    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")

    def test_primeiro_a_entrar_fica_na_fila(self):
        game, queued = join_matchmaking(self.alice, 3)
        self.assertIsNone(game)
        self.assertTrue(queued)
        self.assertEqual(CorrespondenceQueueEntry.objects.count(), 1)

    def test_segundo_com_mesmo_controle_pareia_na_hora(self):
        join_matchmaking(self.alice, 3)
        game, queued = join_matchmaking(self.bob, 3)
        self.assertFalse(queued)
        self.assertIsNotNone(game)
        self.assertEqual(game.status, CorrespondenceGame.STATUS_ACTIVE)
        self.assertEqual(
            {game.white_player_id, game.black_player_id},
            {
                self.alice.id,
                self.bob.id,
            },
        )
        self.assertEqual(CorrespondenceQueueEntry.objects.count(), 0)

    def test_controles_diferentes_nao_pareiam(self):
        join_matchmaking(self.alice, 1)
        game, queued = join_matchmaking(self.bob, 7)
        self.assertIsNone(game)
        self.assertTrue(queued)
        self.assertEqual(CorrespondenceQueueEntry.objects.count(), 2)

    def test_endpoint_join_e_leave(self):
        self.client.force_authenticate(self.alice)
        response = self.client.post(
            MATCHMAKING_URL, {"time_control_days": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["queued"])

        response = self.client.delete(
            MATCHMAKING_URL, {"time_control_days": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(CorrespondenceQueueEntry.objects.count(), 0)


class SimultaneousLimitTests(APITestCase):
    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")
        self.carol = make_user("carol@chess.com", "carol")
        self.dave = make_user("dave@chess.com", "dave")

    def _duas_partidas_ativas_para_alice(self):
        for opponent, username in ((self.bob, "bob"), (self.carol, "carol")):
            with patch(PUSH_PATCH):
                game = create_challenge(self.alice, username, 1)
            respond_to_challenge(game, opponent, True)

    def test_terceiro_desafio_e_recusado_no_limite_gratis(self):
        self._duas_partidas_ativas_para_alice()
        with self.assertRaises(ChallengeError) as ctx:
            create_challenge(self.alice, "dave", 1)
        self.assertEqual(ctx.exception.code, "limit")

    def test_plano_pago_nao_tem_limite(self):
        make_paid(self.alice)
        self._duas_partidas_ativas_para_alice()
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "dave", 1)
        self.assertEqual(game.status, CorrespondenceGame.STATUS_PENDING)

    def test_matchmaking_recusa_acima_do_limite(self):
        self._duas_partidas_ativas_para_alice()
        with self.assertRaises(ChallengeError) as ctx:
            join_matchmaking(self.alice, 3)
        self.assertEqual(ctx.exception.code, "limit")

    def test_endpoint_devolve_403_no_limite(self):
        self._duas_partidas_ativas_para_alice()
        self.client.force_authenticate(self.alice)
        response = self.client.post(
            CHALLENGE_URL,
            {"username": "dave", "time_control_days": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("2 partidas", response.data["detail"])

    def test_desafio_pendente_nao_conta_para_o_limite(self):
        """Só `active` ocupa cota — dois convites pendentes não bloqueiam
        um terceiro desafio."""
        with patch(PUSH_PATCH):
            create_challenge(self.alice, "bob", 1)
            create_challenge(self.alice, "carol", 1)
            game = create_challenge(self.alice, "dave", 1)
        self.assertEqual(game.status, CorrespondenceGame.STATUS_PENDING)


class MoveSubmissionTests(APITestCase):
    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")
        with patch(PUSH_PATCH):
            self.game = create_challenge(self.alice, "bob", 1)
        self.game = respond_to_challenge(self.game, self.bob, True)
        self.white = (
            self.alice if self.game.white_player_id == self.alice.id else self.bob
        )
        self.black = self.bob if self.white is self.alice else self.alice

    def test_lance_legal_atualiza_fen_e_troca_o_turno(self):
        with patch(PUSH_PATCH) as push:
            game = submit_move(self.game, self.white, "e2e4")
        self.assertEqual(game.moves, ["e4"])
        self.assertEqual(game.turn, CorrespondenceGame.COLOR_BLACK)
        self.assertNotEqual(game.fen, CorrespondenceGame.START_FEN)
        push.assert_called_once()
        self.assertEqual(push.call_args.args[0], self.black)

    def test_lance_fora_de_hora_e_erro(self):
        with self.assertRaises(MoveError) as ctx:
            submit_move(self.game, self.black, "e7e5")
        self.assertEqual(ctx.exception.code, "not_your_turn")

    def test_nao_participante_e_erro(self):
        carol = make_user("carol@chess.com", "carol")
        with self.assertRaises(MoveError) as ctx:
            submit_move(self.game, carol, "e2e4")
        self.assertEqual(ctx.exception.code, "not_participant")

    def test_lance_ilegal_e_erro(self):
        with self.assertRaises(MoveError) as ctx:
            submit_move(self.game, self.white, "e2e5")
        self.assertEqual(ctx.exception.code, "illegal")

    def test_lance_via_api(self):
        self.client.force_authenticate(self.white)
        with patch(PUSH_PATCH):
            response = self.client.post(
                move_url(self.game.id), {"move": "e2e4"}, format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["moves"], ["e4"])


class CheckmateFinishesGameTests(APITestCase):
    """Fluxo completo do critério de aceite: desafio → aceite → lance →
    finalização com rating aplicado, usando o mate-do-pastor (4 lances)."""

    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        self.game = respond_to_challenge(game, self.bob, True)
        self.white = (
            self.alice if self.game.white_player_id == self.alice.id else self.bob
        )
        self.black = self.bob if self.white is self.alice else self.alice

    def _mate_do_pastor(self):
        # 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#
        sequencia = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]
        game = self.game
        for i, uci in enumerate(sequencia):
            jogador = self.white if i % 2 == 0 else self.black
            with patch(PUSH_PATCH):
                game = submit_move(game, jogador, uci)
        return game

    def test_xeque_mate_finaliza_e_aplica_rating(self):
        white_rating_antes, _ = ModalityRating.objects.get_or_create(
            profile=Profile.objects.get(user=self.white),
            modality=ModalityRating.MODALITY_CORRESPONDENCE,
        )
        white_rating_antes = white_rating_antes.rating
        black_rating_antes, _ = ModalityRating.objects.get_or_create(
            profile=Profile.objects.get(user=self.black),
            modality=ModalityRating.MODALITY_CORRESPONDENCE,
        )
        black_rating_antes = black_rating_antes.rating

        game = self._mate_do_pastor()

        self.assertEqual(game.status, CorrespondenceGame.STATUS_FINISHED)
        self.assertEqual(game.termination, "checkmate")
        self.assertIsNotNone(game.ended_at)
        vencedor = self.white if game.result == "white" else self.black
        perdedor = self.black if vencedor is self.white else self.white
        self.assertEqual(vencedor, self.white)  # Qxf7# é lance das brancas

        rating_vencedor = ModalityRating.objects.get(
            profile__user=vencedor, modality=ModalityRating.MODALITY_CORRESPONDENCE
        )
        rating_perdedor = ModalityRating.objects.get(
            profile__user=perdedor, modality=ModalityRating.MODALITY_CORRESPONDENCE
        )
        self.assertGreater(rating_vencedor.rating, white_rating_antes)
        self.assertLess(rating_perdedor.rating, black_rating_antes)
        self.assertEqual(rating_vencedor.games_played, 1)
        self.assertEqual(rating_perdedor.games_played, 1)

    def test_finalizada_nao_conta_mais_para_o_limite_de_simultaneas(self):
        self._mate_do_pastor()
        # As duas partidas anteriores terminaram — um novo desafio da alice
        # não deve esbarrar no limite de 2 simultâneas.
        make_user("carol@chess.com", "carol")
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "carol", 1)
        self.assertEqual(game.status, CorrespondenceGame.STATUS_PENDING)


class ListAndDetailTests(APITestCase):
    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")
        self.carol = make_user("carol@chess.com", "carol")
        self.client.force_authenticate(self.alice)

    def test_lista_so_traz_partidas_do_usuario(self):
        with patch(PUSH_PATCH):
            minha = create_challenge(self.alice, "bob", 1)
            create_challenge(self.bob, "carol", 1)

        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [row["id"] for row in response.data]
        self.assertEqual(ids, [minha.id])

    def test_ordenada_por_prazo_mais_urgente_primeiro(self):
        with patch(PUSH_PATCH):
            g1 = create_challenge(self.alice, "bob", 7)
            g2 = create_challenge(self.alice, "carol", 1)
        respond_to_challenge(g1, self.bob, True)
        respond_to_challenge(g2, self.carol, True)

        response = self.client.get(LIST_URL)
        ids = [row["id"] for row in response.data]
        # g2 (1 dia) vence antes de g1 (7 dias) — prazo mais urgente primeiro.
        self.assertEqual(ids, [g2.id, g1.id])

    def test_detalhe_de_terceiro_e_404(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.bob, "carol", 1)
        response = self.client.get(detail_url(game.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_detalhe_do_participante_funciona(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        response = self.client.get(detail_url(game.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], game.id)


class PushNotificationTests(APITestCase):
    """Os dois pushes do critério de aceite: convite recebido e sua vez."""

    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")

    def test_push_de_convite_recebido(self):
        with patch(PUSH_PATCH) as push:
            create_challenge(self.alice, "bob", 1)
        push.assert_called_once()
        args = push.call_args.args
        self.assertEqual(args[0], self.bob)
        self.assertIn("Desafio", args[1])

    def test_push_de_sua_vez_apos_lance(self):
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        game = respond_to_challenge(game, self.bob, True)
        white = self.alice if game.white_player_id == self.alice.id else self.bob
        black = self.bob if white is self.alice else self.alice

        with patch(PUSH_PATCH) as push:
            submit_move(game, white, "e2e4")
        push.assert_called_once()
        args = push.call_args.args
        self.assertEqual(args[0], black)
        self.assertIn("vez", args[1].lower())

    def test_sem_push_ao_lance_que_finaliza_a_partida(self):
        """O último lance de um xeque-mate não avisa 'sua vez' — a partida
        acabou, não há próximo turno."""
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
        game = respond_to_challenge(game, self.bob, True)
        white = self.alice if game.white_player_id == self.alice.id else self.bob
        black = self.bob if white is self.alice else self.alice

        sequencia = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]
        for i, uci in enumerate(sequencia[:-1]):
            jogador = white if i % 2 == 0 else black
            with patch(PUSH_PATCH):
                game = submit_move(game, jogador, uci)

        with patch(PUSH_PATCH) as push:
            game = submit_move(game, white, sequencia[-1])
        self.assertEqual(game.status, CorrespondenceGame.STATUS_FINISHED)
        push.assert_not_called()
