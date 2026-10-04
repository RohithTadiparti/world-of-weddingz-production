import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { AndroidLogo, AppleLogo } from '@phosphor-icons/react';
import { ANDROID_APK } from '../components/AppDownload';

/**
 * Where testers get the mobile app: `/app`, public.
 *
 * The Android build is whatever the build-android container last published
 * to docker/downloads, described by version.json beside it. On a laptop the
 * QR code is the way across to the phone; on the phone itself it is just the
 * download button. iPhone builds cannot be side-loaded, so that half only
 * appears once a TestFlight link is published in downloads/ios.json.
 */
interface AndroidBuild {
  versionName: string;
  versionCode: number;
  commit: string;
  builtAt: string;
  sizeBytes: number;
  sha256: string;
  apiUrl: string;
}

interface IosBuild {
  testflightUrl: string;
  note?: string;
}

type Loaded<T> = { state: 'loading' } | { state: 'none' } | { state: 'ready'; value: T | null };

const NAV_LINK = 'plate text-[0.8125rem] uppercase tracking-[0.16em] text-gray-700 hover:text-brand';

async function readJson<T>(path: string): Promise<T | null> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The Android build, or null details when only the APK itself is there. */
async function loadAndroid(): Promise<Loaded<AndroidBuild>> {
  const build = await readJson<AndroidBuild>('/downloads/version.json');
  if (build) return { state: 'ready', value: build };
  const apk = await fetch(ANDROID_APK, { method: 'HEAD', cache: 'no-store' });
  return apk.ok ? { state: 'ready', value: null } : { state: 'none' };
}

async function loadIos(): Promise<Loaded<IosBuild>> {
  const ios = await readJson<IosBuild>('/downloads/ios.json');
  return ios?.testflightUrl ? { state: 'ready', value: ios } : { state: 'none' };
}

function useQr(text: string | null): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return setSvg(null);
    let live = true;
    QRCode.toString(text, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#241017', light: '#FFFFFF' },
    })
      .then((out) => live && setSvg(out))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [text]);
  return svg;
}

function Qr({ text, label }: { text: string; label: string }) {
  const svg = useQr(text);
  if (!svg) return <div className="h-44 w-44 shrink-0 border border-gray-200" aria-hidden />;
  return (
    <div
      role="img"
      aria-label={label}
      className="h-44 w-44 shrink-0 border border-gray-200 bg-white [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function builtOn(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function GetApp() {
  const [android, setAndroid] = useState<Loaded<AndroidBuild>>({ state: 'loading' });
  const [ios, setIos] = useState<Loaded<IosBuild>>({ state: 'loading' });

  useEffect(() => {
    loadAndroid()
      .then(setAndroid)
      .catch(() => setAndroid({ state: 'none' }));
    loadIos()
      .then(setIos)
      .catch(() => setIos({ state: 'none' }));
  }, []);

  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const onAndroid = /android/i.test(ua);
  const onIphone = /iphone|ipad|ipod/i.test(ua);
  const apkUrl = typeof window === 'undefined' ? ANDROID_APK : new URL(ANDROID_APK, window.location.origin).href;

  return (
    <div className="relative isolate min-h-[100dvh]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[74rem] flex-col px-5 sm:px-8">
        <header className="flex min-h-[6.25rem] flex-wrap items-center justify-between gap-x-10 gap-y-3 border-b border-gray-200 py-4">
          <Link
            to="/"
            className="plate font-serif text-[1.35rem] uppercase tracking-[0.2em] text-brand sm:text-[1.7rem]"
          >
            World of Weddingz
          </Link>
          <nav className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <Link to="/" className={NAV_LINK}>
              Home
            </Link>
            <Link to="/login" className={NAV_LINK}>
              Sign in
            </Link>
          </nav>
        </header>

        <main className="flex flex-col gap-10 py-12">
          <div className="flex max-w-[44rem] flex-col gap-3">
            <p className="eyebrow tracking-[0.18em]">Test builds</p>
            <h1 className="font-serif text-[2.5rem] font-normal leading-[1.1] text-brand sm:text-[3rem]">
              Get the app
            </h1>
            <p className="text-[0.9375rem] leading-relaxed text-gray-700">
              {onAndroid || onIphone
                ? 'Install the latest test build on this phone.'
                : 'Scan a code with your phone’s camera to install the latest test build, or open this page on the phone itself.'}
            </p>
          </div>

          <div className="grid gap-7 md:grid-cols-2">
            <section
              aria-labelledby="android-title"
              className="flex flex-col gap-6 border border-gray-200 bg-surface p-8"
            >
              <div className="flex items-center gap-3">
                <AndroidLogo size={26} className="text-brand" aria-hidden />
                <h2 id="android-title" className="font-serif text-[1.75rem] font-normal text-brand">
                  Android
                </h2>
              </div>

              {android.state === 'loading' ? (
                <div className="skeleton h-44 w-full" />
              ) : android.state === 'none' ? (
                <p className="text-[0.9375rem] text-gray-700">
                  No Android build has been published yet. Check back soon.
                </p>
              ) : (
                <>
                  <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
                    {!onAndroid && <Qr text={apkUrl} label="QR code to download the Android app" />}
                    <div className="flex flex-col gap-3">
                      <a href={ANDROID_APK} download="wow.apk" className="btn min-h-12 px-8">
                        Download for Android
                      </a>
                      {android.value && (
                        <p className="text-sm text-gray-500">
                          {megabytes(android.value.sizeBytes)} · Android 7 and later
                        </p>
                      )}
                    </div>
                  </div>

                  {android.value && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t border-gray-200 pt-5 text-sm">
                      <dt className="eyebrow tracking-[0.14em]">Version</dt>
                      <dd className="text-gray-700">
                        {android.value.versionName} (build {android.value.versionCode})
                      </dd>
                      <dt className="eyebrow tracking-[0.14em]">Built</dt>
                      <dd className="text-gray-700">{builtOn(android.value.builtAt)}</dd>
                      <dt className="eyebrow tracking-[0.14em]">Commit</dt>
                      <dd className="font-mono text-gray-700">{android.value.commit}</dd>
                      <dt className="eyebrow tracking-[0.14em]">Server</dt>
                      <dd className="text-gray-700">{hostOf(android.value.apiUrl)}</dd>
                      <dt className="eyebrow tracking-[0.14em]">SHA-256</dt>
                      <dd className="break-all font-mono text-xs text-gray-500">{android.value.sha256}</dd>
                    </dl>
                  )}

                  <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-gray-700">
                    <li>Download the file and open it from your notifications or Downloads.</li>
                    <li>
                      The first time, Android asks you to allow installs from your browser. Allow it, then
                      go back and tap Install.
                    </li>
                    <li>A newer build installs over the old one; you stay signed in.</li>
                  </ol>
                </>
              )}
            </section>

            <section
              aria-labelledby="ios-title"
              className="flex flex-col gap-6 border border-gray-200 bg-surface p-8"
            >
              <div className="flex items-center gap-3">
                <AppleLogo size={26} className="text-brand" aria-hidden />
                <h2 id="ios-title" className="font-serif text-[1.75rem] font-normal text-brand">
                  iPhone
                </h2>
              </div>

              {ios.state === 'loading' ? (
                <div className="skeleton h-44 w-full" />
              ) : ios.state === 'none' ? (
                <p className="text-[0.9375rem] leading-relaxed text-gray-700">
                  The iPhone app is on its way through TestFlight. Until then, the website works in
                  Safari; add it to your Home Screen from the Share menu.
                </p>
              ) : (
                ios.value && (
                  <>
                    <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
                      {!onIphone && (
                        <Qr text={ios.value.testflightUrl} label="QR code to join the iPhone test on TestFlight" />
                      )}
                      <a href={ios.value.testflightUrl} className="btn min-h-12 px-8">
                        Open in TestFlight
                      </a>
                    </div>
                    {ios.value.note && <p className="text-sm text-gray-500">{ios.value.note}</p>}
                    <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-gray-700">
                      <li>Install Apple’s TestFlight app from the App Store.</li>
                      <li>Open the link on the iPhone and accept the invitation.</li>
                      <li>TestFlight offers each new build as it arrives.</li>
                    </ol>
                  </>
                )
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
