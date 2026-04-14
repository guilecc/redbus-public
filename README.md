# RedBus: Local Intelligence. Absolute Privacy. Total Orchestration.

RedBus is a **Local Autonomous Work Assistant** (Agnostic AI Hub) designed to orchestrate your digital life with absolute privacy and proactive intelligence. Everything runs locally on your machine, ensuring your data never leaves your control.

---

## "Zero-Trust" Privacy and Security
- **100% Local-First**: RedBus lives on your machine. Zero cloud servers, zero mandatory accounts, zero tracking.
- **Secure Vault**: Encrypted storage for API keys (Jira, GitHub, AWS, etc.) natively managed by the operating system.
- **BrowserView Isolation**: Automations and website access occur in isolated and secure instances, protecting your main browsing session.
- **Single Database**: Your entire "Soul" (profile), memory, and history are stored in a single encrypted SQLite file (`.redbus`) with WAL mode for maximum performance.

## Elite Autonomous Orchestration
- **Maestro/Worker Architecture**: Total role flexibility. Use ultra-fast models like **Gemini 1.5 Flash** or **Llama 3** as the **Maestro** (Light Planner), and direct the raw power of **Claude 3.5 Sonnet** or the latest **Gemma/Qwen** models as the **Worker** (Intelligent Executor).
- **Living Spec Protocol**: A dynamic execution engine that transforms complex instructions into mutable specifications, allowing the AI to adjust the plan in real-time as results are obtained.
- **Token Economy**: Drastic reduction in costs and context overhead through surgical updates and intelligent message compression.
- **Agnostic Orchestration**: Dynamic switching between top-tier providers (**Anthropic**, **Google Gemini**, **OpenAI**) and state-of-the-art local LLMs (**Gemma, Qwen, Llama, GLM**) via **Ollama**, optimizing planning latency and maximizing execution intelligence.

## Environmental Sensors System
RedBus doesn't just respond; it **perceives** your workflow through integrated sensors:
- **Vision Sensor (Eye)**: Periodic screen capture with integrated OCR (Tesseract.js) to understand what you are seeing.
- **Accessibility Sensor (UI Tree)**: Analyzes the macOS element tree to navigate and interact with native applications with surgical precision.
- **Active Window Sensor**: Monitors which application and document you are using to contextualize suggestions.
- **Clipboard Sensor**: Tracks clipboard content to offer immediate actions on copied items.
- **Auditory Sensor (Meeting Memory)**: Captures audio from the microphone and system simultaneously to document meetings in real-time. Learn more in the [Audio Drivers Setup Guide](./DRIVERS_SETUP.md).

## Proactivity Engine
- **Digital Subconscious**: RedBus monitors sensor signals in the background and autonomously decides when to intervene and help, without you having to ask.
- **Presence Levels**: Adjust from "OFF" to "HIGH" to define how present the AI should be in your daily life.
- **Contextual Suggestions**: Receive alerts, summaries, or automatic executions based on what you are doing at the moment.

## Meeting Intelligence & Automated Minutes
- **Multi-channel Recording**: Captures clean audio from calls on Teams, Zoom, Meet, and Slack by processing system output.
- **Hybrid Transcription**: Choose between **Local Whisper** (total privacy and zero cost) or **Multimodal Cloud** (maximum performance with Gemini/OpenAI).
- **Structured Minutes**: Automatic generation of summaries, decision points, and action items integrated into your workflow.
- **tl;dv Integration**: Automatic synchronization with meetings recorded on external platforms.

## Deep Memory & File Intelligence
- **Local File Intelligence**: Instant upload and analysis of documents (PDF, DOCX, XLSX, CSV, JSON, Markdown). The AI extracts text and uses it as context for its responses.
- **Document & Image OCR**: Integrated support for reading text in images (PNG, JPG) and scanned PDFs through local processing (Tesseract.js).
- **Long-term Facts (MemPalace)**: Persistent storage of information about you, your preferences, and your work, filtered by confidence and historical relevance.
- **Semantic Search & FTS5**: Instantly locate any chat, seen image (OCR), or meeting transcription with full-text search in seconds.
- **Archiving & Compression**: Intelligent history management to keep AI context clean and efficient without losing critical information.

## Productivity & Automation Hub
- **Executive Inbox (Unified Message Hub)**: A unified command center to manage all communications and pending tasks.
- **Deterministic Extraction**: Monitoring of unread messages in **Outlook 365**, **Microsoft Teams**, and **WhatsApp Web** with 100% reliability, without relying on AI navigation.
- **Urgency Classification**: AI trained to filter noise, automatically classifying messages by urgency level (Emergency, Important, Informative).
- **"Zero-Token" Shortcuts**: Connect your communication channels with simple commands like "open whatsapp" or "show my outlook" without spending AI tokens for navigation.
- **Routine Manager (Cron Engine)**: Schedule recurring tasks, system checks, or backups with backoff support and time zones.
- **Skill Forge (Python Executor)**: An extensible library of Python automations that can be triggered by the AI or manually.
- **Playwright Automation**: Built-in browser capable of performing complex web actions (login, data extraction, form filling).

## Native Experience & Premium Aesthetics
- **Activity Console**: Full transparency on what the AI is "thinking" and doing in real-time.
- **Terminal-First Interface**: Fluid chat with visual progress feedback for agentic tasks.
- **Widget Overlay**: Recording and sensor controls always at hand with a discreet floating interface.
- **Native Multi-language**: Full support for both English and Portuguese (BR).

---

### Tech Stack: The Future is Local
- **Runtime**: Electron & Node.js
- **Frontend**: React + Vite + Vanilla CSS
- **Database**: SQLite (better-sqlite3)
- **AI**: Maestro/Worker Orchestration Loop (Ollama Local & Cloud LLMs support)
- **Automation**: Playwright & Python Child Processes
- **Vision/Audio**: Tesseract.js & Transformers.js (Whisper WASM)

---

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.

You are free to:
- **Share**: Copy and redistribute the material in any medium or format.
- **Adapt**: Remix, transform, and build upon the material.

Under the following conditions:
- **Attribution**: You must give appropriate credit and provide a link to the license.
- **Non-Commercial**: You **may not** use the material for commercial purposes.

For more details, please refer to the [LICENSE](./LICENSE) file.
