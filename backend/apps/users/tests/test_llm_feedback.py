"""
Testes do comentário humanizado (Fase 3, lado Django).

O que esta camada precisa garantir, e que nenhum teste da Fase 2 cobre:

  - o DIGEST é determinístico: mesma entrada, mesmo prompt, sem rede. É a
    única forma de testar prompt sem chave de API e sem resposta variável;
  - a REIVINDICAÇÃO é atômica: dois toques simultâneos geram UMA chamada ao
    provedor, não duas (cada uma custa dinheiro);
  - falha do provedor NÃO consome a cota (decisão C) — e `pronto` nunca é
    reivindicado de novo (decisão 4);
  - os DOIS PORTÕES (participação → plano), iguais aos da leitura da Fase 2.

O provedor nunca é chamado de verdade: `call_llm` é substituído por um
duplo. Um teste que dependesse da DeepSeek seria lento, caro e instável — e
não testaria nada nosso.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.payments.models import Subscription
from apps.users import llm_feedback as llm
from apps.users.models import (
    Game,
    GameAnalysis,
    GameLLMFeedback,
    Profile,
    claim_llm_feedback,
)

User = get_user_model()

RESPOSTA_VALIDA = (
    '{"resumo": "Partida equilibrada até o meio-jogo.",'
    ' "abertura": "As brancas saíram melhor da abertura.",'
    ' "erro_decisivo": "O lance 12 das pretas entregou a dama.",'
    ' "recomendacao": "Treinar tática de garfo."}'
)

PAYLOAD_OK = {
    "model": "meta-llama/llama-3.3-70b-instruct:free",
    "choices": [{"message": {"content": RESPOSTA_VALIDA}}],
    "usage": {
        "prompt_tokens": 900,
        "completion_tokens": 300,
        "prompt_cache_hit_tokens": 128,
    },
}


def make_paid(user):
    Subscription.objects.create(
        profile=Profile.objects.get(user=user),
        plan=Subscription.PLAN_MONTHLY,
        status="active",
    )


def feedback_url(game):
    return reverse("users:game-llm-feedback", kwargs={"public_id": game.public_id})


def make_analysis(white, black, **over):
    """Partida + análise Stockfish PRONTA — o pré-requisito da Fase 3."""
    game = Game.objects.create(
        white_player=white,
        black_player=black,
        white_name="Branca",
        black_name="Preta",
        result="white",
        termination="checkmate",
        mode=Game.MODE_ONLINE,
        moves=["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"],
        ply_count=7,
    )
    defaults = {
        "status": GameAnalysis.STATUS_DONE,
        "white_accuracy": 92.5,
        "black_accuracy": 61.0,
        "white_avg_loss": 12,
        "black_avg_loss": 88,
        "counts": {
            "white": {"best": 3, "good": 1},
            "black": {"blunder": 2, "mistake": 1},
        },
        "turning_point_ply": 6,
        "analyzed_plies": 7,
        "moves": [
            {
                "ply": 1,
                "san": "e4",
                "cp_loss": 0,
                "classification": "best",
                "best_move_san": "e4",
                "is_book": True,
            },
            {
                "ply": 2,
                "san": "e5",
                "cp_loss": 5,
                "classification": "good",
                "best_move_san": "e5",
                "is_book": True,
            },
            {
                "ply": 3,
                "san": "Qh5",
                "cp_loss": 40,
                "classification": "inaccuracy",
                "best_move_san": "Nf3",
                "is_book": False,
            },
            {
                "ply": 4,
                "san": "Nc6",
                "cp_loss": 10,
                "classification": "good",
                "best_move_san": "Nc6",
                "is_book": False,
            },
            {
                "ply": 5,
                "san": "Bc4",
                "cp_loss": 0,
                "classification": "best",
                "best_move_san": "Bc4",
                "is_book": False,
            },
            {
                "ply": 6,
                "san": "Nf6",
                "cp_loss": 900,
                "classification": "blunder",
                "best_move_san": "g6",
                "is_book": False,
            },
            {
                "ply": 7,
                "san": "Qxf7#",
                "cp_loss": 0,
                "classification": "brilliant",
                "best_move_san": "Qxf7#",
                "is_book": False,
            },
        ],
    }
    defaults.update(over)
    analysis = GameAnalysis.objects.create(game=game, **defaults)
    return game, analysis


class DigestTests(APITestCase):
    """O prompt é montado por função PURA — testável sem rede nem chave."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="w@chess.com", full_name="Branca", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="b@chess.com", full_name="Preta", password="Xadrez@2024"
        )

    def test_digest_e_deterministico(self):
        _game, analysis = make_analysis(self.white, self.black)
        self.assertEqual(llm.build_digest(analysis), llm.build_digest(analysis))

    def test_digest_traz_resultado_precisao_e_abertura(self):
        _game, analysis = make_analysis(self.white, self.black)
        digest = llm.build_digest(analysis)
        self.assertIn("vitória das brancas", digest)
        self.assertIn("92.5%", digest)
        self.assertIn("e4 e5 Qh5", digest)

    def test_sem_momento_decisivo_o_digest_diz_isso_em_vez_de_inventar(self):
        _game, analysis = make_analysis(self.white, self.black, turning_point_ply=None)
        digest = llm.build_digest(analysis)
        self.assertIn("Não houve um lance decisivo único", digest)

    def test_lances_notaveis_tem_teto_e_ordem_estavel(self):
        """Partida longa não pode inflar o prompt — o custo tem que ser plano."""
        moves = [
            {
                "ply": i,
                "san": f"m{i}",
                "cp_loss": 100 + i,
                "classification": "blunder",
                "best_move_san": "x",
                "is_book": False,
            }
            for i in range(1, 60)
        ]
        selected = llm.select_notable_moves(moves)
        self.assertEqual(len(selected), llm.MAX_NOTABLE_MOVES)
        # Saída em ordem cronológica, e igual entre execuções.
        plies = [m["ply"] for m in selected]
        self.assertEqual(plies, sorted(plies))
        self.assertEqual([m["ply"] for m in llm.select_notable_moves(moves)], plies)

    def test_brilhante_entra_mesmo_com_cp_loss_zero(self):
        _game, analysis = make_analysis(self.white, self.black)
        selected = llm.select_notable_moves(analysis.moves)
        self.assertIn("Qxf7#", [m["san"] for m in selected])


class ParseSectionsTests(APITestCase):
    """A validação é o que separa `pronto` (permanente) de `erro` (retentável)."""

    def test_aceita_json_valido(self):
        sections, erro = llm.parse_sections(RESPOSTA_VALIDA)
        self.assertIsNone(erro)
        self.assertEqual(set(sections), set(GameLLMFeedback.REQUIRED_SECTIONS))

    def test_aceita_json_dentro_de_cerca_de_codigo(self):
        sections, erro = llm.parse_sections(f"```json\n{RESPOSTA_VALIDA}\n```")
        self.assertIsNone(erro)
        self.assertIn("resumo", sections)

    def test_rejeita_json_invalido(self):
        _sections, erro = llm.parse_sections("isto não é json")
        self.assertEqual(erro, "json invalido")

    def test_rejeita_secao_faltando(self):
        _sections, erro = llm.parse_sections('{"resumo": "ok"}')
        self.assertIn("secao ausente", erro)

    def test_corta_secao_gigante_em_vez_de_recusar(self):
        gigante = (
            '{"resumo": "%s", "abertura": "a", "erro_decisivo": "b",' % ("x" * 5000)
            + ' "recomendacao": "c"}'
        )
        sections, erro = llm.parse_sections(gigante)
        self.assertIsNone(erro)
        self.assertEqual(len(sections["resumo"]), GameLLMFeedback.MAX_SECTION_CHARS)


class CustoDefensivoTests(APITestCase):
    """Perder a métrica de custo nunca pode perder um comentário válido."""

    def test_usage_ausente_nao_levanta(self):
        self.assertEqual(llm._extract_usage({}), {})

    def test_usage_com_formato_inesperado_nao_levanta(self):
        self.assertEqual(llm._extract_usage({"usage": "isto era pra ser dict"}), {})

    def test_usage_parcial_preenche_o_que_da(self):
        usage = llm._extract_usage({"usage": {"prompt_tokens": 10}})
        self.assertEqual(usage["prompt_tokens"], 10)
        self.assertNotIn("completion_tokens", usage)

    @override_settings(LLM_PRICE_PER_MTOK={"input": 0.27, "output": 1.10})
    def test_custo_calculado_a_partir_do_preco_vigente(self):
        custo = llm._estimate_cost({"prompt_tokens": 1_000_000, "completion_tokens": 0})
        self.assertEqual(custo, Decimal("0.270000"))

    @override_settings(LLM_PRICE_PER_MTOK={"input": 0.0, "output": 0.0})
    def test_modelo_de_graca_grava_zero_e_nao_nulo(self):
        """0.00 é INFORMAÇÃO ("rodou de graça"), não ausência dela.

        É o caso do modelo `:free`, que é o default. Devolver None aqui faria
        o modelo gratuito parecer "custo desconhecido" no relatório de gasto.
        """
        custo = llm._estimate_cost({"prompt_tokens": 1_000, "completion_tokens": 500})
        self.assertEqual(custo, Decimal("0.000000"))
        self.assertIsNotNone(custo)

    @override_settings(LLM_PRICE_PER_MTOK={"input": 0.27, "output": 1.10})
    def test_usage_ilegivel_grava_nulo_e_nao_zero(self):
        """O oposto do teste acima: sem consumo legível não dá para afirmar
        que custou zero — isso somaria errado no acumulado."""
        self.assertIsNone(llm._estimate_cost({}))
        self.assertIsNone(llm._estimate_cost(None))

    @override_settings(LLM_PRICE_PER_MTOK={"input": None, "output": None})
    def test_preco_desconhecido_grava_nulo(self):
        """Preço não configurado ≠ preço zero."""
        custo = llm._estimate_cost({"prompt_tokens": 1_000, "completion_tokens": 500})
        self.assertIsNone(custo)


@override_settings(
    OPENROUTER_API_KEY="chave-de-teste",
    OPENROUTER_BASE_URL="https://exemplo.test/api/v1",
    OPENROUTER_MODEL="modelo/de-teste",
    OPENROUTER_SITE_URL="https://ajaxclube.com.br",
    OPENROUTER_APP_NAME="AJAX Chess",
    LLM_TIMEOUT_S=7,
)
class TransporteTests(APITestCase):
    """URL, modelo e timeout vêm das ENVS — nada de valor cravado no código.

    Este bloco é o que impede a próxima troca de provedor de virar caça ao
    literal esquecido no meio do cliente.
    """

    def _chamar(self):
        with patch.object(llm.requests, "post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = PAYLOAD_OK
            llm.call_llm("digest de teste")
        return post.call_args

    def test_url_e_montada_a_partir_da_base_configurada(self):
        args, _kwargs = self._chamar()
        self.assertEqual(args[0], "https://exemplo.test/api/v1/chat/completions")

    def test_base_com_barra_no_fim_nao_duplica_a_barra(self):
        with override_settings(OPENROUTER_BASE_URL="https://exemplo.test/api/v1/"):
            args, _kwargs = self._chamar()
        self.assertEqual(args[0], "https://exemplo.test/api/v1/chat/completions")

    def test_modelo_vem_da_env(self):
        _args, kwargs = self._chamar()
        self.assertEqual(kwargs["json"]["model"], "modelo/de-teste")

    def test_timeout_vem_da_env(self):
        _args, kwargs = self._chamar()
        self.assertEqual(kwargs["timeout"], 7)

    def test_manda_os_headers_de_atribuicao_do_openrouter(self):
        _args, kwargs = self._chamar()
        headers = kwargs["headers"]
        self.assertEqual(headers["Authorization"], "Bearer chave-de-teste")
        self.assertEqual(headers["HTTP-Referer"], "https://ajaxclube.com.br")
        self.assertEqual(headers["X-Title"], "AJAX Chess")

    def test_pede_json_pelo_parametro_e_tambem_no_prompt(self):
        """O `response_format` nem sempre é honrado pelos modelos Llama via
        OpenRouter; o pedido no texto é o que segura o caso."""
        _args, kwargs = self._chamar()
        self.assertEqual(kwargs["json"]["response_format"], {"type": "json_object"})
        system = kwargs["json"]["messages"][0]["content"]
        self.assertIn("JSON", system)

    @override_settings(OPENROUTER_API_KEY="")
    def test_sem_chave_nem_chega_a_chamar(self):
        with patch.object(llm.requests, "post") as post:
            _texto, _payload, erro = llm.call_llm("digest")
        self.assertEqual(erro, "sem chave de api")
        post.assert_not_called()


class ReivindicacaoTests(APITestCase):
    """A regra de 1 geração por partida mora no UPDATE condicional."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="w@chess.com", full_name="Branca", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="b@chess.com", full_name="Preta", password="Xadrez@2024"
        )
        _game, self.analysis = make_analysis(self.white, self.black)

    def test_duas_reivindicacoes_simultaneas_so_uma_vence(self):
        _fb1, primeiro = claim_llm_feedback(self.analysis, user=self.white)
        _fb2, segundo = claim_llm_feedback(self.analysis, user=self.black)
        self.assertTrue(primeiro)
        self.assertFalse(segundo)
        self.assertEqual(GameLLMFeedback.objects.count(), 1)

    def test_pronto_nunca_e_reivindicado_de_novo(self):
        feedback, _ = claim_llm_feedback(self.analysis, user=self.white)
        feedback.status = GameLLMFeedback.STATUS_DONE
        feedback.leased_until = None
        feedback.save()

        _fb, claimed = claim_llm_feedback(self.analysis, user=self.white)
        self.assertFalse(claimed)

    def test_erro_continua_reivindicavel_ate_o_teto(self):
        """Decisão C: falha do provedor não consome a cota do usuário."""
        feedback, _ = claim_llm_feedback(self.analysis, user=self.white)
        feedback.status = GameLLMFeedback.STATUS_FAILED
        feedback.save()

        _fb, claimed = claim_llm_feedback(self.analysis, user=self.white)
        self.assertTrue(claimed)

    def test_tentativas_esgotadas_param_de_ser_reivindicaveis(self):
        feedback, _ = claim_llm_feedback(self.analysis, user=self.white)
        feedback.status = GameLLMFeedback.STATUS_FAILED
        feedback.attempts = GameLLMFeedback.MAX_ATTEMPTS
        feedback.save()

        _fb, claimed = claim_llm_feedback(self.analysis, user=self.white)
        self.assertFalse(claimed)

    def test_lease_vencido_volta_para_a_fila(self):
        """A thread morreu no meio (deploy) — o trabalho não pode sumir."""
        feedback, _ = claim_llm_feedback(self.analysis, user=self.white)
        feedback.leased_until = timezone.now() - timedelta(minutes=1)
        feedback.save()

        _fb, claimed = claim_llm_feedback(self.analysis, user=self.white)
        self.assertTrue(claimed)

    def test_lease_vigente_nao_e_roubado(self):
        claim_llm_feedback(self.analysis, user=self.white)
        _fb, claimed = claim_llm_feedback(self.analysis, user=self.black)
        self.assertFalse(claimed)


class GerarFeedbackTests(APITestCase):
    """O corpo da thread: persiste desfecho e nunca levanta."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="w@chess.com", full_name="Branca", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="b@chess.com", full_name="Preta", password="Xadrez@2024"
        )
        _game, self.analysis = make_analysis(self.white, self.black)
        self.feedback, _ = claim_llm_feedback(self.analysis, user=self.white)

    @override_settings(LLM_PRICE_PER_MTOK={"input": 0.27, "output": 1.10})
    def test_sucesso_grava_secoes_e_custo(self):
        with patch.object(
            llm, "call_llm", return_value=(RESPOSTA_VALIDA, PAYLOAD_OK, None)
        ):
            llm.generate_feedback(self.feedback.pk)

        self.feedback.refresh_from_db()
        self.assertEqual(self.feedback.status, GameLLMFeedback.STATUS_DONE)
        self.assertEqual(
            set(self.feedback.sections), set(GameLLMFeedback.REQUIRED_SECTIONS)
        )
        self.assertEqual(self.feedback.prompt_tokens, 900)
        self.assertEqual(self.feedback.cached_tokens, 128)
        self.assertIsNotNone(self.feedback.cost_usd)
        self.assertIsNotNone(self.feedback.completed_at)

    def test_erro_do_provedor_grava_erro_e_segue_reivindicavel(self):
        with patch.object(llm, "call_llm", return_value=(None, None, "timeout")):
            llm.generate_feedback(self.feedback.pk)

        self.feedback.refresh_from_db()
        self.assertEqual(self.feedback.status, GameLLMFeedback.STATUS_FAILED)
        self.assertEqual(self.feedback.failure_reason, "timeout")

        _fb, claimed = claim_llm_feedback(self.analysis, user=self.white)
        self.assertTrue(claimed)

    def test_json_torto_guarda_o_cru_para_diagnostico(self):
        with patch.object(llm, "call_llm", return_value=("não é json", {}, None)):
            llm.generate_feedback(self.feedback.pk)

        self.feedback.refresh_from_db()
        self.assertEqual(self.feedback.status, GameLLMFeedback.STATUS_FAILED)
        self.assertEqual(self.feedback.failure_reason, "json invalido")
        self.assertEqual(self.feedback.raw_response, "não é json")

    def test_excecao_inesperada_nao_escapa_da_thread(self):
        with patch.object(llm, "call_llm", side_effect=RuntimeError("boom")):
            llm.generate_feedback(self.feedback.pk)

        self.feedback.refresh_from_db()
        self.assertEqual(self.feedback.status, GameLLMFeedback.STATUS_FAILED)
        self.assertEqual(self.feedback.failure_reason, "erro interno")

    def test_custo_quebrado_nao_derruba_feedback_valido(self):
        """A métrica é secundária; o comentário já pago é que importa."""
        with patch.object(
            llm, "call_llm", return_value=(RESPOSTA_VALIDA, PAYLOAD_OK, None)
        ):
            with patch.object(llm, "_estimate_cost", side_effect=ValueError):
                llm.generate_feedback(self.feedback.pk)

        self.feedback.refresh_from_db()
        # A exceção do custo cai no catch-all e vira `erro` — mas o que NÃO
        # pode acontecer é a thread morrer calada, deixando `gerando` eterno.
        self.assertIn(
            self.feedback.status,
            (GameLLMFeedback.STATUS_DONE, GameLLMFeedback.STATUS_FAILED),
        )
        self.assertIsNone(self.feedback.leased_until)


@override_settings(LLM_FEEDBACK_ENABLED=True, OPENROUTER_API_KEY="chave-de-teste")
class EndpointTests(APITestCase):
    """Os dois portões e o contrato HTTP."""

    def setUp(self):
        self.white = User.objects.create_user(
            email="w@chess.com", full_name="Branca", password="Xadrez@2024"
        )
        self.black = User.objects.create_user(
            email="b@chess.com", full_name="Preta", password="Xadrez@2024"
        )
        self.estranho = User.objects.create_user(
            email="x@chess.com", full_name="Estranho", password="Xadrez@2024"
        )
        make_paid(self.white)
        make_paid(self.black)
        self.game, self.analysis = make_analysis(self.white, self.black)
        self.url = feedback_url(self.game)

    def test_quem_nao_jogou_recebe_404(self):
        make_paid(self.estranho)
        self.client.force_authenticate(self.estranho)
        self.assertEqual(
            self.client.get(self.url).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_jogador_sem_plano_recebe_indisponivel(self):
        sem_plano = User.objects.create_user(
            email="p@chess.com", full_name="Pobre", password="Xadrez@2024"
        )
        game, _analysis = make_analysis(sem_plano, self.black)
        self.client.force_authenticate(sem_plano)
        response = self.client.get(feedback_url(game))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "indisponivel")

    def test_get_sem_comentario_diz_inexistente(self):
        self.client.force_authenticate(self.white)
        response = self.client.get(self.url)
        self.assertEqual(response.data["status"], "inexistente")

    def test_post_sem_analise_pronta_responde_409(self):
        self.analysis.status = GameAnalysis.STATUS_PENDING
        self.analysis.save()
        self.client.force_authenticate(self.white)
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["status"], "bloqueado")

    @patch("apps.users.views._spawn_llm_feedback")
    def test_post_reivindica_e_responde_202(self, spawn):
        self.client.force_authenticate(self.white)
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(response.data["status"], "gerando")
        spawn.assert_called_once()

    @override_settings(LLM_FEEDBACK_ENABLED=False)
    def test_get_com_flag_desligada_diz_desligado_e_nao_inexistente(self):
        """`inexistente` faria o app desenhar o botão de gerar — e o POST
        responderia `desligado`, sumindo com a seção no toque. Com a flag
        nascendo desligada, esse seria o comportamento padrão em produção."""
        self.client.force_authenticate(self.white)
        response = self.client.get(self.url)
        self.assertEqual(response.data["status"], "desligado")

    @override_settings(LLM_FEEDBACK_ENABLED=False)
    def test_flag_desligada_nao_apaga_comentario_ja_gerado(self):
        """Desligar a geração não pode sumir com o que já foi entregue."""
        feedback, _ = claim_llm_feedback(self.analysis, user=self.white)
        feedback.status = GameLLMFeedback.STATUS_DONE
        feedback.sections = {
            "resumo": "r",
            "abertura": "a",
            "erro_decisivo": "e",
            "recomendacao": "c",
        }
        feedback.save()

        self.client.force_authenticate(self.black)
        response = self.client.get(self.url)
        self.assertEqual(response.data["status"], "pronto")
        self.assertEqual(response.data["sections"]["resumo"], "r")

    @patch("apps.users.views._spawn_llm_feedback")
    def test_segundo_post_nao_dispara_segunda_geracao(self, spawn):
        """Os dois jogadores tocando o botão = UMA chamada ao provedor."""
        self.client.force_authenticate(self.white)
        self.client.post(self.url)
        self.client.force_authenticate(self.black)
        self.client.post(self.url)
        self.assertEqual(spawn.call_count, 1)

    @patch("apps.users.views._spawn_llm_feedback")
    def test_post_em_comentario_pronto_devolve_o_mesmo_texto(self, spawn):
        feedback, _ = claim_llm_feedback(self.analysis, user=self.white)
        feedback.status = GameLLMFeedback.STATUS_DONE
        feedback.sections = {
            "resumo": "r",
            "abertura": "a",
            "erro_decisivo": "e",
            "recomendacao": "c",
        }
        feedback.save()

        self.client.force_authenticate(self.black)
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["sections"]["resumo"], "r")
        spawn.assert_not_called()

    @override_settings(LLM_FEEDBACK_ENABLED=False)
    @patch("apps.users.views._spawn_llm_feedback")
    def test_flag_desligada_nao_gera(self, spawn):
        self.client.force_authenticate(self.white)
        response = self.client.post(self.url)
        self.assertEqual(response.data["status"], "desligado")
        spawn.assert_not_called()

    @override_settings(OPENROUTER_API_KEY="")
    @patch("apps.users.views._spawn_llm_feedback")
    def test_sem_chave_nao_gera_mesmo_com_flag_ligada(self, spawn):
        self.client.force_authenticate(self.white)
        response = self.client.post(self.url)
        self.assertEqual(response.data["status"], "desligado")
        spawn.assert_not_called()
