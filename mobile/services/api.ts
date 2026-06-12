// URLs resolvidas via variáveis de ambiente:
//   Dev  → .env.development.local  (npm start)
//   Prod → .env.production.local   (npm run start:prod)
// Copie o arquivo .example correspondente e preencha.

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
export const NODE_URL = process.env.EXPO_PUBLIC_NODE_URL ?? "http://localhost:3000";
