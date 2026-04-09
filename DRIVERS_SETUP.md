# RedBus Audio Bridge: Setup and Usage

RedBus is capable of intercepting and recording system audio (e.g., calls on Teams, Zoom, Meet, Slack) to process meeting minutes locally, maintaining total confidentiality. Behavior and requirements vary between **macOS** and **Windows**.

---

## 🍏 macOS Users

The Mac audio architecture does not allow native capture of system sound output. To resolve this, RedBus uses a custom virtual audio driver based on **BlackHole**.

### 1. Manual Driver Installation (macOS)

The driver is a HAL (AudioServerPlugIn) type and does not require changes to macOS SIP (System Integrity Protection).

If you need to install or reinstall manually for development:
1. Open a terminal.
2. Navigate to the driver folder:
   ```bash
   cd drivers/redbus-audio-bridge
   ```
3. Run the installation script (an administrator password will be requested):
   ```bash
   sudo ./scripts/install.sh
   ```

### 2. Automatic Flow on macOS

You **do not** need to manually configure anything in Mac's "Audio MIDI Setup" preferences.

1. **Activation:** When the meeting starts, click **Record** in the RedBus Recording Widget.
2. **Automatic Aggregate Device:** The system silently creates a "Multi-Output Device" that includes your normal speakers/headphones and the `RedBusAudio`. Sound plays through your headphones while the driver copies the signal.
3. **Simultaneous Listening:** The app reads the `RedBusAudio` stream while you proceed with the meeting without interruption.
4. **Finalizing:** When recording stops, RedBus destroys the Multi-Output Device via script and restores your previous default sound output.

### 3. Driver Uninstallation (macOS)

To completely remove the virtual driver:
```bash
cd drivers/redbus-audio-bridge
sudo ./scripts/uninstall.sh
```

---

## 🪟 Windows Users

For Microsoft Windows users, the operating system architecture (WASAPI Loopback) already allows capturing system audio natively.

**No additional driver installation is required.**

### How to use:
1. RedBus recognizes you are on Windows and automatically enables "System Audio" listening.
2. Simply click **Record** in the Recording Widget during your meeting.
3. The RedBus engine will capture the mix of all audio coming out of your PC directly through native system APIs.
4. Without the need for Virtual Devices or Aggregate Devices, no output is manipulated during listening, ensuring 100% conflict-free usage.
