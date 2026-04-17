# 📘 Git Workflow — Projeto Xadrez Ajax

## Objetivo

Padronizar o uso de Git e GitHub no projeto, garantindo organização, rastreabilidade e colaboração eficiente entre os desenvolvedores.

---

# 🧠 Conceitos Básicos
Repositório-local: código do projeto é armazenado no computador.
Repositório-remoto: código do projeto é armazenado no github.
Branch: Linha de desenvolvimento isolada.
Commit: Registro de uma alteração no código.
Pull Request (PR): Solicitação para integrar alterações em outra branch.
Issue: Tarefa ou funcionalidade registrada no Kanban.

---

# Estratégia de Branches

## Branches principais

* `main` → Produção (código estável)
* `dev` → Desenvolvimento
* feature/* → Novas funcionalidades
* release/* → Preparação de versão
* hotfix/* → Correções urgentes em produção

---

## Branches de trabalho

Criadas a partir da `dev`:

```bash
feature/UC<numero>-<descricao>
```

### Exemplo:

```bash
feature/UC01-home-xadrez
```
---

# Fluxo de Desenvolvimento

## 1. Criar nova branch

```bash
git checkout dev
git pull
git checkout -b feature/UC01-home-xadrez
```
---

## 2. Desenvolver funcionalidade

Realizar as alterações necessárias no código.

---

## 3. Adicionar alterações

```bash
git add .
```

---

## 4. Criar commit

Padrão recomendado:

```bash
feat: descrição da funcionalidade closes #numero
```

### Exemplo:

```bash
feat: cria tela inicial do app closes #5
📌 Observações:

feat: → nova funcionalidade
fix: → correção de bug
refactor → refatorar código
docs → documentação


## 🔗 Issue relacionada closes #
closes #5 → fecha automaticamente a tarefa após merge
```

---

## 5. Enviar para o repositório remoto

Primeiro push:

```bash
git push -u origin feature/UC01-home-xadrez
```

---

## 6. Criar Pull Request

* Base: `dev`
* Compare: sua branch
* Adicionar descrição clara
* Referenciar issue

---

## 7. Code Review

* Aguardar aprovação
* Ajustar se necessário

---

## 8. Merge do pull request

Após aprovação:

✔️ Merge na branch `dev`

💥 Resultado:

* Código integrado
* Issue fechada automaticamente

---

🚫 Arquivos que NÃO devem ser versionados

Adicionar ao .gitignore:

node_modules/
.expo/
.expo-shared/
dist/
web-build/
.env*
.DS_Store
Thumbs.db

---


# 🚫 Arquivos ignorados (.gitignore)

```bash
node_modules/
.expo/
.expo-shared/
dist/
web-build/
.env*
.DS_Store
Thumbs.db
```

---

# ✅ Boas Práticas

* Criar uma branch por caso de uso e commits por tarefa
* Commits pequenos e claros
* Usar `closes #numero`
* Não trabalhar direto na `main`
* Sempre fazer review antes do merge

---

# 🔥 Fluxo Resumido

```bash
Feature → Commit → Push → PR → CI → Review → Merge → Done
```

---

# 📌 Conclusão

Esse processo garante:

✔️ Organização
✔️ Qualidade
✔️ Escalabilidade
✔️ Padrão profissional de desenvolvimento
