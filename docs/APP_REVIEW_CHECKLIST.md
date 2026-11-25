# App Review & Store Release Checklist

Pre-submission checklist for Apple App Store and Google Play release of **Blobs** (`com.maddtechnologies.blobs`, version `1.0.0`, EAS project `72a92f6b-f4e9-485c-9371-56363acd0835`).

---

## 1. Reviewer Access & Demo Environment

Blobs connects directly to a user-owned Hermes dashboard gateway rather than a central SaaS backend. Both stores require a working sign-in path during review:

- [ ] Expose a seeded public HTTPS demo gateway (see [DEMO.md](DEMO.md) for the demo world setup: Scout, Courier, Forge, Scribe, Ember).
- [ ] Option A — Built-in button: set `EXPO_PUBLIC_DEMO_URL` in EAS environment variables so **Connect** displays a **Try live demo** button, and provide demo username/password in App Store Connect / Play Console review notes.
- [ ] Option B — Review notes / deep link: provide the demo server URL, demo username & password, or a prefill link `hermesbot://connect?url=https://<demo-host>`.
- [ ] Verify demo credentials log into a non-empty workspace with:
  - [ ] Active **Needs you** items (blocked prompt + dashboard review items)
  - [ ] At least one pinned bot dashboard with charts/lists/records
  - [ ] Seeded chat history so reviewers can immediately browse chats, dashboards, and Needs you triage

---

## 2. App Store & Play Console Metadata

- [ ] **App Name**: `Blobs - a Hermes Agent client` (`eas.json`)
- [ ] **Company / Owner**: `Madd Technologies LLC` (`app.json` owner: `madd-technologies`)
- [ ] **Bundle ID / Package**: `com.maddtechnologies.blobs`
- [ ] **ASC App ID**: `6823473365`
- [ ] **Privacy Policy URL**: `https://blobs.maddtechnologies.com/privacy.html` (linked from Settings → Privacy policy)
- [ ] **Support URL**: `https://github.com/Madd-Technologies/blobs/issues` (linked from Settings → Report an issue)
- [ ] **Source URL / Open Source Notices**: Settings → Licences screen (`/licences`) lists third-party open-source licences offline
- [ ] **Age Rating / Data Safety**:
  - Zero third-party analytics, ads, or crash tracking SDKs
  - Server URL and credentials stored locally in OS-encrypted `expo-secure-store` (Android/iOS)
  - User-generated / self-hosted content: connected solely to user-configured Hermes server

---

## 3. Permissions & App Transport Security Justifications

Include concise explanations in App Review notes matching `app.json`:

- **Local Network (`NSLocalNetworkUsageDescription`)**: *"Blobs connects to the Hermes server you choose, which can be on your local network."* (Required because self-hosted Hermes gateways commonly run over LAN or Tailscale.)
- **ATS (`NSAllowsArbitraryLoads: true` / Android `usesCleartextTraffic: true`)**: Users self-host Hermes on private LANs or VPNs using `http://`; Blobs warns in the Connect screen (`plainOverInternet`) when an unencrypted `http://` address appears to traverse the public internet.
- **Export Compliance (`usesNonExemptEncryption: false`)**: Blobs uses only standard OS HTTPS/TLS transport APIs with no custom cryptography.
- **Microphone (`expo-audio` / `expo-image-picker`)**: Used for voice messages and duplex calls with bots.
- **Camera & Photo Library (`expo-image-picker`, `NSPhotoLibraryAddUsageDescription`)**: Used for capturing/attaching photos to chats and saving bot-generated images to Photos.
- **Push Notifications**: Uses `expo-notifications` (APNs on iOS, FCM on Android via Expo Push Service) when users opt in, plus optional UnifiedPush (`ntfy`) on Android. No Firebase Analytics or Crashlytics SDKs are included.

---

## 4. Store Screenshots & Previews

Capture light and dark screenshots at required sizes (iPhone 6.9"/6.5", Play Phone + 7"/10" Tablet if applicable) against the seeded demo server (`docs/CAPTURE.md`):

- [ ] **Home base station**: `Needs you` sheet (blocked items separated from review queue), `In flight` live activity strip, `Dashboards` tiles, and bot/room rows
- [ ] **Needs you triage**: Deck swipe view + List mode with Urgency/Bot filter strip and bulk Done/Snooze action bar
- [ ] **Bot Chat**: Rich Markdown + Mermaid diagram or PDF attachment viewer + interactive tool/approval card
- [ ] **Bot Dashboard**: Native panels (KPI tiles, chart, checklist/board) + template starter sheet
- [ ] **Bot Screen takeover**: Live remote desktop viewer (`noVNC`) or Settings/Theme switcher

---

## 5. Pre-Submission Quality Gate & EAS Commands

Run local verification on the release commit before kicking off cloud builds:

```bash
npm run check
```

Verify bundle assets (`assets/web/mermaid.min.txt`, `assets/web/pdf.html`, `assets/web/novnc.html`) are committed and Metro bundles cleanly (`npx expo export --platform ios` / `android` on CI).

### Build & Submit (see [RELEASING.md](RELEASING.md))

```bash
# 1. TestFlight smoke build & verify on real hardware (cold boot, Connect demo, Needs you, Chat, Dashboard)
eas build --platform ios --profile testflight
eas submit --platform ios --profile testflight --latest

# 2. Production store builds (iOS App Store & Google Play AAB)
eas build --platform all --profile production

# 3. Submit production builds after smoke-testing
eas submit --platform ios --profile production --latest
eas submit --platform android --profile production --latest
```

### Final Store Sanity Checks

- [ ] Cold start on airplane mode / flaky network degrades gracefully to offline banner and cached roster/dashboards (no white screen or hang)
- [ ] Connect screen rejects gateway API port (`8642`) vs dashboard gateway (`9119`) with clear guidance, and clears invalid credentials on auth failure
- [ ] `__DEV__` routes (`/dev/gallery`) are unreachable in production builds (`<Stack.Protected guard={__DEV__ && configured}>`)
- [ ] Apple "Request to delete account / Disconnect": Settings → Sign out / Disconnect clears stored server config, tokens, and cached stores immediately
