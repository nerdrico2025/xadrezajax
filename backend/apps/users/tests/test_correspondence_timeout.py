"""
Testes do comando `finalize_expired_correspondence_games` (perda por
tempo do Modo Turno, Fase C).

O que precisa ficar garantido:
  - partida com prazo vencido finaliza com o jogador do turno perdendo e
    rating aplicado no pool de correspondência;
  - partida com prazo no futuro, pendente ou já terminada não é tocada;
  - rodar o comando duas vezes seguidas no mesmo estado não aplica o
    resultado duas vezes (idempotência via re-checagem sob o lock);
  - os dois pushes disparam (perdeu por tempo / venceu por tempo),
    `send_push` sempre mockado.
"""

from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.users.correspondence import create_challenge, respond_to_challenge
from apps.users.models import CorrespondenceGame, ModalityRating, Profile

User = get_user_model()

PUSH_PATCH = "apps.users.correspondence.send_push"


def make_user(email, username):
    user = User.objects.create_user(
        email=email, full_name=username.title(), password="Xadrez@2024"
    )
    Profile.objects.filter(user=user).update(username=username)
    return user


def run_command():
    out = StringIO()
    call_command("finalize_expired_correspondence_games", stdout=out)
    return out.getvalue()


class TimeoutFinalizationTests(TestCase):
    def setUp(self):
        self.alice = make_user("alice@chess.com", "alice")
        self.bob = make_user("bob@chess.com", "bob")
        with patch(PUSH_PATCH):
            game = create_challenge(self.alice, "bob", 1)
            game = respond_to_challenge(game, self.bob, True)
        self.game = game
        self.white = self.alice if game.white_player_id == self.alice.id else self.bob
        self.black = self.bob if self.white is self.alice else self.alice

    def expire(self, game=None):
        game = game or self.game
        game.current_deadline = timezone.now() - timezone.timedelta(seconds=1)
        game.save(update_fields=["current_deadline"])
        return game

    def test_partida_vencida_finaliza_com_o_turno_perdendo(self):
        self.expire()
        quem_devia_perder = self.white if self.game.turn == "w" else self.black

        with patch(PUSH_PATCH) as push:
            output = run_command()

        self.game.refresh_from_db()
        self.assertEqual(self.game.status, CorrespondenceGame.STATUS_FINISHED)
        self.assertEqual(self.game.termination, "timeout")
        self.assertIsNotNone(self.game.ended_at)

        vencedor = self.white if self.game.result == "white" else self.black
        self.assertNotEqual(vencedor, quem_devia_perder)
        self.assertIn("1 partida(s) finalizada(s)", output)
        self.assertEqual(push.call_count, 2)

    def test_rating_e_aplicado_ao_vencedor_e_ao_perdedor(self):
        self.expire()
        with patch(PUSH_PATCH):
            run_command()

        self.game.refresh_from_db()
        vencedor = self.white if self.game.result == "white" else self.black
        perdedor = self.black if vencedor is self.white else self.white

        rating_vencedor = ModalityRating.objects.get(
            profile__user=vencedor, modality=ModalityRating.MODALITY_CORRESPONDENCE
        )
        rating_perdedor = ModalityRating.objects.get(
            profile__user=perdedor, modality=ModalityRating.MODALITY_CORRESPONDENCE
        )
        self.assertGreater(rating_vencedor.rating, 1500)
        self.assertLess(rating_perdedor.rating, 1500)
        self.assertEqual(rating_vencedor.games_played, 1)
        self.assertEqual(rating_perdedor.games_played, 1)

    def test_partida_com_prazo_no_futuro_nao_e_tocada(self):
        # `respond_to_challenge` já deixa current_deadline no futuro (1 dia).
        with patch(PUSH_PATCH) as push:
            output = run_command()

        self.game.refresh_from_db()
        self.assertEqual(self.game.status, CorrespondenceGame.STATUS_ACTIVE)
        self.assertEqual(self.game.result, "")
        push.assert_not_called()
        self.assertIn("Nenhuma partida", output)

    def test_desafio_pendente_nao_e_tocado_mesmo_sem_deadline(self):
        make_user("carol@chess.com", "carol")
        with patch(PUSH_PATCH):
            pendente = create_challenge(self.alice, "carol", 1)

        with patch(PUSH_PATCH) as push:
            run_command()

        pendente.refresh_from_db()
        self.assertEqual(pendente.status, CorrespondenceGame.STATUS_PENDING)
        push.assert_not_called()

    def test_partida_ja_finalizada_nao_e_tocada_de_novo(self):
        self.expire()
        with patch(PUSH_PATCH):
            run_command()
        self.game.refresh_from_db()
        rating_antes = ModalityRating.objects.get(
            profile__user=self.white, modality=ModalityRating.MODALITY_CORRESPONDENCE
        ).rating

        with patch(PUSH_PATCH) as push:
            output = run_command()

        push.assert_not_called()
        self.assertIn("Nenhuma partida", output)
        rating_depois = ModalityRating.objects.get(
            profile__user=self.white, modality=ModalityRating.MODALITY_CORRESPONDENCE
        ).rating
        self.assertEqual(rating_antes, rating_depois)

    def test_rodar_duas_vezes_seguidas_nao_aplica_resultado_duas_vezes(self):
        self.expire()
        with patch(PUSH_PATCH):
            run_command()
            run_command()

        rating_white = ModalityRating.objects.get(
            profile__user=self.white, modality=ModalityRating.MODALITY_CORRESPONDENCE
        )
        rating_black = ModalityRating.objects.get(
            profile__user=self.black, modality=ModalityRating.MODALITY_CORRESPONDENCE
        )
        self.assertEqual(rating_white.games_played, 1)
        self.assertEqual(rating_black.games_played, 1)

    def test_push_avisa_quem_perdeu_e_quem_venceu(self):
        self.expire()
        with patch(PUSH_PATCH) as push:
            run_command()

        self.game.refresh_from_db()
        vencedor = self.white if self.game.result == "white" else self.black
        perdedor = self.black if vencedor is self.white else self.white

        destinatarios = {call.args[0]: call.args[1] for call in push.call_args_list}
        self.assertEqual(set(destinatarios), {vencedor, perdedor})
        self.assertIn("esgotado", destinatarios[perdedor].lower())
        self.assertIn("tempo", destinatarios[vencedor].lower())

    def test_varias_partidas_vencidas_finalizam_juntas(self):
        carol = make_user("carol@chess.com", "carol")
        dave = make_user("dave@chess.com", "dave")
        with patch(PUSH_PATCH):
            outro = create_challenge(carol, "dave", 3)
            outro = respond_to_challenge(outro, dave, True)
        self.expire()
        self.expire(outro)

        with patch(PUSH_PATCH):
            output = run_command()

        self.assertIn("2 partida(s) finalizada(s)", output)
        self.game.refresh_from_db()
        outro.refresh_from_db()
        self.assertEqual(self.game.status, CorrespondenceGame.STATUS_FINISHED)
        self.assertEqual(outro.status, CorrespondenceGame.STATUS_FINISHED)
