#!/usr/bin/env swift
//
// RedBus Audio Helper — CoreAudio aggregate device manager
// Compiles with: swiftc -O -o redbus-audio-helper RedBusAudioHelper.swift
//
// Commands:
//   list-devices                  List all audio devices as JSON
//   get-default-output            Print current default output device UID
//   create-aggregate <outputUID>  Create Multi-Output: speakers + RedBusAudio
//                                 (Tahoe-safe 2-step: create without virtual → set default → add virtual)
//   destroy-aggregate <aggID>     Destroy aggregate and restore original output
//   set-default-output <uid>      Set default output device by UID
//   check-multi-output            Check if Multi-Output with RedBusAudio exists
//   watch-output                  Watch for default output changes (long-running, prints JSON events)
//

import CoreAudio
import AudioToolbox
import Foundation

// MARK: - Helpers

func getDeviceCount() -> UInt32 {
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &propAddr, 0, nil, &size)
    return size / UInt32(MemoryLayout<AudioDeviceID>.size)
}

func getAllDevices() -> [AudioDeviceID] {
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &propAddr, 0, nil, &size)
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var devices = [AudioDeviceID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &propAddr, 0, nil, &size, &devices)
    return devices
}

func getDeviceName(_ id: AudioDeviceID) -> String {
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceNameCFString,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var name: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    AudioObjectGetPropertyData(id, &propAddr, 0, nil, &size, &name)
    return name as String
}

func getDeviceUID(_ id: AudioDeviceID) -> String {
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var uid: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    AudioObjectGetPropertyData(id, &propAddr, 0, nil, &size, &uid)
    return uid as String
}

func hasStreams(_ id: AudioDeviceID, scope: AudioObjectPropertyScope) -> Bool {
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreams,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(id, &propAddr, 0, nil, &size)
    return size > 0
}

func getDefaultOutputUID() -> String {
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var deviceID: AudioDeviceID = 0
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &propAddr, 0, nil, &size, &deviceID)
    return getDeviceUID(deviceID)
}

func setDefaultOutputByID(_ devID: AudioDeviceID) -> Bool {
    var id = devID
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    let s1 = AudioObjectSetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &propAddr, 0, nil,
        UInt32(MemoryLayout<AudioDeviceID>.size), &id)
    fputs("[setDefault] kAudioHardwarePropertyDefaultOutputDevice → OSStatus \(s1) (device \(devID))\n", stderr)

    // Also set system output (alert sounds etc.)
    var propAddr2 = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    let s2 = AudioObjectSetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &propAddr2, 0, nil,
        UInt32(MemoryLayout<AudioDeviceID>.size), &id)
    fputs("[setDefault] kAudioHardwarePropertyDefaultSystemOutputDevice → OSStatus \(s2)\n", stderr)

    return s1 == noErr
}

func setDefaultOutput(uid: String) -> Bool {
    guard let dev = findDeviceByUID(uid) else { return false }

    // Attempt 1: CoreAudio API (set both default + system output)
    setDefaultOutputByID(dev)
    usleep(150_000) // 150ms — give coreaudiod time to apply
    if getDefaultOutputUID() == uid { return true }

    // Attempt 2: retry with longer delay
    fputs("WARN: First attempt didn't stick, retrying...\n", stderr)
    setDefaultOutputByID(dev)
    usleep(500_000) // 500ms
    if getDefaultOutputUID() == uid { return true }

    // Attempt 3: SwitchAudioSource CLI (brew install switchaudio-osx)
    let deviceName = getDeviceName(dev)
    fputs("WARN: CoreAudio API failed. Trying SwitchAudioSource...\n", stderr)
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    proc.arguments = ["SwitchAudioSource", "-s", deviceName]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    do {
        try proc.run()
        proc.waitUntilExit()
        usleep(300_000)
        if getDefaultOutputUID() == uid {
            fputs("OK: SwitchAudioSource succeeded\n", stderr)
            return true
        }
    } catch { /* not installed */ }

    fputs("ERROR: All attempts to set default output failed for: \(deviceName) (\(uid))\n", stderr)
    fputs("HINT: Install SwitchAudioSource: brew install switchaudio-osx\n", stderr)
    return false
}

func findRedBusDevice() -> (id: AudioDeviceID, uid: String)? {
    for dev in getAllDevices() {
        let name = getDeviceName(dev)
        if name.contains("RedBusAudio") {
            return (dev, getDeviceUID(dev))
        }
    }
    return nil
}

// MARK: - Commands

func cmdListDevices() {
    var result: [[String: Any]] = []
    for dev in getAllDevices() {
        let name = getDeviceName(dev)
        let uid = getDeviceUID(dev)
        let hasOut = hasStreams(dev, scope: kAudioObjectPropertyScopeOutput)
        let hasIn = hasStreams(dev, scope: kAudioObjectPropertyScopeInput)
        result.append(["id": dev, "name": name, "uid": uid, "hasOutput": hasOut, "hasInput": hasIn])
    }
    if let json = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
       let str = String(data: json, encoding: .utf8) {
        print(str)
    }
}

func cmdGetDefaultOutput() {
    print(getDefaultOutputUID())
}

func cmdSetDefaultOutput(_ uid: String) {
    if setDefaultOutput(uid: uid) {
        print("OK")
    } else {
        fputs("ERROR: Device not found: \(uid)\n", stderr)
        exit(1)
    }
}

func cmdCheckMultiOutput() {
    // Check if a Multi-Output device that includes RedBusAudio already exists
    // These are created via Audio MIDI Setup and persist across reboots
    guard let redbus = findRedBusDevice() else {
        let result: [String: Any] = ["found": false, "driverInstalled": false]
        if let json = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
           let str = String(data: json, encoding: .utf8) { print(str) }
        return
    }

    // Look for any aggregate/multi-output device that contains RedBusAudio as a sub-device
    var multiOutputDevice: [String: Any]? = nil
    for dev in getAllDevices() {
        let name = getDeviceName(dev)
        let uid = getDeviceUID(dev)
        // Multi-Output devices created by Audio MIDI Setup have "Multi-Output" in name
        // or are aggregate devices. Check if this device contains RedBusAudio.
        if name.contains("Multi-Output") || name.contains("RedBus") {
            // Verify it has output streams (it's usable as an output)
            if hasStreams(dev, scope: kAudioObjectPropertyScopeOutput) {
                multiOutputDevice = [
                    "id": dev,
                    "name": name,
                    "uid": uid
                ]
                break
            }
        }
    }

    let result: [String: Any] = [
        "found": multiOutputDevice != nil,
        "driverInstalled": true,
        "redbusUID": redbus.uid,
        "redbusName": getDeviceName(redbus.id),
        "multiOutput": multiOutputDevice as Any
    ]
    if let json = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
       let str = String(data: json, encoding: .utf8) {
        print(str)
    }
}

// MARK: - Aggregate Creation (Tahoe-safe 2-step)

func cleanupStaleAggregates() {
    // Remove any leftover com.redbus.aggregate.* devices from crashed sessions
    for dev in getAllDevices() {
        let uid = getDeviceUID(dev)
        if uid.hasPrefix("com.redbus.aggregate.") {
            var devID = dev
            AudioHardwareDestroyAggregateDevice(devID)
            fputs("[cleanup] Destroyed stale aggregate: \(uid)\n", stderr)
        }
    }
}

func findDeviceByUID(_ uid: String) -> AudioDeviceID? {
    for dev in getAllDevices() {
        if getDeviceUID(dev) == uid { return dev }
    }
    return nil
}

func cmdCreateAggregate(_ outputUID: String) {
    // Tahoe-safe 2-step aggregate creation:
    // Step 1: Create aggregate with ONLY the physical output (no virtual driver)
    // Step 2: Set as default output (works because no virtual driver yet)
    // Step 3: Add RedBusAudio as sub-device to the existing aggregate

    guard let redbus = findRedBusDevice() else {
        fputs("ERROR: RedBusAudio driver not found\n", stderr)
        exit(1)
    }

    guard findDeviceByUID(outputUID) != nil else {
        fputs("ERROR: Output device not found: \(outputUID)\n", stderr)
        exit(1)
    }

    // Clean up any stale aggregates first
    cleanupStaleAggregates()

    let aggUID = "com.redbus.aggregate.\(ProcessInfo.processInfo.processIdentifier)"
    let aggName = "RedBus Multi-Output"

    // Step 1: Create aggregate with only the physical output
    // NOT stacked, NOT private — makes it behave like Audio MIDI Setup's Multi-Output
    let subDeviceList: NSArray = [outputUID as NSString]
    let description: NSDictionary = [
        kAudioAggregateDeviceUIDKey as NSString: aggUID as NSString,
        kAudioAggregateDeviceNameKey as NSString: aggName as NSString,
        kAudioAggregateDeviceSubDeviceListKey as NSString: subDeviceList,
        kAudioAggregateDeviceIsPrivateKey as NSString: NSNumber(value: 0),
        kAudioAggregateDeviceIsStackedKey as NSString: NSNumber(value: 1),
    ]

    var aggID: AudioDeviceID = 0
    var status = AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggID)
    guard status == noErr else {
        fputs("ERROR: Failed to create aggregate (step 1): OSStatus \(status)\n", stderr)
        exit(1)
    }

    // Step 2: Set aggregate as default output BEFORE adding virtual driver
    // Use the AudioDeviceID directly (more reliable than UID lookup for new devices)
    let aggUIDActual = getDeviceUID(aggID)
    fputs("[step2] Setting aggregate \(aggID) (\(aggUIDActual)) as default output...\n", stderr)

    setDefaultOutputByID(aggID)
    usleep(300_000) // 300ms — give coreaudiod time

    var defaultSet = getDefaultOutputUID() == aggUIDActual
    if !defaultSet {
        fputs("[step2] First attempt failed, retrying with 500ms delay...\n", stderr)
        setDefaultOutputByID(aggID)
        usleep(500_000) // 500ms
        defaultSet = getDefaultOutputUID() == aggUIDActual
    }
    if !defaultSet {
        fputs("[step2] Second attempt failed, retrying with 1s delay...\n", stderr)
        setDefaultOutputByID(aggID)
        usleep(1_000_000) // 1s
        defaultSet = getDefaultOutputUID() == aggUIDActual
    }

    fputs("[step2] Default output set: \(defaultSet) (current: \(getDefaultOutputUID()))\n", stderr)

    // Step 3: Add RedBusAudio as sub-device to the existing aggregate
    fputs("[step3] Adding RedBusAudio (\(redbus.uid)) to aggregate...\n", stderr)

    // Destroy and recreate with both sub-devices
    // (modifying sub-device list on existing aggregate is unreliable on Tahoe)
    var aggID2: AudioDeviceID = aggID
    let aggUID2 = aggUIDActual

    // Try modifying the sub-device list first
    let newSubDeviceList: NSArray = [outputUID as NSString, redbus.uid as NSString]
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioAggregateDevicePropertyFullSubDeviceList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var cfList: CFArray = newSubDeviceList as CFArray
    status = AudioObjectSetPropertyData(
        aggID2, &propAddr, 0, nil,
        UInt32(MemoryLayout<CFArray>.size), &cfList)

    if status != noErr {
        fputs("[step3] FullSubDeviceList failed (OSStatus \(status)), trying composition...\n", stderr)

        // Alternative: destroy and recreate with both devices
        // But first save whether we were default
        let wasDefault = defaultSet

        AudioHardwareDestroyAggregateDevice(aggID2)
        usleep(200_000)

        let subDeviceList2: NSArray = [outputUID as NSString, redbus.uid as NSString]
        let description2: NSDictionary = [
            kAudioAggregateDeviceUIDKey as NSString: aggUID2 as NSString,
            kAudioAggregateDeviceNameKey as NSString: aggName as NSString,
            kAudioAggregateDeviceSubDeviceListKey as NSString: subDeviceList2,
            kAudioAggregateDeviceIsPrivateKey as NSString: NSNumber(value: 0),
            kAudioAggregateDeviceIsStackedKey as NSString: NSNumber(value: 1),
        ]
        aggID2 = 0
        status = AudioHardwareCreateAggregateDevice(description2 as CFDictionary, &aggID2)
        if status != noErr {
            fputs("ERROR: Failed to recreate aggregate with both devices: OSStatus \(status)\n", stderr)
            exit(1)
        }

        // If we were default before, try to set again (may fail on Tahoe with virtual)
        if wasDefault {
            setDefaultOutputByID(aggID2)
            usleep(300_000)
            defaultSet = getDefaultOutputUID() == getDeviceUID(aggID2)
            fputs("[step3] Re-set as default after recreate: \(defaultSet)\n", stderr)
        }
    } else {
        fputs("[step3] FullSubDeviceList succeeded\n", stderr)
    }

    let finalUID = getDeviceUID(aggID2)
    let result: [String: Any] = [
        "aggregateID": aggID2,
        "aggregateUID": finalUID,
        "redbusUID": redbus.uid,
        "defaultChanged": defaultSet,
        "outputUID": outputUID,
    ]
    if let json = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
       let str = String(data: json, encoding: .utf8) {
        print(str)
    }
}

func cmdDestroyAggregate(_ aggIDStr: String) {
    guard let aggIDNum = UInt32(aggIDStr) else {
        fputs("ERROR: Invalid aggregate ID: \(aggIDStr)\n", stderr)
        exit(1)
    }
    let aggID = AudioDeviceID(aggIDNum)
    let status = AudioHardwareDestroyAggregateDevice(aggID)
    if status == noErr {
        print("OK")
    } else {
        fputs("ERROR: Failed to destroy aggregate \(aggIDStr): OSStatus \(status)\n", stderr)
        exit(1)
    }
}

// MARK: - Watch Output (long-running listener)

func cmdWatchOutput() {
    // Prints a JSON line to stdout every time the default output changes
    var propAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)

    let listenerBlock: AudioObjectPropertyListenerBlock = { _, _ in
        let newUID = getDefaultOutputUID()
        let newDevices = getAllDevices()
        var newName = ""
        for dev in newDevices {
            if getDeviceUID(dev) == newUID {
                newName = getDeviceName(dev)
                break
            }
        }
        let event: [String: Any] = [
            "event": "output-changed",
            "uid": newUID,
            "name": newName,
        ]
        if let json = try? JSONSerialization.data(withJSONObject: event, options: []),
           let str = String(data: json, encoding: .utf8) {
            print(str)
            fflush(stdout)
        }
    }

    let status = AudioObjectAddPropertyListenerBlock(
        AudioObjectID(kAudioObjectSystemObject),
        &propAddr,
        DispatchQueue.main,
        listenerBlock)

    guard status == noErr else {
        fputs("ERROR: Failed to add output listener: OSStatus \(status)\n", stderr)
        exit(1)
    }

    // Print initial state
    let initialUID = getDefaultOutputUID()
    let initEvent: [String: Any] = ["event": "watching", "currentUID": initialUID]
    if let json = try? JSONSerialization.data(withJSONObject: initEvent, options: []),
       let str = String(data: json, encoding: .utf8) {
        print(str)
        fflush(stdout)
    }

    // Keep running
    dispatchMain()
}

// MARK: - Main

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("""
    Usage: redbus-audio-helper <command> [args]
    Commands:
      list-devices                  List all audio devices (JSON)
      get-default-output            Current default output UID
      set-default-output <uid>      Set default output
      check-multi-output            Check if Multi-Output with RedBusAudio exists
      create-aggregate <outputUID>  Create Tahoe-safe Multi-Output aggregate
      destroy-aggregate <aggID>     Destroy aggregate device
      watch-output                  Watch for default output changes (long-running)

    """, stderr)
    exit(1)
}

switch args[1] {
case "list-devices":
    cmdListDevices()
case "get-default-output":
    cmdGetDefaultOutput()
case "set-default-output":
    guard args.count >= 3 else { fputs("ERROR: Missing UID\n", stderr); exit(1) }
    cmdSetDefaultOutput(args[2])
case "check-multi-output":
    cmdCheckMultiOutput()
case "create-aggregate":
    guard args.count >= 3 else { fputs("ERROR: Missing output UID\n", stderr); exit(1) }
    cmdCreateAggregate(args[2])
case "destroy-aggregate":
    guard args.count >= 3 else { fputs("ERROR: Missing aggregate ID\n", stderr); exit(1) }
    cmdDestroyAggregate(args[2])
case "watch-output":
    cmdWatchOutput()
default:
    fputs("ERROR: Unknown command: \(args[1])\n", stderr)
    exit(1)
}
