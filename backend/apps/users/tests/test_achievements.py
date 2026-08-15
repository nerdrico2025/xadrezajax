"""
Testes do sistema de conquistas.

O que esta camada precisa garantir:

  - cada um dos 6 tipos de regra, isoladamente, com fixture determinística;
  - partida ONLINE concede aos DOIS jogadores, não só a quem fez a request
    (quem faz a request é o node-api — se olhássemos só para ela, ninguém
    ganharia nada);
  - conquista NUNCA derruba o registro do resultado: avaliador quebrado, o
    resultado da partida é salvo do mesmo jeito;
  - o unique_together impede desbloqueio duplicado em reprocessamento;
  - `nova` reflete `seen_at`, e o POST /seen/ desliga a comemoração.

Sistema IRMÃO do Modo Campanha: nada aqui toca CampaignProgress nem
CampaignWinLog.
"""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.achievements import check_achievements
from apps.users.models import (
    AchievementDefinition,
    Game,
    GameHistory,
    UserAchievement,
    get_or_create_profile,
)

User = get_user_model()

LIST_URL = reverse("users:achievement-list")
SEEN_URL = reverse("users:achievement-seen")
GAME_RESULT_URL = reverse("users:game-result")

INTERNAL_SECRET = "test-internal-secret"


def clear_catalog():
    """Zera o catálogo semeado pela migration 0022.

    Estes testes exercitam o MECANISMO (regras, concessão, endpoints), então
    cada um monta o catálogo de que precisa. As 7 definições reais têm teste
    próprio, em SeedTests — misturar as duas coisas deixaria cada asserção
    dependente do conteúdo do seed, que é dado de produto e vai mudar.
    """
    AchievementDefinition.objects.all().delete()


def make_user(email="a@chess.com"):
    user = User.objects.create_user(
        email=email, full_name="Jogador", password="Xadrez@2024"
    )
    get_or_create_profile(user)
    return user


def definition(code="test", rule_type="games_played", params=None, **over):
    data = {
        "code": code,
        "name": code,
        "description": "d",
        "icon": "trophy-outline",
        "category": "partidas",
        "trigger": AchievementDefinition.TRIGGER_GAME,
        "rule_type": rule_type,
        "params": params if params is not None else {"threshold": 1},
    }
    data.update(over)
    return AchievementDefinition.objects.create(**data)


def play(user, result="win", rated=False, when=None):
    history = GameHistory.objects.create(
        user=user,
        opponent_name="X",
        result=result,
        mode=GameHistory.MODE_AI,
        modality="blitz",
        rating_before=1200,
        rating_after=1200,
        rated=rated,
    )
    if when is not None:
        # `played_at` é auto_now_add — para testar ORDEM é preciso reescrever.
        GameHistory.objects.filter(pk=history.pk).update(played_at=when)
        history.refresh_from_db()
    return history


class RegrasTests(APITestCase):
    """Os 6 tipos de regra, um a um."""

    def setUp(self):
        clear_catalog()
        self.user = make_user()

    def _concede(self, defn, context=None):
        novas = check_achievements(self.user, defn.trigger, context)
        return [n.achievement.code for n in novas]

    def test_win_count(self):
        defn = definition("first_win", "win_count", {"threshold": 1})
        self.assertEqual(self._concede(defn), [])
        play(self.user, "win")
        self.assertEqual(self._concede(defn), ["first_win"])

    def test_win_count_ignora_derrota(self):
        defn = definition("first_win", "win_count", {"threshold": 1})
        play(self.user, "loss")
        self.assertEqual(self._concede(defn), [])

    def test_rated_win_count_so_conta_partida_valendo_rating(self):
        defn = definition("rated", "rated_win_count", {"threshold": 1})
        play(self.user, "win", rated=False)  # vs IA
        self.assertEqual(self._concede(defn), [])
        play(self.user, "win", rated=True)
        self.assertEqual(self._concede(defn), ["rated"])

    def test_games_played_conta_qualquer_resultado(self):
        defn = definition("g3", "games_played", {"threshold": 3})
        play(self.user, "win")
        play(self.user, "loss")
        self.assertEqual(self._concede(defn), [])
        play(self.user, "draw")
        self.assertEqual(self._concede(defn), ["g3"])

    def test_win_streak_precisa_ser_seguida(self):
        defn = definition("s3", "win_streak", {"threshold": 3})
        agora = timezone.now()
        play(self.user, "win", when=agora - timedelta(minutes=5))
        play(self.user, "loss", when=agora - timedelta(minutes=4))
        play(self.user, "win", when=agora - timedelta(minutes=3))
        play(self.user, "win", when=agora - timedelta(minutes=2))
        # 2 seguidas, com uma derrota antes: ainda não.
        self.assertEqual(self._concede(defn), [])
        play(self.user, "win", when=agora - timedelta(minutes=1))
        self.assertEqual(self._concede(defn), ["s3"])

    def _game(self, **over):
        data = {
            "white_player": self.user,
            "white_name": "Eu",
            "black_name": "Rival",
            "result": "white",
            "termination": "checkmate",
            "mode": Game.MODE_ONLINE,
            "ply_count": 15,
        }
        data.update(over)
        return Game.objects.create(**data)

    def test_fast_checkmate(self):
        defn = definition("mate", "fast_checkmate", {"max_plies": 20})
        game = self._game()
        self.assertEqual(self._concede(defn, {"game": game}), ["mate"])

    def test_fast_checkmate_ignora_partida_longa(self):
        defn = definition("mate", "fast_checkmate", {"max_plies": 20})
        game = self._game(ply_count=40)
        self.assertEqual(self._concede(defn, {"game": game}), [])

    def test_fast_checkmate_exige_termination_preenchido(self):
        """Campo é ADITIVO: partida antiga tem "" e não pode virar mate."""
        defn = definition("mate", "fast_checkmate", {"max_plies": 20})
        game = self._game(termination="")
        self.assertEqual(self._concede(defn, {"game": game}), [])

    def test_fast_checkmate_exige_que_o_usuario_tenha_VENCIDO(self):
        """Houve mate rápido, mas quem levou foi o usuário."""
        defn = definition("mate", "fast_checkmate", {"max_plies": 20})
        game = self._game(result="black")  # user é o das brancas
        self.assertEqual(self._concede(defn, {"game": game}), [])

    def test_fast_checkmate_sem_game_no_contexto(self):
        defn = definition("mate", "fast_checkmate", {"max_plies": 20})
        self.assertEqual(self._concede(defn, {}), [])

    def test_puzzle_streak_usa_current_streak(self):
        defn = definition(
            "p7",
            "puzzle_streak",
            {"threshold": 7},
            trigger=AchievementDefinition.TRIGGER_PUZZLE,
        )
        with patch("apps.puzzles.views._current_streak", return_value=6):
            self.assertEqual(self._concede(defn), [])
        with patch("apps.puzzles.views._current_streak", return_value=7):
            self.assertEqual(self._concede(defn), ["p7"])


class ResilienciaTests(APITestCase):
    """Conquista é bônus: não pode derrubar nada."""

    def setUp(self):
        clear_catalog()
        self.user = make_user()

    def test_avaliador_quebrado_nao_propaga_excecao(self):
        definition("quebrada", "win_count", {"threshold": 1})
        play(self.user, "win")
        with patch(
            "apps.users.achievements._eval_win_count",
            side_effect=RuntimeError("boom"),
        ):
            with patch.dict(
                "apps.users.achievements.RULE_EVALUATORS",
                {"win_count": lambda *a: (_ for _ in ()).throw(RuntimeError("boom"))},
            ):
                novas = check_achievements(
                    self.user, AchievementDefinition.TRIGGER_GAME
                )
        self.assertEqual(novas, [])

    def test_uma_regra_ruim_nao_derruba_as_outras(self):
        definition("boa", "games_played", {"threshold": 1})
        definition("ruim", "win_streak", {"threshold": 1})
        play(self.user, "win")

        def explode(*_args, **_kwargs):
            raise RuntimeError("boom")

        with patch.dict(
            "apps.users.achievements.RULE_EVALUATORS", {"win_streak": explode}
        ):
            novas = check_achievements(self.user, AchievementDefinition.TRIGGER_GAME)
        self.assertEqual([n.achievement.code for n in novas], ["boa"])

    def test_regra_desconhecida_e_ignorada(self):
        """Banco à frente do código: conceder às cegas seria pior."""
        definition("futura", "regra_que_nao_existe", {"threshold": 1})
        play(self.user, "win")
        self.assertEqual(
            check_achievements(self.user, AchievementDefinition.TRIGGER_GAME), []
        )

    def test_reprocessamento_nao_desbloqueia_duas_vezes(self):
        defn = definition("first_win", "win_count", {"threshold": 1})
        play(self.user, "win")
        primeira = check_achievements(self.user, AchievementDefinition.TRIGGER_GAME)
        segunda = check_achievements(self.user, AchievementDefinition.TRIGGER_GAME)
        self.assertEqual(len(primeira), 1)
        self.assertEqual(segunda, [])
        self.assertEqual(
            UserAchievement.objects.filter(user=self.user, achievement=defn).count(), 1
        )

    def test_definicao_inativa_nao_e_avaliada(self):
        definition("off", "win_count", {"threshold": 1}, is_active=False)
        play(self.user, "win")
        self.assertEqual(
            check_achievements(self.user, AchievementDefinition.TRIGGER_GAME), []
        )


class EndpointTests(APITestCase):
    def setUp(self):
        clear_catalog()
        self.user = make_user()
        self.client.force_authenticate(self.user)

    def test_lista_traz_nao_conquistadas_com_progresso(self):
        definition("g10", "games_played", {"threshold": 10})
        play(self.user, "win")
        play(self.user, "loss")

        response = self.client.get(LIST_URL)
        item = next(i for i in response.data if i["code"] == "g10")
        self.assertFalse(item["conquistada"])
        self.assertEqual(item["progresso"], {"atual": 2, "alvo": 10})

    def test_conquistada_nao_traz_progresso(self):
        definition("g1", "games_played", {"threshold": 1})
        play(self.user, "win")
        check_achievements(self.user, AchievementDefinition.TRIGGER_GAME)

        response = self.client.get(LIST_URL)
        item = next(i for i in response.data if i["code"] == "g1")
        self.assertTrue(item["conquistada"])
        self.assertNotIn("progresso", item)
        self.assertIsNotNone(item["conquistada_em"])

    def test_nova_e_true_ate_o_post_seen(self):
        definition("g1", "games_played", {"threshold": 1})
        play(self.user, "win")
        check_achievements(self.user, AchievementDefinition.TRIGGER_GAME)

        item = next(i for i in self.client.get(LIST_URL).data if i["code"] == "g1")
        self.assertTrue(item["nova"])

        response = self.client.post(SEEN_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["marcadas"], 1)

        item = next(i for i in self.client.get(LIST_URL).data if i["code"] == "g1")
        self.assertFalse(item["nova"])

    def test_seen_com_codes_marca_so_o_pedido(self):
        definition("a1", "games_played", {"threshold": 1})
        definition("a2", "win_count", {"threshold": 1})
        play(self.user, "win")
        check_achievements(self.user, AchievementDefinition.TRIGGER_GAME)

        self.client.post(SEEN_URL, {"codes": ["a1"]}, format="json")
        data = {i["code"]: i for i in self.client.get(LIST_URL).data}
        self.assertFalse(data["a1"]["nova"])
        self.assertTrue(data["a2"]["nova"])

    def test_seen_rejeita_codes_que_nao_e_lista(self):
        response = self.client.post(SEEN_URL, {"codes": "a1"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_seen_nao_recarimba_o_que_ja_foi_visto(self):
        definition("a1", "games_played", {"threshold": 1})
        play(self.user, "win")
        check_achievements(self.user, AchievementDefinition.TRIGGER_GAME)
        self.client.post(SEEN_URL, {}, format="json")
        response = self.client.post(SEEN_URL, {}, format="json")
        self.assertEqual(response.data["marcadas"], 0)

    def test_exige_autenticacao(self):
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(LIST_URL).status_code, status.HTTP_401_UNAUTHORIZED
        )


class PartidaOnlineTests(APITestCase):
    """O caso que um teste ingênuo deixaria passar: partida online concede aos
    DOIS jogadores. Quem faz a requisição é o node-api, não um deles."""

    def setUp(self):
        clear_catalog()
        self.white = make_user("w@chess.com")
        self.black = make_user("b@chess.com")
        definition("first_win", "win_count", {"threshold": 1})
        definition("g1", "games_played", {"threshold": 1})

    def test_concede_aos_dois_jogadores(self):
        from django.test import override_settings

        with override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET):
            response = self.client.post(
                GAME_RESULT_URL,
                {
                    "white_id": self.white.id,
                    "black_id": self.black.id,
                    "result": "white",
                    "time_control": 300,
                    "external_id": "G-ACH-1",
                    "termination": "checkmate",
                },
                format="json",
                headers={"X-Internal-Secret": INTERNAL_SECRET},
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # As brancas venceram: ganham "primeira vitória" E "1 partida".
        brancas = set(
            UserAchievement.objects.filter(user=self.white).values_list(
                "achievement__code", flat=True
            )
        )
        self.assertEqual(brancas, {"first_win", "g1"})

        # As pretas perderam, mas JOGARAM — a conquista de volume conta.
        pretas = set(
            UserAchievement.objects.filter(user=self.black).values_list(
                "achievement__code", flat=True
            )
        )
        self.assertEqual(pretas, {"g1"})

    def test_resposta_traz_conquistas_novas_por_jogador(self):
        from django.test import override_settings

        with override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET):
            response = self.client.post(
                GAME_RESULT_URL,
                {
                    "white_id": self.white.id,
                    "black_id": self.black.id,
                    "result": "white",
                    "time_control": 300,
                    "external_id": "G-ACH-2",
                },
                format="json",
                headers={"X-Internal-Secret": INTERNAL_SECRET},
            )
        codes_w = {c["code"] for c in response.data["white"]["conquistas_novas"]}
        codes_b = {c["code"] for c in response.data["black"]["conquistas_novas"]}
        self.assertIn("first_win", codes_w)
        self.assertNotIn("first_win", codes_b)

    def test_avaliador_quebrado_nao_impede_o_registro_da_partida(self):
        """O cenário REAL: uma regra explode no meio do fim de partida.

        A partida tem de ser registrada do mesmo jeito — conquista é bônus.
        (Simular `check_achievements` levantando não testaria nada: ela é
        blindada por contrato; quem pode quebrar é um avaliador.)
        """
        from django.test import override_settings

        def explode(*_args, **_kwargs):
            raise RuntimeError("boom")

        with patch.dict(
            "apps.users.achievements.RULE_EVALUATORS", {"win_count": explode}
        ):
            with override_settings(INTERNAL_API_SECRET=INTERNAL_SECRET):
                response = self.client.post(
                    GAME_RESULT_URL,
                    {
                        "white_id": self.white.id,
                        "black_id": self.black.id,
                        "result": "white",
                        "time_control": 300,
                        "external_id": "G-ACH-3",
                    },
                    format="json",
                    headers={"X-Internal-Secret": INTERNAL_SECRET},
                )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # A partida e os DOIS extratos existem, apesar da regra quebrada.
        self.assertEqual(GameHistory.objects.count(), 2)
        # A conquista da regra sã foi concedida; a da quebrada, não.
        codes = set(UserAchievement.objects.values_list("achievement__code", flat=True))
        self.assertIn("g1", codes)
        self.assertNotIn("first_win", codes)


class SeedTests(APITestCase):
    """As 7 definições do primeiro corte, vindas da migration 0022."""

    def test_seed_criou_as_sete(self):
        codes = set(AchievementDefinition.objects.values_list("code", flat=True))
        self.assertEqual(
            codes,
            {
                "first_win",
                "first_rated_win",
                "games_10",
                "games_50",
                "win_streak_3",
                "fast_mate_10",
                "puzzle_streak_7",
            },
        )

    def test_toda_definicao_tem_avaliador_registrado(self):
        """Uma definição sem avaliador seria ignorada em silêncio para sempre."""
        from apps.users.achievements import RULE_EVALUATORS

        for definicao in AchievementDefinition.objects.all():
            self.assertIn(definicao.rule_type, RULE_EVALUATORS, definicao.code)

    def test_limiares_estao_em_dado_e_nao_em_codigo(self):
        por_code = {d.code: d for d in AchievementDefinition.objects.all()}
        self.assertEqual(por_code["games_10"].params, {"threshold": 10})
        self.assertEqual(por_code["games_50"].params, {"threshold": 50})
        self.assertEqual(por_code["fast_mate_10"].params, {"max_plies": 20})
        self.assertEqual(por_code["puzzle_streak_7"].params, {"threshold": 7})
        # 10 e 50 são a MESMA regra com parâmetro diferente — é o que torna
        # "100 partidas" uma linha nova em vez de um deploy.
        self.assertEqual(por_code["games_10"].rule_type, por_code["games_50"].rule_type)
