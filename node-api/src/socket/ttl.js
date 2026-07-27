// Janela de vida de uma partida ativa no Redis.
//
// A partida (`game:{id}`) e a chave de recuperação por usuário
// (`user:game:{id}`) precisam usar o MESMO valor e ser renovadas JUNTAS.
// Enquanto eram 3600 (recuperação) contra 7200 (partida), com só a segunda
// sendo renovada a cada lance, existia uma janela entre 1h e 2h de partida em
// que o `game:` seguia vivo mas o ponteiro de recuperação já tinha expirado:
// o reconnect não achava a partida, o cliente nunca voltava para "in_game" e
// os lances passavam a ser descartados em silêncio.
//
// Uma constante só, um lugar só — é o que impede o descasamento de voltar.
const GAME_TTL = 7200; // 2h

module.exports = { GAME_TTL };
