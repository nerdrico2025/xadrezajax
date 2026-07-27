# Diagnóstico — cluster de bugs em partidas humano-vs-humano

Rodada de teste em device (2026-07-26). Investigação de causa-raiz, **sem alteração
de código, sem mutação de dado**. Refs de arquivo:linha no estado da branch
`fix/polimento-visual-device-rodada3` (base `a7641e2`).

---

## Veredito sobre a hipótese central

> "Partidas de sala humana estão sendo persistidas/tratadas pelo caminho de jogo vs IA."

**Refutada na persistência, confirmada na apresentação.**

Nenhuma partida de sala passa pelo endpoint de IA. `GameResultView` grava sempre
`mode=GameHistory.MODE_ONLINE` (`backend/apps/users/views.py:563,573`), e
`AiGameResultView` (`mode="ai"`) só é chamado por `GameScreen.finishGame`
(`mobile/screen/game/GameScreen.tsx:220`) — inalcançável a partir de
`OnlineGameScreen`.

O que existe de verdade é uma **confusão de rótulo na UI** (§1) somada a uma
**colisão semântica real**: sala privada → `time_control = null` → o Django
classifica como `rated=False`, e `rated=False` é o mesmo balde que "vs IA".
Os dois conceitos ("não mexe no rating" e "contra a IA") estão fundidos no texto
da interface e nas estatísticas de perfil. O tipo da partida
(**ranqueada / amistosa / vs IA**) **não existe como campo em lugar nenhum** —
é inferido no fim, a partir de `time_control`.

---

## 1. Onde o TIPO da partida é definido

### Cadeia completa

| Camada | Decisão | Arquivo:linha |
|---|---|---|
| Mobile (busca rápida) | manda `time_control: 300` | `mobile/app/home.tsx:156,161` |
| Mobile (sala) | `create_room` / `join_room` **sem** `time_control` | `mobile/hooks/useGameSocket.ts:228,234` |
| node (fila) | `timeControl = meta.time_control ?? null` — **valor do cliente** | `node-api/src/socket/index.js:86` |
| node (sala) | `createGame(white, black)` — 3º arg `undefined` → `null` | `node-api/src/socket/gameRoom.js:297` |
| node (fim) | reporta `time_control` ao Django | `node-api/src/services/gameResult.service.js:23` |
| Django | `rated = not _is_unrated_request(data)` | `backend/apps/users/views.py:394-402,567,577` |
| Django | `mode` = hardcoded por endpoint (`online` / `ai`) | `views.py:563,573` / `views.py:697` |

**Causa-raiz:** não há campo de tipo de partida. `rated` é derivado de
`time_control`, e `time_control` **vem do cliente** na busca rápida
(`index.js:86`) — um cliente modificado que envie `time_control: null` joga
contra oponentes reais sem mexer no próprio rating. Sala é sempre não-ranqueada
por omissão de argumento, não por decisão explícita.

**Evidência do tester ("empate por acordo mútuo entre 2 humanos exibido como
contra a IA") — causa exata:**

`mobile/screen/game/GameOverModal.tsx` é o modal do modo vs IA e está
**hardcoded** para ele:

- linha 110: `Partida contra a IA — seu rating não mudou.` — renderizado
  **incondicionalmente**, sem prop de modo;
- linha 41: `loss: { … title: "IA venceu!" }`;
- linha 52: `agreement: "Acordo mútuo"`.

`OnlineGameScreen` usa esse mesmo modal sem discriminar modo
(`OnlineGameScreen.tsx:394-398`). Resultado literal na tela do empate humano:
**"Empate! / Acordo mútuo / Partida contra a IA — seu rating não mudou."**
Derrota online exibe **"IA venceu!"**.

Agravante: a segunda metade da frase é *verdadeira* para sala (não-ranqueada) e
**falsa** para busca rápida (ranqueada, `time_control=300`) — o jogador é
informado de que o rating não mudou justamente quando ele mudou.

**Correção proposta (segura, isolada):** prop `mode: "ai" | "online"` +
`rated: boolean` em `GameOverModal`; `OUTCOME_CONFIG.loss.title` passa a
`"Você perdeu"` quando `mode !== "ai"`; a nota de rating vira condicional
(vs IA → texto atual; online não-ranqueada → "Partida amistosa — seu rating não
mudou."; online ranqueada → delta real ou nada).

**Correção proposta (depende de decisão de produto):** criar campo explícito de
tipo de partida (`game_type` em Redis + coluna em `GameHistory`), definido
**no servidor** — sala ⇒ amistosa, fila ⇒ ranqueada — e parar de derivar
ranqueabilidade de um valor enviado pelo cliente. Ver §9.

---

## 2. Nome do oponente vira "Jogador #3"

**Rótulo:** `mobile/screen/game/OnlineGameScreen.tsx:255`
`{(opponent as any).username ?? \`Jogador #${opponent.id}\`}`

**Causa-raiz — o `meta` nunca é enviado no fluxo de sala:**

- `useGameSocket.ts:228` → `socket.emit("create_room")` — **sem meta**
- `useGameSocket.ts:234` → `socket.emit("join_room", { code })` — **sem meta**
- `gameRoom.js:267` grava `creator_meta: JSON.stringify({})`
- `gameRoom.js:291-295` monta `white`/`black` com `meta` vazio
- `index.js:23-24` → `white: { id: game.white_id, ...{} }` → sem `username`

Comparação que fecha o diagnóstico: a **busca rápida** propaga o nome —
`home.tsx:161` `joinQueue(300, { username, rating })` → `index.js:141`
`addToQueue(userId, socket.id, meta)`. Por isso "Jogador #N" aparece **só em
sala/convite**.

Nota: no convite, `invite_friend` recebe meta do convidante
(`home.tsx:226`) e usa só para o texto do push (`index.js:382`); esse meta
alimenta `createRoom` (`index.js:365`), então o **convidado** vê o nome do
convidante, mas o convidante **nunca** vê o nome do convidado.

**Correção proposta (segura, isolada):** passar meta nos dois emits do cliente
(`createRoom(meta)` / `joinRoom(code, meta)`) e repassar em
`useGameSocket`/`home.tsx`. **Melhor ainda (recomendada):** o node resolver
`username` pelo `userId` autenticado do socket (`socket.userId` já existe via
`socket/auth.js`) em vez de confiar em meta do cliente — hoje qualquer cliente
pode se anunciar com o nome que quiser.

---

## 3. Cancelamento de convite não invalida a sala

**Causa-raiz: o evento não existe.** `grep -rn "cancel" node-api/src` → **zero
ocorrências**. Não há `cancel_invite`, `cancel_room` nem `room_cancelled`.

O botão "Cancelar" da tela de espera chama `onLeaveQueue`
(`MatchmakingScreen.tsx:283-291`) → `leaveQueue()`
(`useGameSocket.ts:220-223`) → `socket.emit("leave_queue")` → handler
`index.js:150-157`, que só faz `removeFromQueue(userId)` — **fila de
matchmaking, nada a ver com sala**.

Consequências encadeadas:
1. `room:CODE` continua no Redis pelos 10 min de TTL (`gameRoom.js:275`);
2. o convidado **não recebe evento nenhum** — o `Alert` de convite
   (`home.tsx:122-140`) segue válido e clicável;
3. se ele aceitar, `join_room` cria a partida (`index.js:170-199`) e
   `io.to(...).emit("game_start")` **arrasta o convidante cancelado para dentro
   do jogo**, porque o socket dele ainda é o `creator_socket` gravado.

**Correção proposta (segura, isolada):**
- node: handler `cancel_room` → `redis.del("room:" + code)` (validando
  `creator_id === userId`) + emitir `invitation_cancelled { room_code }` ao
  socket do convidado;
- node: em `joinRoom`, tratar sala inexistente como já trata
  (`"Sala não encontrada"`, `gameRoom.js:282`) — já correto;
- mobile: `cancelRoom()` no hook; `MatchmakingScreen.tsx:285-288` chama
  `cancelRoom()` em vez de `onLeaveQueue()`; listener de
  `invitation_cancelled` → `DISMISS_INVITATION` + fechar o Alert;
- mobile: `home.tsx:330-334` (botão voltar) idem.

---

## 4. Spinner persistente

Há **três** spinners distintos; dois são bugs reais.

### 4a. Modal "Procurando oponente..." nunca fecha depois da partida — BUG PRINCIPAL

`mobile/app/home.tsx:404-409`
`<Modal visible={quickSearching && !showOnlineGame} …>` — modal **full-screen
bloqueante**.

`quickSearching` é ligado em `handleQuickOnline` (`home.tsx:160`) e o único
reset automático é `home.tsx:90-94`:

```
if (quickSearching && (socketStatus === "error" || socketStatus === "idle") && !onlineGame)
```

`GAME_STARTED` **não desliga** `quickSearching` — o modal só some porque
`showOnlineGame` vira `true`. Ao sair da partida, `handleLeaveOnline`
(`home.tsx:218-222`) → `clearGame()` → reducer `CLEAR_GAME`
(`gameSocketReducer.ts:170-178`) devolve `status: "connected"` (socket vivo),
**não** `"error"`/`"idle"`. Logo: `quickSearching` ainda `true`, `onlineGame`
`null` → **o modal "Procurando oponente..." reaparece e trava a tela ao fim de
toda busca rápida**. Só sai pelo botão "Cancelar".

**Reprodução:** busca rápida → jogar → fim de jogo → "Voltar" → tela travada no
spinner.

**Correção (segura, isolada):** `setQuickSearching(false)` num efeito sobre
`onlineGame` (ao começar) e no `handleLeaveOnline`; ou incluir
`status === "connected"` na condição de reset da linha 91.

### 4b. Convite a amigo offline deixa a sala "aguardando" para sempre

`index.js:365-366` emite `room_created` **antes** de checar se o amigo está
online; nas linhas 372/378 emite `invite_error` e retorna. No cliente,
`ROOM_CREATED` já setou `roomCode` (`gameSocketReducer.ts:126-127`) e o case
`ERROR` (linhas 115-121) **não limpa `roomCode`** → `MatchmakingScreen.tsx:262`
segue no ramo de espera com `ActivityIndicator` + "Aguardando oponente
entrar..." indefinidamente.

**Correção (segura, isolada):** no node, criar a sala **depois** de resolver o
socket do alvo; no reducer, limpar `roomCode` no `ERROR`.

### 4c. Spinner do turno do oponente (comportamento, não travamento)

`OnlineGameScreen.tsx:270-272`: `{!isMyTurn && !game.gameOver &&
<ActivityIndicator/>}`, com
`isMyTurn = game.turn === game.myColor && !game.gameOver && !movePending`
(linha 104). Em sala (`timeControl === null`) o relógio não é renderizado
(linha 273), então esse spinner sem rótulo é a única coisa no header e gira o
turno inteiro do oponente — lê-se como "travado".

### Push ou polling? Há promessa presa?

**Push puro.** Lances chegam por socket `move_made` (`index.js:232` →
`useGameSocket.ts:119`). **Não há polling** de estado de partida em lugar
nenhum. Não há promessa pendente: `movePending` tem timeout de 8 s
(`OnlineGameScreen.tsx:203`) e é resetado por `[game.fen]` (linha 120) e por
`[moveError]` (linha 126). O risco residual é o board ficar
`pointerEvents: "none"` (linha 356) por até 8 s se um `move_made` se perder —
não existe resync sob demanda, só o `game_rejoined` de reconexão
(`index.js:78`).

---

## 5. Board invertido ~1 s nas pretas

**A cor NÃO é a corrida.** `myColor` é calculado antes do dispatch
(`useGameSocket.ts:96`) e já está no estado no primeiro paint de
`OnlineGameScreen` — não há render antes de saber a cor.

**A corrida real é entre o primeiro paint e o `onLayout`:**

`OnlineGameScreen.tsx:355-384`
- linha 356: o wrapper recebe `styles.boardFlipped` (`rotate: 180deg`)
  **imediatamente**, no primeiro frame;
- linha 357: `onLayout` → `setSquareSize(width / 8)` — só **depois** do layout;
- linhas 370-383: `renderPiece` (contra-rotação de 180° das peças) é
  `undefined` enquanto `squareSize === 0`.

⇒ Entre o primeiro paint e o re-render pós-`onLayout`, o **tabuleiro está
girado mas as peças não** — as peças aparecem de cabeça para baixo. Idêntico em
`GameScreen.tsx:587-605`.

Agravante da lib (confirma a nota de memória "boardSize default ignora
altura"): `node_modules/react-native-chessboard/.../props-context/index.js:35`
usa `DEFAULT_BOARD_SIZE = floor(Dimensions.get('window').width / 8) * 8`,
calculado **uma vez no import**, só a partir da largura da janela. Nem
`GameScreen` nem `OnlineGameScreen` passam `boardSize`, então o tabuleiro
renderiza com um tamanho que **não** é o do wrapper medido.

**O padrão de correção já existe no repo** — `PuzzleScreen.tsx:502-536`:
mede primeiro, só renderiza com `boardSize > 0`, passa `boardSize={boardSize}`
e usa `key` incluindo `boardSize`.

**Correção proposta (segura, isolada):** aplicar o padrão do `PuzzleScreen` em
`OnlineGameScreen` e `GameScreen` — render condicional a `squareSize > 0`,
prop `boardSize` explícita, `key` incluindo o tamanho. Isso elimina o frame
invertido **e** o descasamento de tamanho de uma vez.

---

## 6. Classificação (leaderboard)

**Campo lido:** Glicko-2 do modelo, não coluna legada.
`LeaderboardView` (`views.py:918-956`) lê
`ModalityRating.rating` (`r.rating`, linha 948) filtrando
`modality=blitz` (default) **e `games_played__gt=0`** (linha 939).

**Sim, há filtro por nº de partidas — e é o filtro errado, por dois motivos:**

**(a) O filtro usa `ModalityRating.games_played`, que só cresce em partida
ranqueada.** Único ponto de incremento: `_apply_glicko2_result`
(`views.py:434`), chamado apenas quando `not unrated` (`views.py:537`).
Sala privada ⇒ `time_control = null` ⇒ `unrated` ⇒ nunca incrementa. **Rafael
com 0 ranqueadas some por filtro, não por bug** — é o comportamento
documentado. Mas o efeito colateral é que **partidas amistosas entre humanos
são invisíveis para o produto inteiro**.

**(b) A coluna exibida não é a coluna filtrada.** `views.py:951-952` devolve
`games_played` e `wins` de **`r.profile`** (total agregado: IA + online +
amistosas), enquanto o filtro usa `r.games_played` (só ranqueadas blitz).
`LeaderboardScreen.tsx:48-49,77` calcula o win-rate com esses números.
⇒ "N partidas · X% vitórias" ao lado de um rating que veio de um conjunto
completamente diferente de partidas.

**(c) Contaminação histórica — a origem provável do "1 partida · 1500"** (ver §7):
`backend/apps/users/migrations/0008_seed_modality_ratings.py:39` semeou
`games_played = profile.games_played` na linha **blitz** de todo Profile
existente, com `rating = 1500.0`. Como `Profile.games_played` conta **também
partidas vs IA**, qualquer perfil pré-migração com ≥1 partida (de qualquer
tipo) passou a satisfazer `games_played__gt=0` **sem nunca ter jogado uma
ranqueada** — entrando no leaderboard com o 1500 default intacto.

**Correções propostas:**
- *(segura, isolada)* devolver `r.games_played` (da modalidade) em vez de
  `r.profile.games_played` — ou renomear o campo para deixar explícito que é o
  total do perfil, e mandar os dois. Hoje o número mente.
- *(decisão de produto)* limpar a contaminação da 0008 (data migration que zera
  `games_played` das linhas blitz sem `GameHistory` ranqueado correspondente) e
  definir o critério de entrada: `games_played > 0` na modalidade? mínimo de N
  ranqueadas? mostrar provisórios? **Não executar sem sua decisão — mexe em
  dado de produção.**

---

## 7. Usuário Renan

**Não há mock nem seed.** `grep -rni "renan"` no repo retorna só duas
ocorrências, ambas fora do código de aplicação:

- `AJAX_Prompts_Correcoes_Rodada2.md:65` — "deve pegar a conta do fundador e
  possivelmente a do ex-dev Renan", no contexto de contas **reais** criadas
  entre 08/mai e 27/jun/2026 que ficaram **sem `Profile`**;
- `.claude/settings.local.json:186` — um `curl PATCH /profile/` de sessão
  anterior que setou `username: "Renan"` numa conta chamada
  **"Conta Diagnostico Temp"**.

⇒ **Existem dois candidatos para o "Renan" do leaderboard: a conta real do
ex-dev e uma conta de diagnóstico temporária.** Sem acesso a produção
(confirmado: sem ambiente prod disponível nesta sessão) não dá para decidir —
segue a query de verificação em §10.

**Origem do "1 partida · 1500" — hipóteses ordenadas:**

1. **(mais provável) Resíduo da migration 0008.** Perfil existia antes da 0008
   com `Profile.games_played = 1` (provavelmente uma partida vs IA) → linha
   blitz criada com `games_played = 1` e `rating = 1500.0`. O `1` exibido é o
   `profile.games_played` (§6b) e o `1500` é o `DEFAULT_RATING` nunca tocado.
   Explica os dois números **e** o fato de ser o único aparecendo (seria o
   único perfil pré-0008 com `games_played > 0`).
2. **(possível) Um empate ranqueado real.** Glicko-2 entre dois 1500/350 num
   empate devolve rating ≈ 1500 (muda o RD, quase não o rating). Mas nesse caso
   **o oponente também apareceria** no leaderboard — inconsistente com "só
   Renan aparece".

Em ambas as hipóteses o rating Glicko-2 **real no banco é 1500.0** — o valor
default, não um rating conquistado. Não é bug de exibição do rating; é bug do
**critério de entrada** na lista.

**Quantas partidas humanas o referenciam:** não determinável sem o banco. A
query está em §10.

---

## 8. Seed de rating de novo usuário

**Confirmado 800/1200/1600 por onboarding** — `views.py:762`
`ONBOARDING_SEED_RATING = {"beginner": 800, "intermediate": 1200, "advanced": 1600}`,
aplicado às 3 modalidades em `views.py:846-854` via `get_or_create(defaults={"rating": seed})`.

**Mas o seed não alcança quem já tinha conta.** Três caminhos produzem um
`ModalityRating` e só um deles usa o seed:

| Caminho | Rating inicial | Onde |
|---|---|---|
| Onboarding concluído | **800 / 1200 / 1600** | `views.py:850-854` |
| Primeira ranqueada (lazy) | **1500** (`DEFAULT_RATING`) | `models.py:140` via `_locked_modality_rating` (`views.py:405-409`) |
| Migration 0008 (perfis pré-existentes) | **1500** | `0008:36` |

`0010_grandfather_onboarding.py:15-17` marcou **todos** os perfis existentes
como já onboardados. Essas contas (Rafael e Renan incluídos, se pré-deploy)
**nunca passam pelo seed** — caem no 1500 default. `signals.py:11-16` também
não semeia `ModalityRating`, e `0013_backfill_missing_profiles.py:23` cria o
Profile em branco de propósito (documentado nas linhas 10-13).

⇒ **O 1500 não é "esperado como seed de usuário novo"; é o default do Glicko-2
vazando para contas grandfathered.** Usuário novo hoje começa em 800/1200/1600;
usuário antigo começa em 1500. Duas escalas convivendo.

**Correção proposta (decisão de produto):** decidir se contas grandfathered
devem ser re-semeadas (exigiria onboarding retroativo ou uma regra de
conversão) ou se 1500 permanece legítimo para elas. **Não é correção técnica —
é política de rating.**

---

## 9. Classificação das correções

### Seguras e isoladas (PR sem decisão de produto)

| # | Correção | Arquivo(s) |
|---|---|---|
| 1 | `GameOverModal` deixa de dizer "IA"/"contra a IA" em partida online | `GameOverModal.tsx:41,110`, `OnlineGameScreen.tsx:394` |
| 2 | Propagar identidade do jogador em sala (preferir resolver no servidor por `socket.userId`) | `useGameSocket.ts:228,234`, `home.tsx`, `index.js:160-199` |
| 3 | Handler `cancel_room` + evento `invitation_cancelled` + botão Cancelar correto | `index.js`, `gameRoom.js`, `useGameSocket.ts`, `MatchmakingScreen.tsx:285` |
| 4a | Resetar `quickSearching` ao iniciar/encerrar partida | `home.tsx:90-94,218-222` |
| 4b | Criar sala só após confirmar amigo online; `ERROR` limpa `roomCode` | `index.js:365`, `gameSocketReducer.ts:115` |
| 4c | Rotular o spinner de turno ("Vez do oponente") | `OnlineGameScreen.tsx:270` |
| 5 | Padrão `PuzzleScreen`: medir → `boardSize` explícito → `key` | `OnlineGameScreen.tsx:355-384`, `GameScreen.tsx:587-605` |
| 6b | Leaderboard devolver `games_played` da modalidade, não do perfil | `views.py:951-952` |

### Dependem de decisão de produto (não tocar sem seu aval)

| # | Decisão pendente |
|---|---|
| 1 | Amistosa (sala) deve mexer no rating? Hoje: não. Se sim, muda `_is_unrated_request`. |
| 1 | Criar campo explícito de tipo de partida definido **no servidor** (fecha o buraco de o cliente escolher a ranqueabilidade em `index.js:86`). |
| 6 | Critério de entrada no leaderboard: mínimo de ranqueadas? mostrar provisórios? |
| 6c | Limpar a contaminação da migration 0008 — **data migration em produção**. |
| 8 | Contas grandfathered em 1500 vs. novas em 800/1200/1600: unificar ou aceitar? |

---

## 10. Verificação pendente (precisa do banco de produção)

Não executei nada contra produção — sem acesso nesta sessão e fora do escopo
autorizado. Queries **somente leitura** para fechar §6 e §7:

```sql
-- Quem satisfaz o filtro do leaderboard, e por quê
SELECT u.id, u.email, p.username, p.games_played AS perfil_total,
       mr.games_played AS blitz_ranqueadas, mr.rating, mr.deviation
  FROM users_modalityrating mr
  JOIN users_profile p ON p.id = mr.profile_id
  JOIN users_user u    ON u.id = p.user_id
 WHERE mr.modality = 'blitz' AND mr.games_played > 0
 ORDER BY mr.rating DESC;

-- A linha blitz do "Renan" tem GameHistory ranqueado que a justifique?
SELECT gh.id, gh.mode, gh.rated, gh.modality, gh.opponent_name,
       gh.rating_before, gh.rating_after, gh.played_at
  FROM users_gamehistory gh
  JOIN users_user u ON u.id = gh.user_id
  JOIN users_profile p ON p.user_id = u.id
 WHERE p.username = 'Renan'
 ORDER BY gh.played_at DESC;

-- Renan é conta real ou a "Conta Diagnostico Temp"?
SELECT u.id, u.email, u.full_name, u.date_joined, p.username
  FROM users_user u JOIN users_profile p ON p.user_id = u.id
 WHERE p.username ILIKE 'renan' OR u.full_name ILIKE '%diagnostico%';
```

Se `blitz_ranqueadas > 0` **sem** `GameHistory` com `rated=true` na modalidade,
a hipótese 1 do §7 (resíduo da migration 0008) está confirmada.

---

**Checkpoint.** Nenhum arquivo de código alterado, nenhum rating tocado,
nenhuma query rodada contra produção. Aguardando revisão.
