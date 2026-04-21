# Spec: Sistema de Treinamento e Geração Autônoma de Scrapers (Dynamic Scraper Generator)

**Alvo:** Serviços de Extração (`extratorService`), Motor de Treino (Novo modulo)
**Objetivo:** Substituir a extração dependente de LLMs em tempo de execução e scrapers estáticos frágeis por um "Motor de Treinamento". O Motor utiliza um LLM para analisar o DOM atual do Outlook e Teams e **escrever um programa (script Node.js/Playwright)** determinístico. Esse script gerado é então salvo e usado diariamente sem depender do LLM.

---

## 1. Contexto & Motivação

Atualmente, o processo de "digest" apresenta falhas ao identificar assunto e conteúdo de mensagens, resultando em dados de baixa qualidade.
Existe hoje um sistema de treinamento (`trainer.ts`) que analisa snapshots ARIA e tenta extrair exclusivamente **seletores CSS** em formato JSON (`ExtractorSelectors`). No entanto, depender apenas de um dicionário de seletores não é suficiente, pois frequentemente as plataformas adotam lógicas de exibição onde os dados não podem ser resolvidos apenas por uma string de CSS estática (como mensagens aninhadas no Teams ou lógicas de rolagem complexas no Outlook). Isso exige código lógico real (loops, condicionais) em vez de apenas mapear seletores.

**A Solução (Substituição do `trainer.ts` Atual):** Mudar o conceito de "treinamento". O novo motor de treinamento irá **substituir totalmente a arquitetura atual baseada no `trainer.ts` e exportação JSON**. Em vez de o LLM gerar apenas dicionários de seletores (como faz hoje), o modelo deve receber o DOM real e **programar um extrator completo (scraper script em Node/JS)**. 
Uma vez treinado, o sistema terá um script `.js` local, rápido e capaz de lidar com a lógica do site. Quando a plataforma atualizar a interface e o script quebrar, o sistema acionará um novo "treino" para reconstruir esse componente lógico.

---

## 2. A Arquitetura do Treino

O processo de Treinamento pode ser acionado de forma manual pelo usuário ("Treinar Outlook") ou acionado de forma automática quando o scraper atual retornar 0 resultados.

### Fluxo de Funcionamento (Loop de Treinamento)

1. **Acesso e Captura (Snapshot)**
   - O Playwright acessa a página desejada (ex: Caixa de Entrada do Outlook).
   - Aguarda o carregamento e captura o DOM completo ou a árvore de acessibilidade da região principal de mensagens. Pode capturar também trechos de HTML simplificados para caber no contexto do LLM.
   
2. **Desafio (Prompting de Geração)**
   - O sistema envia uma amostra do HTML capturado para um LLM avançado (ex: Claude 3.5 Sonnet ou Gemini Pro).
   - O prompt solicita: *"Com base nesse HTML do Outlook, escreva uma função em JavaScript (usando a API do Playwright ou JS nativo do navegador via `page.evaluate`) que encontre e retorne um array de objetos contendo `remetente`, `assunto`, `conteúdo` e `data`."*

3. **Sandbox e Validação (Test-Driven Self-Correction)**
   - O sistema recebe o código gerado pelo LLM.
   - Em um ambiente seguro/isolado (Sandbox via VM do Node ou avaliando na própria página), o código *roda contra a aba aberta do Playwright*.
   - **Validação:** Se o script estourar um erro de seletor ou retornar nulo, o erro é devolvido para o LLM pedindo correção (Loop de Auto-Correção, limite de 3 tentativas).
   - Se o script conseguir trazer um array preenchido que combine com a realidade vista na tela, o teste passa.

4. **Persistência do Scraper**
   - O código validadado é salvo no disco (ex: `.redbus-data/scrapers/outlook-scraper-v2.js`).
   - A partir de agora, o serviço de digest diário não chama mais o LLM, apenas faz `require()` ou executa esse script diretamente no Playwright.

---

## 3. Contrato do Scraper Gerado

Para garantir que o código gerado pelo LLM possa ser consumido pelo RedBus de forma padronizada, o treinamento deve forçar o LLM a seguir uma interface específica (contrato).

```typescript
// Exemplo de formato de saída que o LLM deve aprender a gerar:
module.exports = async function extractData(page) {
  // Código gerado pelo LLM usando seletores e lógica identificados durante o treino
  return await page.evaluate(() => {
    const messages = [];
    // Lógica inferida do DOM (exemplo)
    document.querySelectorAll('div[aria-label="Message list"] > div').forEach(node => {
      messages.push({
        sender: node.querySelector('.sender-class')?.innerText,
        subject: node.querySelector('.subject-class')?.innerText,
        content: node.querySelector('.preview-class')?.innerText,
        isUnread: node.classList.contains('unread')
      });
    });
    return messages;
  });
}
```

---

## 4. O Sistema "Auto-Healing" (Cura Automática)

O poder dessa arquitetura é a imunidade a atualizações de UI:

- **Dia 1:** O script recém treinado extrai os e-mails em 1 segundo.
- **Dia 40:** A Microsoft atualiza o Outlook. O script encontra 0 mensagens ou lança um Type Error.
- **Detecção:** O RedBus percebe a falha (`if messages.length === 0 && falhou 2 vezes`).
- **Retreinamento:** Em background, o sistema aciona silenciosamente o fluxo de treinamento. O LLM lê o "novo" DOM, enxerga as novas classes e regera o arquivo `.js`.
- **Dia 41:** O digest volta a funcionar normalmente, com um extrator atualizado sem intervenção de dev.

---

## 5. Passos de Implementação (Roadmap)

1. **Módulo de Análise de DOM (`domSnapper.ts`):** 
   Criar rotina que consiga reduzir o HTML do Outlook/Teams, removendo scripts e SVG, focando a atenção apenas nos nós textuais, para não estourar o token limit e confundir o LLM.

2. **Criação do `TrainingOrchestrator.ts`:**
   Responsável pela comunicação com o modelo. Deve enviar as regras de negócio, o HTML simplificado, e pedir a resposta formatada estritamente em um bloco *Code (JS)*.

3. **Validador de Código (Sandbox em tempo real):** 
   Escrever executor que pegue a string de código e tente avaliar na página da mesma sessão do Playwright. Inserir proteção de Try/Catch. Se o código fizer besteira, reverter o DOM (refresh da página) e tentar de novo com a mensagem de erro.

4. **Gerenciador de Scrapers Locais (`ScraperRegistry`):** 
   Grava, versiona (em arquivos de histórico) e carrega e injeta dinamicamente o último executor estável antes de processar os digests matinais.

## 6. Considerações de Segurança

Como estamos gerando código dinamicamente com um LLM e o executando no sistema:
- O código gerado **nunca** deve rodar diretamente no backend do Node com privilégios completos.
- Em vez de gerar um script Node (.js rodando no Electron), deve-se mandar o LLM produzir código de frontend (vanilla JS) e rodar usando unicamente `page.evaluate(generatedString)`.
- Isso garante que o código rodará dentro da sandbox do browser/Chromium, não tendo acesso ao sistema de arquivos do usuário (`fs`, `child_process`).
