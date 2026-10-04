# Mobile builds

The app uses `react-native-webrtc`, so it cannot run in Expo Go: every test
build is a real native build. Every profile below points the app at the test
API (`https://test.worldofweddingz.com/api`); change `EXPO_PUBLIC_API_URL` in
`mobile/eas.json` when a production API exists.

## iOS (EAS Build)

iOS builds run on Expo's macOS machines, so no Mac is needed. They need:

- an Expo account (free), and
- an Apple Developer Program membership (paid) for anything that installs on a
  real iPhone. The simulator profile needs neither Apple account nor device.

One-time setup, from `mobile/`:

```bash
npx eas-cli login
npx eas-cli init          # links the project; writes owner + projectId into app.json
```

Commit the `app.json` change `eas init` makes.

### Profiles (`mobile/eas.json`)

| Profile | What it makes | Who can install it |
|---|---|---|
| `preview` | Ad hoc `.ipa` (iOS), `.apk` (Android) | iPhones registered on the Apple account |
| `simulator` | `.app` for the iOS Simulator | Anybody with a Mac and Xcode |
| `production` | App Store build, build number auto-incremented | TestFlight, then the App Store |

### Testing on an iPhone (ad hoc)

```bash
npx eas-cli device:create     # gives a link/QR to open on each test iPhone
npm run build:ios:preview
```

EAS creates the certificate and provisioning profile on the first run (sign in
with the Apple ID when asked) and prints an install link. A phone registered
after the build needs a new build. iOS 16+ also asks the tester to turn on
Settings → Privacy & Security → Developer Mode.

### TestFlight

```bash
npm run build:ios:production
npm run submit:ios
```

The first submit asks for the App Store Connect app to be created (bundle id
`com.worldofweddings.app`). `ios.config.usesNonExemptEncryption` is `false` in
`app.json` — the app only uses standard HTTPS — so uploads are not held for the
export-compliance question. Revisit that if the app ever adds its own
encryption.

## Android

`npx eas-cli build --platform android --profile preview` produces an `.apk`
the same way. No Expo account is needed to build one locally in Docker:

```bash
BUILD_COMMIT=$(git rev-parse --short HEAD) \
  docker compose -f docker/docker-compose.yml --profile mobile run --rm build-android
```

The `build-android` service (`docker/android-build/build-apk.sh`, on the
`reactnativecommunity/react-native-android` image) copies `mobile/` and
`frontend/` side by side, runs `npm ci`, `expo prebuild` and
`gradlew assembleRelease`, and publishes `wow.apk` and `version.json` into
`docker/downloads`. Both are replaced atomically, so the running site switches
to the new build without a restart. The first build takes a while; the Gradle
and npm caches live in the `android_gradle` and `android_npm` volumes, so later
ones are much quicker.

| Setting (`docker/.env`) | Default | Meaning |
|---|---|---|
| `MOBILE_API_URL` | the test API | The API baked into the APK |
| `ANDROID_ARCHS` | `arm64-v8a` | Add `,armeabi-v7a` for old 32-bit phones |
| `ANDROID_OUT_DIR` | `./downloads` | Where the build is published |
| `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD` | | Only with a signing key, below |

**Signing.** Without a key the APK keeps the release build's default
signature, as every earlier test build did, so testers update in place. To sign
with a key of your own, put it at `docker/android-keys/release.jks`
(git-ignored) and set the alias and password in `docker/.env`. Android refuses
an update signed with a different key, so testers uninstall once when you
switch. Choose one key and keep it, backed up outside the repository.

## Handing builds to testers

`/app` on the website (for example `https://test.worldofweddingz.com/app`) is
the page to send people. It is public and reads what is in `docker/downloads`:

- **Android:** a QR code for `wow.apk` when opened on a computer, a Download
  button on the phone, and the version, build time, commit and checksum from
  `version.json`.
- **iPhone:** iPhones cannot install an app from a web page, so this half shows
  a TestFlight QR code and button once `docker/downloads/ios.json` exists:

  ```json
  { "testflightUrl": "https://testflight.apple.com/join/XXXXXXXX", "note": "Optional line shown under the button" }
  ```

  Use the TestFlight public link from App Store Connect. Until the file exists
  the page says the iPhone app is on its way.

The home page and the dashboard card link to `/app` as well as straight to the
APK.

## Automated builds (GitHub Actions)

`.github/workflows/mobile-builds.yml` builds the Android test APK every day at
02:30 IST. It builds only when `main` has changed `mobile/` or
`frontend/src/lib/` since its last successful run; otherwise it stops after a
few seconds. To build on demand, open **Actions → Mobile builds → Run
workflow** (tick *force* to build with no changes).

The APK is published as the release `android-latest`, replaced on each build,
so the download link never changes:
`https://github.com/RohithTadiparti/WOW-MD/releases/download/android-latest/wow.apk`.
It needs no secrets.

iOS is not automated yet. The EAS project is `@rohtisvr-wow/wow`; what is left
is one interactive production build with the Apple account (above), then an
`EXPO_TOKEN` secret and an iOS job in the workflow.

## Notes

- `ios/` and `android/` are git-ignored on purpose: EAS generates them on each
  build from `app.json` and the config plugins. Do not commit them, or EAS will
  use the committed copies and ignore config changes.
- EAS uploads the whole repository, which the app needs: it reads a few
  modules from `frontend/src` (see `mobile/metro.config.js`).
