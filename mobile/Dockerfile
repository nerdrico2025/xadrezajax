FROM node:20-alpine

RUN apk add --no-cache git curl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8081 19000 19001 19002

ENV EXPO_NO_TELEMETRY=1
ENV EXPO_YES=1

CMD ["npx", "expo", "start", "--host", "lan"]
