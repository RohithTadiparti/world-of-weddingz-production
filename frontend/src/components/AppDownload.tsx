import { Link } from 'react-router-dom';
import { AndroidLogo } from '@phosphor-icons/react';

/**
 * The Android app, served by the web container from docker/downloads (see
 * frontend/nginx.conf). A plain link rather than a router Link: it is a file.
 */
export const ANDROID_APK = '/downloads/wow.apk';

/**
 * The Android app, offered at the foot of a dashboard.
 *
 * A quiet row rather than a banner: somebody opening their dashboard came to
 * do something on it, and the app is a convenience, not the next step.
 */
export function AppDownloadCard() {
  return (
    <section
      aria-labelledby="app-download-title"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-surface p-4"
    >
      <AndroidLogo size={28} className="shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <p id="app-download-title" className="text-sm font-medium text-gray-900">
          Get the Android app
        </p>
        <p className="mt-0.5 text-sm text-gray-500">
          Your matches, chat and notifications on your phone. For Android 7 and later; Android asks
          you to allow installs from your browser the first time.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Link to="/app" className="text-sm text-gray-500 underline underline-offset-4 hover:text-brand">
          QR code
        </Link>
        <a href={ANDROID_APK} download="wow.apk" className="btn-outline btn-sm">
          Download for Android
        </a>
      </div>
    </section>
  );
}
