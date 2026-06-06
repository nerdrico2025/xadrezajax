.PHONY: help dev dev-build down build logs \
        logs-backend logs-node logs-mobile \
        shell-backend shell-node \
        migrate makemigrations createsuperuser \
        test-backend clean ip setup

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

test-backend: ## Roda a suite de testes do Django
	$(BACKEND) python manage.py test

# ─────────────────────────────────────────
# Limpeza
# ─────────────────────────────────────────
clean: ## Para containers e remove volumes (APAGA o banco)
	@echo "⚠️  Isso vai remover os volumes e apagar o banco. Continuar? [y/N]" && \
		read ans && [ $${ans:-N} = y ] && \
		$(COMPOSE) down -v --remove-orphans || echo "Cancelado."
