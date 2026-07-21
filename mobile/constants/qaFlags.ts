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
