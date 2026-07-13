# PLANO — Fase 0 (Estabilização e Fechamento do MVP)

**Data:** 2026-07-07 · **Base:** PRD v1.0 (seções 5/12) + RF-VISUAL-01 · **Autor:** Tech Lead (Claude)
**Revisado em 2026-07-08** com base na auditoria (`docs/execution/AUDITORIA_FASE0.md`) — fonte de verdade sobre o estado real do código.

---

## R. Revisão pós-auditoria (2026-07-08)

A auditoria confirmou: **apenas o item 0.5 foi iniciado** (hoje ✅ concluído — ver status abaixo); 0.1, 0.2, 0.3, 0.4 e 0.6 estavam com zero código. Correções sobre a versão original deste plano:

1. **§0.1 estava desatualizado**: a tag `v0.1.0-mvp-baseline` **existe** (anotada, pushada, apontando para `main` = merge de `dev`). `main` já é o trunk estável.
2. **§0.2 (baseline de testes) superado**: as correções do 0.5 levaram a suíte a **backend 26/26** e **node-api 8/8**; o fix do 429 foi via override de throttle em `core.test_settings` (não via fixture no `conftest.py` como planejado).
3. **Achado adicional**: `mobile/package-lock.json` estava dessincronizado do `package.json` (`npm ci` falhava com `EUSAGE`) — ressincronizado no 0.5.

### Ordem de execução revisada — o item 0.6 deixa de ser bloco único

`SubscriptionScreen` será reconstruída no 0.1 e o badge de rating da Home muda de estrutura no 0.3 — aplicar o dourado nessas áreas antes seria retrabalho. O 0.6 foi dividido:

| Etapa | Escopo | Quando |
|---|---|---|
| **0.6-A** | Token `accent`/`accentText` no `theme.ts` (fixo entre temas) + `#F5A623` → `colors.accent` no `GameOverModal.tsx` + `#F59E0B` → `colors.accent` **só no ícone de coroa** do `HomeScreen.tsx` (badge de rating fica para 0.3) + variante `accent` no `Button.tsx` (sem tocar `primary`) | Imediatamente após 0.5 |
| **0.6-B** | `colors.accent` no badge de rating da Home, já na estrutura Glicko-2 | Embutido no 0.3 |
| **0.6-C** | `colors.accent` no CTA/selo de assinatura (tela real) + destaque do usuário logado no `LeaderboardScreen.tsx` | Embutido no 0.1 |
| **0.6-D** | `colors.accent` no streak de puzzle, desde a primeira versão da tela | Embutido no 0.2 |

**Ordem final:** `0.5 ✅ → 0.6-A → 0.3 (incl. 0.6-B) → 0.1 (incl. 0.6-C) → 0.2 (incl. 0.6-D) → 0.4`

### Status dos itens

| Item | Status | Branch/PR |
|---|---|---|
| 0.5 Trunk + qualidade de CI | ✅ Código completo — aguardando CI verde no PR | `chore/trunk-stabilization` (PR pendente) |
| 0.6-A Accent (base) | ✅ Entregue junto do 0.3 (mesmo PR) | `feature/rating-glicko2` |
| 0.3 Glicko-2 (+0.6-B) | ✅ Código completo — ver §8 | `feature/rating-glicko2` |
| 0.1 Assinaturas+PIX (+0.6-C) | ⬜ | — |
| 0.2 Puzzles mobile (+0.6-D) | ⬜ | — |
| 0.4 Onboarding | ⬜ | — |

---

## 0. Resultado do reconhecimento (Passo 0)

### 0.1 Estado do repositório — o PRD está desatualizado neste ponto
- `main` **não está mais vazia**: em sessão anterior (2026-07-07) fizemos merge limpo de `dev` → `main` e push. Hoje `main` = `dev` + 1 merge commit; `dev` está 100% contida em `main`.
- ~~**Não existe nenhuma tag de release** — pendência real do item 0.5.~~ **[Corrigido na revisão]** A tag anotada `v0.1.0-mvp-baseline` existe e está no origin, apontando para `main`.
- 4 branches obsoletas seguem no remoto sem merge (`autentica-backend`, `feature/menu-modals`, `feature/uc002_create_screen_login`, `perfil-backend`) — divergiram cedo de `dev` e conflitam; ficam fora do escopo.

### 0.2 Baseline de testes (antes de qualquer mudança)
| Suíte | Resultado | Observação |
|---|---|---|
| Backend `pytest apps/` (Python 3.12 + Postgres 16 local, `core.test_settings`) | **25 pass / 1 fail** | `test_wrong_password_returns_401` falha com **429** só quando roda na suíte completa — throttling de login vazando entre testes via cache locmem. Pré-existente, é bug de isolamento de teste, não de produto. Passa isolado. |
| node-api `npm test` (jest) | **5 pass / 3 fail + 1 suíte quebrada** | 3 falhas por falta do binário `stockfish` na máquina local; suíte `socket-matchmaking` não roda porque `socket.io-client` não está nas devDependencies. Pré-existente. |
| CI GitHub Actions | — | **O CI não roda `npm test` nem ESLint no node-api** — o job "Lint Node API" só faz `npm ci`. O CI real é: Black/Flake8 + `manage.py test` (Django) + build Docker. |

Ambiente local montado para o trabalho: Python 3.12.13 + PostgreSQL 16.14 via Homebrew (não há Docker nesta máquina — o fluxo `make test` do repo é docker-based e não se aplica aqui).

### 0.3 Citações do PRD/RF-VISUAL validadas contra o código — todas batem
- `theme.ts` sem token `accent`; `warning` light = `#F59E0B` ✓
- `Profile.rating` IntegerField Elo 1200; `K_FACTOR=32`, `K_FACTOR_AI=24`, `AI_RATING={easy:800, medium:1200, hard:1600}` em `views.py:335-346` ✓
- `GameOverModal.tsx:25` → `#F5A623` ✓ · `HomeScreen.tsx:136` → `#F59E0B` ✓ · badge de rating `HomeScreen.tsx:60-63` em `colors.primary` ✓
- Backend de puzzles completo (`map/`, `<pk>/`, `next/`, `<pk>/progress/`, `stats/`) e **nenhuma tela mobile** ✓
- `SubscriptionScreen.tsx` é mockup puro (CTA "Em breve" sem onPress) ✓
- `Button.tsx` só tem variantes `primary`/`secondary` ✓
- Navegação do app é **state-based** em `mobile/app/home.tsx` (union `ActiveScreen`), não por rotas — as novas telas seguem esse padrão.

### 0.4 Divergências encontradas (PRD × código)
1. **Preços do mockup ≠ PRD**: a tela mostra Anual "R$ 9,90/mês (R$ 118,80/ano)" e Mensal "R$ 16,90". O PRD manda **Mensal R$ 39,90 / Anual R$ 359**. → Seguirei o PRD; os valores do mockup serão descartados.
2. **Não existe conceito de modalidade** (Bullet/Blitz/Rápido) em lugar nenhum: `GameHistory.mode` é só `ai`/`online`; online tem controle de tempo fixo de 5 min (`home.tsx:116`), vs IA tem controle selecionável. A migração Glicko-2 precisa criar esse conceito do zero (mapeamento por tempo: Bullet < 3 min, Blitz 3–10 min, Rápido > 10 min).
3. **Streak de puzzle não existe no backend** — `UserPuzzleProgress.solved_at` permite calculá-lo, mas o `stats/` não o expõe. Será adicionado (cálculo server-side, sem migration).

---

## 1. Ordem de execução e justificativa

O PRD prioriza por RICE (0.1 primeiro). Reordenei por **dependência técnica** — cada item consome o anterior e evita retrabalho:

| # | Item | Branch | Por que nesta posição |
|---|---|---|---|
| 1º | **0.5** Estabilização de trunk | `chore/trunk-stabilization` | Pré-requisito operacional declarado no PRD. Inclui consertar a baseline de testes (throttle nos testes, devDep faltante, CI que não roda testes do node). |
| 2º | **0.6** Dourado como acento | `feature/accent-color-token` | O RF-VISUAL-01 §5 manda implementar **junto/antes** das telas de 0.1 e 0.2 para não retrabalhar. É pequeno e desbloqueia todo o trabalho de UI seguinte. |
| 3º | **0.3** Glicko-2 | `feature/rating-glicko2` | 0.2 (dificuldade adaptativa) e 0.4 (rating inicial inferido) dependem do novo rating. Fazer antes evita migrar duas vezes. |
| 4º | **0.1** Assinaturas + PIX | `feature/subscriptions-pix` | Maior prioridade de negócio; precisa vir antes de 0.2 porque o limite de puzzles do plano Grátis (RF-MON-05) é aplicado na tela de puzzles. |
| 5º | **0.2** Puzzles no mobile | `feature/puzzles-mobile-ui` | Consome: accent (0.6), rating adaptativo (0.3) e gating (0.1). |
| 6º | **0.4** Onboarding 3 toques | `feature/onboarding-3-touches` | Consome rating Glicko-2 (0.3). Último por tocar o fluxo de auth (área sensível — melhor mexer com todo o resto estável). |

Todas as branches partem de `main` (trunk pós-0.5) e são mescladas em sequência (cada uma rebased/mergeada sobre a anterior, já que há dependência). `dev` é sincronizada com `main` ao final.

---

## 2. Detalhamento por item

### Item 0.5 — `chore/trunk-stabilization`
**Proposta de trunk (não executo sem confirmação):** `main` já contém tudo de `dev` (merge feito ontem). Proposta: (a) declarar `main` como trunk estável e alvo de PRs de release; (b) manter `dev` como integração contínua, sincronizada com `main` agora; (c) criar tag anotada `v0.1.0-mvp-baseline` no commit atual de `main`; (d) sem force-push nem reescrita de histórico em nenhuma hipótese.

**Mudanças de código (estabilização da baseline):**
- `backend/core/test_settings.py`: limpar cache entre testes (fixture `autouse` em `conftest.py`) → corrige o 429 do `test_wrong_password_returns_401` na suíte completa.
- `node-api/package.json`: adicionar `socket.io-client` às devDependencies (a suíte de matchmaking exige).
- `.github/workflows/ci.yml`: job do node passa a rodar `npm test` (com testes que dependem de stockfish marcados/skipáveis quando o binário não existe) — hoje o CI dá falsa sensação de verde.
- Testes do controller que dependem de `stockfish`: mock do spawn (já deveriam mockar; hoje dependem do binário).

**Migrations:** nenhuma. **Env:** nenhuma. **Testes:** os existentes passam a rodar de verdade no CI.

### Item 0.6 — `feature/accent-color-token`
- `mobile/constants/theme.ts`: `accent: '#C9A84C'` e `accentText: '#0D0D0D'` fixos em `light` e `dark`.
- Substituições: `GameOverModal.tsx:25` (`#F5A623` → `colors.accent`), `HomeScreen.tsx:136` (`#F59E0B` → `colors.accent`), badge de rating `HomeScreen.tsx:60-63` (`primary` → `accent`).
- `LeaderboardScreen.tsx`: destaque da linha/rating do próprio usuário em `accent`.
- `Button.tsx`: nova variante `accent` (background `colors.accent`, texto `colors.accentText`), sem tocar `primary`.
- Validação WCAG AA por script (dourado sobre `#F8F9FA` e `#0F1117`; `accentText` sobre `accent`).
- **Fora do escopo (registrado):** o PRD §3.3 menciona alinhar dark bg `#0F1117` → `#0D0D0D` da marca; o RF-VISUAL-01 não o lista no escopo técnico. Não farei sem confirmação — mudança de fundo global tem risco visual amplo.

**Migrations/Env:** nenhuma. **Testes:** app mobile não tem suíte de testes hoje (nem no CI); validação = ESLint + revisão visual (critério de aceite do RF exige revisão do PM/fundador antes do merge).

### Item 0.3 — `feature/rating-glicko2`
**Decisão de lib:** implementar módulo interno `backend/apps/users/glicko2.py` (~150 linhas). Justificativa: a única lib PyPI relevante (`glicko2`, de deepy) está sem manutenção há anos e é uma transcrição direta do paper — sem ganho sobre implementação própria testada contra o **exemplo numérico oficial do paper de Glickman** (r=1500, RD=200 vs 3 oponentes → r'≈1464.05, RD'≈151.52), que vira caso de teste.

**Modelo:**
- Novo `ModalityRating`: FK Profile, `modality` (`bullet`/`blitz`/`rapid`), `rating` (float, default 1500→seed do Elo), `deviation` (float), `volatility` (float, 0.06), `games_played`; unique (profile, modality). Propriedade `is_provisional` = `games_played < 20`.
- `GameHistory`: novo campo `modality` (choices, com default para dados antigos — online histórico era sempre 5 min → `blitz`; jogos vs IA antigos também assumem `blitz` por falta de dado; registrado no changelog).
- `Profile.rating` **mantido** como espelho denormalizado (rating blitz arredondado) para não quebrar leaderboard/app antigo durante a transição.
- **Migration de dados (reversível):** para cada Profile, criar 3 `ModalityRating` com `rating=Elo atual`, `deviation=350` (não calibrado, conforme PRD), `volatility=0.06`.

**Endpoints:** `GameResultView`/`AiGameResultView` recebem `time_control` (segundos) → modalidade; node-api passa a enviar o campo (mudança pequena no `gameResult.service.js`). Serializers de perfil e leaderboard expõem os 3 ratings + flag provisório; leaderboard ganha `?modality=` (default blitz).

**Testes:** exemplo do paper de Glickman; vitória/derrota/empate; RD caindo com jogos; período provisório; separação por modalidade; compatibilidade dos endpoints (payload antigo sem `time_control` continua funcionando).

### Item 0.1 — `feature/subscriptions-pix`
**Backend — novo app `backend/apps/subscriptions/`:**
- `Plan` (slug `free`/`monthly`/`annual`, nome, preço em centavos: 0 / 3990 / 35900, intervalo) — seed por migration. **Elite fica fora** (condicional, Fase 2).
- `Subscription` (user FK, plan, status `pending`/`active`/`canceled`/`expired`, provider `revenuecat`/`pix`, `provider_ref`, `current_period_start/end`).
- `PaymentEvent` (provider, `event_id` **unique** → idempotência de webhook, payload, processed_at).
- Endpoints: `GET plans/`, `GET me/` (assinatura atual + limites do dia), `POST pix/checkout/` (cria cobrança PIX, retorna QR/copia-e-cola), `POST webhooks/mercadopago/`, `POST webhooks/revenuecat/`.

**Provedor PIX — DECIDIDO (validação do PM em 2026-07-07): Stripe.** PIX via `PaymentIntent` com `payment_method_types=["pix"]`; unifica cartão+PIX num provedor só. Atenção documentada: PIX no Stripe exige conta BR ativada para o método — em modo teste o fluxo funciona com QR simulado, mas a ativação em produção precisa ser solicitada no dashboard. Env placeholders: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

**RevenueCat:** `react-native-purchases` no mobile + webhook no backend (`REVENUECAT_WEBHOOK_AUTH_TOKEN`). **Limitação real:** compras in-app exigem produtos configurados nas lojas + dev build (não funciona em Expo Go); a integração ficará completa em código com placeholders documentados, e o fluxo testável de ponta a ponta em dev será o PIX (sandbox).

**Gating (RF-MON-05) — no backend:** serviço `check_limits(user)` consultado (a) em `AiGameResultView`, (b) no registro de resultado online e num endpoint `GET limits/` que o mobile consulta **antes** de iniciar partida; (c) nos endpoints de puzzles. Limites: Grátis = 5 partidas/dia (IA + online somadas, por dia-calendário no fuso do servidor) e **3 puzzles/dia** — ⚠️ o PRD diz só "puzzles limitados" sem número; **3/dia é proposta minha, validar**. Pagante = ilimitado.

**Mobile:** `SubscriptionScreen` real — planos vindos da API (preços do PRD), CTA `accent`, fluxo PIX (QR code + copia-e-cola + polling de status), estados loading/sucesso/erro/"já é assinante", selo de plano pago em `accent`; serviço `subscriptions.ts` + hook `useSubscription`.

**Testes:** ciclo de vida da assinatura, idempotência de webhook (mesmo `event_id` 2×), ativação via webhook PIX, limites do Grátis (5ª partida ok, 6ª bloqueada; reset no dia seguinte), pagante ilimitado, expiração.

### Item 0.2 — `feature/puzzles-mobile-ui`
- `mobile/screen/puzzles/PuzzleScreen.tsx` seguindo o padrão de pastas/telas existente (state-based via `home.tsx`, novo `ActiveScreen: "puzzles"`).
- Tabuleiro interativo reutilizando `react-native-chessboard` + `chess.js` no padrão do `GameScreen.tsx`; validação lance-a-lance contra `solution` (UCI), com resposta automática do "oponente" nos lances ímpares da solução.
- Dificuldade adaptativa: rating Glicko-2 do usuário → `?difficulty=` do endpoint `next/` (ex.: <1000 easy, 1000–1400 medium, >1400 hard — thresholds documentados).
- **Backend (adição pequena):** streak em `PuzzleStatsView` (dias consecutivos com puzzle resolvido, via `solved_at`) — sem migration.
- Streak visível na tela e chip de streak na Home, ambos em `colors.accent`.
- Card "Puzzle do dia" na `HomeScreen` no padrão dos cards existentes; registro de progresso via `POST progress/`.
- Gating do plano Grátis (0.1): tela mostra contador e bloqueio elegante com CTA de upgrade (accent) ao atingir o limite.
- **Testes:** backend (streak + gating em puzzles); mobile segue sem suíte (paridade com o repo — registrado como débito).

### Item 0.4 — `feature/onboarding-3-touches`
- Rota `mobile/app/onboarding.tsx` exibida uma única vez pós-cadastro (flag no backend, não só no device).
- 3 perguntas 100% visuais (cards com ícone/imagem, 1 toque cada): experiência ("nunca joguei / jogo casualmente / jogo sério"), conhecimento (reconhecer um mate simples — 3 diagramas), frequência desejada. → nível `beginner`/`intermediate`/`advanced`.
- **Backend:** `POST /api/v1/auth/onboarding/` grava nível, marca `Profile.onboarding_completed_at` (migration nova, reversível) e seeda os `ModalityRating` (beginner 800 / intermediate 1200 / advanced 1600, deviation 350 — provisório).
- Ao concluir → direto para partida vs IA na dificuldade correspondente (fluxo existente), sem passar pela Home. Meta <90s: 3 toques + 1 transição.
- `mobile/services/analytics.ts`: `logEvent()` com buffer local e `// TODO: conectar provedor (Firebase Analytics previsto no PRD §9)` — instrumenta `onboarding_started`, `onboarding_completed`, `first_game_started`, e também os eventos de 0.1/0.2 (paywall, puzzle) retroativamente nesta branch.
- **Testes:** endpoint de onboarding (seed de rating por nível, idempotência — segunda chamada não re-seeda).

---

## 3. Decisões validadas pelo PM (2026-07-07)

| # | Decisão | Definição |
|---|---|---|
| 1 | Estratégia de trunk (0.5) | ✅ `main` = trunk estável, `dev` = integração; tag `v0.1.0-mvp-baseline` em `main` |
| 2 | Provedor PIX | ✅ **Stripe** (escolha do PM; unifica cartão+PIX) |
| 3 | Limite de puzzles do plano Grátis | ✅ **3/dia** |
| 4 | "5 partidas/dia" conta o quê? | ✅ IA + online somadas |
| 5 | Modalidade de jogos históricos na migração | ✅ Tudo vira `blitz` |
| 6 | Dark bg `#0F1117` → `#0D0D0D` | ✅ **Não mexer** nesta fase |
| 7 | Preços | ✅ PRD vence o mockup: Mensal R$ 39,90 / Anual R$ 359 |

## 4. Limitações do ambiente local (afetam critérios de aceite §12)
- **Builds EAS e "pagamentos em produção"**: exigem credenciais de loja/EAS e chaves reais — ficarão como pendência documentada no changelog (código pronto, deploy manual seu).
- **Sem Docker local**: validação backend via Python 3.12 + Postgres 16 locais (mesmas versões do CI); imagens Docker validam no CI do GitHub.
- **Crash-free ≥ 99% e conclusão de onboarding ≥ 80%**: métricas pós-lançamento, impossíveis de aferir agora; instrumentação de analytics deixa os eventos prontos.

## 5. Infra EAS / builds Android (2026-07-12)

- **Projeto EAS antigo abandonado**: `8cc9fb2b-05b3-486b-a9a4-17a002115177` pertencia à conta de um ex-integrante do time, sem acesso disponível.
- **Novo projeto**: `xadrez-ajax` / `a1335737-8154-4680-a930-bb209071c8a2`, confirmado sob a Organização "Clube de Xadrez AJAX". `app.json` reapontado (projectId + `updates.url`); slug alinhado de `ajax` → `xadrez-ajax` (exigência do EAS).
- **Canal de OTA updates reiniciado nesta data** — aceitável, nunca foi usado em produção.
- **Primeiro build de preview gerado com sucesso** (`.apk`, perfil `preview` com `buildType: apk`): build `0fdb0e50-b6bf-4f32-999b-ff0a63d63b0c`, keystore gerado e gerenciado pelo EAS, ~19 min de fila+build.

## 6. Fix de jogadas especiais + CI mobile (2026-07-12)

- **Fix mergeado em `main`** (PR #65): roque no tap-to-move (bug de mapeamento SAN na `react-native-chessboard@0.1.2`, corrigido via patch-package) e promoção com escolha de peça respeitada nos dois fluxos (vs IA e online); en passant já funcionava e ganhou teste de regressão. 13 testes novos (jest-expo).
- **CI de mobile adicionado** (job `test-mobile`: npm ci + ESLint + tsc + Jest) — primeiro job de mobile do pipeline, verde na estreia; `main` pós-merge 5/5 checks.
- **Novo build de preview com o fix incluído**: build `b6e55fff-5d22-483a-b471-7203b7f90514` (commit d4718d4, ~17 min) — substitui o `0fdb0e50` anterior, que era pré-fix.

## 8. Item 0.3 fechado — Glicko-2 por modalidade + 0.6-A/0.6-B (2026-07-12)

Executado conforme o desenho do §2 (item 0.3), na branch `feature/rating-glicko2`:

- **Glicko-2 interno** (`backend/apps/users/glicko2.py`), validado contra o exemplo numérico do paper de Glickman (1464.06 / 151.52 / 0.05999) — decisão de não usar a lib PyPI mantida.
- **`ModalityRating`** (FK Profile, bullet/blitz/rapid, rating/deviation/volatility/games_played, unique por par) + `GameHistory.modality` (default blitz para o histórico). Provisório = `games_played < 20` (property, sem campo extra). `Profile.rating` segue como espelho denormalizado do blitz.
- **Migrations 0007/0008**: schema + seed reversível (Elo atual como seed com RD 350 para quem já jogou; 1500 para quem nunca jogou; games do histórico herdados pelo blitz). Testadas localmente com dados: forward → verificação → reverse → forward, sem perda.
- **Endpoints**: `GameResultView`/`AiGameResultView` aceitam `time_control` (ausente → blitz, compat; null → rápido; segundos → mapa do §0.4); IA = oponente Glicko-2 de RD fixo 60. Leaderboard ganhou `?modality=` (default blitz); perfil expõe `ratings` por modalidade com flag `provisional`. node-api passa `time_control` no `gameResult.service.js`.
- **0.6-A/0.6-B**: token `accent`/`accentText` no `theme.ts` (fixo #C9A84C), vitória do `GameOverModal`, coroa da Home e variante `accent` no `Button`; badge de rating da Home em dourado consumindo `ratings.blitz` com indicador `~` de provisório. **Achado WCAG**: dourado sobre fundo claro = 2.17:1 → no tema claro o dourado é preenchimento/realce, nunca cor de texto (validado por teste automatizado em `mobile/constants/__tests__/theme.test.ts`).
