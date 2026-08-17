"""
Testes da fundação de push (pré-requisito do Modo Turno).

O que esta camada precisa garantir:

  - registro de token é IDEMPOTENTE — chamar de novo com o mesmo token não
    duplica linha, só atualiza `last_seen_at`;
  - o mesmo token não pode pertencer a dois usuários — logout de A / login
    de B no mesmo aparelho REASSOCIA, não duplica nem falha;
  - `send_push` nunca levanta, mesmo com a Expo fora do ar ou respondendo
    lixo — é o mesmo contrato de `check_achievements`.

Nenhuma feature dispara push de verdade nesta fase; estes testes cobrem só o
encanamento.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.models import DeviceToken, register_device_token
from apps.users.push import send_push

User = get_user_model()

DEVICE_TOKEN_URL = reverse("users:device-token")


def make_user(email="a@chess.com"):
    return User.objects.create_user(
        email=email, full_name="Jogador", password="Xadrez@2024"
    )


class RegisterDeviceTokenTests(APITestCase):
    """A função pura, sem HTTP."""

    def test_token_novo_cria_linha(self):
        user = make_user()
        device = register_device_token(user, "tok-1", "ios")
        self.assertEqual(device.user_id, user.id)
        self.assertEqual(DeviceToken.objects.count(), 1)

    def test_mesmo_token_do_mesmo_usuario_nao_duplica(self):
        user = make_user()
        register_device_token(user, "tok-1", "ios")
        register_device_token(user, "tok-1", "ios")
        self.assertEqual(DeviceToken.objects.count(), 1)

    def test_mesmo_token_atualiza_last_seen_at(self):
        user = make_user()
        primeiro = register_device_token(user, "tok-1", "ios")
        primeiro_visto = primeiro.last_seen_at

        segundo = register_device_token(user, "tok-1", "ios")
        segundo.refresh_from_db()
        self.assertGreaterEqual(segundo.last_seen_at, primeiro_visto)
        self.assertEqual(segundo.id, primeiro.id)

    def test_token_de_outro_usuario_reassocia_em_vez_de_duplicar(self):
        """Logout de A, login de B no mesmo aparelho: o token físico é o
        mesmo, e a linha tem de seguir o usuário ATUAL."""
        a, b = make_user("a@chess.com"), make_user("b@chess.com")
        register_device_token(a, "tok-compartilhado", "android")
        register_device_token(b, "tok-compartilhado", "android")

        self.assertEqual(DeviceToken.objects.count(), 1)
        device = DeviceToken.objects.get(token="tok-compartilhado")
        self.assertEqual(device.user_id, b.id)

    def test_usuario_pode_ter_mais_de_um_device(self):
        user = make_user()
        register_device_token(user, "tok-celular", "android")
        register_device_token(user, "tok-tablet", "ios")
        self.assertEqual(DeviceToken.objects.filter(user=user).count(), 2)

    def test_token_vazio_e_no_op(self):
        user = make_user()
        self.assertIsNone(register_device_token(user, "", "ios"))
        self.assertIsNone(register_device_token(user, None, "ios"))
        self.assertEqual(DeviceToken.objects.count(), 0)


class DeviceTokenEndpointTests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(self.user)

    def test_registra_com_sucesso(self):
        response = self.client.post(
            DEVICE_TOKEN_URL,
            {"token": "ExponentPushToken[abc]", "platform": "ios"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(DeviceToken.objects.count(), 1)

    def test_chamar_duas_vezes_e_idempotente(self):
        for _ in range(2):
            response = self.client.post(
                DEVICE_TOKEN_URL,
                {"token": "ExponentPushToken[abc]", "platform": "android"},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(DeviceToken.objects.count(), 1)

    def test_sem_token_e_400(self):
        response = self.client.post(
            DEVICE_TOKEN_URL, {"platform": "ios"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_platform_invalida_e_400(self):
        response = self.client.post(
            DEVICE_TOKEN_URL,
            {"token": "x", "platform": "windows-phone"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_exige_autenticacao(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            DEVICE_TOKEN_URL,
            {"token": "x", "platform": "ios"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class SendPushTests(APITestCase):
    """`send_push` nunca levanta — mesmo contrato de check_achievements."""

    def setUp(self):
        self.user = make_user()

    def test_usuario_sem_device_devolve_lista_vazia_sem_chamar_a_expo(self):
        with patch("apps.users.push.requests.post") as post:
            resultado = send_push(self.user, "Sua vez", "Fulano jogou", {})
        post.assert_not_called()
        self.assertEqual(resultado, [])

    def test_sucesso_devolve_o_token_aceito(self):
        register_device_token(self.user, "tok-1", "ios")
        resposta_expo = {"data": [{"status": "ok", "id": "receipt-1"}]}
        with patch("apps.users.push.requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = resposta_expo
            resultado = send_push(self.user, "Sua vez", "Fulano jogou", {"x": 1})

        self.assertEqual(resultado, ["tok-1"])
        enviado = post.call_args.kwargs["json"]
        self.assertEqual(enviado[0]["to"], "tok-1")
        self.assertEqual(enviado[0]["title"], "Sua vez")
        self.assertEqual(enviado[0]["data"], {"x": 1})

    def test_erro_de_rede_nao_levanta(self):
        import requests as requests_module

        register_device_token(self.user, "tok-1", "ios")
        with patch(
            "apps.users.push.requests.post",
            side_effect=requests_module.ConnectionError("boom"),
        ):
            resultado = send_push(self.user, "t", "b")
        self.assertEqual(resultado, [])

    def test_expo_respondendo_erro_http_nao_levanta(self):
        register_device_token(self.user, "tok-1", "ios")
        with patch("apps.users.push.requests.post") as post:
            post.return_value.status_code = 500
            post.return_value.text = "internal error"
            resultado = send_push(self.user, "t", "b")
        self.assertEqual(resultado, [])

    def test_expo_respondendo_json_invalido_nao_levanta(self):
        register_device_token(self.user, "tok-1", "ios")
        with patch("apps.users.push.requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.side_effect = ValueError("not json")
            resultado = send_push(self.user, "t", "b")
        self.assertEqual(resultado, [])

    def test_expo_recusando_um_token_nao_derruba_os_outros(self):
        register_device_token(self.user, "tok-bom", "ios")
        register_device_token(self.user, "tok-ruim", "android")
        resposta_expo = {
            "data": [
                {"status": "ok"},
                {"status": "error", "message": "DeviceNotRegistered"},
            ]
        }
        with patch("apps.users.push.requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = resposta_expo
            resultado = send_push(self.user, "t", "b")

        # A ordem de envio segue a dos tokens no queryset — o teste checa o
        # conjunto, não a posição.
        self.assertEqual(len(resultado), 1)
        self.assertIn(resultado[0], {"tok-bom", "tok-ruim"})

    def test_manda_para_todos_os_devices_do_usuario(self):
        register_device_token(self.user, "tok-1", "ios")
        register_device_token(self.user, "tok-2", "android")
        with patch("apps.users.push.requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = {
                "data": [{"status": "ok"}, {"status": "ok"}]
            }
            send_push(self.user, "t", "b")

        enviado = post.call_args.kwargs["json"]
        self.assertEqual({m["to"] for m in enviado}, {"tok-1", "tok-2"})
