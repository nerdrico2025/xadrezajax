
## Instalação

3. **Instale as dependências**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure as variáveis de ambiente**:
   - Copie o arquivo `.env.example` para `.env`
   - Edite o `.env` com suas configurações:
     ```
     SECRET_KEY=sua-chave-secreta-aqui
     DEBUG=True
     ALLOWED_HOSTS=localhost,127.0.0.1
     DB_NAME=chess_db
     DB_USER=chess_user
     DB_PASSWORD=chess_password
     DB_HOST=localhost
     DB_PORT=5432
     ```

5. **Inicie o banco de dados**:
   ```bash
   docker-compose up -d
   ```

6. **Execute as migrações**:
   ```bash
   python manage.py migrate
   ```


## Execução

Para iniciar o servidor de desenvolvimento:

```bash
python manage.py runserver
```

O servidor estará disponível em `http://localhost:8000`.

## Testes

Para executar os testes:

```bash
python manage.py test apps.users --verbosity=2
```

## API Endpoints

### Autenticação

- `POST /api/v1/auth/register/`: Registrar novo usuário (UC02)
- `POST /api/v1/auth/login/`: Fazer login com e-mail e senha (UC03)
- `POST /api/v1/auth/google/`: Autenticar via Google OAuth (UC01)
- `POST /api/v1/auth/token/refresh/`: Renovar access token via refresh token

### Recuperação de Senha

- `POST /api/v1/auth/password-reset/`: Solicitar recuperação de senha (UC04)
  - Envia e-mail com link de redefinição
- `POST /api/v1/auth/password-reset/confirm/`: Confirmar redefinição de senha (UC04)
  - Valida token e redefine a senha

### Usuário Autenticado

- `GET /api/v1/auth/me/`: Obter dados do usuário atual (autenticado)
- `PATCH /api/v1/auth/theme/`: Atualizar preferência de tema (light/dark/system) (UC05)
- `POST /api/v1/auth/logout/`: Fazer logout e blacklist do refresh token (UC06)

## Estrutura do Projeto

```
backend/
├── apps/
│   └── users/          # App de usuários
│       ├── migrations/ # Migrações do banco
│       ├── models.py   # Modelo User personalizado
│       ├── serializers.py
│       ├── views.py
│       ├── urls.py
│       └── tests/      # Testes automatizados
├── core/               # Configurações principais
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── docker-compose.yml  # Configuração do PostgreSQL
├── manage.py
├── requirements.txt
└── .env                # Variáveis de ambiente
```