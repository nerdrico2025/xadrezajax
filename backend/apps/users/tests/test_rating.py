"""
Testes do rating Glicko-2 por modalidade (RF-PERF-02, item 0.3 da Fase 0).

Cobre: o módulo glicko2 contra o exemplo numérico oficial do paper de
Glickman, cálculo após vitória/derrota/empate, período provisório (RD alto →
variação maior por partida), separação por modalidade e compatibilidade com
payloads antigos (sem time_control) e com o histórico Elo migrado.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.glicko2 import DRAW, LOSS, WIN, Rating, rate
from apps.users.models import GameHistory, ModalityRating, Profile

User = get_user_model()

GAME_RESULT_URL = reverse("users:game-result")
AI_RESULT_URL = reverse("users:game-ai-result")
LEADERBOARD_URL = reverse("users:leaderboard")
PROFILE_URL = reverse("users:profile")

INTERNAL_SECRET = "test-internal-secret"


class Glicko2ModuleTests(SimpleTestCase):
    """Valida a implementação contra o paper de Glickman (glicko2.pdf)."""

    def test_paper_example(self):
        """Exemplo numérico oficial: r=1500, RD=200 vs 3 oponentes."""
        player = Rating(rating=1500, deviation=200, volatility=0.06)
        outcomes = [
            (Rating(1400, 30, 0.06), WIN),
            (Rating(1550, 100, 0.06), LOSS),
            (Rating(1700, 300, 0.06), LOSS),
        ]
        new = rate(player, outcomes)
        self.assertAlmostEqual(new.rating, 1464.06, delta=0.05)
        self.assertAlmostEqual(new.deviation, 151.52, delta=0.05)
        self.assertAlmostEqual(new.volatility, 0.05999, delta=0.0001)

    def test_win_increases_and_loss_decreases(self):
        player = Rating()
        opponent = Rating()
        self.assertGreater(rate(player, [(opponent, WIN)]).rating, player.rating)
        self.assertLess(rate(player, [(opponent, LOSS)]).rating, player.rating)

    def test_draw_between_equals_keeps_rating(self):
        player = Rating(1500, 200, 0.06)
        new = rate(player, [(Rating(1500, 200, 0.06), DRAW)])
        self.assertAlmostEqual(new.rating, 1500.0, delta=0.01)

    def test_deviation_decreases_with_each_game(self):
        """RD (incerteza) cai conforme o jogador acumula partidas."""
        player = Rating()
        for _ in range(5):
            new = rate(player, [(Rating(), WIN)])
            self.assertLess(new.deviation, player.deviation)
            player = new

    def test_upset_moves_rating_more_than_expected_result(self):
        """Vencer um oponente muito mais forte rende mais pontos."""
        player = Rating(1500, 100, 0.06)
        vs_stronger = rate(player, [(Rating(1900, 100, 0.06), WIN)])
        vs_weaker = rate(player, [(Rating(1100, 100, 0.06), WIN)])
        self.assertGreater(vs_stronger.rating, vs_weaker.rating)


@override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET)
class GameResultViewGlickoTests(APITestCase):
    """Partida online: POST /game/result/ chamado pelo node-api."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="white@chess.com", full_name="White", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="black@chess.com", full_name="Black", password="Xadrez@2024"
        )

    def post_result(self, result, **extra):
        payload = {
            "white_id": self.white.id,
            "black_id": self.black.id,
            "result": result,
            **extra,
        }
        return self.client.post(
            GAME_RESULT_URL,
            payload,
            format="json",
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )

    def rating_of(self, user, modality):
        return ModalityRating.objects.get(profile__user=user, modality=modality)

    def test_white_win_updates_ratings_and_counters(self):
        response = self.post_result("white", time_control=300)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["modality"], "blitz")

        white_rating = self.rating_of(self.white, "blitz")
        black_rating = self.rating_of(self.black, "blitz")
        self.assertGreater(white_rating.rating, 1500)
        self.assertLess(black_rating.rating, 1500)

        white_profile = Profile.objects.get(user=self.white)
        black_profile = Profile.objects.get(user=self.black)
        self.assertEqual(
            (white_profile.wins, white_profile.losses, white_profile.games_played),
            (1, 0, 1),
        )
        self.assertEqual(
            (black_profile.wins, black_profile.losses, black_profile.games_played),
            (0, 1, 1),
        )

    def test_draw_between_equal_new_players_keeps_ratings(self):
        response = self.post_result("draw", time_control=300)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertAlmostEqual(
            self.rating_of(self.white, "blitz").rating, 1500.0, delta=0.01
        )
        self.assertAlmostEqual(
            self.rating_of(self.black, "blitz").rating, 1500.0, delta=0.01
        )
        self.assertEqual(Profile.objects.get(user=self.white).draws, 1)

    def test_provisional_player_swings_more_than_calibrated(self):
        """Período provisório: RD alto (350) → variação maior por partida do
        que a de um jogador calibrado (RD baixo), no mesmo jogo."""
        white_profile = Profile.objects.get(user=self.white)
        ModalityRating.objects.create(
            profile=white_profile,
            modality="blitz",
            rating=1500,
            deviation=60,
            games_played=30,
        )

        self.post_result("white", time_control=300)

        calibrated_gain = self.rating_of(self.white, "blitz").rating - 1500
        provisional_loss = 1500 - self.rating_of(self.black, "blitz").rating
        self.assertGreater(provisional_loss, calibrated_gain)

    def test_provisional_flag_follows_20_games_threshold(self):
        white_profile = Profile.objects.get(user=self.white)
        ModalityRating.objects.create(
            profile=white_profile, modality="blitz", games_played=19
        )
        response = self.post_result("white", time_control=300)
        # 19 partidas + esta = 20 → deixou de ser provisório
        self.assertFalse(response.data["white"]["provisional"])
        self.assertTrue(response.data["black"]["provisional"])

    def test_bullet_game_does_not_touch_blitz_rating(self):
        self.post_result("white", time_control=300)
        blitz_before = self.rating_of(self.white, "blitz").rating

        self.post_result("white", time_control=60)  # bullet

        self.assertEqual(self.rating_of(self.white, "blitz").rating, blitz_before)
        self.assertGreater(self.rating_of(self.white, "bullet").rating, 1500)

    def test_payload_without_time_control_defaults_to_blitz(self):
        """Compatibilidade: node-api antigo não envia time_control."""
        response = self.post_result("white")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["modality"], "blitz")
        self.assertTrue(
            ModalityRating.objects.filter(
                profile__user=self.white, modality="blitz", games_played=1
            ).exists()
        )

    def test_profile_rating_mirrors_blitz_only(self):
        """Profile.rating (Elo legado) segue o blitz arredondado; partidas de
        outras modalidades não mexem no espelho."""
        self.post_result("white", time_control=300)
        white_profile = Profile.objects.get(user=self.white)
        blitz = self.rating_of(self.white, "blitz")
        self.assertEqual(white_profile.rating, round(blitz.rating))

        mirror_before = white_profile.rating
        self.post_result("white", time_control=60)  # bullet
        white_profile.refresh_from_db()
        self.assertEqual(white_profile.rating, mirror_before)

    def test_game_history_records_modality_and_ratings(self):
        self.post_result("black", time_control=900)  # rapid
        white_history = GameHistory.objects.get(user=self.white)
        self.assertEqual(white_history.modality, "rapid")
        self.assertEqual(white_history.result, "loss")
        self.assertEqual(white_history.rating_before, 1500)
        self.assertEqual(
            white_history.rating_after,
            round(self.rating_of(self.white, "rapid").rating),
        )

    def test_uniform_seed_ignores_legacy_elo(self):
        """Seed uniforme (decisão do PM 2026-07-12): o Elo antigo do perfil
        não é herdado — todo rating Glicko-2 parte de 1500/350/0.06,
        independente do valor de Profile.rating (espelho legado)."""
        white_profile = Profile.objects.get(user=self.white)
        white_profile.rating = 1350  # Elo legado alto não muda o seed
        white_profile.games_played = 42
        white_profile.save(update_fields=["rating", "games_played"])

        response = self.post_result("draw", time_control=300)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Empate entre dois seeds 1500 idênticos ≈ nenhum movimento: prova
        # que o cálculo partiu de 1500, não do Elo 1350.
        self.assertAlmostEqual(
            self.rating_of(self.white, "blitz").rating, 1500.0, delta=0.01
        )
        self.assertLess(self.rating_of(self.white, "blitz").deviation, 350)

    def test_unrated_game_counts_stats_but_not_rating(self):
        """Partida sem relógio (time_control null): incrementa wins/losses/
        games_played e cria GameHistory, mas não altera ModalityRating nem o
        espelho Profile.rating (decisão do PM, PLANO_FASE0 §8)."""
        # Estado prévio calibrado no rapid para provar que nada se move
        white_profile = Profile.objects.get(user=self.white)
        ModalityRating.objects.create(
            profile=white_profile,
            modality="rapid",
            rating=1600,
            deviation=90,
            games_played=25,
        )
        mirror_before = white_profile.rating

        response = self.post_result("white", time_control=None)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["modality"], "rapid")
        # Resposta reflete o estado atual, sem cálculo de atualização
        self.assertEqual(response.data["white"]["rating"], 1600)
        self.assertEqual(response.data["white"]["deviation"], 90)
        self.assertFalse(response.data["white"]["provisional"])
        self.assertEqual(response.data["black"]["rating"], 1500)
        self.assertEqual(response.data["black"]["deviation"], 350)
        self.assertTrue(response.data["black"]["provisional"])

        # Rating intocado (nem linha nova para quem não tinha)
        white_rapid = self.rating_of(self.white, "rapid")
        self.assertEqual(
            (white_rapid.rating, white_rapid.deviation, white_rapid.games_played),
            (1600, 90, 25),
        )
        self.assertFalse(
            ModalityRating.objects.filter(profile__user=self.black).exists()
        )

        # Espelho e contadores
        white_profile.refresh_from_db()
        self.assertEqual(white_profile.rating, mirror_before)
        self.assertEqual((white_profile.wins, white_profile.games_played), (1, 1))
        black_profile = Profile.objects.get(user=self.black)
        self.assertEqual((black_profile.losses, black_profile.games_played), (1, 1))

        # Histórico criado com rating congelado
        white_history = GameHistory.objects.get(user=self.white)
        self.assertEqual(white_history.modality, "rapid")
        self.assertEqual(white_history.rating_before, white_history.rating_after)
        self.assertEqual(white_history.rating_before, 1600)
        black_history = GameHistory.objects.get(user=self.black)
        self.assertEqual(black_history.rating_before, black_history.rating_after)

    def test_timed_game_still_rated_regression(self):
        """Regressão: com relógio (mesmo rápido, >10 min) segue rateando."""
        self.post_result("white", time_control=900)
        self.assertGreater(self.rating_of(self.white, "rapid").rating, 1500)
        self.assertEqual(self.rating_of(self.white, "rapid").games_played, 1)

    def test_invalid_time_control_returns_400(self):
        response = self.post_result("white", time_control="blitz")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_wrong_secret_returns_403(self):
        response = self.client.post(
            GAME_RESULT_URL,
            {"white_id": self.white.id, "black_id": self.black.id, "result": "white"},
            format="json",
            headers={"X-Internal-Secret": "wrong"},
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class AiGameResultViewGlickoTests(APITestCase):
    """Partida vs IA: POST /game/ai-result/ pelo app autenticado."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="player@chess.com", full_name="Player", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=self.user)

    def rating_of(self, modality):
        return ModalityRating.objects.get(profile__user=self.user, modality=modality)

    def test_win_creates_modality_rating_and_history(self):
        response = self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": "medium", "time_control": 60},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["modality"], "bullet")
        self.assertGreater(response.data["rating"], 1500)
        self.assertTrue(response.data["provisional"])

        history = GameHistory.objects.get(user=self.user)
        self.assertEqual(history.modality, "bullet")
        self.assertEqual(history.mode, GameHistory.MODE_AI)

    def test_payload_without_time_control_defaults_to_blitz(self):
        """Compatibilidade: app antigo envia só result + difficulty."""
        response = self.client.post(
            AI_RESULT_URL, {"result": "loss", "difficulty": "easy"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["modality"], "blitz")

    def test_null_time_control_is_rapid_and_unrated(self):
        """Partida sem relógio ("Sem limite"): modalidade rápido, mas não
        rateada — conta stats/histórico e congela o rating."""
        response = self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": "medium", "time_control": None},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["modality"], "rapid")
        self.assertEqual(response.data["rating"], 1500)
        self.assertEqual(response.data["deviation"], 350)
        self.assertTrue(response.data["provisional"])

        # Sem linha de rating criada; stats e histórico registrados
        self.assertFalse(
            ModalityRating.objects.filter(profile__user=self.user).exists()
        )
        profile = Profile.objects.get(user=self.user)
        self.assertEqual((profile.wins, profile.games_played), (1, 1))
        self.assertEqual(profile.rating, 1200)  # espelho intocado

        history = GameHistory.objects.get(user=self.user)
        self.assertEqual(history.modality, "rapid")
        self.assertEqual(history.rating_before, history.rating_after)

    def test_beating_hard_ai_pays_more_than_easy(self):
        first = self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": "hard", "time_control": 300},
            format="json",
        )
        gain_hard = first.data["rating"] - 1500

        other = User.objects.create_user(
            email="p2@chess.com", full_name="P2", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=other)
        second = self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": "easy", "time_control": 300},
            format="json",
        )
        gain_easy = second.data["rating"] - 1500

        self.assertGreater(gain_hard, gain_easy)

    def test_ai_games_do_not_mix_modalities(self):
        self.client.post(
            AI_RESULT_URL,
            {"result": "win", "difficulty": "medium", "time_control": 60},
            format="json",
        )
        self.client.post(
            AI_RESULT_URL,
            {"result": "loss", "difficulty": "medium", "time_control": 600},
            format="json",
        )
        self.assertEqual(self.rating_of("bullet").games_played, 1)
        self.assertEqual(self.rating_of("blitz").games_played, 1)
        self.assertFalse(
            ModalityRating.objects.filter(
                profile__user=self.user, modality="rapid"
            ).exists()
        )


@override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET)
class LeaderboardModalityTests(APITestCase):
    def setUp(self):
        # O leaderboard é público e throttled (anon 20/min); no CI a suíte
        # inteira compartilha o contador via Redis — zera para não herdar
        # requisições anônimas dos testes anteriores.
        cache.clear()

    def make_player(self, email, blitz=None, bullet=None):
        user = User.objects.create_user(
            email=email, full_name=email.split("@")[0], password="Xadrez@2024"
        )
        profile = user.profile
        profile.games_played = 1
        profile.save(update_fields=["games_played"])
        if blitz is not None:
            ModalityRating.objects.create(
                profile=profile, modality="blitz", rating=blitz, games_played=1
            )
        if bullet is not None:
            ModalityRating.objects.create(
                profile=profile, modality="bullet", rating=bullet, games_played=25
            )
        return user

    def test_default_is_blitz_ordered_by_rating(self):
        self.make_player("a@chess.com", blitz=1600)
        self.make_player("b@chess.com", blitz=1700)
        self.make_player("c@chess.com", bullet=1900)  # não joga blitz

        response = self.client.get(LEADERBOARD_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([r["rating"] for r in response.data], [1700, 1600])
        self.assertEqual(response.data[0]["full_name"], "b")
        self.assertTrue(response.data[0]["provisional"])

    def test_modality_param_filters_ranking(self):
        self.make_player("a@chess.com", blitz=1600)
        self.make_player("c@chess.com", bullet=1900)

        response = self.client.get(LEADERBOARD_URL, {"modality": "bullet"})
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["rating"], 1900)
        self.assertFalse(response.data[0]["provisional"])  # 25 partidas

    def test_invalid_modality_returns_400(self):
        response = self.client.get(LEADERBOARD_URL, {"modality": "correspondence"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ProfileRatingsTests(APITestCase):
    def test_profile_exposes_ratings_per_modality_with_defaults(self):
        user = User.objects.create_user(
            email="fresh@chess.com", full_name="Fresh", password="Xadrez@2024"
        )
        self.client.force_authenticate(user=user)

        response = self.client.get(PROFILE_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ratings = response.data["ratings"]
        self.assertEqual(set(ratings.keys()), {"bullet", "blitz", "rapid"})
        for modality in ratings.values():
            self.assertEqual(modality["rating"], 1500)
            self.assertEqual(modality["deviation"], 350)
            self.assertTrue(modality["provisional"])
        # Espelho Elo legado permanece no payload
        self.assertEqual(response.data["rating"], 1200)
