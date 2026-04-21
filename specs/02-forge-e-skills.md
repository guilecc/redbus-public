# Spec 02 — Forge ↦ Skills

## Objetivo

Transformar o `forgeService` atual (CRUD de snippets + exec sandbox) em um
sistema de **Skills** no estilo `oc/skills/`: pacotes markdown com metadados +
scripts auxiliares + opcional lista de tools, que podem ser descobertos,
instalados e ativados de forma declarativa.

## Estado atual (`redbus`)

- `electron/services/forgeService.ts` (303 linhas):
  - CRUD de `ForgeSnippets` (SQLite): `name, language, code, parameters_schema,
    required_vault_keys, version`.
  - `execSnippet(code, language, params)` → roda `python|node|bash` via
    `execFile` em tmpdir com timeout de 30s e regex anti-destrutivo.
- Snippets são invocados programaticamente; **não existe metadata
  LLM-friendly** para o modelo decidir *quando* usar.
- Não existe bundling de recursos (templates, fixtures, scripts auxiliares).

> Como esta é uma **versão nova do app**, não há preocupação com migração
> de snippets existentes nem retrocompat da tabela `ForgeSnippets`.

## Padrão de inspiração (`oc/skills/`)

### Anatomia de uma Skill (oc/skills/skill-creator/SKILL.md)

```
skill-name/
├── SKILL.md               # obrigatório
│   ├── frontmatter YAML: name, description, metadata.openclaw
│   └── corpo markdown com instruções
├── scripts/               # executáveis deterministícos
├── references/            # docs carregadas sob demanda
└── assets/                # templates, fontes, etc.
```

**Frontmatter** (o que o LLM lê antes do trigger):

```yaml
---
name: coding-agent
description: "Quando usar. Quando NÃO usar. Restrições operacionais."
metadata:
  openclaw:
    emoji: "🧩"
    requires: { anyBins: ["claude", "codex"] }
    install: [{ id, kind, package, bins, label }, ...]
---
```

### Princípios do `skill-creator`

- **Concise is Key**: só adicionar contexto que o modelo não tem.
- **Degrees of Freedom**: alto (texto) → médio (pseudocódigo) → baixo (scripts
  fixos) conforme fragilidade do passo.
- **SKILL.md = onboarding guide**, não tutorial exaustivo.
- Corpo da skill só é carregado **depois do trigger** (economia de tokens).

## Plano de migração no `redbus`

### Fase 1 — Formato Skill + loader

1. Definir diretório `~/.redbus/skills/<nome>/SKILL.md` (e um bundled
   `resources/skills/` para skills built-in).
2. Criar `electron/services/skillsLoader.ts`:
   - Varre diretórios, parseia frontmatter (usar `gray-matter`).
   - Valida schema (zod): `{ name, description, metadata?: { emoji?, requires?,
     install?, tools?, params? } }`.
   - Indexa `{ name → { dir, frontmatter, bodyPath } }`.
3. Adicionar tabela `SkillsIndex` no SQLite (cache de frontmatter + mtime) para
   não relê-los a cada chat turn.

### Fase 2 — Integração com a LLM

- Prompt do sistema recebe uma **seção `## Available Skills`** construída a
  partir dos frontmatters:
  ```
  - coding-agent: Delegate coding tasks to Codex/Claude Code via bash…
  - skill-creator: Create, edit, improve or audit AgentSkills…
  ```
  Apenas `name + description` — corpo não é carregado até ser necessário.
- Nova tool `read_skill(name)` que retorna o corpo do SKILL.md + listagem de
  `scripts/` e `references/` do diretório.
- Nova tool `run_skill_script(name, script, args)` que executa
  `skills/<name>/scripts/<script>` reaproveitando o sandbox do `forgeService`.

### Fase 3 — UX de criação de Skill

- Porta o fluxo do `oc/skills/skill-creator/SKILL.md`: comando "Criar nova
  skill" abre wizard com (a) nome, (b) descrição (trigger), (c) nível de
  liberdade, (d) scripts opcionais.
- O próprio LLM pode autorar skills via tool `write_skill(frontmatter, body,
  scripts[])`.

## Execução sandbox (reaproveitar)

Manter a lógica de `forgeService.execSnippet` (timeout, buffer, regex anti-
destrutivo, env sanitizado), apenas renomeando para `execInSkillSandbox` e
recebendo `{ skillDir, scriptRelPath, args }`. O `cwd` passa a ser um tmp
copiado **a partir** do skillDir para preservar `references/` e `assets/`
durante a execução.

A tabela `ForgeSnippets` pode ser **removida** do schema SQLite — o
storage canônico passa a ser o filesystem (`skills/`). O `forgeService.ts`
deixa de ter CRUD e fica reduzido ao `execInSkillSandbox`.

## Critérios de sucesso

- É possível criar uma skill nova só colocando um diretório em
  `~/.redbus/skills/` sem recompilar.
- LLM consegue decidir, só com frontmatter, qual skill invocar.
- `forgeService.ts` perde o peso de CRUD e fica só com `execInSkillSandbox`.
- Nenhuma referência a `ForgeSnippets` restante no código.

## Fora de escopo

- Marketplace/sync de skills (tratar depois).
- Assinatura/verificação de skills externas.
- Permissões granulares por skill (FS read-only, rede, etc.).

