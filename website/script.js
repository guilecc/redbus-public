const translations = {
    en: {
        nav_features: "Features",
        nav_drivers: "Audio Drivers",
        nav_github: "GitHub",
        hero_title: "Autonomous Intelligence\nThat Perceives You.",
        hero_subtitle: "Equipped with advanced environmental sensors to proactively assist your workflow. Total orchestration, 100% local privacy.",
        download_btn: "Download Latest Release",
        download_note: "Version 1.0.2. Free forever.",
        
        section_features_title: "Unparalleled Capabilities",
        feat_privacy_title: "Zero-Trust Privacy",
        feat_privacy_desc: "100% Local-First. Zero cloud servers, zero mandatory accounts. Your memory and history are stored in an encrypted local database.",
        feat_orch_title: "Maestro/Worker Orchestration",
        feat_orch_desc: "Dynamic hybrid routing. Use light local models or affordable cloud APIs for planning (Maestro), and direct heavy execution to powerful local instances (Gemma, Qwen, Llama) or frontier cloud models (Worker).",
        feat_senses_title: "Environmental Sensors",
        feat_senses_desc: "RedBus perceives your workflow through screen OCR, clipboard monitoring, active window detection, and native UI accessibility trees.",
        feat_proactivity_title: "Proactivity Engine",
        feat_proactivity_desc: "A digital subconscious that monitors your context and intervenes autonomously to assist you, based on your preset presence levels.",
        feat_meetings_title: "Meeting Intelligence",
        feat_meetings_desc: "Records system and mic audio to process transcripts and action items locally. Perfect for Teams, Zoom, and Meet.",
        feat_memory_title: "Deep Memory (MemPalace)",
        feat_memory_desc: "Upload files, maintain perpetual context, and find any past chat or OCR image instantly with full-text search.",
        feat_auto_title: "Professional Automation",
        feat_auto_desc: "Execute python scripts with Skill Forge or automate web tasks with Playwright. A powerful toolbox for complex engineering tasks.",
        feat_llm_title: "Elite Model Support",
        feat_llm_desc: "Total Agnostic Power. Run high-density local models via Ollama (Gemma, Llama, Qwen, GLM) with zero friction, or leverage Anthropic, Google, and OpenAI for global-scale intelligence.",
        
        section_intelligence_title: "Intelligent Orchestration Core",
        section_intelligence_desc: "The engine behind RedBus logic. Agnostic, autonomous, and powerful.",
        
        section_drivers_title: "Audio Bridge Setup",
        section_drivers_desc: "Enable system audio capture for meeting intelligence. Setup depends on your operating system.",
        driver_win_desc: "Windows allows native system audio capture via WASAPI Loopback.",
        driver_win_li1: "No additional drivers required.",
        driver_win_li2: "Automatic \"System Audio\" capture.",
        driver_win_li3: "Conflict-free simultaneous listening.",
        driver_mac_desc: "macOS requires a virtual audio driver (RedBusAudio) to intercept system sound.",
        driver_mac_li1: "Pre-installed custom HAL driver.",
        driver_mac_li2: "Automatically creates a Multi-Output Device on record.",
        driver_mac_li3: "Restores default output seamlessly on stop.",
        driver_mac_dl: "Download Driver",
        driver_mac_inst: "Manual Install",
        
        modal_title: "macOS Driver Installation",
        modal_intro: "Follow these steps to manually install the audio bridge:",
        modal_step1: "Unzip the downloaded <code>RedBusAudio-Driver.zip</code>.",
        modal_step2: "Move the <code>RedBusAudio2ch.driver</code> folder to: <code>/Library/Audio/Plug-Ins/HAL/</code>",
        modal_step3: "Open your Terminal.",
        modal_step4: "Restart the audio system with this command:",
        modal_note: "Admin password will be required for the terminal command.",
        
        section_trouble_title: "Troubleshooting",
        trouble_mac_title: "macOS \"App is damaged\" message",
        trouble_mac_desc: "If you see a message saying RedBus is damaged, it's actually Gatekeeper blocking the unsigned app. Run this in your Terminal to fix:",
        
        footer_text: "Built for privacy and absolute control."
    },
    pt: {
        nav_features: "Recursos",
        nav_drivers: "Drivers de Áudio",
        nav_github: "Código Fonte",
        hero_title: "Inteligência Autônoma\nQue Percebe Você.",
        hero_subtitle: "Equipado com sensores ambientais avançados para agir proativamente no seu fluxo de trabalho. Orquestração total, 100% local.",
        download_btn: "Baixar Última Versão",
        download_note: "Versão 1.0.2. Grátis para sempre.",
        
        section_features_title: "Capacidades Incomparáveis",
        feat_privacy_title: "Privacidade Zero-Trust",
        feat_privacy_desc: "100% Local-First. Zero servidores na nuvem, zero contas obrigatórias. Sua memória e histórico armazenados em um banco local criptografado.",
        feat_orch_title: "Orquestração Maestro/Worker",
        feat_orch_desc: "Roteamento híbrido dinâmico. Use modelos locais leves ou APIs de nuvem econômicas para planejamento (Maestro), e direcione a execução pesada para modelos locais robustos (Gemma, Qwen, Llama) ou modelos de fronteira na nuvem (Worker).",
        feat_senses_title: "Sensores Ambientais",
        feat_senses_desc: "RedBus percebe o seu fluxo de trabalho via OCR de tela, área de transferência, janela ativa e árvore de UI nativa de acessibilidade.",
        feat_proactivity_title: "Motor de Proatividade",
        feat_proactivity_desc: "Um subconsciente digital que monitora seu contexto e intervém de forma autônoma para ajudar, com base nos seus níveis de presença.",
        feat_meetings_title: "Inteligência em Reuniões",
        feat_meetings_desc: "Grava áudio do sistema e do microfone para processar transcrições e tarefas localmente. Perfeito para Teams, Zoom e Meet.",
        feat_memory_title: "Memória Profunda (MemPalace)",
        feat_memory_desc: "Faça upload de arquivos, mantenha contexto perpétuo e encontre conversas antigas ou OCR em instantes com busca FTS.",
        feat_auto_title: "Automação Profissional",
        feat_auto_desc: "Execute scripts python com Skill Forge ou automatize tarefas web com Playwright. Uma caixa de ferramentas para tarefas complexas.",
        feat_llm_title: "Suporte a Modelos de Elite",
        feat_llm_desc: "Poder Totalmente Agnóstico. Rode modelos locais de alta densidade via Ollama (Gemma, Llama, Qwen, GLM) com zero fricção, ou use Anthropic, Google e OpenAI para inteligência em escala global.",
        
        section_intelligence_title: "Núcleo de Orquestração Inteligente",
        section_intelligence_desc: "O motor por trás da lógica do RedBus. Agnóstico, autônomo e poderoso.",
        
        section_drivers_title: "Configuração do Áudio",
        section_drivers_desc: "Habilite a captura de som do sistema para reuniões. A configuração depende do seu sistema operacional.",
        driver_win_desc: "O Windows permite capturar o áudio do sistema nativamente via WASAPI Loopback.",
        driver_win_li1: "Nenhum driver extra é necessário.",
        driver_win_li2: "Captura automática de \"Áudio do Sistema\".",
        driver_win_li3: "Escuta simultânea sem nenhum conflito 100% garantida.",
        driver_mac_desc: "O macOS exige um driver virtual de áudio (RedBusAudio) para interceptar o som.",
        driver_mac_li1: "Driver customizado (HAL) incluído.",
        driver_mac_li2: "Cria automaticamente um Dispositivo de Saída Múltipla ao gravar.",
        driver_mac_li3: "Restaura perfeitamente o som padrão ao parar a gravação.",
        driver_mac_dl: "Baixar Driver",
        driver_mac_inst: "Instalação Manual",
        
        modal_title: "Instalação do Driver (macOS)",
        modal_intro: "Siga estes passos para instalar manualmente o driver de áudio:",
        modal_step1: "Extraia o arquivo <code>RedBusAudio-Driver.zip</code> baixado.",
        modal_step2: "Mova a pasta <code>RedBusAudio2ch.driver</code> para: <code>/Library/Audio/Plug-Ins/HAL/</code>",
        modal_step3: "Abra o seu Terminal.",
        modal_step4: "Reinicie o sistema de áudio com o comando:",
        modal_note: "A senha de administrador será solicitada para rodar o comando no terminal.",
        
        section_trouble_title: "Resolução de Problemas",
        trouble_mac_title: "Mensagem \"App danificado\" no macOS",
        trouble_mac_desc: "Se você vir uma mensagem dizendo que o RedBus está danificado, na verdade é o Gatekeeper bloqueando o app não assinado. Rode isso no seu Terminal para corrigir:",

        footer_text: "Construído para privacidade e controle absoluto."
    }
};

let currentLang = 'en';

document.addEventListener('DOMContentLoaded', () => {
    const langToggleToggleBtn = document.getElementById('lang-toggle');
    const currentLangSpan = document.getElementById('current-lang');

    langToggleToggleBtn.addEventListener('click', () => {
        currentLang = currentLang === 'en' ? 'pt' : 'en';
        currentLangSpan.textContent = currentLang.toUpperCase();
        updateLanguage(currentLang);
    });

    // Fade-in animation observer for cards
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = 1;
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.card, .driver-card').forEach(el => {
        el.style.opacity = 0;
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'all 0.5s ease-out';
        observer.observe(el);
    });
    // Hardcoded Github URL
    const repoUrl = 'https://github.com/guilecc/redbus-public';
    const releasesUrl = `${repoUrl}/releases`;
    
    document.getElementById('github-link').href = repoUrl;
    const downloadBtn = document.getElementById('main-download-btn');
    if (downloadBtn) downloadBtn.href = releasesUrl;
});

function updateLanguage(lang) {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerHTML = translations[lang][key];
        }
    });
}

function toggleModal(show) {
    const modal = document.getElementById('modal-overlay');
    modal.style.display = show ? 'flex' : 'none';
    if (show) {
        lucide.createIcons();
    }
}
