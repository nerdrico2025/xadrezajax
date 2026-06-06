# 🧠 Arquitetura do Sistema

## 📌 Visão Geral

O sistema segue uma arquitetura modular com separação clara entre UI, lógica de domínio e serviços externos.

---

## 🧱 Camadas

### 🎨 UI Layer

Responsável pela renderização:

* screens/
* components/

Não contém regras de negócio por enquanto.


---

### 🪝 State Layer

Gerenciamento de estado via hooks:

* useGame.ts

Responsável não definido 

---

### 🌐 Service Layer

Integrações externas:

* APIs
* WebSockets (futuro multiplayer)

---

## 🔄 Fluxo da aplicação

UI (Screen)
↓
Hook (useGame)
↓
Game Logic (rules/moves)
↓
Atualização do estado
↓
Re-render UI

---

## 🧠 Princípios adotados

* Separação de responsabilidades
* Baixo acoplamento
* Alta coesão
* Escalabilidade

---

## 🚀 Evolução futura

* IA para jogadas automáticas
* Multiplayer em tempo real
* Persistência de partidas
* Sistema de ranking
