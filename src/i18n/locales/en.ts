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

  onboarding: {
    shellTitle: string;
    stepLabel: (current: number, total: number) => string;
    back: string;
    next: string;
    skip: string;
    finish: string;
    welcome: {
      headline: string;
      body: string;
      privacy: string;
      local: string;
      cta: string;
    };
    providers: {
      title: string;
      subtitle: string;
      openai: string;
      anthropic: string;
      google: string;
      ollamaCloud: string;
      test: string;
      testing: string;
      valid: string;
      invalid: string;
      noneWarning: string;
      ollamaDetected: (n: number) => string;
      ollamaMissing: string;
    };
    ollama: {
      title: string;
      subtitle: string;
      urlLabel: string;
      online: string;
      offline: string;
      checking: string;
      detectedModels: (n: number) => string;
      noModelsHint: string;
      recheck: string;
      rechecking: string;
      install: string;
      installHint: string;
      remoteHint: string;
    };
    roles: {
      title: string;
      subtitle: string;
      recommended: string;
      auto: string;
      manual: string;
      modelFor: (role: string) => string;
      noModelAvailable: string;
      setupIncomplete: string;
    };
    profile: {
      title: string;
      subtitle: string;
      nameLabel: string;
      namePlaceholder: string;
      emailLabel: string;
      emailPlaceholder: string;
      aliasesLabel: string;
      aliasesPlaceholder: string;
      aliasesHint: string;
      hint: string;
      incomplete: string;
    };
    review: {
      title: string;
      subtitle: string;
      rolesHeading: string;
      keysHeading: string;
      ready: string;
      profileHeading: string;
    };
  };

  settings: {
    title: string;
    tabs: {
      llm: string;
      vault: string;
      audio: string;
      proactivity: string;
      digest: string;
      system: string;
    };

    llm: {
      title: string;
      subtitle: string;
      apiKeys: string;
      orchestration: string;
      orchestrationDesc: string;
      save: string;
      saving: string;
      check: string;
      roles: {
        title: string;
        simpleMode: string;
        advancedMode: string;
        copyPlannerToAll: string;
        resetDefaults: string;
        planner: { name: string; description: string };
        executor: { name: string; description: string };
        synthesizer: { name: string; description: string };
        utility: { name: string; description: string };
        digest: { name: string; description: string };
      };
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
      isCloudLabel: string;
      workerWarning: string;
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

    digest: {
      title: string;
      subtitle: string;
      save: string;
      saving: string;
      saved: string;
      resetDefaults: string;
      noise: {
        title: string;
        desc: string;
        dropAcks: string;
        dropAcksDesc: string;
        minLength: string;
        minLengthDesc: string;
        customAckPatterns: string;
        customAckPatternsDesc: string;
        customAckPatternsPlaceholder: string;
      };
      signal: {
        title: string;
        desc: string;
        signalLength: string;
        signalLengthDesc: string;
        alwaysSignalHint: string;
      };
      thread: {
        title: string;
        desc: string;
        neutralCap: string;
        neutralCapDesc: string;
        alwaysKeepFirst: string;
        alwaysKeepFirstDesc: string;
        alwaysKeepLast: string;
        alwaysKeepLastDesc: string;
      };
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
      resetSetup: string;
      resetSetupDesc: string;
      resetSetupBtn: string;
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
      todos: string;
    };
  };

  chat: {
    inputPlaceholder: string;
    alreadyLogged: string;
    taskStarted: string;
    taskScheduled: string;
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
    greeting: "Hello! It's great to have you here. It looks like we haven't been properly introduced yet. What should I call you, and what should be my name and mission?",
  },

  langSetup: {
    headline: 'Proactive Autonomous Assistant with Sensors',
    body: 'RedBus is your digital right-hand. Equipped with innovative vision, auditory, and contextual sensors, it acts proactively to anticipate your needs, protect your privacy, and execute complex tasks locally.',
    tagline: 'Unlimited Power Under Your Control. 100% Local. 100% Private.',
    divider: 'choose your language to get started',
    footnote: 'This choice affects how memories are stored and how the AI communicates with you. You can change it later in Settings, but starting fresh is recommended.',
    en: { name: 'English', desc: 'The AI will respond in English' },
    ptBR: { name: 'Português (BR)', desc: 'The AI will respond in Brazilian Portuguese' },
  },

  onboarding: {
    shellTitle: 'redbus setup',
    stepLabel: (c, total) => `step ${c} of ${total}`,
    back: 'back',
    next: 'next',
    skip: 'skip',
    finish: 'finish setup',
    welcome: {
      headline: 'welcome to redbus',
      body: 'before we start, we need to connect at least one LLM provider and bind semantic roles (planner, executor, synthesizer, utility). Nothing will run until setup is complete.',
      privacy: 'API keys are stored locally using OS-native encryption.',
      local: 'You can also run 100% local via Ollama.',
      cta: 'begin',
    },
    providers: {
      title: 'llm providers',
      subtitle: 'paste any API keys you want to use. You can add or remove providers later.',
      openai: 'OpenAI (GPT / o-series)',
      anthropic: 'Anthropic (Claude)',
      google: 'Google (Gemini)',
      ollamaCloud: 'Ollama Cloud',
      test: 'check',
      testing: 'checking...',
      valid: 'ok',
      invalid: 'invalid',
      noneWarning: 'Add at least one API key, or install / start Ollama on the next step.',
      ollamaDetected: (n) => `Ollama detected · ${n} local model(s) ready`,
      ollamaMissing: 'Ollama not reachable — configure a server or install it on the next step.',
    },
    ollama: {
      title: 'ollama (local or remote)',
      subtitle: 'run models locally for full privacy, or point to a remote Ollama server on your network.',
      urlLabel: 'Ollama API URL',
      online: 'online',
      offline: 'offline',
      checking: 'checking...',
      detectedModels: (n) => `${n} model(s) detected`,
      noModelsHint: 'No local models yet. Run `ollama pull llama3.2` or similar, then recheck.',
      recheck: 'recheck',
      rechecking: 'rechecking...',
      install: 'install ollama',
      installHint: 'Ollama is not running at this URL. Install it from ollama.com and start the service, or change the URL above to a reachable server.',
      remoteHint: 'You can also point to a remote Ollama server — just paste its URL above (e.g. http://192.168.1.10:11434).',
    },
    roles: {
      title: 'roles',
      subtitle: 'each semantic role needs a model. We pick sensible defaults — you can override any of them.',
      recommended: 'recommended',
      auto: 'auto (recommended)',
      manual: 'manual',
      modelFor: (role) => `model for ${role}`,
      noModelAvailable: 'no reachable model — add a provider key or a local Ollama model.',
      setupIncomplete: 'all four roles need a model before you can finish.',
    },
    profile: {
      title: 'your professional identity',
      subtitle: 'used by the digest to detect messages actually addressed to you (cc/mentions/subject/body).',
      nameLabel: 'Full professional name',
      namePlaceholder: 'e.g. Guilherme Cardoso',
      emailLabel: 'Work email',
      emailPlaceholder: 'e.g. guilherme@company.com',
      aliasesLabel: 'Nicknames / aliases',
      aliasesPlaceholder: 'e.g. Gui, Guile, G. Cardoso',
      aliasesHint: 'comma-separated. Any short form or variation you are called by in emails or Teams chats. Optional, but improves addressing detection.',
      hint: 'stored locally. Used only to steer the digest LLM prompt; never sent standalone.',
      incomplete: 'name and email are required to continue.',
    },
    review: {
      title: 'review',
      subtitle: 'everything looks good? Finishing setup will unlock the chat.',
      rolesHeading: 'role bindings',
      keysHeading: 'providers connected',
      ready: 'ready to go',
      profileHeading: 'professional identity',
    },
  },

  settings: {
    title: 'settings',
    tabs: {
      llm: 'LLM & Models',
      vault: 'Vault',
      audio: 'Audio',
      proactivity: 'Proactivity',
      digest: 'Digest',
      system: 'System',
    },

    llm: {
      title: 'LLM & Models',
      subtitle: 'API keys and named roles per call site',
      apiKeys: 'api keys',
      orchestration: 'roles',
      orchestrationDesc: 'Each call site picks a semantic role. Point every role at the right model for your budget and latency needs.',
      save: 'save',
      saving: 'saving...',
      check: 'check',
      roles: {
        title: 'Roles',
        simpleMode: 'Simple (1 model for all)',
        advancedMode: 'Advanced (per role)',
        copyPlannerToAll: 'Copy planner to all',
        resetDefaults: 'Reset defaults',
        planner: { name: 'Planner', description: 'Decides the next step. Use a strong reasoning model.' },
        executor: { name: 'Executor', description: 'Executes tasks with tools (browser, filesystem). Prefer speed.' },
        synthesizer: { name: 'Synthesizer', description: 'Converts technical output into a natural response.' },
        utility: { name: 'Utility', description: 'Internal tasks (memory, briefings, analyses).' },
        digest: { name: 'Digest', description: 'Bulk summarization of emails/chats. Prefer a local model (Ollama) to save tokens and handle high message volume at zero cost.' },
      },
    },

    ollama: {
      title: 'Local Models (Ollama)',
      subtitle: 'Run local models via Ollama (Gemma 4, Qwen, GLM) for full privacy and zero cloud costs.',
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
      descLabel: 'Description:',
      isCloudLabel: 'Cloud',
      workerWarning: 'Warning: This model is small. Using it as Worker might be slow or unreliable for complex extractions and code generation.'
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

    digest: {
      title: 'Daily Digest',
      subtitle: 'how the daily communications digest curates messages before sending them to the LLM. Tighter settings = fewer tokens, more local-model friendly; looser settings = more context, higher cost.',
      save: 'save',
      saving: 'saving…',
      saved: 'saved',
      resetDefaults: 'reset to defaults',
      noise: {
        title: 'Noise filter',
        desc: 'drops trivial messages (acknowledgments, emoji-only, very short replies) before they reach the LLM.',
        dropAcks: 'drop acknowledgments',
        dropAcksDesc: 'dropping messages that are just "ok", "thanks", "got it", "valeu", "obrigado", etc. Built-in list covers EN + PT-BR.',
        minLength: 'minimum length (chars)',
        minLengthDesc: 'neutral messages shorter than this (after removing emoji) are treated as noise. Messages with questions, mentions, URLs or high importance are always kept regardless of length.',
        customAckPatterns: 'custom noise phrases',
        customAckPatternsDesc: 'comma-separated extra phrases to drop. Matches the full message (case-insensitive, trailing punctuation allowed). Useful for team-specific fillers ("rgr", "copy that", "pode crer").',
        customAckPatternsPlaceholder: 'e.g. rgr, pode crer, roger',
      },
      signal: {
        title: 'Signal preservation',
        desc: 'these messages are ALWAYS kept, even inside a large thread — they carry real information.',
        signalLength: 'signal length (chars)',
        signalLengthDesc: 'messages longer than this are auto-promoted to signal and never deduplicated.',
        alwaysSignalHint: 'Always kept regardless of length: importance = high · @mentions of you · messages with a question (?) · URLs · @handle mentions.',
      },
      thread: {
        title: 'Thread grouping',
        desc: 'for messages that are neither noise nor signal ("neutral" chatter), cap how many survive per thread/chat.',
        neutralCap: 'max neutral messages per thread',
        neutralCapDesc: 'after noise/signal filtering, if a thread still has more neutral messages than this cap, keep only the boundary ones (first + last + evenly spaced) to preserve the arc without bloating the prompt.',
        alwaysKeepFirst: 'always keep the thread opener',
        alwaysKeepFirstDesc: 'the oldest message of each thread is preserved even if classified as noise — useful to remember the thread existed at all.',
        alwaysKeepLast: 'always keep the latest message',
        alwaysKeepLastDesc: 'the newest message of each thread is preserved so the digest reflects the current state of the conversation.',
      },
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
      resetSetup: 'reset onboarding setup',
      resetSetupDesc: 'returns to the first-launch setup wizard. API keys stay, but role bindings are cleared.',
      resetSetupBtn: 'reset setup',
    },
  },

  modals: {
    reset: {
      title: 'confirm factory reset',
      body: 'this action will permanently delete:',
      items: ['soul, profile, notes and todos', 'all message history and memories', 'API keys and role bindings', 'archive files, skills and app settings'],
      keysPreserved: 'this will send you back to the onboarding wizard',
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
      todos: 'To-Do Manager',
    },
  },

  chat: {
    inputPlaceholder: '› run a task, ask a question, or give me a command...',
    alreadyLogged: 'already logged in',
    taskStarted: 'Starting task...',
    taskScheduled: 'Task scheduled.',
  },

  activityConsole: {
    title: 'activity console',
    empty: 'no activity yet.',
    clearAll: 'clear all',
  },
};

export default en;
