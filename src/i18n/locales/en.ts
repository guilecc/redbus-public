export interface Translations {
  app: {
    loading: string;
    processing: string;
    greeting: string;
  };

  langSetup: {
    headline: string;
    body: string;
    tagline: string;
    divider: string;
    footnote: string;
    en: { name: string; desc: string };
    ptBR: { name: string; desc: string };
  };

  settings: {
    title: string;
    tabs: {
      llm: string;
      vault: string;
      audio: string;
      proactivity: string;
      system: string;
    };

    llm: {
      title: string;
      subtitle: string;
      apiKeys: string;
      orchestration: string;
      orchestrationDesc: string;
      maestroModel: string;
      workerModel: string;
      save: string;
      saving: string;
      check: string;
    };

    ollama: {
      title: string;
      subtitle: string;
      url: string;
      online: string;
      offline: string;
      checking: string;
      hint: string;
      setWorker: string;
      setMaestro: string;
      download: string;
      worker: string;
      maestro: string;
      reqLabel: string;
      descLabel: string;
    };

    vault: {
      title: string;
      subtitle: string;
      savedTokens: string;
      savedTokensDesc: string;
      noTokens: string;
      addToken: string;
      service: string;
      servicePlaceholder: string;
      tokenKey: string;
      tokenPlaceholder: string;
      add: string;
      del: string;
    };

    audio: {
      title: string;
      subtitle: string;
      devices: string;
      mic: string;
      micDesc: string;
      selectMic: string;
      systemAudio: string;
      systemAudioDesc: string;
      selectLoopback: string;
      transcriptionMode: string;
      fullCloud: string;
      fullCloudDesc: string;
      hybrid: string;
      hybridDesc: string;
      hybridBadge: string;
      cloudEngine: string;
      provider: string;
      providerDesc: string;
    };

    proactivity: {
      title: string;
      subtitle: string;
      level: string;
      levelDesc: string;
      currentLevel: string;
    };

    system: {
      title: string;
      subtitle: string;
      governance: string;
      governanceDesc: string;
      manualCleanup: string;
      manualCleanupDesc: string;
      cleanNow: string;
      cleanResult: (n: number) => string;
      tldv: string;
      tldvDesc: string;
      tldvApiKey: string;
      tldvApiKeyDesc: string;
      tldvPlaceholder: string;
      language: string;
      languageDesc: string;
      currentLanguage: string;
      currentLanguageDesc: string;
      dangerZone: string;
      dangerZoneDesc: string;
      factoryReset: string;
      factoryResetDesc: string;
      reset: string;
    };
  };

  modals: {
    reset: {
      title: string;
      body: string;
      items: string[];
      keysPreserved: string;
      typeToConfirm: string;
      confirmWord: string;
      toConfirm: string;
      cancel: string;
      confirm: string;
      confirming: string;
    };
    langWarning: {
      title: string;
      body1: string;
      body2: string;
      recommendation: string;
      recommendationBody: string;
      cancel: string;
      changeAnyway: string;
    };
    hitlConsent: {
      title: string;
      reason: string;
      intendedAction: string;
      deny: string;
      approve: string;
    };
    auth: {
      alreadyLogged: string;
    };
  };

  titlebar: {
    sensors: {
      clipboard: { on: string; off: string };
      activeWindow: { on: string; off: string };
      vision: { on: string; off: string };
      accessibility: { on: string; off: string };
      mic: { on: string; off: string };
    };
    proactivity: {
      OFF: string;
      LOW: string;
      MEDIUM: string;
      HIGH: string;
    };
    nav: {
      chat: string;
      meetings: string;
      inbox: string;
      routines: string;
      skills: string;
      history: string;
      settings: string;
      activityConsole: { open: string; close: string };
    };
  };

  chat: {
    inputPlaceholder: string;
    alreadyLogged: string;
  };

  activityConsole: {
    title: string;
    empty: string;
    clearAll: string;
  };
}

const en: Translations = {
  app: {
    loading: 'initializing redbus...',
    processing: 'processing...',
    greeting: 'RedBus system initialized. No profile found. Tell me: who are you, and what will be my role and my name?',
  },

  langSetup: {
    headline: 'Proactive Autonomous Assistant with Sensors',
    body: 'RedBus is your digital right-hand. Equipped with innovative vision, auditory, and contextual sensors, it acts proactively to anticipate your needs, protect your privacy, and execute complex tasks locally.',
    tagline: 'Unlimited Power Under Your Control. 100% Local. 100% Private.',
    divider: 'choose your language to get started',
    footnote: 'This choice affects how memories are stored and how the AI communicates with you. You can change it later in Settings, but starting fresh is recommended.',
    en: { name: 'English', desc: 'The AI will respond in English' },
    ptBR: { name: 'Português (BR)', desc: 'A IA vai responder em Português do Brasil' },
  },

  settings: {
    title: 'settings',
    tabs: {
      llm: 'LLM & Models',
      vault: 'Vault',
      audio: 'Audio',
      proactivity: 'Proactivity',
      system: 'System',
    },

    llm: {
      title: 'LLM & Models',
      subtitle: 'API keys and maestro/worker orchestration',
      apiKeys: 'api keys',
      orchestration: 'orchestration',
      orchestrationDesc: 'Flexible roles for Maestro (planner) and Worker (executor). Surgical updates optimize token surgical strikes and context health.',
      maestroModel: 'maestro model',
      workerModel: 'worker model',
      save: 'save',
      saving: 'saving...',
      check: 'check',
    },

    ollama: {
      title: 'Local Models (Ollama)',
      subtitle: 'Run Gemma 4 locally for full privacy and zero cloud costs.',
      url: 'Ollama API URL',
      online: 'Online',
      offline: 'Offline',
      checking: 'Checking...',
      hint: 'Ensure Ollama is running (`ollama serve`) and accessible.',
      setWorker: 'Set as Worker',
      setMaestro: 'Set as Maestro',
      download: 'Download',
      worker: 'worker',
      maestro: 'maestro',
      reqLabel: 'Requirements:',
      descLabel: 'Description:'
    },

    vault: {
      title: 'Token Vault',
      subtitle: 'external API tokens encrypted by the OS',
      savedTokens: 'saved tokens',
      savedTokensDesc: 'Jira, GitHub, AWS and other services. Stored with native OS encryption.',
      noTokens: 'no tokens saved.',
      addToken: 'add token',
      service: 'service',
      servicePlaceholder: 'e.g. jira, github, aws',
      tokenKey: 'token / api key',
      tokenPlaceholder: 'paste your token here',
      add: 'add',
      del: 'del',
    },

    audio: {
      title: 'Audio Sensor',
      subtitle: 'meeting memory — record meetings and generate structured notes',
      devices: 'audio devices',
      mic: 'your microphone',
      micDesc: 'captures your voice during the meeting',
      selectMic: '— select microphone —',
      systemAudio: 'system audio (meeting return)',
      systemAudioDesc: 'captures Teams/Meet/Zoom audio from speakers',
      selectLoopback: '— select loopback device —',
      transcriptionMode: 'transcription mode',
      fullCloud: 'Full Cloud (Max Performance)',
      fullCloudDesc: 'Sends audio to the configured API (Gemini/Whisper). No CPU usage, but requires sending your voice to the cloud.',
      hybrid: 'Hybrid (Local STT + Cloud)',
      hybridDesc: 'Voice converted to text on your machine (uses CPU). Only the text goes to the cloud to generate the notes.',
      hybridBadge: 'whisper-tiny ~77MB · WASM · no GPU',
      cloudEngine: 'cloud engine',
      provider: 'provider',
      providerDesc: 'Gemini = native multimodal audio (1 call) · Whisper = transcription + LLM',
    },

    proactivity: {
      title: 'Proactivity',
      subtitle: 'agent subconscious — autonomous conversations based on context',
      level: 'proactivity level',
      levelDesc: 'OFF = disabled · LOW = emergencies only · MEDIUM = useful suggestions · HIGH = present and proactive',
      currentLevel: 'current level',
    },

    system: {
      title: 'System',
      subtitle: 'data governance, retention and maintenance',
      governance: 'data governance',
      governanceDesc: 'manual cleanup and disk maintenance.',
      manualCleanup: 'manual cleanup',
      manualCleanupDesc: 'clear old technical logs and compact the database (VACUUM)',
      cleanNow: 'clean now',
      cleanResult: (n: number) => `Cleanup done: ${n} records deleted + VACUUM executed.`,
      tldv: 'tl;dv integration',
      tldvDesc: 'sync meetings recorded in tl;dv automatically.',
      tldvApiKey: 'API Key',
      tldvApiKeyDesc: 'find it at',
      tldvPlaceholder: 'paste your API key here',
      language: 'language / idioma',
      languageDesc: 'language for AI communication — affects how memories are stored.',
      currentLanguage: 'current language',
      currentLanguageDesc: 'the language the AI uses to respond',
      dangerZone: 'danger zone',
      dangerZoneDesc: 'irreversible actions. proceed with caution.',
      factoryReset: 'factory reset redbus',
      factoryResetDesc: 'deletes soul, memory and history. preserves API keys.',
      reset: 'reset',
    },
  },

  modals: {
    reset: {
      title: 'confirm factory reset',
      body: 'this action will permanently delete:',
      items: ['soul (user profile)', 'all message history', 'living specs and vector memory', 'history files'],
      keysPreserved: 'your API keys will be preserved',
      typeToConfirm: 'type',
      confirmWord: 'RESET',
      toConfirm: 'to confirm',
      cancel: 'cancel',
      confirm: 'confirm reset',
      confirming: 'resetting...',
    },

    langWarning: {
      title: '⚠ language change warning',
      body1: 'Changing the language after your first interaction is not recommended.',
      body2: 'Memories are stored in the original language of each conversation. Switching languages mid-way may cause the AI to hallucinate translations or produce inconsistent results when referencing past context.',
      recommendation: 'Recommendation:',
      recommendationBody: 'do a Factory Reset (Settings › System › Danger Zone) to start fresh in the new language.',
      cancel: 'cancel',
      changeAnyway: 'change anyway',
    },

    hitlConsent: {
      title: 'authorization required',
      reason: 'reason:',
      intendedAction: 'intended action:',
      deny: 'deny',
      approve: 'approve',
    },

    auth: {
      alreadyLogged: 'already logged in',
    },
  },

  titlebar: {
    sensors: {
      clipboard: { on: 'Clipboard: ON', off: 'Clipboard: OFF' },
      activeWindow: { on: 'Active Window: ON', off: 'Active Window: OFF' },
      vision: { on: 'Photographic Eye: ON', off: 'Photographic Eye: OFF' },
      accessibility: { on: 'UI Tree: ON', off: 'UI Tree: OFF' },
      mic: { on: 'Close recording widget', off: 'Open recording widget' },
    },
    proactivity: {
      OFF: 'Proactivity: Off',
      LOW: 'Proactivity: Low',
      MEDIUM: 'Proactivity: Medium',
      HIGH: 'Proactivity: High',
    },
    nav: {
      chat: 'Chat Terminal',
      meetings: 'Meetings',
      inbox: 'Executive Inbox',
      routines: 'Routines',
      skills: 'Skill Manager',
      history: 'History',
      settings: 'Settings',
      activityConsole: { open: 'Open Activity Console', close: 'Close Activity Console' },
    },
  },

  chat: {
    inputPlaceholder: '› run a task, ask a question, or give me a command...',
    alreadyLogged: 'already logged in',
  },

  activityConsole: {
    title: 'activity console',
    empty: 'no activity yet.',
    clearAll: 'clear all',
  },
};

export default en;
