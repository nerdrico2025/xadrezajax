
## Requisitos

- **Python**: Versão 3.10 ou superior.
- **PostgreSQL**
- **Redis**
- **Docker e Docker Compose** (Opcional, porém recomendado): Para subir as instâncias locais do banco de dados e Redis facilmente.

### Principais Bibliotecas Utilizadas:
- `Django==6.0.4`
- `djangorestframework==3.17.1`
- `djangorestframework-simplejwt` (Autenticação baseada em JWT)
- `django-redis` (Integração com Redis)
- `google-auth` (Validação de login social via Google)
- `psycopg2-binary` (Driver do PostgreSQL)

---

## Guia de Configuração e Instalação

Passo a passo para rodar o projeto localmente.

### 0. Entrar na pasta backend
```bash
cd backend
```

### 1. Configurar o Ambiente Virtual
```bash
python -m venv .venv

# Ativação (Windows - PowerShell)
.venv\Scripts\activate

# Ativação (Linux/MacOS)
source .venv/bin/activate
```

### 2. Instalar Dependências
```bash
pip install -r requirements.txt
```

### 3. Variáveis de Ambiente
```env
# Configurações do Django
SECRET_KEY=sua_chave_secreta_super_segura
DEBUG=True

# Configurações do Banco de Dados PostgreSQL
DB_NAME=xadrez_db
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
DB_HOST=localhost
DB_PORT=5432

# Configurações do Redis
REDIS_URL=redis://localhost:6379/1

# Integrações de Terceiros
SENDGRID_API_KEY=sua_api_key_sendgrid
GOOGLE_CLIENT_ID=seu_client_id_google_oauth
```
> **Nota:** Como estamos em ambiente de desenvolvimento, usar uma `SECRET_KEY` aleatória e manter o `DEBUG=True`. No entanto, **nunca** usar `DEBUG=True` em produção.

### 4. Configurar Banco de Dados e Cache
Se possuir **Docker** instalado, pode facilmente subir instâncias do PostgreSQL e Redis rodando o comando na pasta `backend/`:

```bash
docker-compose up -d
```
*Isto irá ler o arquivo `docker-compose.yml` e iniciar os contêineres necessários.*

### 5. Executar Migrações
Com o banco de dados rodando, aplique as migrações para criar as tabelas necessárias:
```bash
python manage.py migrate
```

### 6. Criar um Superusuário (Opcional)
Para acessar o painel de administração do Django, crie um superusuário:
```bash
python manage.py createsuperuser
```
*(Será solicitado para informar um endereço de e-mail e uma senha).*

### 7. Rodar o Servidor
Para finalizar, inicie o servidor de desenvolvimento:
```bash
python manage.py runserver
```
O servidor estará acessível em `http://127.0.0.0:8000/`.

### 8. Expor Servidor Localmente com Ngrok
Para acessar a API externamente, pode expor a porta local usando o ngrok:
```bash
ngrok http 8000
``` 
Isso gerará uma URL pública (como `https://xxxx-xxxx.ngrok-free.dev`) apontando para o seu `localhost:8000`.

### 9. Rodar o Frontend
Primeiramente, crie ou edite o arquivo `.env` na pasta do frontend (`ajax/`) com as seguintes variáveis:
```env
# URL base da API (pode ser seu IP local ou a URL gerada pelo ngrok)
EXPO_PUBLIC_API_BASE_URL=https://xxxx-xxxx.ngrok-free.dev

# Client ID do Google para autenticação social
EXPO_PUBLIC_GOOGLE_CLIENT_ID=seu_client_id_google_oauth
```

Em seguida, execute o aplicativo:
```bash
cd ../ajax
npm install
npm start
```
> **Dica:** O comando `npm start` funciona se usar um emulador no próprio PC ou se o celular estiver conectado à mesma rede Wi-Fi do computador.
> Caso o celular não consiga se conectar (devido a firewalls do roteador, redes diferentes, etc.), rode o frontend com o comando `npx expo start --tunnel`.

---

## Testes e Qualidade de Código

### Rodando os Testes
Para garantir que tudo está funcionando corretamente, o projeto conta com uma suíte de testes. Você pode executá-la utilizando o pytest ou o test runner padrão do Django:

```bash
# Usando o manage.py
python manage.py test

# Ou usando o pytest (se instalado, conforme configurado em setup.cfg)
pytest
```

### Linter (Flake8)
As configurações do linter estão no arquivo `setup.cfg`. Para checar o padrão de código:
```bash
flake8
```

---

## Principais Endpoints da API

Aqui estão os principais endpoints expostos pela API (geralmente baseados no prefixo `/api/v1/`):

### Autenticação e Usuários
- `POST /api/v1/users/register/` - Criação de uma nova conta de usuário.
- `POST /api/v1/token/` - Login padrão com E-mail e Senha, retornando `access` e `refresh` tokens (JWT).
- `POST /api/v1/token/refresh/` - Renovação do `access_token` usando um `refresh_token` válido.
- `POST /api/v1/users/google-login/` - Login/Cadastro utilizando token JWT fornecido pelo Google OAuth.

### Recuperação de Senha
- `POST /api/v1/users/password-reset/` - Solicita o envio de um código numérico de 6 dígitos para o e-mail informado.
- `POST /api/v1/users/password-reset/verify/` - Valida o código recebido pelo usuário.
- `POST /api/v1/users/password-reset/confirm/` - Define uma nova senha, dado que o código e a sessão foram validados com sucesso.

