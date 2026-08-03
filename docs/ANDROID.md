# LinkBridge — Android app

The Android app is the **device side**. It pairs via a deep link, streams the
screen/camera, injects touch gestures, and browses the gallery — all gated by
explicit, on-device consent.

## Project layout

```
android/
  settings.gradle.kts        Gradle settings + module includes
  build.gradle.kts           Plugin versions
  gradle/libs.versions.toml  Version catalog (AGP, Kotlin, WebRTC, CameraX…)
  app/
    build.gradle.kts
    proguard-rules.pro
    src/main/
      AndroidManifest.xml
      java/com/linkbridge/app/
        LinkBridgeApp.kt          Application class
        MainActivity.kt           Status + capabilities + per-session gate
        PairingActivity.kt        Deep-link pairing + permission flow
        consent/  ConsentNotifier, ConsentActionReceiver (Accept/Deny)
        net/      ApiClient, Endpoints, SignalingClient
        permissions/Permissions.kt
        remote/   RemoteAccessibilityService, GestureDispatcher, GalleryProvider
        service/  RemoteService (foreground; owns signaling + WebRTC)
        util/     SecureStore (Keystore AES-GCM), Prefs
        webrtc/   RtcManager, ScreenCapturer, CameraXCapturer
      res/  layouts, values, xml/accessibility_service_config.xml
```

## Permission model

The app requests **only** what its features require, and always through the
official Android system flows:

| Permission | Required for | When granted |
|---|---|---|
| `POST_NOTIFICATIONS` | consent notifications, service foreground | pairing flow (blocking step) |
| MediaProjection (screen capture) | live screen streaming | pairing flow (blocking step) |
| Accessibility (`dispatchGesture` only, no window content) | touch control | pairing flow (blocking step) |
| `CAMERA` | live camera | session start — camera tab, first open |
| `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` | gallery | session start — gallery tab, first open |
| `FOREGROUND_SERVICE_*` + `WAKE_LOCK` | keeping the remote session alive | declared, granted at runtime |

Deliberately absent: `RECORD_AUDIO`, SMS, contacts, call logs,
notification-read, and location. File transfer and clipboard sync are not
features of LinkBridge.

### Accessibility note
`RemoteAccessibilityService` uses `canRetrieveWindowContent=false` and only
calls `dispatchGesture`. It reads no window content and observes no events.
This keeps the touch-control surface minimal and auditable.

## Pairing flow

1. The owner generates a deep link from the dashboard (`linkbridge://pair?token=…`).
2. The user opens the link (or scans the QR) on the device.
3. `PairingActivity` shows a consent prompt.
4. The flow walks through notifications → screen capture → accessibility in
   order. Each step blocks until the user completes the official system
   screen; the activity auto-advances when it regains focus.
5. On success the app calls `POST /api/devices/pair/complete`, stores the
   device token (encrypted in `SecureStore`), and starts `RemoteService`.

If the user declines any permission, pairing is cancelled; nothing partial is
saved.

## RemoteService (foreground)

- Holds the single `SignalingClient` + `RtcManager` per device.
- Shows a persistent notification with the current status.
- Renders consent requests as notifications with **Accept** / **Deny**
  actions (`ConsentActionReceiver`). Deny refuses the session; Accept opens
  the permission gate and only then replies `consent.response granted`.
- Any disconnect triggers the WebSocket auto-reconnect (exponential backoff),
  so sessions survive network changes.

## WebRTC on the device

- `RtcManager` answers offers from the dashboard, adds the chosen video
  source, and opens a reliable data channel.
- `ScreenCapturer` — `MediaProjection` + `VirtualDisplay` into a
  `SurfaceTexture`; the frame is pulled via `SurfaceTextureHelper` and fed to
  the `VideoSource`. On Android 14+ the MediaProjection token is obtained at
  pairing and reused for streamed sessions.
- `CameraXCapturer` — a `CameraX`-based `VideoCapturer` for the front camera.
- `GestureDispatcher` maps normalized touch coordinates (0..1) from the data
  channel into absolute screen coordinates and injects them through the
  accessibility service.
- `GalleryProvider` reads MediaStore thumbnails (and full images) and returns
  them as data URLs over the data channel.

## WebRTC signaling

All signaling (offer/answer/ICE) is exchanged through the backend WebSocket;
media flows peer-to-peer with a TURN fallback. Control commands such as
`camera.start`, `gallery.list`, and `gesture` travel over the data channel,
and transparently fall back to the WebSocket (`relay.data`) when the channel
is unavailable.

## Building

```bash
# from repo root
cd android

# debug build (point it at your backend during development)
./gradlew assembleDebug -Plinkbridge.serverUrl=http://10.0.2.2:8080

# release (configure signing in app/build.gradle.kts)
./gradlew assembleRelease
```

Requirements: JDK 17+, Android SDK (compileSdk 35, build-tools 35.x). The
project uses the Gradle wrapper pinned to 8.9.

### App Links
For verified HTTPS deep links, host `assetlinks.json` at
`https://<your-domain>/.well-known/assetlinks.json` with your release signing
certificate fingerprint:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.linkbridge.app",
      "sha256_cert_fingerprints": ["YOUR_RELEASE_FINGERPRINT"]
    }
  }
]
```

The `linkbridge://` custom scheme works regardless of certificate
verification.
