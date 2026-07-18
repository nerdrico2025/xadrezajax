# Smoke test manual — build 1.3.0 (rodada de correções v1.1.0 → PRs A–F)

**Escopo:** os 8 pontos apontados na rodada de testes em device sobre o build
v1.1.0 (ver `AJAX_Prompts_Correcoes_v1.1.1.md`), todos mergeados em main
(PRs #72–#76 + PRs D/E via merge local). Executar no APK de preview 1.3.0,
em device físico, marcando cada caixa.

**Como usar:** siga a ordem — os itens 7 e 8 dependem de iniciar uma partida
vs IA, aproveite a mesma sessão de jogo.

## Item 1 — Dourado AJAX aplicado com regra (PR F)

- [ ] Tema claro e escuro: o dourado aparece nos acentos (CTAs primárias,
      chip de streak, realces) e **nunca** como texto de corpo ou número.
- [ ] Nenhum elemento laranja em nenhuma tela (proibição D4 do rebranding).
- [ ] No tema claro, textos dourados usam o tom escurecido (`#826417`) e
      permanecem legíveis sobre fundos claros.

## Item 2 — Nomenclatura AJAX (PR F)

- [ ] Header/TopBar e nome do app instalado: **"AJAX"** (maiúsculo).
- [ ] Textos de usuário (login, onboarding, planos): **"Clube de Xadrez
      AJAX"** — nenhuma ocorrência de "Xadrez Ajax" ou "Ajax" minúsculo.

## Item 3 — Botões de assinatura (PR A)

- [ ] Tela de planos: cada botão de plano responde ao toque.
- [ ] Fluxo abre o Checkout do Stripe (ambiente de preview) ou exibe erro
      tratado com feedback visível — nunca toque sem resposta.

## Item 4 — Partidas vs IA no Perfil (PR B)

- [ ] Terminar uma partida vs IA (vitória, derrota ou empate) e abrir o
      Perfil: a partida aparece no histórico e no bloco **vs IA / Amistosas**.
- [ ] O rating Glicko-2 e o bloco **Ranqueadas** não mudam (decisão D1).

## Item 5 — Temas de tabuleiro (PR E)

- [ ] Trocar o tema do tabuleiro nas configurações: os 5 temas aplicam
      imediatamente (Verde Clássico, Madeira AJAX, Azul Petróleo, etc.).
- [ ] Fechar e reabrir o app: o tema escolhido persiste (storage local).
- [ ] Peças legíveis em todos os temas (incl. Preto & Marfim).

## Item 6 — Tela de Puzzles (PR A)

- [ ] Puzzle do dia abre, aceita lances corretos e desfaz lances errados.
- [ ] Streak e contador do plano Grátis (3/dia) exibidos; ao esgotar,
      paywall elegante com CTA "Assinar Premium".

## Item 7 — Wizard de configuração vs IA (PR C)

- [ ] Configurar partida vs IA percorre o wizard de 3 passos (dificuldade,
      cor, relógio) e **nenhuma escolha inicia o jogo sozinha** (decisão D5)
      — só o botão final de confirmação inicia.

## Item 8 — Percepção de travamento na jogada da IA (PR D)

- [ ] Durante o cálculo da IA aparece o indicador "Pensando" não-bloqueante
      (decisão D6) — o tabuleiro continua visível e a UI responsiva.
- [ ] Nenhum spinner modal/overlay em nenhuma dificuldade.
- [ ] Com a rede derrubada no meio do lance da IA: após ~10s aparece "A IA
      não respondeu" com "Tentar novamente" / "Sair" — sem limbo silencioso.

## Itens com ressalvas conhecidas (não bloqueantes, já decididos)

- **Item 7:** a validação de força da IA cobriu só os pares extremos
  (Mestre 8/8 vs Iniciante/Fácil). Pares adjacentes ficam como follow-up
  (`node-api/scripts/validate-ai-strength.js`) — decisão de 2026-07-17.
- **Item 5:** persistência do tema é local-only por decisão (2026-07-17);
  sincronização multi-dispositivo só quando houver necessidade real.
- **Item 1:** isenções WCAG deliberadas documentadas no PR #76 (accent puro
  como realce decorativo no tema claro; dot do Matchmaking com anel +
  accessibilityLabel).
