#!/bin/bash
# Builds the Android test APK and publishes it to /out (docker/downloads),
# where the web container serves it at /downloads/wow.apk and the /app page
# shows its QR code. Run with:
#
#   BUILD_COMMIT=$(git rev-parse --short HEAD) \
#     docker compose -f docker/docker-compose.yml --profile mobile run --rm build-android
#
# The app reads modules from frontend/src, so both trees are copied side by
# side; the sources are mounted read-only and never written to.
set -euo pipefail

log() { echo "=== $*"; }

mkdir -p /w/mobile /w/frontend
tar -C /src/mobile --exclude=node_modules --exclude=android --exclude=ios -cf - . | tar -C /w/mobile -xf -
tar -C /src/frontend --exclude=node_modules --exclude=dist --exclude=e2e-results -cf - . | tar -C /w/frontend -xf -

cd /w/mobile
log "node $(node -v), $(java -version 2>&1 | head -1)"
log "API: ${EXPO_PUBLIC_API_URL:?EXPO_PUBLIC_API_URL must be set}"

log "npm ci"
npm ci --no-audit --no-fund > /tmp/npm.log 2>&1 || { tail -30 /tmp/npm.log; exit 1; }

log "expo prebuild"
CI=1 npx expo prebuild --platform android --no-install > /tmp/prebuild.log 2>&1 || { tail -40 /tmp/prebuild.log; exit 1; }

log "gradle assembleRelease (${ANDROID_ARCHS})"
cd android
./gradlew assembleRelease --no-daemon "-PreactNativeArchitectures=${ANDROID_ARCHS}" > /tmp/gradle.log 2>&1 \
  || { tail -60 /tmp/gradle.log; exit 1; }
APK=app/build/outputs/apk/release/app-release.apk

# Signing. Without a keystore the APK keeps the release build's default
# signature, which is what every earlier test build carried, so testers can
# update in place. With one in /keys it is re-signed with that key instead;
# switching keys means testers uninstall once, so pick one and keep it.
if [ -f /keys/release.jks ]; then
  : "${ANDROID_KEYSTORE_PASSWORD:?set ANDROID_KEYSTORE_PASSWORD for /keys/release.jks}"
  apksigner=$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner
  log "signing with /keys/release.jks (alias ${ANDROID_KEY_ALIAS})"
  "$apksigner" sign --ks /keys/release.jks --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEYSTORE_PASSWORD \
    --out /tmp/signed.apk "$APK"
  APK=/tmp/signed.apk
  SIGNING=release-key
else
  log "no /keys/release.jks; keeping the default signature"
  SIGNING=default
fi

# What the /app page shows about the build.
VERSION_NAME=$(node -p "require('/w/mobile/app.json').expo.version")
VERSION_CODE=$(sed -n 's/^\s*versionCode \([0-9]*\).*/\1/p' app/build.gradle | head -1)
SIZE=$(stat -c %s "$APK")
SHA256=$(sha256sum "$APK" | cut -d' ' -f1)

# Publish atomically: a tester mid-download keeps the old file, and nobody
# sees a half-written APK or a version.json that describes the wrong one.
cp "$APK" /out/.wow.apk.tmp
cat > /out/.version.json.tmp <<JSON
{
  "platform": "android",
  "file": "wow.apk",
  "versionName": "${VERSION_NAME}",
  "versionCode": ${VERSION_CODE:-1},
  "commit": "${BUILD_COMMIT}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sizeBytes": ${SIZE},
  "sha256": "${SHA256}",
  "apiUrl": "${EXPO_PUBLIC_API_URL}",
  "signing": "${SIGNING}",
  "architectures": "${ANDROID_ARCHS}"
}
JSON
mv -f /out/.wow.apk.tmp /out/wow.apk
mv -f /out/.version.json.tmp /out/version.json
log "published wow.apk ($((SIZE / 1024 / 1024)) MB, ${VERSION_NAME}, ${BUILD_COMMIT})"
cat /out/version.json
