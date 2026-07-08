# AUDITORIA — Fase 0 (estado real do código)

**Data:** 2026-07-07 · **Auditor:** Claude (Fable 5) · **Branch auditada:** `chore/trunk-stabilization` (HEAD `426dc6f`)
**Método:** evidência primária apenas — código, migrations, branches, commits, testes e lint executados do zero nesta sessão. Nenhum relato anterior (incluindo `PLANO_FASE0.md`) foi aceito sem confirmação contra o código.

---

## 1. Tabela-resumo

| Item | Status | Branch | Evidência concreta |
|---|---|---|---|
| **0.5** Estabilização de trunk | 🟡 **Parcial** | `chore/trunk-stabilization` (local, não pushada) | `main` = `dev` (merge `6179a57`), tag anotada `v0.1.0-mvp-baseline` criada **e pushada** ao origin. Fix de throttle (`632d0ba`) e rename do teste de matchmaking (`0886523`) **commitados**. Faltam: 2 mudanças não commitadas (ver §3) e o CI, que segue sem rodar `npm test`/ESLint no node-api (`.github/workflows/ci.yml:100-115` — job `lint-node` só faz `npm ci`). |
| **0.6** Dourado como acento | ❌ **Não iniciado** | — | `mobile/constants/theme.ts` não tem token `accent` nem `#C9A84C` (grep vazio). Laranjas intactos: `GameOverModal.tsx:25` (`#F5A623`), `HomeScreen.tsx:136` (`#F59E0B`), `theme.ts:38` (`warning: '#F59E0B'`), `SettingsScreen.tsx:267` (`#F59E0B18`). `Button.tsx:22` só tem variantes `primary \| secondary`. |
| **0.3** Elo → Glicko-2 | ❌ **Não iniciado** | — | `Profile.rating` segue `IntegerField(default=1200, verbose_name="Rating ELO")` (`backend/apps/users/models.py:53`). Cálculo segue Elo: `K_FACTOR=32`, `K_FACTOR_AI=24` (`views.py:335-336`). Migrations param em `0006_gamehistory.py`. Não existe `glicko2.py`, `ModalityRating`, modalidade ou período provisório (grep por `glicko`/`deviation`/`volatility`/`modality` vazio em `backend/apps/`). |
| **0.1** Assinaturas + PIX | ❌ **Não iniciado** | — | `backend/apps/` contém apenas `users/` e `puzzles/` — nenhum app de subscriptions. Zero referências a Stripe/RevenueCat/PIX no código Python do projeto. Nenhuma env de pagamento em `.env.example` (raiz ou backend). `SubscriptionScreen.tsx` segue mockup puro — único `onPress` é o botão voltar (linha 28); sem chamadas de API, sem estados de loading/erro. Nenhum gating (5 partidas/dia ou limite de puzzles) em `GameResultView`/`AiGameResultView`/`puzzles/views.py`. Nenhum webhook. |
| **0.2** Puzzles no mobile | ❌ **Não iniciado** | — | Listagem completa de `mobile/screen/`: `game/` (4 arquivos), `home/` (3), `online/` (1), `profile/` (4) — nenhuma tela de puzzle. Nenhuma navegação nova na `HomeScreen`. Backend de puzzles existe (pré-Fase 0), mas sem streak: grep por `streak` em `backend/apps/puzzles/` vazio. |
| **0.4** Onboarding 3 toques | ❌ **Não iniciado** | — | Nenhum arquivo de onboarding em `mobile/app/` ou `mobile/screen/` (listagem completa acima). Não existe `mobile/services/analytics.ts` nem qualquer instrumentação (grep por `onboarding`/`analytics` só encontra texto irrelevante em `SubscriptionScreen.tsx`). Sem endpoint `auth/onboarding/` no backend. |

**Conclusão em uma linha:** dos 6 itens, apenas o 0.5 foi iniciado (e está ~80% concluído); 0.1, 0.2, 0.3, 0.4 e 0.6 não têm uma linha de código sequer.

---

## 2. Levantamento de branches, tags e histórico (Passo 0)

- **Nenhuma das 5 branches de feature previstas no plano existe**, nem local nem no origin: `feature/accent-color-token`, `feature/rating-glicko2`, `feature/subscriptions-pix`, `feature/puzzles-mobile-ui`, `feature/onboarding-3-touches` — todas ausentes de `git branch -a` e `git ls-remote`.
- A única branch relacionada à Fase 0 é **`chore/trunk-stabilization`** (local apenas), com 3 commits sobre `main`:
  - `632d0ba` fix(backend): deriva THROTTLE_RATES de teste para evitar ImproperlyConfigured
  - `0886523` test(node-api): renomeia socket-matchmaking para .integration.js
  - `426dc6f` docs(product): adiciona PRD v1 e RF-VISUAL-01 (movidos para `docs/product/`)
- **`main` não está vazia**: `main` == `origin/main` == tag `v0.1.0-mvp-baseline` == `6179a57` (merge de `dev`). `dev` está 100% contida em `main`.
- **Tag `v0.1.0-mvp-baseline` existe, é anotada e está no origin** (objeto `797574a` → commit `6179a57`).
- `PLANO_FASE0.md` existe (não rastreado, na raiz). `CHANGELOG_FASE0.md` e `prompt_claude_code_fase0.md` **não existem** no repositório.
- Sem stashes (`git stash list` vazio).
- 4 branches antigas sem merge no origin (`autentica-backend`, `feature/menu-modals`, `feature/uc002_create_screen_login`, `perfil-backend`) — anteriores à Fase 0, fora do escopo.

---

## 3. Mudanças não commitadas encontradas

| Arquivo | Conteúdo | Recomendação |
|---|---|---|
| `node-api/package.json` + `package-lock.json` | Adiciona `socket.io-client@^4.8.3` às devDependencies (requisito do script de integração de matchmaking) | **Commitar** em `chore/trunk-stabilization` — ex.: `chore(node-api): adiciona socket.io-client como devDependency` |
| `node-api/src/tests/game.controller.test.js` | Mock do Stockfish ganha `DEPTH_BY_DIFFICULTY: {easy:2, medium:8, hard:18}` e a asserção passa a verificar `getBestMove(VALID_FEN, 8)` — remove a dependência do binário local | **Commitar** — ex.: `test(node-api): ajusta mock do Stockfish para assinatura com profundidade` |
| `PLANO_FASE0.md` (não rastreado, raiz) | Plano de execução da Fase 0 | **Decisão do PM**: mover para `docs/product/` (junto do PRD) ou manter fora do repo como documento de trabalho. Se entrar, atualizar o §0.1 (ver divergência D1 abaixo) |

Nada mais: a árvore está limpa fora esses 3 pontos, e não há trabalho perdido em outras branches (verificado por `git log`/`git diff` contra `dev`).

---

## 4. Testes e lint — rodados do zero nesta auditoria

Ambiente: sem Docker nesta máquina (fluxo `make test` inaplicável). Backend em Python 3.12.13 (venv `backend/.venv`) + PostgreSQL 16 local; banco de teste **recriado do zero** (`--create-db`), o que também valida que as 6 migrations aplicam limpo.

| Camada | Comando | Resultado exato |
|---|---|---|
| Backend | `pytest apps/ --create-db` (settings `core.test_settings`) | ✅ **26 passed, 0 failed** em 5.14s |
| node-api | `npm test` (jest `--runInBand`) | ✅ **8 passed, 0 failed** (1 suíte — o rename tirou corretamente o script standalone do Jest) |
| Mobile | — | ⚠️ **Não existe suíte de testes** (`mobile/package.json` não tem script `test`) — débito conhecido, registrado no plano |
| Black | `black --check backend/` (v25.11.0, mesma do CI) | ✅ 37 arquivos, 0 mudanças |
| Flake8 | `flake8 backend/ --max-line-length=88 --extend-ignore=E203,W503` | ✅ 0 apontamentos |
| ESLint mobile | `npx expo lint` | ✅ **0 erros**, 8 warnings pré-existentes (`react-hooks/exhaustive-deps` ×5, `import/no-duplicates` ×2, `no-unused-vars` ×1) em arquivos não tocados pela Fase 0 |
| ESLint node-api | — | ⚠️ **Não existe**: sem config ESLint, sem dependência no `package.json`. O job de CI chamado "lint-node" não linta nada |

### Achados colaterais (registrados, não corrigidos)
1. **`mobile/package-lock.json` estava dessincronizado do `package.json`** — dependências foram adicionadas sem atualizar o lock, então `npm ci` falhava com `EUSAGE` (builds não reproduzíveis). *(Correção pós-auditoria: a versão original deste relatório afirmava que o lockfile não existia — errado, ele existia e estava rastreado; o achado real é a dessincronização. Corrigido em `d3fefdd`.)*
2. **CI dá falso verde no node-api**: `lint-node` (`ci.yml:100-115`) roda apenas `npm ci` — nem testes nem lint. Já era pendência declarada do item 0.5.
3. Verificação negativa de marca (0.6): busca ampla por laranjas (`#F5A623|#F59E0B|#FFA500|#FF6B00|orange`) em `mobile/` retorna **apenas as 4 ocorrências pré-existentes** citadas na tabela — nenhum laranja novo foi introduzido.

---

## 5. Validação cruzada — Critérios de Aceite do PRD §12

| Critério | Estado | Evidência |
|---|---|---|
| Assinatura Mensal/Anual comprável (cartão + PIX), paywall real | ❌ | Sem backend de billing; `SubscriptionScreen` é mockup estático |
| Limites do plano Grátis aplicados | ❌ | Nenhuma lógica de contagem/limite no backend |
| Puzzle diário no app, dificuldade adaptativa, streak visível | ❌ | Nenhuma tela de puzzle no mobile; sem streak no backend |
| Rating Glicko-2 ativo, provisório nas 20 primeiras | ❌ | Cálculo segue Elo (K_FACTOR) |
| Onboarding < 90s, ≥ 80% conclusão | ❌ | Fluxo não existe |
| Crash-free ≥ 99% | ❌ (não aferível) | Métrica pós-lançamento; sem instrumentação |
| Builds EAS + trunk estável com tag | 🟡 | Trunk estável com tag ✅ (`v0.1.0-mvp-baseline` no origin); builds EAS ❌ |
| Analytics instrumentado | ❌ | `mobile/services/analytics.ts` não existe |
| Marca v2.0 (dourado em CTAs, sem laranja) | ❌ | Token `accent` não existe; laranjas em 4 pontos |

---

## 6. Divergências entre relato e realidade

- **D1 — `PLANO_FASE0.md` §0.1 diz "Não existe nenhuma tag de release — pendência real do item 0.5"**: desatualizado. A tag `v0.1.0-mvp-baseline` existe, é anotada e está pushada no origin. Foi criada depois da escrita do plano.
- **D2 — Baseline de testes do plano (§0.2) já não vale**: o plano registra "25 pass / 1 fail" no backend e "5 pass / 3 fail + 1 suíte quebrada" no node-api. Estado atual: **26/26 e 8/8** — as correções do item 0.5 (throttle via `test_settings`, mock do Stockfish, rename da suíte de matchmaking) resolveram tudo.
- **D3 — Abordagem do fix de throttle divergiu do plano (sem prejuízo)**: o plano previa fixture `autouse` de limpeza de cache no `conftest.py`; o implementado foi desligar throttle via override de `REST_FRAMEWORK` em `core.test_settings` (com escopos preservados com taxa `None`). Funciona e é mais abrangente; o `conftest.py` atual só força `SECRET_KEY`.
- **D4 — O contexto deste prompt de auditoria dizia que o fix de throttle e o rename estavam "não commitados"**: estavam, no momento em que o prompt foi escrito — foram commitados nesta mesma sessão (`632d0ba`, `0886523`) antes da auditoria começar.
- Fora isso, **nenhum relato de conclusão falso foi encontrado**: o plano não afirma ter implementado 0.1–0.4/0.6, e de fato nada disso existe no código.

---

## 7. Recomendação de próximo passo

**Fechar o item 0.5 primeiro — é o único iniciado e faltam ~20%:**
1. Commitar as 2 mudanças pendentes do node-api (mock do Stockfish; devDependency `socket.io-client`).
2. Fazer o CI rodar `npm test` no node-api (hoje é falso verde) — mudança de ~5 linhas no `ci.yml`, já viável porque os testes não dependem mais do binário `stockfish`.
3. Pushar `chore/trunk-stabilization` e abrir PR para `main`.
4. (Colateral recomendado, decisão do PM) Ressincronizar o lockfile de `mobile/` com o `package.json` — dessincronizado, impede `npm ci` e build reproduzível.

**Depois, seguir a ordem do próprio plano (0.6 → 0.3 → 0.1 → 0.2 → 0.4)**: a auditoria não encontrou nenhum item adiantado que justifique reordenar — os outros cinco estão uniformemente em zero, e a justificativa de dependência técnica do plano (accent antes das telas; Glicko antes de puzzles/onboarding; gating antes da tela de puzzles) permanece válida. O 0.6 é o menor e desbloqueia todo o trabalho de UI subsequente.

*Nenhuma correção foi aplicada durante esta auditoria; os bugs/débitos encontrados estão apenas registrados acima.*
