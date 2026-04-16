import type { Translations } from './en';

const ptBR: Translations = {
  // ── App shell ──
  app: {
    loading: 'inicializando redbus...',
    processing: 'processando...',
    greeting: 'Sistema RedBus iniciado. Nenhum perfil encontrado. Me diga: quem é você, qual será minha função, e qual será meu nome?',
  },

  // ── Language selection (first launch) ──
  langSetup: {
    headline: 'Assistente Autônomo e Proativo com Sensores',
    body: 'O RedBus é o seu braço direito digital. Equipado com sensores inovadores de visão, audição e contexto, ele age de forma proativa para antecipar suas necessidades, proteger sua privacidade e executar tarefas complexas localmente.',
    tagline: 'Poder Ilimitado sob seu Controle. 100% Local. 100% Privado.',
    divider: 'escolha o idioma para começar',
    footnote: 'Esta escolha afeta como as memórias são armazenadas e como a IA se comunica com você. Você pode mudar depois nas Configurações, mas recomeçar do zero é recomendado.',
    en: { name: 'English', desc: 'The AI will respond in English' },
    ptBR: { name: 'Português (BR)', desc: 'A IA vai responder em Português do Brasil' },
  },

  // ── Settings sidebar ──
  settings: {
    title: 'configurações',
    tabs: {
      llm: 'LLM & Modelos',
      vault: 'Cofre',
      audio: 'Áudio',
      proactivity: 'Proatividade',
      system: 'Sistema',
    },

    llm: {
      title: 'LLM & Modelos',
      subtitle: 'chaves de API e orquestração maestro/worker',
      apiKeys: 'api keys',
      orchestration: 'orquestração',
      orchestrationDesc: 'Papéis flexíveis para Maestro (planejador) e Worker (executor). Orquestração cirúrgica para máxima economia de tokens e saúde do contexto.',
      maestroModel: 'modelo maestro',
      workerModel: 'modelo worker',
      save: 'salvar',
      saving: 'salvando...',
      check: 'verificar',
    },

    ollama: {
      title: 'Modelos Locais (Ollama)',
      subtitle: 'Rode modelos locais via Ollama (Gemma 4, Qwen, GLM). Sem custos, 100% privado.',
      url: 'URL da API do Ollama',
      online: 'Online',
      offline: 'Offline',
      checking: 'Checando...',
      hint: 'Certifique-se que o Ollama está rodando (`ollama serve`) e acessível.',
      setWorker: 'Definir como Worker',
      setMaestro: 'Definir como Maestro',
      download: 'Baixar',
      worker: 'worker',
      maestro: 'maestro',
      reqLabel: 'Requisitos:',
      descLabel: 'Descrição:',
      isCloudLabel: 'Nuvem',
      workerWarning: 'Aviso: Este modelo é pequeno. Usá-lo como Worker pode ser lento ou instável para extrações complexas e geração de código.'
    },

    vault: {
      title: 'Cofre de Tokens',
      subtitle: 'tokens de APIs externas criptografados pelo OS',
      savedTokens: 'tokens salvos',
      savedTokensDesc: 'Jira, GitHub, AWS e outros serviços. Armazenados com criptografia nativa do sistema operacional.',
      noTokens: 'nenhum token salvo.',
      addToken: 'adicionar token',
      service: 'serviço',
      servicePlaceholder: 'ex: jira, github, aws',
      tokenKey: 'token / api key',
      tokenPlaceholder: 'cole o token aqui',
      add: 'adicionar',
      del: 'del',
    },

    audio: {
      title: 'Sensor Auditivo',
      subtitle: 'meeting memory — grave reuniões e gere atas estruturadas',
      devices: 'dispositivos de áudio',
      mic: 'seu microfone',
      micDesc: 'captura a sua voz durante a reunião',
      selectMic: '— selecione o microfone —',
      systemAudio: 'áudio do sistema (retorno da reunião)',
      systemAudioDesc: 'captura o áudio do Teams/Meet/Zoom que sai dos alto-falantes',
      selectLoopback: '— selecione o dispositivo de loopback —',
      transcriptionMode: 'modo de transcrição',
      fullCloud: 'Full Nuvem (Máxima Performance)',
      fullCloudDesc: 'Envia o áudio para a API configurada (Gemini/Whisper). Não consome CPU, mas requer envio de voz para a nuvem.',
      hybrid: 'Híbrido (STT Local + Nuvem)',
      hybridDesc: 'Voz convertida em texto na sua máquina (consome CPU). Apenas o texto vai para a nuvem gerar a ata.',
      hybridBadge: 'whisper-tiny ~77MB · WASM · sem GPU',
      cloudEngine: 'motor de nuvem',
      provider: 'provedor',
      providerDesc: 'Gemini = áudio multimodal nativo (1 chamada) · Whisper = transcrição + LLM',
    },

    proactivity: {
      title: 'Proatividade',
      subtitle: 'o subconsciente do agente — conversas autônomas baseadas no contexto',
      level: 'nível de proatividade',
      levelDesc: 'OFF = desligado · LOW = só emergências · MEDIUM = sugestões úteis · HIGH = presente e proativo',
      currentLevel: 'nível atual',
    },

    system: {
      title: 'Sistema',
      subtitle: 'governança de dados, retenção e ações de manutenção',
      governance: 'governança de dados',
      governanceDesc: 'limpeza manual e manutenção de disco.',
      manualCleanup: 'limpeza manual',
      manualCleanupDesc: 'limpar logs técnicos antigos e compactar o banco (VACUUM)',
      cleanNow: 'limpar agora',
      cleanResult: (n: number) => `Limpeza concluída: ${n} registos eliminados + VACUUM executado.`,
      tldv: 'integração tl;dv',
      tldvDesc: 'sincronize reuniões gravadas no tl;dv automaticamente.',
      tldvApiKey: 'API Key',
      tldvApiKeyDesc: 'encontre em',
      tldvPlaceholder: 'cole sua API key aqui',
      language: 'idioma / language',
      languageDesc: 'idioma para comunicação com a IA — afeta como as memórias são armazenadas.',
      currentLanguage: 'idioma atual',
      currentLanguageDesc: 'o idioma que a IA usa para responder',
      dangerZone: 'zona de perigo',
      dangerZoneDesc: 'ações irreversíveis. proceda com cautela.',
      factoryReset: 'resetar redbus (factory reset)',
      factoryResetDesc: 'apaga alma, memória e histórico. preserva api keys.',
      reset: 'resetar',
    },
  },

  // ── Modals ──
  modals: {
    reset: {
      title: 'confirmar factory reset',
      body: 'esta ação vai apagar permanentemente:',
      items: ['alma (perfil do usuário)', 'todo o histórico de mensagens', 'living specs e memória vetorial', 'arquivos de histórico'],
      keysPreserved: 'suas api keys serão preservadas',
      typeToConfirm: 'digite',
      confirmWord: 'RESETAR',
      toConfirm: 'para confirmar',
      cancel: 'cancelar',
      confirm: 'confirmar reset',
      confirming: 'resetando...',
    },

    langWarning: {
      title: '⚠ aviso de mudança de idioma',
      body1: 'Não é recomendado mudar o idioma após a primeira interação.',
      body2: 'As memórias são armazenadas no idioma original de cada conversa. Trocar de idioma no meio do caminho pode fazer a IA alucinar traduções ou produzir resultados inconsistentes ao referenciar contextos anteriores.',
      recommendation: 'Recomendação:',
      recommendationBody: 'faça um Factory Reset (Configurações › Sistema › Zona de Perigo) para começar do zero no novo idioma.',
      cancel: 'cancelar',
      changeAnyway: 'mudar mesmo assim',
    },

    hitlConsent: {
      title: 'autorização necessária',
      reason: 'motivo:',
      intendedAction: 'ação pretendida:',
      deny: 'negar',
      approve: 'aprovar',
    },

    auth: {
      alreadyLogged: 'já loguei',
    },
  },

  // ── TitleBar ──
  titlebar: {
    sensors: {
      clipboard: { on: 'Clipboard: LIGADO', off: 'Clipboard: DESLIGADO' },
      activeWindow: { on: 'Janela Ativa: LIGADO', off: 'Janela Ativa: DESLIGADO' },
      vision: { on: 'Olho Fotográfico: LIGADO', off: 'Olho Fotográfico: DESLIGADO' },
      accessibility: { on: 'Árvore UI: LIGADO', off: 'Árvore UI: DESLIGADO' },
      mic: { on: 'Fechar balão de gravação', off: 'Abrir balão de gravação' },
    },
    proactivity: {
      OFF: 'Proatividade: Desligada',
      LOW: 'Proatividade: Baixa',
      MEDIUM: 'Proatividade: Média',
      HIGH: 'Proatividade: Alta',
    },
    nav: {
      chat: 'Terminal de Chat',
      meetings: 'Reuniões',
      inbox: 'Inbox Executiva',
      routines: 'Rotinas',
      skills: 'Skill Manager',
      history: 'Histórico',
      settings: 'Configurações',
      activityConsole: { open: 'Abrir Activity Console', close: 'Fechar Activity Console' },
      todos: 'Tarefas',
    },
  },

  // ── Chat ──
  chat: {
    inputPlaceholder: '› execute uma tarefa, faça uma pergunta ou me dê um comando...',
    alreadyLogged: 'já loguei',
    taskStarted: 'Iniciando tarefa...',
    taskScheduled: 'Tarefa agendada.',
  },

  // ── Activity Console ──
  activityConsole: {
    title: 'console de atividade',
    empty: 'nenhuma atividade ainda.',
    clearAll: 'limpar tudo',
  },
};

export default ptBR;
