# 27 — Sistema de To-Dos

## Visão Geral

O RedBus possui um sistema de gerenciamento de tarefas (To-Do) integrado ao banco de dados SQLite, à orquestração do Maestro, ao motor de proatividade e ao MemPalace (AAAK). Permite que o agente crie, conclua e monitore tarefas de forma autônoma.

## Arquitetura

```
┌──────────────────────────────┐
│        TodoManager.tsx       │  ← UI React (Vanilla CSS)
│  (listagem, checkbox, filtro)│
└──────────┬───────────────────┘
           │ IPC (todo:*)
┌──────────▼───────────────────┐
│      ipcHandlers.ts          │  ← Handlers IPC padrão {status, data, error}
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│      todoService.ts          │  ← CRUD + lógica de negócio
│  createTodo, completeTodo,   │
│  archiveTodo, listTodos,     │
│  findTodoByContent,          │
│  getPendingTodosWithDeadline │
└──────────┬───────────────────┘
           │
     ┌─────┼─────┐
     ▼           ▼
 database.ts   aaakService.ts
 (Todos table)  (MemPalace)
```

## Banco de Dados

Tabela `Todos` no SQLite:

| Campo        | Tipo     | Descrição                          |
|-------------|----------|-------------------------------------|
| id          | TEXT PK  | UUID v4                             |
| content     | TEXT     | Descrição da tarefa                 |
| target_date | DATETIME | Prazo opcional (ISO 8601)           |
| status      | TEXT     | 'pending' ou 'completed'           |
| archived    | INTEGER  | 0 (ativo) ou 1 (arquivado)         |
| created_at  | DATETIME | Data de criação                     |

## Serviço (todoService.ts)

Localização: `electron/services/todoService.ts`

### Funções exportadas:
- `createTodo(db, { content, target_date? })` → Cria tarefa + MemPalace event
- `listTodos(db, includeArchived?)` → Lista tarefas (padrão: não-arquivadas)
- `completeTodo(db, todoId)` → Marca como concluída + MemPalace event
- `archiveTodo(db, todoId)` → Arquiva (soft delete)
- `unarchiveTodo(db, todoId)` → Restaura do arquivo
- `deleteTodo(db, todoId)` → Remove permanentemente
- `getTodo(db, todoId)` → Busca por ID
- `findTodoByContent(db, query)` → Busca fuzzy por conteúdo (LIKE)
- `getPendingTodosWithDeadline(db, withinMs?)` → Tarefas com prazo próximo

## IPC Channels

| Canal           | Payload                            | Retorno                |
|----------------|------------------------------------|------------------------|
| todo:create    | { content, target_date? }          | { status, data: Todo } |
| todo:list      | includeArchived?: boolean          | { status, data: Todo[] }|
| todo:complete  | todoId: string                     | { status, data }       |
| todo:archive   | todoId: string                     | { status, data }       |
| todo:unarchive | todoId: string                     | { status, data }       |
| todo:delete    | todoId: string                     | { status, data }       |
| todo:get       | todoId: string                     | { status, data: Todo } |

## Interface do Usuário

- **Aba:** "to-dos" na barra de navegação (ícone `ListTodo` da lucide-react)
- **Componente:** `src/components/Todos/TodoManager.tsx`
- **Estilo:** Vanilla CSS em `src/index.css` (classes `.todo-*`)
- **Funcionalidades:**
  - Input inline para criar tarefa (Enter ou botão +)
  - Campo datetime-local para prazo opcional
  - Checkbox para marcar como concluído
  - Botões de arquivar e excluir (visíveis no hover)
  - Filtro para mostrar/ocultar arquivados
  - Indicador visual de prazo vencido (borda vermelha)

### Botão "Adicionar ao To-Do" no InboxView

Itens de ação no digest (`action_items`) possuem um botão inline "to-do" que converte o item em uma tarefa com um clique via `window.redbusAPI.createTodo()`.

## Integração com MemPalace (AAAK)

Função `storeTodoEventInMempalace()` em `aaakService.ts`:

- **Criação** → `hall_events` com formato `TODO.new:"conteúdo" | DUE:data`
- **Conclusão** → `hall_facts` com formato `TODO.done:"conteúdo"`
- Wing: "Tarefas" / Room: "To-Dos"
- Inclui drawer com JSON raw do evento

## Orquestração (Maestro)

### FORMAT M — Create To-Do
O Maestro identifica intenções como "me lembre de...", "adiciona uma tarefa", "preciso fazer X amanhã" e dispara `create_todo` com `content` e `target_date` inferidos.

```json
{
  "create_todo": { "content": "Enviar relatório", "target_date": "2026-04-14T09:00:00Z" }
}
```

### FORMAT N — Complete To-Do
O Maestro identifica "já fiz X", "pode marcar como feito" e dispara `check_todo` com busca fuzzy.

```json
{
  "check_todo": { "query": "relatório" }
}
```

## Motor de Proatividade

O `proactivityEngine.ts` verifica tarefas pendentes com `getPendingTodosWithDeadline()` (janela de 2 horas). Se encontrar tarefas urgentes/vencidas, injeta no contexto ambiental:

- Descrição da tarefa
- Status do prazo (vencido há X min / vence em X min)
- Instrução para sugerir resolução com base no contexto atual (janela ativa, clipboard)

## Testes

- `test/todoService.test.ts` — 13 testes: CRUD, busca, MemPalace
- `test/TodoManager.test.tsx` — 6 testes: renderização, input, checkbox, estados vazios

