.PHONY: help dev dev-build down build logs \
        logs-backend logs-node logs-mobile \
        shell-backend shell-node \
        migrate makemigrations createsuperuser \
        test test-backend test-node ci clean ip setup \
        prod-init prod-up prod-down prod-logs prod-cert-renew

# ─────────────────────────────────────────
# Configuração
# ─────────────────────────────────────────
COMPOSE = docker compose
BACKEND = $(COMPOSE) exec backend
NODE    = $(COMPOSE) exec node-api

help: ## Exibe todos os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─────────────────────────────────────────
# Setup inicial
# ─────────────────────────────────────────
setup: ## Configuração inicial: cria .env e sobe os containers
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✅ .env criado a partir de .env.example — ajuste as variáveis antes de continuar"; \
	else \
		echo "ℹ️  .env já existe, pulando criação"; \
	fi

ip: ## Exibe o IP local da máquina (use em EXPO_PUBLIC_* e HOST_IP no .env)
	@hostname -I | awk '{print $$1}'

# ─────────────────────────────────────────
# Ciclo de vida dos containers
# ─────────────────────────────────────────
dev: ## Sobe todos os serviços (sem rebuild)
	$(COMPOSE) up

dev-build: ## Sobe todos os serviços com rebuild das imagens
	$(COMPOSE) up --build

down: ## Para e remove todos os containers
	$(COMPOSE) down

build: ## Reconstrói todas as imagens sem subir
	$(COMPOSE) build

# ─────────────────────────────────────────
# Logs
# ─────────────────────────────────────────
logs: ## Acompanha logs de todos os serviços
	$(COMPOSE) logs -f

logs-backend: ## Logs apenas do Django
	$(COMPOSE) logs -f backend

logs-node: ## Logs apenas do Node API
	$(COMPOSE) logs -f node-api

logs-mobile: ## Logs apenas do Expo
	$(COMPOSE) logs -f mobile

# ─────────────────────────────────────────
# Shells interativos
# ─────────────────────────────────────────
shell-backend: ## Shell Python (Django) interativo
	$(BACKEND) python manage.py shell

shell-node: ## Shell do container Node
	$(NODE) sh

shell-db: ## psql direto no banco
	$(COMPOSE) exec postgres psql -U $${DB_USER} -d $${DB_NAME}

# ─────────────────────────────────────────
# Django
# ─────────────────────────────────────────
migrate: ## Aplica migrações pendentes
	$(BACKEND) python manage.py migrate

makemigrations: ## Gera novas migrações
	$(BACKEND) python manage.py makemigrations

createsuperuser: ## Cria superusuário no Django Admin
	$(BACKEND) python manage.py createsuperuser

ci: ## Suite completa em ambiente isolado (sem afetar o dev)
	@echo "🏗️  Construindo imagens de teste..."
	@docker compose -f docker-compose.test.yml build -q
	@echo "\n🧪 Node API ────────────────────────────"
	@docker compose -f docker-compose.test.yml run --rm node-test || \
		(docker compose -f docker-compose.test.yml down -v --remove-orphans && exit 1)
	@echo "\n🧪 Django ──────────────────────────────"
	@docker compose -f docker-compose.test.yml run --rm backend-test || \
		(docker compose -f docker-compose.test.yml down -v --remove-orphans && exit 1)
	@echo "\n✅ Todos os testes passaram!"
	@docker compose -f docker-compose.test.yml down -v --remove-orphans

test: ## Roda testes nos containers de desenvolvimento (dev deve estar no ar)
	@echo "\n🧪 Django ──────────────────────────────"
	$(BACKEND) pytest apps/ --cov=apps --cov-report=term-missing -q
	@echo "\n🧪 Node API ────────────────────────────"
	$(NODE) npm test

test-backend: ## Roda apenas os testes do Django com coverage
	$(BACKEND) pytest apps/ --cov=apps --cov-report=term-missing

test-node: ## Roda apenas os testes do Node API
	$(NODE) npm test

# ─────────────────────────────────────────
# Produção
# Pré-requisito: .env.prod preenchido e domínio apontando para o servidor
# ─────────────────────────────────────────
-include .env.prod
export

# ⚠️  Os alvos prod-* abaixo usam o docker-compose.prod.yml, que NÃO espelha
# o deploy real: a produção roda no Easypanel (serviços nativos com
# proxy/SSL próprios). Use-os só para rodar a stack fora do Easypanel.
PROD_COMPOSE = docker compose -f docker-compose.prod.yml

prod-init: ## Primeira inicialização: obtém certificado SSL e sobe produção
	@test -f .env.prod || (echo "❌ Crie o .env.prod antes de continuar (cp .env.prod.example .env.prod)" && exit 1)
	@echo "🏗️  Construindo imagens..."
	$(PROD_COMPOSE) build
	@echo "\n🚀 Subindo serviços (sem Nginx por enquanto)..."
	$(PROD_COMPOSE) up -d postgres redis backend node-api
	@echo "\n🔐 Obtendo certificado SSL para $(DOMAIN)..."
	docker run --rm -p 80:80 \
		-v /etc/letsencrypt:/etc/letsencrypt \
		certbot/certbot certonly --standalone --agree-tos \
		--non-interactive --email $(ADMIN_EMAIL) -d $(DOMAIN)
	@echo "\n✅ Certificado obtido! Subindo Nginx..."
	$(PROD_COMPOSE) up -d nginx
	@echo "\n🎉 Produção no ar em https://$(DOMAIN)"

prod-up: ## Sobe produção (certificado já existente)
	$(PROD_COMPOSE) up -d --build

prod-down: ## Para produção
	$(PROD_COMPOSE) down

prod-logs: ## Acompanha logs de produção
	$(PROD_COMPOSE) logs -f

prod-cert-renew: ## Renova o certificado SSL (rode antes de vencer — a cada 3 meses)
	docker run --rm \
		-v /etc/letsencrypt:/etc/letsencrypt \
		-v certbot_www:/var/www/certbot \
		certbot/certbot renew --quiet
	$(PROD_COMPOSE) exec nginx nginx -s reload
	@echo "✅ Certificado renovado e Nginx recarregado"

# ─────────────────────────────────────────
# Limpeza
# ─────────────────────────────────────────
clean: ## Para containers e remove volumes (APAGA o banco)
	@echo "⚠️  Isso vai remover os volumes e apagar o banco. Continuar? [y/N]" && \
		read ans && [ $${ans:-N} = y ] && \
		$(COMPOSE) down -v --remove-orphans || echo "Cancelado."
