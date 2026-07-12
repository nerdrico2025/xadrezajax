# RF-VISUAL-01 — Introduzir Dourado AJAX como cor de acento no design system mobile

**Fase:** 0 (Estabilização e Fechamento do MVP) · **Tipo:** Débito de design system · **Esforço estimado:** P (1–2 dias)
**Origem:** Feedback do fundador após ver o app em uso — "muito preto e branco, sem uma cor de destaque."

---

## 1. Problema

A identidade de marca **já prevê** uma terceira cor com essa função exata. O Briefing Técnico v2.0 define:

> Dourado AJAX `#C9A84C` — *"Uso opcional e criterioso: selos, versões especiais, materiais de premiação."*

E o Guia de Posicionamento v1.0 é mais explícito ainda sobre o papel funcional dela:

> *"Dourado é o acento — reserve para destaques, CTAs e elementos de status."*

**O código, porém, não implementa esse token.** `mobile/constants/theme.ts` define apenas `primary` (azul petróleo), `success`, `error`, `warning` — não existe `accent`. Resultado: `colors.primary` é reaproveitado para praticamente tudo (botões, tabs, links, badges, ícones selecionados, bordas de destaque), e o app perde a hierarquia visual que a cor de acento deveria criar. É a causa técnica direta da sensação "sem graça" relatada.

**Achado adicional:** o app já *tentou* resolver isso de forma pontual e não padronizada, com dois hexadecimais soltos fora da paleta:
- `GameOverModal.tsx:25` — estado de vitória usa `#F5A623` (laranja/âmbar, cor do **logo antigo, abandonada no rebranding**)
- `HomeScreen.tsx:136` — ícone de coroa do card "Classificação" usa `#F59E0B` (âmbar do token `warning`)

Nenhum dos dois é o dourado oficial `#C9A84C`. Isso confirma o diagnóstico: a necessidade de destaque já existia intuitivamente no desenvolvimento, só não foi formalizada como token de marca — e por isso saiu inconsistente.

**Decisão de marca (reafirmada):** não usar laranja. Os documentos são categóricos — *"Laranja em qualquer variação — cor do logo anterior, abandonada no rebranding"* e *"Nunca usar o laranja como cor — foi substituído no rebranding 2026."* O dourado já cumpre o papel que se buscava.

---

## 2. Objetivo

Adicionar `accent` (`#C9A84C`) como token formal no design system e aplicá-lo, de forma **criteriosa** (não como nova cor primária), aos pontos de destaque, status e conversão do app — restaurando a hierarquia visual sem comprometer a sobriedade "sofisticada, sem ser inacessível" da marca.

---

## 3. Escopo técnico

### 3.1 `mobile/constants/theme.ts`
Adicionar o token em `light` e `dark`:

```ts
const accentColor = '#C9A84C'; // Dourado AJAX — uso reservado a destaque/status/conversão

// dentro de Colors.light e Colors.dark:
accent: accentColor,
accentText: '#0D0D0D', // texto sobre fundo dourado (contraste)
```

Manter `#C9A84C` fixo em ambos os temas (light/dark) — é uma cor de marca, não deve variar por tema, ao contrário de `primary`.

### 3.2 Componentes e telas onde o `accent` entra

| Componente / Tela | Uso atual | Ajuste proposto |
|---|---|---|
| `screen/game/GameOverModal.tsx:25` | Vitória usa `#F5A623` (hardcoded, fora da paleta) | Substituir por `colors.accent` |
| `screen/home/HomeScreen.tsx:60-63` | Badge de rating usa `colors.primary` | Migrar para `colors.accent` — rating é "elemento de status", uso-modelo do briefing |
| `screen/home/HomeScreen.tsx:136` | Ícone de coroa (card Classificação) usa `#F59E0B` (hardcoded) | Substituir por `colors.accent` |
| `screen/home/SubscriptionScreen.tsx` | Hero e ícones usam `colors.primary + "18"` | CTA de assinatura ("Assinar") e selo "Premium"/"Elite" em `colors.accent` — é o uso mais alinhado ao briefing ("CTAs") e ao objetivo comercial do app (RF-MON-04 do PRD) |
| `screen/home/LeaderboardScreen.tsx:63-64` | Medalhas top-3 já usam emoji (🥇🥈🥉); linha do usuário logado usa `colors.primary` | Manter medalhas; usar `colors.accent` no destaque do rating do próprio usuário no ranking |
| `components/Button.tsx` | Variantes `primary`/`secondary` | Adicionar variante `accent` (não substituir `primary`) para CTAs de conversão específicos (assinar, upgrade) |
| Puzzle streak (a construir em RF-PUZ-03, ainda não implementado) | — | Especificar desde já: streak visual em `colors.accent`, seguindo o mesmo princípio de "elemento de status" |
| Badge de plano pago (Anual/Elite) — a construir junto de RF-MON-04 | — | Selo em `colors.accent`, uso mais próximo à letra do briefing ("selos, materiais de premiação") |

### 3.3 O que **não** muda
- `colors.primary` (azul petróleo) permanece a cor funcional do dia a dia: navegação, tabs, links, ações neutras, botão padrão.
- Dourado não deve virar cor de fundo, de superfície grande ou de texto corrido — mantém a lógica "criteriosa" do briefing, evitando que perca força por banalização.

---

## 4. Critérios de aceite

- [ ] Token `accent` (`#C9A84C`) adicionado em `theme.ts`, com `accentText` para contraste.
- [ ] Nenhum hexadecimal solto de "destaque" remanescente no código (eliminar `#F5A623` e `#F59E0B` como cor de status/vitória).
- [ ] Badge de rating na Home, estado de vitória no `GameOverModal`, e CTA/selo da `SubscriptionScreen` usando `colors.accent`.
- [ ] Nova variante `accent` disponível em `Button.tsx`, sem alterar o comportamento da variante `primary` existente.
- [ ] Validação de contraste (WCAG AA) do dourado sobre fundo claro e escuro, e de `accentText` sobre `accent`.
- [ ] Revisão visual do PM/fundador antes de merge — item nasceu de feedback direto, fecha o loop com validação visual.

---

## 5. Observação de processo

Este item é pequeno em esforço mas estrategicamente ligado à **Fase 0** do PRD: os dois destinos mais visíveis do dourado (badge de rating/status e CTA de assinatura) são exatamente os pontos onde a Fase 0 já está atuando — RF-PERF-02 (Glicko-2/rating) e RF-MON-04 (paywall real). Faz sentido implementar `accent` **junto** com essas entregas, não como item isolado depois, para não retrabalhar a mesma tela duas vezes.
