# PLANO — Fase 2 (Análise Pós-Jogo por Stockfish)

**Data:** 2026-08-08 · **Base:** Fase 1 (PR #100, `Game.moves`) + PR #101 (auth, pool e telemetria do node-api)
**Status:** desenho aprovado por Rafael em 2026-08-08, com 5 decisões travadas (ver §7).
**Fora de escopo:** feedback humanizado por LLM — é a Fase 3, com model e gating próprios.

Classificar cada lance de uma partida já terminada, sem competir com os lances das partidas
que ainda estão acontecendo.

---

## 1. Trigger e fluxo de dados

O ponto de partida é uma assimetria real entre os dois modos: em partida online o node-api já
tem os lances em mãos no momento em que reporta o resultado; em partida vs IA ele nunca fica
sabendo que a partida existiu (o app reporta direto ao Django). A conclusão natural seria dois
fluxos — e um canal novo `Django → node-api` só para o caso da IA.

**A proposta é o contrário**, por um motivo que só aparece olhando o modo de falha: quem sabe
que a análise está pendente precisa ser quem sobrevive a um restart. O node-api reinicia a cada
deploy e perde tudo que está em memória. O Postgres não.

### Decisão: fila no Django, node-api puxando

O Django marca a partida como pendente de análise no momento em que a grava. O node-api pergunta
periodicamente "tem trabalho?", recebe os lances na resposta, analisa e devolve o resultado por um
`POST` — **na mesma direção e com o mesmo `X-Internal-Secret`** dos três endpoints internos que já
existem (`/game/result/`, `/internal/color-balance/`, `/payments/internal/can-play/`).

Nenhum canal `Django → node-api` é criado. O Django continua sem precisar conhecer a URL do
node-api, que hoje ele não conhece.

```
Partida online ──┐
(node-api →      │
 /game/result/)  │
                 ├──► Django · Postgres ◄──1─── node-api
Partida vs IA ───┘     Game (lances)      puxa (GET)
(app →                 GameAnalysis
 /ai-result/)          status=pendente   ───2──► devolve (POST)
                            ▲
                            │ GET .../analysis/  (polling)
                           App
```

### O que o modelo de puxar compra

- **Sobrevive a queda e a deploy.** Análise interrompida continua pendente no banco e é
  repescada. No modelo em que o node-api dispara sozinho, uma partida analisada durante um
  redeploy some sem deixar rastro.
- **Contrapressão de graça.** O node-api só pede trabalho quando tem engine livre; não existe
  fila crescendo em memória.
- **Um código só.** Partida vs IA não vira cidadã de segunda classe, e a lógica de classificação
  não é escrita duas vezes.
- **Reprocessamento barato.** Reanalisar mil partidas com outros parâmetros é um `UPDATE`
  marcando-as como pendentes.

### A alternativa descartada

Para partida online, o node-api poderia analisar direto depois de reportar o resultado — os lances
já estão na mão, sem nenhum `GET`. É mais rápido e custa: dois caminhos de código, perda silenciosa
em restart, e uma fila em memória que ninguém enxerga. A economia é de um round-trip HTTP numa
operação que leva mais de trinta segundos.

Se um dia a latência importar, o modelo de puxar aceita esse atalho depois, sem reescrita: o
node-api analisa na hora e só usa o `POST` de devolução. A fila continua sendo a rede de segurança.

### Síncrono ou assíncrono

**Assíncrono.** Uma partida de 80 lances custa mais de trinta segundos de engine — não cabe em
resposta de requisição. Sem Celery nem Bull no projeto, "assíncrono" aqui significa: o Django
guarda o estado, o node-api trabalha em background, o app consulta.

O app faz polling em `GET /api/v1/auth/games/<public_id>/analysis/`, que responde `pendente`,
`analisando`, `pronta`, `falhou` ou `indisponivel` (plano Grátis). O `public_id` da Fase 1 existe
exatamente para ser esse identificador exposto.

---

## 2. Pool de análise

### Uma avaliação por posição, não três por lance

O `validate-cp-loss.js` gasta três buscas por lance porque mede lances *hipotéticos*: sorteia o que
a IA jogaria e compara com o melhor. Análise de partida não precisa disso — os lances já foram
jogados. Avaliando cada posição uma vez, a perda de um lance sai da diferença entre avaliações
consecutivas:

```
cp_loss(lance i) = eval(P_i) − ( −eval(P_{i+1}) )

eval sempre do ponto de vista de quem está para jogar;
a inversão de sinal é a troca de lado entre as duas posições.
```

Uma partida de N lances custa **N+1 buscas, não 3N**. Com `movetime 400`:

| Partida | Lances | Buscas | Tempo | Observação |
|---|---:|---:|---:|---|
| Curta | 40 | 41 | 16 s | Miniatura, mate cedo |
| Típica | 80 | 81 | 32 s | O caso comum |
| Longa | 160 | 161 | 64 s | Final arrastado |
| Teto da Fase 1 | 1000 | 1001 | 6 min 40 s | Precisa de corte próprio — ver §6.2 |

### Configuração

Reaproveita o `REFERENCE` do `validate-cp-loss.js`, que é a mesma configuração do nível Mestre já
em produção — `skill 20`, `depth 12`, `movetime 400` — com duas mudanças:

- **`MultiPV 2` em vez de 1.** A segunda linha é o que torna "Brilhante" definível (§4) e permite
  mostrar "o melhor era X" na tela. Custa 10–20 % a mais por busca; é o único gasto extra.
- **`setoption name Threads 1` explícito.** Hoje o valor é o default 1 por omissão. Numa VPS
  pequena, herdar esse número por acidente é frágil demais para o processo que queremos manter
  fora do caminho dos lances ao vivo.

Uma diferença de disciplina em relação ao pool ao vivo: lá o `ucinewgame` a cada busca é
obrigatório, porque a tabela de hash sobrevivendo entre lances deixaria a IA mais forte que a
calibragem medida. Na análise é o oposto — as posições são da mesma partida e se sucedem, então
**manter a hash entre elas acelera sem distorcer nada**. O `ucinewgame` é enviado uma vez por
partida, não por posição.

### Isolamento

**Segunda instância de `EnginePool`, tamanho 1**, no mesmo processo. A classe já aceita
`{ size, maxQueue }` e não precisa de mudança estrutural — o que não pode acontecer é a instância
de análise herdar `POOL_SIZE`.

Duas instâncias separadas, e não uma fila com prioridade dentro do pool existente: prioridade
dentro de um pool só significaria uma análise já em curso segurando o engine que um lance ao vivo
precisa. Fila separada garante que o pool ao vivo nunca perde um slot para análise.

Isso resolve a disputa por *slot de engine*. Não resolve a disputa por **CPU física**, que na VPS
continua compartilhada. Para isso, um recuo explícito que a PR #101 tornou possível:

- Antes de pegar um engine de análise, consultar `livePool.stats().waiting`. Se houver alguém
  esperando por engine numa partida ao vivo, adiar o lote.
- Entre uma posição e a seguinte, ceder o event loop e repetir a checagem. Uma análise em curso
  *pausa* quando chega gente jogando, em vez de disputar até o fim.

É prioridade cooperativa, não preempção real — mas usa dado verdadeiro em vez de palpite, e não
exige infraestrutura nova.

---

## 3. Schema no Django

Campo novo em `Game` está descartado: a análise tem ciclo de vida próprio (pendente, falhou, refeita
com outros parâmetros) e a partida é imutável depois de gravada. Misturar os dois faria a partida
ter estado.

A escolha real é entre **uma linha por lance** e **uma linha por partida com o detalhe em JSON**:

| Critério | `MoveAnalysis` (linha por lance) | `GameAnalysis` (JSON por partida) |
|---|---|---|
| Volume | ~80 linhas por partida | 1 linha |
| Renderizar a partida | N linhas para montar a tela | 1 linha, 1 query |
| "Todos os blunders deste usuário" | SQL direto | precisa das colunas de resumo |
| Reanalisar | apagar N linhas | sobrescrever 1 campo |
| Migrar o formato do detalhe | migration de verdade | versionar e reprocessar |

**Decisão travada (1): uma `GameAnalysis` por partida — detalhe por lance em `JSONField`, resumo em
colunas indexáveis.** As colunas de resumo cobrem as agregações que o produto vai querer (precisão
média, contagem por classificação, evolução ao longo do tempo) sem multiplicar linhas por oitenta.
O JSON cobre a tela de revisão, que sempre lê a partida inteira de uma vez.

Se um dia uma feature exigir SQL por lance, `MoveAnalysis` pode ser derivada do JSON — o caminho
contrário, agregar oitenta linhas para desenhar uma tela, é o que estaríamos pagando desde o
primeiro dia sem precisar.

```
GameAnalysis
  game            FK → Game, PROTECT
  status          pendente | analisando | pronta | falhou
  — parâmetros, para o resultado ser reprodutível —
  params_version  int      (faixas de classificação usadas)
  engine_depth    int
  engine_movetime int
  engine_id       str      ("Stockfish 16.1")
  — resumo, indexável —
  white_accuracy  float    black_accuracy  float
  white_avg_loss  int      black_avg_loss  int
  counts          JSON     ({brilliant, best, good, inaccuracy, mistake, blunder} por cor)
  turning_point_ply  int, null
  — detalhe —
  moves           JSON     (uma entrada por lance)
  analyzed_plies  int      (< ply_count quando houve corte)
  — operação —
  attempts        int      leased_until  datetime, null
  failure_reason  str
  created_at · completed_at

entrada de moves[]
  ply · san · eval_cp · cp_loss · classification
  best_move_san · is_only_move · is_book

GameNarrative  — Fase 3, criada depois; nada aqui muda —
  analysis        FK → GameAnalysis
  text · model · prompt_version · generated_at
```

`PROTECT` na FK para `Game`, e não `CASCADE`: apagar uma partida com análise deve ser decisão
consciente, não efeito colateral. E vale lembrar que a exclusão de conta não apaga `Game` — a
Fase 1 usa `SET_NULL` nos jogadores justamente para a partida sobreviver na biblioteca do
adversário. A análise segue junto.

`params_version` é o que torna reprocessamento honesto: mudou faixa de classificação ou
profundidade, incrementa a versão e as análises antigas ficam identificáveis como "feitas com outra
régua". Sem esse campo, uma tela mostraria números de duas réguas diferentes sem ninguém perceber.

### Espaço para a Fase 3

`GameNarrative` como model separado, não campo em `GameAnalysis`. Os dois têm ciclo de vida
diferente (regerar o texto não invalida a análise), custo diferente e **gating diferente** — Mensal
vê a classificação, Anual vê o texto. Criar essa tabela na Fase 3 não toca em nada do que esta fase
entrega.

---

## 4. Classificação

### Truncamento, antes das faixas

O `scoreOf` do `validate-cp-loss.js` converte mate em ±10000 cp. Numa partida real isso destrói a
classificação: deixar passar um mate em 5 viraria perda de vinte mil centipawns, e a média da
partida inteira iria junto.

**Truncar toda avaliação em ±1000 cp antes de calcular a perda.** É prática padrão de análise e tem
justificativa direta: acima de dez peões de vantagem, a diferença entre "ganho" e "ganho demais" não
é informação para quem está aprendendo. Posições de mate forçado entram como o teto, e a perda por
deixar o mate escapar continua grande — mas grande como um blunder, não como evento fora de escala.

### Faixas

| Classe | cp_loss | Condição adicional | Leitura |
|---|---:|---|---|
| Brilhante | ≤ 10 | é lance único **e** sacrifica material | Achou o que não era óbvio |
| Ótimo | ≤ 10 | — | O melhor, ou empatado com ele |
| Bom | 11–50 | — | Não é o melhor e não custa nada |
| Impreciso | 51–100 | — | Entregou meio peão |
| Erro | 101–300 | — | Entregou material ou a iniciativa |
| Blunder | > 300 | — | Mudou o rumo da partida |

O corte em 300 cp não é inventado aqui: é o `BIG_BLUNDER_CP` que o `validate-cp-loss.js` já usa como
limiar de erro grave. A régua da análise e a régua da calibragem da IA passam a ser a mesma — se um
dia uma mudar, a outra deveria mudar junto, e isso fica visível.

### Brilhante não sai de cp_loss

Vale dizer com todas as letras porque é a diferença entre entregar a feature e entregar uma etiqueta
que nunca aparece: **por perda de centipawns, um lance brilhante é indistinguível de um lance
óbvio** — os dois perdem zero. O que faz um lance ser brilhante é o contexto: ele é o único que
funciona, e parece errado.

Daí o `MultiPV 2`. Com a segunda melhor linha em mãos:

- **Lance único**: a segunda linha perde ≥ 200 cp em relação à primeira. O jogador achou a agulha.
- **Sacrifício**: o lance entrega material (≥ 1,5 peão de saldo, contado no replay com o `chess.js`,
  que já está no node-api) e ainda assim mantém a avaliação.

Exigir as duas condições deixa "Brilhante" raro, que é o ponto — uma etiqueta que aparece toda hora
não significa nada. Se na validação ficar raro *demais*, afrouxar o limiar de sacrifício é ajuste de
um número.

### Momento decisivo

Sobre a série de avaliações da partida inteira, converter centipawns em probabilidade de vitória — a
escala de cp não é linear e uma queda de 300 cp significa coisas muito diferentes em 0 e em 800.
Depois:

1. Considerar só os lances de quem **perdeu** a partida (num empate, os dois lados).
2. Entre eles, achar a maior queda de probabilidade de vitória em um único lance.
3. Aceitar só se o lance **cruzou uma fronteira**: de ganhando ou igual para perdendo. Uma queda de
   95 % para 80 % é grande em número e não decidiu nada.

`turning_point_ply` é nulo quando não existe esse momento — partida ganha do começo ao fim, ou
derrota construída em dez imprecisões sem nenhum lance culpado. **Nulo é resultado legítimo, não
falha**, e a tela precisa ter o que dizer nesse caso. Apontar um "erro decisivo" em partida que não
teve um é pior do que não apontar nada.

---

## 5. Gating por plano

A checagem acontece em **dois momentos, com propósitos diferentes**, e os dois usam o
`has_paid_access` que já existe em `apps/payments/access.py`:

| Momento | Onde | Protege |
|---|---|---|
| Ao enfileirar | Django, ao gravar a partida | **CPU.** Partida de quem não vai poder ver não entra na fila. |
| Ao ler | Django, no endpoint de análise | **Acesso.** Quem não paga recebe `indisponivel`, nunca o conteúdo. |

O gating ao enfileirar é o que importa para o custo. Sem ele, o plano Grátis consumiria a mesma
engine do plano pago para produzir análise que ninguém veria.

### O caso que quebra a regra simples

Uma partida online tem **dois** jogadores, com planos possivelmente diferentes. Um tabuleiro só, uma
análise só.

**Decisão travada (5): enfileirar se pelo menos um dos dois é pagante; liberar a leitura por
usuário.** Se o das brancas é Mensal e o das pretas é Grátis, a análise roda uma vez, as brancas
veem e as pretas recebem `indisponivel`. Analisar duas vezes seria desperdício; não analisar puniria
o pagante pelo plano do adversário.

Em partida vs IA não há ambiguidade: um usuário só.

A separação Mensal × Anual já está pronta no schema: esta fase entrega `GameAnalysis`, liberada com
`has_paid_access`. A Fase 3 acrescenta `GameNarrative` com sua própria checagem de plano anual.
Nenhuma das duas precisa saber da outra.

---

## 6. Riscos

### 6.1 Análise órfã depois de uma queda

Se o node-api cair no meio de uma análise, a linha fica travada em `analisando` para sempre. É o modo
de falha mais provável, porque acontece em todo redeploy.

**Mitigação:** `leased_until` — o node-api marca a linha com prazo ao pegar o trabalho, e o Django
devolve à fila qualquer análise cujo prazo venceu. Sem daemon, sem cron: a checagem cabe no próprio
endpoint que entrega trabalho. `attempts` conta as tentativas e a partida vira `falhou` depois da
terceira, para uma partida problemática não ocupar a engine em loop.

### 6.2 Partidas muito longas

O teto de 1000 plies da Fase 1 protege o banco, não a CPU: analisar 1000 posições são quase sete
minutos de engine numa VPS pequena.

**Mitigação (decisão travada 3):** teto próprio de análise em **300 plies** (150 lances de cada
lado, acima de qualquer partida normal), gravando `analyzed_plies` quando houver corte. Uma partida
cortada ainda entrega classificação e momento decisivo do trecho analisado, e a tela pode dizer que
analisou até certo ponto. Rejeitar seria pior; analisar tudo, também.

### 6.3 Lances de partida vs IA não são autoritativos

Em partida online os lances passaram pelo `chess.js` do servidor. Em partida vs IA vêm do cliente,
sem validação. **Para a confiabilidade do que o usuário vê, não compromete**: é a partida dele, não
há ranking nem adversário, e uma partida forjada só rende uma análise bonita de algo que não
aconteceu. Ninguém é prejudicado.

O problema é de custo: **um `POST` barato compra minutos de engine.** É amplificação de recurso, na
mesma família do que a PR #101 fechou no endpoint da engine.

**Mitigação:** limite de análises por usuário por dia (vs IA); teto de plies da §6.2; e o replay SAN
no node-api rejeitando sequência ilegal — que também cobre o caso honesto de payload corrompido.
Vale registrar que **o Django não tem biblioteca de xadrez** (não há `python-chess` nas
dependências), então a validação de legalidade só pode acontecer no node-api, durante o replay. Ou
seja: partida inválida é detectada tarde, e o caminho de falha precisa ser limpo — marcar `falhou`
com motivo, sem repescar.

### 6.4 Contenção de CPU com as partidas ao vivo

É o risco de fundo, e o único que não dá para eliminar dentro de um processo só. O recuo cooperativo
da §2 reduz; não elimina.

**Mitigação:** a telemetria da PR #101 passa a ser instrumento de decisão. Se depois de ligar a
análise o `queued` do pool ao vivo sair de zero, a relação causa-efeito fica visível e as saídas são
conhecidas: reduzir o `movetime`, analisar só fora de pico, ou aceitar que a análise precisa de
outra caixa.

**Decisão travada (4): subir a Fase 2 com a análise desligada por variável de ambiente e ligar
observando esse número.**

### 6.5 Lances de abertura inflam a precisão

Os primeiros dez ou quinze lances costumam ser teoria conhecida, com perda quase zero. Contá-los na
média faz todo mundo parecer mais preciso do que é, e o efeito é maior justamente em quem decora
aberturas.

**Mitigação:** marcar `is_book` e excluir esses lances da média de precisão, mantendo-os na lista
exibida. Sem livro de aberturas no projeto, a aproximação viável é posicional (ignorar os N
primeiros plies na estatística).

### 6.6 Dependência de deploy

A Fase 2 só funciona com o node-api publicado, e o node-api já acumula a PR #101, que **quebra o APK
1.8.3 em campo**. A análise entra na mesma janela de publicação: backend, node-api e APK juntos.
Nada aqui muda esse acoplamento — só aumenta o que depende dele.

---

## 7. Decisões travadas (aprovadas por Rafael em 2026-08-08)

1. `GameAnalysis` como **uma linha por partida** (detalhe em JSON), não uma linha por lance.
2. **MultiPV 2**, habilitando a classificação "Brilhante".
3. Teto de **300 plies** para análise; `analyzed_plies` grava o corte parcial.
4. Análise atrás de **variável de ambiente, desligada por padrão** no primeiro deploy.
5. Partida online com **pelo menos um** jogador pagante é enfileirada; leitura liberada só para quem
   tem `has_paid_access`.

---

## 8. Divisão em PRs

O escopo não cabe em revisão única. Três PRs sequenciais, cada um verde sozinho:

| PR | Escopo | Depende de |
|---|---|---|
| **1 — Django** | `GameAnalysis` + migration, gating ao enfileirar, endpoints interno de fila/devolução e público de leitura, feature flag | Fase 1 (mergeada) |
| **2 — node-api** | Segundo `EnginePool`, loop de polling, replay, avaliação, classificação, momento decisivo | PR 1 (contrato dos endpoints) |
| **3 — Mobile** | Tela de análise com polling, `MoveHistory` reaproveitado, gate client-side | PR 1 (contrato de leitura) |

Com a flag desligada, o PR 1 sozinho não muda nenhum comportamento em produção: nenhuma
`GameAnalysis` é criada e os endpoints ficam ociosos.
