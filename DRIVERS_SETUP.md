# RedBus Audio Bridge: Setup and Usage

O RedBus é capaz de interceptar e gravar o áudio do sistema (ex: chamadas no Teams, Zoom, Meet, Slack) para processar as suas atas de reunião localmente, mantendo total sigilo. O comportamento e os requisitos variam entre **macOS** e **Windows**.

---

## 🍏 Usuários de macOS

A arquitetura de áudio do Mac não permite captura nativa da saída de som do sistema. Para resolver isso, o RedBus utiliza um driver de áudio virtual customizado, baseado no **BlackHole**.

### 1. Instalação Manual do Driver (macOS)

O driver é do tipo HAL (AudioServerPlugIn) e não exige modificações no SIP do macOS (System Integrity Protection). 

Se você precisar instalar ou reinstalar de forma manual para desenvolvimento:
1. Abra um terminal.
2. Navegue até a pasta do driver:
   ```bash
   cd drivers/redbus-audio-bridge
   ```
3. Rode o script de instalação (uma senha de administrador será solicitada):
   ```bash
   sudo ./scripts/install.sh
   ```

### 2. Fluxo Automático no macOS

Você **não** precisa configurar nada manualmente nas preferências "Audio MIDI Setup" do Mac. 

1. **Ativação da Captura:** Quando a reunião começar, clique em **Gravar** no Widget de Gravação do RedBus.
2. **Dispositivo Agregado Automático:** O sistema cria silenciosamente um "Multi-Output Device" (Dispositivo de Saída Múltipla) que engloba as suas caixas normais e o `RedBusAudio`. O som sai para os seus fones ao mesmo tempo em que o driver copia o sinal.
3. **Escuta Simultânea:** O app lê o fluxo do `RedBusAudio` enquanto você prossegue com a reunião sem interrupções.
4. **Finalizando:** Ao parar a gravação, o RedBus destrói o Dispositivo de Saída Múltipla via script e restaura a sua saída de som padrão anterior.

### 3. Desinstalação do Driver (macOS)

Para remover por completo o driver virtual:
```bash
cd drivers/redbus-audio-bridge
sudo ./scripts/uninstall.sh
```

---

## 🪟 Usuários de Windows

Para usuários do Microsoft Windows, a arquitetura do sistema operacional (WASAPI Loopback) já permite capturar o áudio do sistema de forma nativa. 

**Nenhuma instalação de driver adicional é necessária.** 

### Como utilizar:
1. O RedBus reconhece que você está no Windows e habilita automaticamente a escuta do "Áudio do Sistema".
2. Basta clicar em **Gravar** no Widget de Gravação durante a sua reunião.
3. A engine do RedBus vai capturar a mescla de todo o áudio saindo do seu PC diretamente através das APIs nativas do sistema.
4. Sem a necessidade de usar Dispositivos Virtuais ou Dispositivos Agregados, nenhuma saída é manipulada durante a escuta, garantindo uso 100% livre de conflitos.
