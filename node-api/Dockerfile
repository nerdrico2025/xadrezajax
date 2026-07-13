FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        stockfish \
        curl \
    && ln -sf /usr/games/stockfish /usr/local/bin/stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

# node direto como PID 1 (mesmo comando de "npm start", sem a camada do npm):
# recebe SIGTERM de verdade no redeploy, sem o log confuso do npm repassando o sinal
CMD ["node", "index.js"]
