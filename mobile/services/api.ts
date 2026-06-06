// URLs resolvidas via variáveis de ambiente (.env na raiz do projeto)
// Em desenvolvimento Docker, defina no .env:
//   EXPO_PUBLIC_API_URL=http://<seu-ip-local>:8000
//   EXPO_PUBLIC_NODE_URL=http://<seu-ip-local>:3000
// O dispositivo físico/emulador precisa do IP da máquina host, não de "localhost".

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
export const NODE_URL = process.env.EXPO_PUBLIC_NODE_URL ?? "http://localhost:3000";
