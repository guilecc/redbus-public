# RedBus Audio Bridge

macOS virtual audio loopback driver based on [BlackHole](https://github.com/ExistentialAudio/BlackHole) (MIT License).

Allows RedBus to capture system audio (Teams, Zoom, Meet, etc.) by creating a virtual audio device that routes the system output back as input.

## Architecture

- **Type:** AudioServerPlugIn (HAL plugin, `.driver` bundle) — NOT a kext/dext
- **No kernel extension** — no SIP modifications, no user approval needed
- **Mechanism:** Ring buffer in shared memory; apps write to output → RedBus reads from input
- **Channels:** 2 (stereo)
- **Sample rates:** 8k–768kHz
- **Latency:** Zero additional latency

## Build

```bash
cd drivers/redbus-audio-bridge
chmod +x build.sh
./build.sh
```

Output: `build/RedBusAudio2ch.driver`

## Install / Uninstall (dev)

```bash
sudo ./scripts/install.sh
sudo ./scripts/uninstall.sh
```

## Customization

All branding is configured via C preprocessor macros in `build.sh`:

| Macro | Value | Purpose |
|-------|-------|---------|
| `kDriver_Name` | `"RedBusAudio"` | Device name shown in Audio MIDI Setup |
| `kPlugIn_BundleID` | `"com.redbus.audiobridge"` | Unique bundle ID (no conflict with stock BlackHole) |
| `kManufacturer_Name` | `"RedBus"` | Manufacturer label |
| `kCanBeDefaultDevice` | `false` | Prevents accidental selection as default output |
| `kNumber_Of_Channels` | `2` | Stereo |

## How RedBus uses this

1. **Install:** Bundled with the RedBus macOS installer (postinstall script)
2. **Record flow:**
   - User clicks "Gravar" → RedBus creates a Multi-Output Device (speakers + RedBusAudio)
   - Sets Multi-Output as system output temporarily
   - Captures from RedBusAudio input via `getUserMedia`
   - User continues hearing audio normally through speakers/headphones
3. **Stop:** Restores original audio output, destroys aggregate device

## License

BlackHole is licensed under MIT. See [LICENSE-BlackHole](./LICENSE-BlackHole).

