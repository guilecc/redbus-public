# 🚌 RedBus: Local Intelligence. Absolute Privacy. Total Orchestration.

RedBus é um **Hub de Assistente Autônomo Local** (Agnostic AI Hub) projetado para orquestrar sua vida digital com privacidade absoluta e inteligência proativa. Tudo roda localmente na sua máquina, garantindo que seus dados nunca saiam do seu controle.

---

## 🛡️ Privacidade e Segurança "Zero-Trust"
- **100% Local-First**: O RedBus vive na sua máquina. Zero servidores na nuvem, zero contas obrigatórias, zero rastreamento.
- **Cofre de Tokens (Secure Vault)**: Armazenamento de chaves de API (Jira, GitHub, AWS, etc.) criptografado nativamente pelo sistema operacional.
- **Isolamento por BrowserView**: As automações e acessos a sites ocorrem em instâncias isoladas e seguras, protegendo sua navegação principal.
- **Banco de Dados Único**: Toda a sua "Alma" (perfil), memória e histórico são armazenados em um único arquivo SQLite criptografado (`.redbus`) com modo WAL para máxima performance.

## 🧠 Orquestração Autônoma de Elite
- **Arquitetura Maestro/Worker**: Flexibilidade total de papéis. Use modelos ultrarrápidos como o **Gemini 2.0 Flash** no papel de **Maestro** (Planejador Light), e direcione o poder bruto do **Claude 4.6 (Sonnet ou Opus)** ou do recém-lançado **Gemma 4** como **Worker** (Executor Inteligente).
- **Protocolo Living Spec**: Uma engine de execução dinâmica que transforma instruções complexas em especificações mutáveis, permitindo que a IA ajuste o plano em tempo real conforme obtém resultados.
- **Economia de Tokens**: Redução drástica de custos e overhead de contexto através de atualizações cirúrgicas e compactação inteligente de mensagens.
- **Orquestração Agnóstica**: Troca dinâmica entre provedores de ponta (**Anthropic**, **Google Gemini**, **OpenAI**) e o estado da arte do LLM local com **Gemma 4** via **Ollama**, permitindo otimizar latência no planejamento e inteligência extrema na execução.

## 👁️ O Sistema de "Sentidos" (Environmental Sensors)
O RedBus não apenas responde; ele **percebe** seu fluxo de trabalho através de sensores integrados:
- **Olho Fotográfico (Vision Sensor)**: Captura periódica de tela com OCR integrado (Tesseract.js) para entender o que você está vendo.
- **Sensor de Acessibilidade (UI Tree)**: Analisa a árvore de elementos do macOS para navegar e interagir com aplicativos nativos com precisão cirúrgica.
- **Sensor de Janela Ativa**: Monitora qual aplicativo e documento você está usando para contextualizar sugestões.
- **Sensor de Clipboard**: Acompanha o conteúdo da área de transferência para oferecer ações imediatas sobre o que foi copiado.
- **Sensor Auditivo (Meeting Memory)**: Captura áudio do microfone e do sistema simultaneamente para documentar reuniões em tempo real.

## ⚡ Motor de Proatividade (Proactivity Engine)
- **Subconsciente Digital**: O RedBus monitora os sinais dos sensores em segundo plano e decide autonomamente quando intervir para ajudar, sem que você precise pedir.
- **Níveis de Presença**: Ajuste de "OFF" a "HIGH" para definir o quanto a IA deve ser presente no seu dia a dia.
- **Sugestões Contextuais**: Receba alertas, resumos ou execuções automáticas baseadas no que você está fazendo no momento.

## 🎙️ Ata Viva & Meeting Intelligence
- **Gravação Multicanal**: Captura áudio limpo de chamadas no Teams, Zoom, Meet e Slack processando o retorno do sistema.
- **Transcrição Híbrida**: Escolha entre **Whisper Local** (privacidade total e zero custo) ou **Cloud Multimodal** (máxima performance com Gemini/OpenAI).
- **Atas Estruturadas**: Geração automática de resumos, pontos de decisão e listas de tarefas (Action Items) integradas ao seu fluxo.
- **Integração tl;dv**: Sincronização automática com reuniões gravadas em plataformas externas.

## 🗂️ Memória Profunda & Inteligência de Arquivos
- **Inteligência de Arquivos Locais**: Upload e análise instantânea de documentos (PDF, DOCX, XLSX, CSV, JSON, Markdown). A IA extrai o texto e o utiliza como contexto para suas respostas.
- **OCR de Documentos e Imagens**: Suporte integrado para leitura de texto em imagens (PNG, JPG) e PDFs digitalizados através de processamento local (Tesseract.js).
- **Fatos de Longo Prazo (MemPalace)**: Armazenamento persistente de informações sobre você, suas preferências e seu trabalho, filtrados por confiança e relevância histórica.
- **Busca Semântica e FTS5**: Localize qualquer chat, imagem vista (OCR) ou transcrição de reunião instantaneamente com busca por texto completo em segundos.
- **Arquivamento e Compactação**: Gerenciamento inteligente de histórico para manter o contexto da IA sempre limpo e eficiente, sem perder informações críticas.

## 🛠️ Hub de Produtividade e Automação
- **Inbox Executiva (Unified Message Hub)**: Centro de comando unificado para gerenciar todas as comunicações e tarefas pendentes.
- **Extração Determinística**: Monitoramento de mensagens não lidas no **Outlook 365**, **Microsoft Teams** e **WhatsApp Web** com 100% de confiabilidade, sem depender de navegação por IA.
- **Classificação de Urgência**: IA treinada para filtrar o ruído, classificando mensagens automaticamente por nível de urgência (Emergencial, Importante, Informativo).
- **Atalhos "Zero-Token"**: Conecte seus canais de comunicação com comandos simples como "entra no zap" ou "mostra meu outlook" sem gastar tokens de IA para a autenticação.
- **Gerenciador de Rotinas (Cron Engine)**: Agende tarefas recorrentes, verificações de sistema ou backups com suporte a backoff e zonas temporais.
- **Skill Forge (Python Executor)**: Biblioteca extensível de automações em Python que podem ser disparadas pela IA ou manualmente.
- **Playwright Automation**: Navegador embutido capaz de realizar ações complexas na web (login, extração de dados, preenchimento de formulários).

## 🖥️ Experiência Nativa e Estética Premium
- **Console de Atividade**: Transparência total sobre o que a IA está "thinking" e fazendo em tempo real.
- **Interface Terminal-First**: Chat fluído com feedback visual de progresso de tarefas agenticas.
- **Widget Overlay**: Controle de gravação e sensores sempre à mão com uma interface flutuante discreta.
- **Multi-idioma Nativo**: Suporte completo para Português (BR) e Inglês.

---

### **Stack Tecnológica: O Futuro é Local**
- **Runtime**: Electron & Node.js
- **Frontend**: React + Vite + Vanilla CSS
- **Banco de Dados**: SQLite (better-sqlite3)
- **IA**: Maestro/Worker Orchestration Loop (Gemma 4 & Cloud LLMs support)
- **Automação**: Playwright & Python Child Processes
- **Visão/Áudio**: Tesseract.js & Transformers.js (Whisper WASM)
