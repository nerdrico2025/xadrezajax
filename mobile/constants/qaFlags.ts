import { IS_PROD } from "@/services/api";

/**
 * Flags de QA — só existem para viabilizar teste manual em device.
 *
 * Cada flag tem DUAS travas: precisa estar explicitamente ligada por variável
 * de ambiente E o build não pode ser de produção. Ligar a var num build de
 * produção não tem efeito — é proposital, para que um erro de configuração no
 * eas.json nunca vaze comportamento de QA para o usuário final.
 */

/**
 * Destrava todos os níveis de dificuldade da IA no wizard, ignorando o
 * cadeado da campanha.
 *
 * Por que existe: a campanha (PRs #79/#80) só libera um nível a cada 3
 * vitórias, então não há como testar a calibragem de Médio/Difícil/Mestre em
 * device sem antes vencer a campanha inteira — o que tornaria a validação da
 * curva de dificuldade impraticável.
 *
 * Escopo: afeta APENAS a seleção no wizard. A progressão da campanha continua
 * sendo registrada normalmente no backend (vitórias contam, selos são
 * concedidos) — isto não falsifica progresso, só remove o bloqueio visual de
 * seleção.
 */
export const QA_UNLOCK_ALL_AI_LEVELS =
  !IS_PROD && process.env.EXPO_PUBLIC_QA_UNLOCK_LEVELS === "true";

/**
 * Mostra o bloco de diagnóstico com o PGN da partida no modal de fim de jogo.
 *
 * Por que existe: a análise da calibragem da IA precisa da partida lance a
 * lance (ver utils/aiGamePgn.ts), e o PGN não é persistido em lugar nenhum —
 * copiar do modal é o único canal. Só que o bloco é ruído puro para o usuário
 * final, e estava aparecendo em TODOS os builds.
 *
 * Usa a MESMA variável de ambiente do destravamento de níveis: as duas coisas
 * servem à mesma campanha de QA em device, e ligar uma sem a outra não faz
 * sentido — a partida de diagnóstico é jogada justamente nos níveis destravados.
 */
export const QA_SHOW_AI_DIAGNOSTIC_PGN = QA_UNLOCK_ALL_AI_LEVELS;
