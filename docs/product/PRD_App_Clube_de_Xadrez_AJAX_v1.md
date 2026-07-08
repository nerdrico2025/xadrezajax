# PRD — Aplicativo Mobile · Clube de Xadrez AJAX

**Versão:** 1.0 · **Data:** Julho 2026 · **Autor (PM responsável):** Product Management — AJAX
**Plataforma:** Mobile (iOS + Android) · **Marca:** Clube de Xadrez AJAX — *Associação de Jogadores Amantes de Xadrez*
**Base do diagnóstico:** repositório `github.com/nerdrico2025/xadrezajax` (branch `dev`, ~12.000 LOC)

---

## 1. Sumário Executivo

O Clube de Xadrez AJAX está construindo o **primeiro super-app de xadrez do Brasil com personalização cultural** — partidas ao vivo, IA de análise humanizada em português, e-learning e ligas competitivas, ancorado em 24 anos de história física em Maricá/RJ e na parceria com a Federação Francesa de Xadrez (FFE).

Este PRD parte de um **diagnóstico real do código já existente**, e não de um projeto do zero. O achado central é que **o núcleo de jogo e autenticação já está construído e é robusto**, mas os dois motores de negócio do MVP — **monetização (assinaturas) e o hábito diário (puzzles no app)** — ainda **não estão acessíveis ao usuário**. Além disso, o sistema de rating diverge do especificado (Elo em vez de Glicko-2) e a IA de análise pós-jogo (o principal argumento de upgrade da v1.1) ainda não existe.

**Prioridade número 1 deste ciclo:** transformar o app de "jogo funcional sem receita" em "produto monetizável" — ativar assinaturas com PIX, expor puzzles no app e corrigir o rating. Sem isso, nenhuma das métricas North Star (MRR de R$37K, 1.000 pagantes) é alcançável.

**Risco de processo crítico e imediato:** a branch `main` do repositório está **vazia**. Todo o trabalho (~12k linhas) vive na branch `dev` e em ~20 branches de feature. Não há um trunk estável nem release marcada. Isso precisa ser resolvido antes de qualquer deploy de produção.

---

## 2. Visão do Produto e Objetivos

### 2.1 Posicionamento
> *"Não somos um clube de xadrez. Somos um polo intelectual onde mentes brilhantes se encontram, evoluem e competem com precisão."*

Clube híbrido (**phygital**) premium: sede física em Maricá + plataforma digital com IA. O app é a peça que escala a experiência presencial para o Brasil inteiro.

### 2.2 Diferenciais competitivos (devem guiar priorização)
1. **IA humanizada pós-jogo** (Stockfish + LLM) — feedback em português como um mestre comentando a partida. Chess.com não oferece isso.
2. **Metodologia FFE** — credencial internacional (Phillipe Kalman, árbitro oficial).
3. **Ligas com anti-cheating rigoroso** — resolve a dor central da persona "Lucas, o Competidor Digital".
4. **Integração phygital** (totens na sede, partidas físicas sobem via PGN).
5. **Sede premium + 24 anos de história** — prova social que nenhum app novo pode comprar.

### 2.3 Métricas North Star — 12 meses

| Métrica | Meta 6 meses | Meta 12 meses |
|---|---|---|
| Usuários cadastrados | 5.000 | 20.000 |
| Membros pagantes | 150 | 1.000 |
| Conversão freemium → pago | 3% | 5% |
| MRR | R$ 5K | R$ 37K |
| Retenção D30 | 25% | 40% |
| NPS | ≥ 30 | ≥ 40 |
| Churn mensal | < 10% | < 7% |

### 2.4 Personas-alvo
- **Lucas · Competidor Digital** (22, Brasil inteiro): quer evoluir e competição justa. Canal: App, YouTube, Instagram Reels. → **prioridade do produto digital.**
- **Carlos · Networker Presencial** (38, Maricá): quer status e conexões. Canal: sede, Instagram, WhatsApp VIP. → prioridade da sede/phygital.
- **Gestor · Parceiro B2B** (Secretarias/Colégios): quer programa pedagógico mensurável. → prioridade v2.0.

---

## 3. Diagnóstico do Estado Atual (baseado no código)

### 3.1 Arquitetura real implementada

O projeto é um **monorepo com três serviços**. Nota importante: **a stack real diverge do Roadmap original** em pontos relevantes (documentados na seção 3.4).

| Camada | Tecnologia real (no repo) | O que o Roadmap previa | Situação |
|---|---|---|---|
| App Mobile | React Native 0.81 + Expo 54, expo-router, TypeScript, Zustand | React Native + Expo | ✅ Alinhado |
| Backend API | **Django 6.0 + DRF + SimpleJWT (REST)** | Node.js + GraphQL (Apollo) | ⚠️ Divergente |
| Serviço tempo real | **Node.js + Express 5 + Socket.io + ioredis** | WebSockets (Socket.io) | ✅ Alinhado |
| Banco / Cache | PostgreSQL + Redis | PostgreSQL + Redis | ✅ Alinhado |
| Motor de xadrez | **Stockfish nativo via subprocess no node-api** | Stockfish 16 **WASM no device** | ⚠️ Divergente |
| Auth social | google-auth (validação de ID token) | — | ✅ Presente |
| Pagamentos | **Ausente** | Stripe + RevenueCat + PIX | ❌ Não iniciado |
| IA de análise | **Ausente** | Python (FastAPI) + OpenAI | ❌ Não iniciado |
| Infra | Docker Compose (dev/test/prod), Nginx + SSL, GitHub Actions CI | — | ✅ Maduro |

**Fluxo:** Mobile → Django REST (auth, perfil, partidas, leaderboard, amigos, puzzles) e Mobile ↔ Node.js/Socket.io (matchmaking, salas de partida online, IA de oponente via Stockfish).

### 3.2 O que já está PRONTO (funcional e testado)

**Autenticação e conta (UC01–UC06):**
- Cadastro por e-mail, login com JWT, refresh de token.
- Login com Google (validação de ID token).
- Recuperação de senha por código enviado por e-mail (solicitar → verificar código → confirmar).
- Troca de senha, exclusão de conta.
- Alternância de tema claro/escuro com persistência (UC05).

**Perfil (UC07–UC08):**
- Modelo `Profile` com username, avatar (upload), bio, rating, contadores (partidas, vitórias, derrotas, empates).
- Visualização e edição de perfil.

**Jogo:**
- Partida **vs IA** (Stockfish, profundidade por dificuldade: fácil=2, médio=8, difícil=18).
- Partida **online multiplayer** via Socket.io: matchmaking, salas de jogo, autenticação de socket via JWT, estado em Redis.
- Relógio de xadrez, peças capturadas, histórico de lances, modal de fim de jogo, sons e haptics.
- Histórico de partidas (modos "ai"/"online") com rating antes/depois.
- **Leaderboard** e sistema de **amizades** (pedido → aceite, status online de amigos).

**Infra e qualidade:**
- Docker Compose para dev, test e produção; Nginx com SSL; Gunicorn.
- CI (GitHub Actions): lint (Black/Flake8), testes Django com PostgreSQL, lint Node, build de imagens Docker.
- Testes automatizados: `pytest` (backend, incl. auth) e `jest` (node-api, matchmaking e controller).
- Autenticação biométrica, banner de offline, detecção de rede no mobile.

**Aderência de marca (parcial, mas positiva):** o tema do app **já segue a paleta v2.0** — azul petróleo `#1B5F7A` como cor primária e preto `#0D0D0D` no texto. **O laranja do logo antigo já foi abandonado** no app, conforme o rebrand.

### 3.3 O que está PELA METADE ou AUSENTE

| Item | Estado | Impacto |
|---|---|---|
| **Assinaturas / Pagamentos** | `SubscriptionScreen` é **apenas um mockup de UI** (lista benefícios "Premium"). **Zero** integração Stripe/RevenueCat/PIX; nenhum modelo de plano/assinatura no backend. | 🔴 Bloqueia 100% da receita — feature MVP de maior RICE (95) |
| **Puzzles no app** | Backend **completo** (modelos `Puzzle`/`UserPuzzleProgress`, seed, endpoints, progresso). **Nenhuma tela no mobile** — inacessível ao usuário. | 🔴 Bloqueia o loop de hábito diário (RICE 75) |
| **Rating Glicko-2** | Implementado como **Elo simples** (K-factor, rating único 1200). Sem Glicko-2, sem rating por modalidade, sem período provisório de 20 partidas. | 🟠 Divergência de spec; afeta qualidade do matchmaking e retenção |
| **IA de análise pós-jogo (LLM)** | Ausente. O Stockfish do node-api só calcula o lance do oponente, não gera feedback humanizado. | 🟠 É o principal argumento de upgrade da v1.1 |
| **Onboarding de baixa fricção** | Existe fluxo de auth, mas **não** o onboarding de "3 perguntas visuais / nível inferido / primeira partida em <90s" do pilar de UX. | 🟠 Afeta ativação e TTV (meta ≥80% conclusão) |
| **RBAC (PlayerProfile/AdminProfile)** | `Profile` único e plano. Sem especialização Player/Admin nem verificação de permissões (UC09–UC12). | 🟡 Necessário antes de features B2B/admin |
| Ligas, marketplace, e-learning, anti-cheating, xadrez por correspondência, biblioteca PGN, torneios, B2B | Ausentes | 🟢 Esperado — fases v1.1–v2.0 |
| **Polimento de marca** | Dourado AJAX `#C9A84C` (cor de acento para CTAs/status) não é usado como token — o app usa apenas azul petróleo em quase tudo, gerando sensação de "sem graça"; dois hexadecimais soltos e fora da paleta (`#F5A623`, `#F59E0B`) já tentam cumprir esse papel de forma não padronizada em `GameOverModal.tsx` e `HomeScreen.tsx`; fundo dark `#0F1117` difere do `#0D0D0D` da marca. Ver **RF-VISUAL-01** (anexo dedicado). | 🟡 Item de backlog priorizado (Fase 0) |

### 3.4 Divergências vs. documentação (decisões a ratificar)

1. **Backend Django REST em vez de Node.js/GraphQL.** Recomendação: **manter Django** — está maduro, testado e produtivo. Atualizar o Roadmap/documentação para refletir a arquitetura real (não vale reescrever).
2. **Stockfish server-side nativo em vez de WASM no device.** Recomendação: **manter server-side** (offload de CPU, consistência entre devices, mitiga o risco de performance em Android mid-range citado no Roadmap). Requer garantir o binário `stockfish` no container de deploy do node-api.
3. **Elo em vez de Glicko-2.** Recomendação: **migrar para Glicko-2** conforme spec — é um critério de qualidade do MVP e melhora o matchmaking.

### 3.5 Risco de processo (ação imediata)
`main` está **vazia**; tudo vive em `dev` + ~20 branches. **Antes do próximo deploy:** promover `dev` a trunk estável, definir política de branch/release, e marcar uma tag de versão. Sem isso não há baseline de produção auditável.

---

## 4. Gap Analysis — do estado atual ao MVP lançável

Para o MVP ser considerado **lançável e monetizável**, o gap prioritário é:

1. **Ativar receita** — modelos de assinatura no backend + integração RevenueCat/Stripe + **PIX** + paywall real conectado (hoje é mockup).
2. **Expor puzzles no app** — telas mobile consumindo o backend já pronto (esforço baixo, valor alto de retenção).
3. **Corrigir rating** — migrar Elo → Glicko-2, com rating provisório nas 20 primeiras partidas.
4. **Onboarding de ativação** — fluxo de 3 toques com nível inferido e primeira partida em <90s.
5. **Estabilizar trunk e deploy** — resolver o `main` vazio, publicar builds nas lojas (EAS).

---

## 5. Escopo do Produto por Fase

Priorização por **RICE** (Reach × Impact × Confidence / Effort), herdada do Roadmap e reordenada pelo estado real do código.

### FASE 0 — Estabilização e Fechamento do MVP (imediata)
*Objetivo: tornar o que existe lançável e monetizável.*

| # | Entrega | RICE | Justificativa |
|---|---|---|---|
| 0.1 | **Assinaturas + PIX** (RevenueCat/Stripe, planos Mensal R$39,90 / Anual R$359) + paywall real | 95 | Desbloqueia toda a receita; hoje 0% |
| 0.2 | **Puzzles no app** (tela diária, dificuldade adaptativa, streak) consumindo backend existente | 75 | Loop de hábito; backend já pronto → esforço baixo |
| 0.3 | **Migração rating Elo → Glicko-2** (provisório nas 20 primeiras, por modalidade) | 78 | Qualidade de matchmaking e retenção |
| 0.4 | **Onboarding 3 toques** (nível inferido, 1ª partida <90s, zero formulários) | 70 | Ativação ≥80% |
| 0.5 | **Estabilização de trunk + deploy** (main→release, builds EAS iOS/Android) | — | Pré-requisito de lançamento |
| 0.6 | **RF-VISUAL-01 — Dourado AJAX como cor de acento** (token `accent` no design system; CTAs de conversão, badge de rating, streak, estado de vitória, selo de plano pago; alinhar dark bg à paleta) | — | Consistência com identidade v2.0; feedback direto do fundador — ver anexo dedicado |

**Critérios de lançamento (Definition of Launch):** crash-free ≥ 99%, onboarding ≥ 80% de conclusão, Glicko-2 correto, pagamentos (PIX + cartão) em produção, `main` como trunk estável com tag de release.

### FASE 1 (v1.1) — Retenção e novas receitas
*A análise pós-jogo com IA é o argumento central de upgrade ao Anual.*

| Entrega | RICE | Métrica |
|---|---|---|
| **Análise pós-jogo com IA** (Stockfish + LLM, classifica lances, turning point) — completa só no Anual | 92 | LTV |
| Ligas sazonais (Bronze→Mestre, promoção/rebaixamento) | 80 | Retenção D30 |
| Painel de evolução (acurácia por fase, pontos cegos) | 72 | NPS |
| Marketplace MVP (tabuleiros/livros, comissão 15–25%) | 58 | GMV |
| Xadrez por correspondência (assíncrono, até 10 simultâneas p/ pagantes) | 55 | Retenção |
| Biblioteca PGN (histórico, filtros, integração com análise) | 48 | NPS |

*Risco-chave: custo de LLM. Mitigação: análise completa só no Anual; básica (Stockfish) no Mensal; revisão humana de 100% das respostas nas 2 primeiras semanas.*

### FASE 2 (v1.2) — Educação e comunidade
*Plano Elite é **condicional** a ≥3 GM/MI contratados.*

| Entrega | RICE |
|---|---|
| Plano Elite Mentor Pro (R$89,90) — **condicional a ≥3 GM/MI** | 88 |
| E-learning com GM/MI (revenue share 60/40, certificados) | 82 |
| Alertas de repertório (TWIC + Lichess API) | 75 |
| Webinars ao vivo (exclusivo Anual/Elite) | 65 |
| Masterclasses temáticas (venda avulsa) | 60 |
| Revista digital mensal | 52 |

*Iniciar negociação com GM/MI no mês 5. Sem GM confirmado, Elite fica desativado.*

### FASE 3 (v2.0) — Escala e integridade
| Entrega | RICE |
|---|---|
| Anti-cheating avançado (ML, fingerprinting, apelação 48h) | 85 |
| Planos B2B (clubes/escolas, dashboard multi-usuário) — **exige RBAC** | 80 |
| Torneios híbridos (online + presencial, patrocínio) | 78 |
| Leaderboard nacional (ranking por estado) | 62 |
| Clube de vantagens (Anual/Elite) | 55 |
| API pública para clubes (importação de ratings FIDE) | 48 |

*Prospecção B2B começa no mês 9, antes do sprint de desenvolvimento.*

---

## 6. Requisitos Funcionais (consolidados)

Numeração alinhada aos casos de uso do projeto. Status: ✅ pronto · 🟡 parcial · 🔴 ausente.

### 6.1 Autenticação e Conta
- **RF-AUTH-01** Login com Google (UC01) — ✅
- **RF-AUTH-02** Cadastro por e-mail/senha com validações (UC02) — ✅
- **RF-AUTH-03** Login por e-mail/senha (UC03) — ✅
- **RF-AUTH-04** Recuperação de senha por código (UC04) — ✅
- **RF-AUTH-05** Alternar e persistir tema claro/escuro (UC05) — ✅
- **RF-AUTH-06** Logout com limpeza de token/cache (UC06) — ✅
- **RF-AUTH-07** Onboarding de 3 toques com nível inferido — 🔴

### 6.2 Perfil e Permissões
- **RF-PERF-01** Criar/visualizar/atualizar perfil, avatar, bio (UC07/UC08) — ✅
- **RF-PERF-02** Rating **Glicko-2** por modalidade, provisório nas 20 primeiras partidas — 🟡 (hoje Elo)
- **RF-PERF-03** Especialização PlayerProfile — 🔴
- **RF-PERF-04** Especialização AdminProfile + concessão de privilégios (UC10) — 🔴
- **RF-PERF-05** Verificação de tipo de perfil e permissões / RBAC (UC11/UC12) — 🔴

### 6.3 Jogo
- **RF-JOGO-01** Partida vs IA (Bullet/Blitz/Rápido, dificuldade) — ✅
- **RF-JOGO-02** Partida online com matchmaking por rating — ✅
- **RF-JOGO-03** Relógio, histórico de lances, peças capturadas, fim de jogo, sons — ✅
- **RF-JOGO-04** Registro de histórico + atualização de rating — ✅ (rating a migrar)
- **RF-JOGO-05** Matchmaking "1 toque" sem configuração manual — 🟡 (validar contra pilar UX)

### 6.4 Puzzles
- **RF-PUZ-01** Backend de puzzles com progresso e categorias — ✅
- **RF-PUZ-02** Tela de puzzle diário no app com dificuldade adaptativa — 🔴
- **RF-PUZ-03** Streak gamificado visível na home — 🔴

### 6.5 Social
- **RF-SOC-01** Amizades (pedido/aceite/listagem/status online) — ✅
- **RF-SOC-02** Leaderboard — ✅

### 6.6 Monetização
- **RF-MON-01** Modelos de plano/assinatura no backend (Grátis, Mensal, Anual, Elite) — 🔴
- **RF-MON-02** Integração RevenueCat/Stripe (compras in-app iOS/Android) — 🔴
- **RF-MON-03** **PIX** como método de pagamento — 🔴
- **RF-MON-04** Paywall real conectado (substituir mockup) + gating de features por plano — 🔴
- **RF-MON-05** Limites do plano Grátis (5 partidas/dia, puzzles limitados) — 🔴

### 6.7 IA de Análise (v1.1)
- **RF-IA-01** Análise pós-jogo Stockfish + LLM, classificação de lances e turning point — 🔴
- **RF-IA-02** Feedback humanizado em português (tom da marca) — 🔴
- **RF-IA-03** Gating: análise completa só no Anual, básica no Mensal — 🔴

---

## 7. Requisitos Não-Funcionais

- **Performance:** crash-free ≥ 99%; primeira partida jogável em < 90s; análise pós-jogo exibida em ≤ 2s (gráfico de vantagem).
- **Tempo real:** latência de lance imperceptível via Socket.io; reconexão graciosa; estado de partida resiliente em Redis.
- **Disponibilidade:** deploy com Nginx + SSL + Gunicorn; health checks (`/health/`) já presentes.
- **Segurança:** JWT com refresh; SecureStore no device; validação de ID token Google server-side; auth de socket via JWT; LGPD (exclusão de conta já existe — documentar retenção de dados).
- **Qualidade:** CI verde obrigatório (lint + testes + build) como parte do DoD; cobertura de testes crescente em fluxos de pagamento e Glicko-2.
- **Compatibilidade:** iOS e Android via Expo/EAS; degradação graciosa de recursos pesados no plano Grátis (mitiga risco de Android mid-range).
- **Observabilidade:** instrumentar eventos para os KPIs (Firebase Analytics + eventos customizados de puzzles/DAU, conforme Roadmap).
- **UX (pilar não-negociável):** dark mode como padrão; progressão (rating/streak/liga) sempre visível na home; tabuleiro ocupa 100% da largura na partida; nenhum commit de tela sem wireframe aprovado.

---

## 8. Arquitetura-Alvo

Manter a arquitetura atual (validada em produção) e **acrescentar**, não reescrever:

```
┌─────────────────────────────┐
│  App Mobile (Expo / RN)     │  chess.js, react-native-chessboard,
│  expo-router · Zustand      │  socket.io-client, SecureStore, biometria
└───────┬─────────────┬───────┘
        │ REST (JWT)  │ WebSocket (JWT)
        ▼             ▼
┌───────────────┐  ┌──────────────────────────┐
│ Django + DRF  │  │ Node.js + Express +      │
│ auth, perfil, │  │ Socket.io                │
│ partidas,     │  │ matchmaking, game rooms, │
│ leaderboard,  │  │ Stockfish (subprocess)   │
│ amigos,       │  └──────────┬───────────────┘
│ puzzles,      │             │
│ [assinaturas] │◄────────────┘ resultado de partida
└──┬─────────┬──┘
   │         │
   ▼         ▼
┌──────┐  ┌──────┐        ┌──────────────────────────┐
│ PgSQL│  │Redis │        │ [NOVO] Serviço de Análise │
└──────┘  └──────┘        │ IA (LLM) — v1.1           │
                          │ Stockfish + OpenAI        │
┌──────────────────────┐  └──────────────────────────┘
│ [NOVO] RevenueCat/    │
│ Stripe + PIX          │  ← webhooks → Django (assinaturas)
└──────────────────────┘
```

**Novos componentes por fase:** Fase 0 → módulo de assinaturas no Django + RevenueCat/Stripe/PIX. Fase 1 → serviço de análise IA (pode ser um app Django ou microserviço, integrando Stockfish já disponível + LLM). Fase 3 → serviço de anti-cheating (ML) e camada B2B com RBAC.

---

## 9. KPIs e Instrumentação

| Métrica | Meta 6m | Meta 12m | Ferramenta |
|---|---|---|---|
| Usuários cadastrados | 5.000 | 20.000 | Firebase Analytics |
| Membros pagantes | 150 | 1.000 | Stripe / RevenueCat |
| Conversão freemium → pago | 3% | 5% | Stripe / RevenueCat |
| MRR | R$ 5K | R$ 37K | Stripe / RevenueCat |
| Retenção D30 | 25% | 40% | Firebase Analytics |
| Sessões puzzles / DAU | 2,0 | 3,0 | Evento customizado |
| NPS | ≥ 30 | ≥ 40 | Delighted / in-app |
| GMV Marketplace | R$ 10K/mês | R$ 50K/mês | ERP / Stripe |
| Churn mensal | < 10% | < 7% | RevenueCat / Stripe |

**Ação:** a instrumentação de eventos (especialmente puzzles/DAU e funil de conversão do paywall) deve entrar **junto** com as features da Fase 0 — sem ela, não medimos o sucesso do lançamento.

---

## 10. Riscos e Mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| `main` vazia / sem trunk estável | 🔴 Alta | Promover `dev` a trunk, política de release, tag de versão antes do deploy |
| Receita bloqueada (paywall é mockup) | 🔴 Alta | Priorizar 0.1 (assinaturas + PIX) no topo do backlog |
| Puzzles inacessíveis apesar do backend pronto | 🟠 Média | Entrega 0.2 (baixo esforço, alto valor) |
| Massa crítica baixa no início | 🟠 Média | Beta fechado com 500 convidados via federações antes do público |
| Performance Stockfish em Android mid-range | 🟠 Média | Já mitigado por rodar server-side; limitar profundidade no plano Grátis |
| Custo de LLM (v1.1) | 🟠 Média | Análise completa só no Anual; revisão humana no rollout inicial |
| Dependência de GM/MI (v1.2) | 🟠 Média | Negociar a partir do mês 5; Elite condicional a ≥3 confirmados |
| Ciclo de venda B2B longo (v2.0) | 🟡 Baixa | Iniciar prospecção no mês 9, antes do desenvolvimento |
| Divergência doc × código gera retrabalho | 🟡 Baixa | Ratificar decisões da seção 3.4 e atualizar o Roadmap |

---

## 11. Time e Governança

Estrutura prevista: 1 PM, 1 Tech Lead, 2 Devs Mobile (RN), 2 Devs Backend (Django + Python/IA), 1 Designer UX/UI, 1 QA, 1 Data Analyst (part-time).

**Processo:** sprints de 2 semanas (planning, daily, review, retro); priorização RICE para todo o backlog; feature flags com rollout gradual 10%→50%→100%.
**Definition of Done:** código revisado, testes passando (CI verde), documentação atualizada e aceito pelo PM.
**Governança de escopo:** < 3 pts → PM; 3–8 pts → PM + Tech Lead; estratégico → PM + Diretoria.

---

## 12. Critérios de Aceite do MVP (Fase 0)

O MVP é considerado **lançado** quando:
- [ ] Assinatura Mensal e Anual compráveis via **cartão e PIX**, em produção, com paywall real (não mockup).
- [ ] Limites do plano Grátis aplicados (5 partidas/dia, puzzles limitados).
- [ ] Puzzle diário acessível no app, com dificuldade adaptativa e streak visível.
- [ ] Rating **Glicko-2** ativo, provisório nas 20 primeiras partidas.
- [ ] Onboarding com primeira partida em < 90s e ≥ 80% de conclusão.
- [ ] Crash-free ≥ 99% em iOS e Android.
- [ ] Builds publicados (EAS) e trunk estável com tag de release.
- [ ] Eventos de analytics instrumentados (cadastro, conversão, puzzle/DAU, partida).
- [ ] Marca consistente com a identidade v2.0 (acento dourado em CTAs; sem laranja).

---

## 13. Anexos — Evidências do Diagnóstico

**Endpoints Django já implementados:** `register`, `login` (JWT), `token/refresh`, `password-reset` (+`verify-code`, +`confirm`), `me`, `google`, `profile`, `game/result`, `game/ai-result`, `game/history`, `leaderboard`, `password/change`, `account` (delete), `friends` (list/request/requests/action), `puzzles/*`.

**Modelos de dados:** `User` (auth por e-mail), `Profile` (username, avatar, bio, rating Elo 1200, contadores), `GameHistory` (result, mode ai/online, rating_before/after), `Friendship` (pending/accepted), `Puzzle` (fen, solution UCI, difficulty, category, rating), `UserPuzzleProgress`.

**Telas mobile existentes:** auth (splash, login, register, forgot-password, verify-code, reset-password), home (Home, Leaderboard, Subscription*mockup*), game (GameScreen vs IA, OnlineGameScreen, CapturedPieces, MoveHistory, GameOverModal), online (Matchmaking), profile (Profile, Settings, Friends, GameHistory). **Ausente:** tela de Puzzles.

**Infra:** Docker Compose (dev/test/prod), Nginx + SSL, Gunicorn, GitHub Actions CI (Black/Flake8, testes Django+Postgres, lint Node, build Docker), testes pytest + jest.

*Documento vivo — sujeito a revisão a cada ciclo de planejamento.*
