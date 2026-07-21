# Smoke test manual — Modo Campanha vs IA (build 1.4.0)

**Escopo:** os 2 PRs do épico Modo Campanha (#79 backend, #80 mobile),
mergeados em `main`. Executar no APK de preview 1.4.0, em device físico.

**Pré-requisito:** backend redeployado no Easypanel (migrations 0014/0015
aplicadas — ver checklist de deploy) e este build instalado no device.

**Como usar:** siga a ordem — os itens dependem de uma conta com Iniciante
ainda travado nos próximos níveis (conta nova ou sem vitórias de campanha
registradas).

## Item 1 — Progresso e desbloqueio no wizard

- [ ] Abrir o wizard de partida vs IA: Iniciante aparece desbloqueado e
      selecionável; Fácil/Médio/Difícil/Mestre aparecem com cadeado,
      atenuados, **não** selecionáveis.
- [ ] Tocar num nível travado mostra um aviso ("Vença N partidas...") e
      **não** seleciona nem avança o wizard sozinho.
- [ ] Vencer 1ª e 2ª partida vs IA no Iniciante: reabrir o wizard mostra
      "1/3 vitórias" e depois "2/3 vitórias" com barra dourada preenchida
      proporcionalmente, no card do Iniciante.
- [ ] Vencer a 3ª partida no Iniciante: reabrir o wizard mostra Fácil
      desbloqueado (sem cadeado, selecionável).

## Item 2 — Feedback de desbloqueio no fim de partida

- [ ] Na partida que completa a 3ª vitória (a que desbloqueia o próximo
      nível), a tela de resultado mostra um banner dourado "Nível
      [atual] dominado!" + "Nível [próximo] desbloqueado".
- [ ] Nas vitórias 1ª e 2ª (que NÃO cruzam o limiar), o banner **não**
      aparece — só a tela de resultado normal.
- [ ] Empate ou derrota nunca mostram o banner e não somam ao contador
      (confirmar reabrindo o wizard: número de vitórias não mudou).

## Item 3 — Selos no Perfil

- [ ] Perfil → bloco "vs IA e Amistosas" → faixa de 5 selos abaixo.
- [ ] Nível ainda não dominado: selo atenuado/contorno.
- [ ] Nível dominado (Iniciante, após a 3ª vitória): selo dourado
      preenchido.
- [ ] Tocar num selo mostra o nome do nível e o status (conquistado ou
      progresso atual).

## Item 4 — Regras que não podem quebrar (regressão)

- [ ] A partida que testou o desbloqueio contou normalmente na cota diária
      do plano Grátis (5 partidas vs IA/dia) — conferir em
      `GET /payments/can-play/` ou pela contagem visível no app.
- [ ] O rating (Glicko-2) do jogador não mudou em nenhuma partida de
      campanha, mesmo nas que desbloquearam nível (decisão D1, já valia
      antes do Modo Campanha).
- [ ] Partida vs IA sem relógio ("Sem limite") também soma vitória de
      campanha normalmente.

## Itens com ressalvas conhecidas (não bloqueantes, já decididos)

- **Item 3:** o selo não mostra a data de conquista — a API de leitura
  (`GET /campaign/`) não retorna esse timestamp; decisão de escopo do
  PR 2 (opcional na espec original).
- **Item 2:** a detecção do desbloqueio é 100% client-side (busca o
  progresso logo após a vitória) — se essa busca falhar por rede, a
  partida e o registro da vitória continuam normais, só o banner
  comemorativo não aparece naquela vez.
