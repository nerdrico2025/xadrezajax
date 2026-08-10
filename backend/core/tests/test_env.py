"""Leitura de flags booleanas de ambiente.

O contrato precisa ser o MESMO de `parseBooleanFlag` em
node-api/src/services/analysisQueue.js: os dois serviços leem
`POST_GAME_ANALYSIS_ENABLED` da mesma variável, e enquanto um comparava com
`"True"` e o outro com `"true"`, setar o mesmo valor nos dois ligava só um —
sem erro, sem log. Se um dos lados mudar, este arquivo e o de lá têm de
mudar juntos.
"""

from unittest import mock

from django.test import SimpleTestCase

from core.env import env_bool


class EnvBoolTests(SimpleTestCase):
    def assert_reads(self, raw, expected):
        with mock.patch.dict("os.environ", {"FLAG_DE_TESTE": raw}, clear=False):
            self.assertIs(env_bool("FLAG_DE_TESTE"), expected)

    def test_qualquer_caixa_liga(self):
        for raw in ("true", "True", "TRUE", "TrUe"):
            with self.subTest(raw=raw):
                self.assert_reads(raw, True)

    def test_espacos_em_volta_sao_ignorados(self):
        # Colar valor no painel do Easypanel costuma trazer um espaço junto.
        for raw in (" true", "true ", "  TRUE  ", "true\n"):
            with self.subTest(raw=raw):
                self.assert_reads(raw, True)

    def test_o_resto_nao_liga(self):
        # Estreito de propósito: quanto mais formas de dizer sim, mais formas
        # de um valor errado parecer certo.
        for raw in ("false", "False", "", " ", "0", "1", "yes", "on", "sim"):
            with self.subTest(raw=raw):
                self.assert_reads(raw, False)

    def test_variavel_ausente_usa_o_default(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertIs(env_bool("NAO_EXISTE"), False)
            self.assertIs(env_bool("NAO_EXISTE", default=True), True)

    def test_variavel_vazia_nao_usa_o_default(self):
        # "existe mas não foi preenchida" é uma escolha explícita de não
        # ligar, não ausência de configuração.
        with mock.patch.dict("os.environ", {"FLAG_DE_TESTE": ""}, clear=False):
            self.assertIs(env_bool("FLAG_DE_TESTE", default=True), False)


class PostGameAnalysisFlagTests(SimpleTestCase):
    """A flag real, não só o helper: o settings tem de USAR `env_bool`."""

    def test_settings_usa_env_bool(self):
        import importlib

        import core.settings

        for raw, expected in (("TRUE", True), ("true", True), ("False", False)):
            with self.subTest(raw=raw):
                with mock.patch.dict(
                    "os.environ", {"POST_GAME_ANALYSIS_ENABLED": raw}, clear=False
                ):
                    reloaded = importlib.reload(core.settings)
                    self.assertIs(reloaded.POST_GAME_ANALYSIS_ENABLED, expected)

        # Deixa o módulo como estava para não contaminar os outros testes.
        importlib.reload(core.settings)
