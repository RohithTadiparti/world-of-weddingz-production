import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { FileText, Trash, X } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { Body, Button, Caption } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';
import { COMPLIANCE_DOCUMENT_EXTENSIONS } from '@/shared/vendor-listing-rules';

/**
 * Picking a file and putting it where the platform serves it from.
 *
 * The same two steps the web uploader takes — ask the API to presign, then PUT
 * the bytes straight at storage — because the reason for it is the same on both:
 * a ten-megabyte upload must not occupy a request worker for the length of
 * somebody's phone connection.
 *
 * What is different is how the bytes get into the request, and it is why every
 * portfolio photograph and compliance document failed with "Could not reach the
 * server" (EZ1-I248). This read the file with `fetch('file:///…')` and PUT the
 * resulting blob. There is no file: handler in React Native's networking stack:
 * the read itself fails, as a network error, before anything is sent — which is
 * exactly the message the vendor saw, about a server that was never contacted.
 *
 * The platform's own uploader does the read instead. `createUploadTask` with
 * BINARY_CONTENT streams the file from disk as the request body, which is what
 * a presigned PUT needs — a multipart body with `{ uri, name, type }` would
 * arrive at S3 as a file whose bytes are a MIME envelope — and it reports
 * progress, so a vendor on a slow connection can see that something is
 * happening rather than deciding the app has hung.
 */

/** Kept in step with `UPLOAD_IMAGE_EXTENSIONS` on the API. */
const FALLBACK_EXTENSION = 'jpg';

const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'png', 'apng', 'webp',
  'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff',
];

/** What the attachment route accepts: an image, or a PDF. */
const DOCUMENT_EXTENSIONS = [...IMAGE_EXTENSIONS, 'pdf'];

/**
 * What the biodata reader can look at. Kept in step with
 * `BIODATA_IMAGE_EXTENSIONS` on the API: the file goes to a vision model that
 * reads these and nothing else, so a PDF is refused here rather than uploaded
 * and read as nothing.
 */
const BIODATA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const ALLOWED: Record<Kind, { extensions: string[]; message: string }> = {
  photo: { extensions: IMAGE_EXTENSIONS, message: 'Choose an image — a JPEG, PNG, HEIC or WebP.' },
  attachment: { extensions: DOCUMENT_EXTENSIONS, message: 'Choose an image or a PDF.' },
  biodata: {
    extensions: BIODATA_EXTENSIONS,
    message: 'Choose a photo of your biodata: a JPEG, PNG or WebP image.',
  },
  // A vendor's compliance documents: the officer's formats only.
  compliance: {
    extensions: [...COMPLIANCE_DOCUMENT_EXTENSIONS],
    message: 'Upload a PDF, JPG, JPEG or PNG file.',
  },
};

/** The server's own MAX_FILE_SIZE default, checked here so a refusal is
 *  immediate rather than ten megabytes later. */
const MAX_BYTES = 10 * 1024 * 1024;

/** A type worth passing on: an image, a video or a PDF, never a blank. */
const REPORTED_TYPE = /^(image|video)\/[a-z0-9.+-]+$|^application\/pdf$/i;

/** A refusal the person can act on, as opposed to one about the network. */
class UploadError extends Error {}

const PRIVATE_STORAGE_URL =
  /^(https?:)\/\/(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|\[::1\])(:\d{1,5})?(\/.*)?$/i;
const ORIGIN = /^(https?:\/\/[^/]+)/i;

/**
 * A storage URL the phone can actually open (EZ1-I248).
 *
 * A local storage server can return a URL with an address from the developer's
 * machine or LAN. That address may not be reachable from the phone. Repoint
 * loopback and private-network storage URLs at the API origin already configured
 * for this app, preserving the upload path. Public storage URLs remain intact.
 */
export function reachable(url: string): string {
  const privateStorage = PRIVATE_STORAGE_URL.exec(url);
  const apiOrigin = ORIGIN.exec(api.defaults.baseURL ?? '');
  if (!privateStorage || !apiOrigin) return url;
  const storageOrigin = `${privateStorage[1]}//${privateStorage[2]}${privateStorage[3] ?? ''}`;
  if (storageOrigin.toLowerCase() === apiOrigin[1].toLowerCase()) return url;
  return `${apiOrigin[1]}${privateStorage[4] ?? ''}`;
}

function hostOf(url: string): string {
  return ORIGIN.exec(url)?.[1] ?? url;
}

function extensionOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

async function upload(
  uri: string,
  fileName: string,
  mimeType: string,
  kind: Kind,
  onProgress?: (fraction: number) => void,
  purpose?: 'profile_photo',
): Promise<Uploaded> {
  const allowed = ALLOWED[kind];
  if (!allowed.extensions.includes(extensionOf(fileName))) {
    throw new UploadError(allowed.message);
  }

  let size = 0;
  let fileBlob: Blob | null = null;

  if (Platform.OS === 'web') {
    try {
      const response = await fetch(uri);
      fileBlob = await response.blob();
      size = fileBlob.size;
    } catch {
      throw new UploadError('That file could not be read. Choose it again.');
    }
  } else {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) throw new UploadError('That file could not be read. Choose it again.');
    size = info.size;
  }

  if (size > MAX_BYTES) {
    throw new UploadError('That file is over 10MB. Choose a smaller one.');
  }

  // The size and type go with the request so storage can hold the upload to
  // them: on S3 both are signed into the upload URL, and a file of any other
  // length is refused there. The type only when it is a real one.
  const presignPath =
    kind === 'attachment' || kind === 'compliance' ? '/media/attachment/presign'
    : kind === 'biodata' ? '/media/biodata/presign'
    : '/media/profile-photo/presign';
  const { data } = await api.post(
    presignPath,
    {
      filename: fileName,
      size: size,
      ...(REPORTED_TYPE.test(mimeType) ? { contentType: mimeType } : {}),
    },
  );

  const uploadUrl = reachable(data.uploadUrl as string);

  if (Platform.OS === 'web' && fileBlob) {
    if (onProgress) onProgress(0.1);
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileBlob,
        headers: { 'Content-Type': mimeType, ...((data.headers as Record<string, string>) ?? {}) },
      });
    } catch {
      throw new UploadError(`Could not reach storage at ${hostOf(uploadUrl)}. Check your connection and try again.`);
    }
    if (!response.ok) {
      throw new UploadError(`Storage refused the file (${response.status}). Try again.`);
    }
    if (onProgress) onProgress(1);
  } else {
    const task = FileSystem.createUploadTask(
      uploadUrl,
      uri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        // The type only. Setting a multipart content type by hand is what breaks
        // an upload that has no boundary to go with it.
        headers: { 'Content-Type': mimeType, ...((data.headers as Record<string, string>) ?? {}) },
      },
      (progress) => {
        if (!onProgress || !progress.totalBytesExpectedToSend) return;
        onProgress(progress.totalBytesSent / progress.totalBytesExpectedToSend);
      },
    );

    let response: Awaited<ReturnType<typeof task.uploadAsync>>;
    try {
      response = await task.uploadAsync();
    } catch {
      // Named, so "could not reach" says which address could not be reached.
      throw new UploadError(`Could not reach storage at ${hostOf(uploadUrl)}. Check your connection and try again.`);
    }
    if (!response) throw new UploadError('That upload was interrupted. Try again.');
    if (response.status < 200 || response.status >= 300) {
      throw new UploadError(`Storage refused the file (${response.status}). Try again.`);
    }
  }

  // The server reads the file back and refuses one that is not what it
  // claimed to be — or, for a profile photograph, one that is AI-generated —
  // before anything is attached to it. Its message is shown as it is.
  await api.post('/media/complete', { key: data.key, ...(purpose ? { purpose } : {}) });

  return { url: reachable(data.publicUrl as string), key: data.key as string };
}

type Kind = 'photo' | 'attachment' | 'biodata' | 'compliance';

/** Where an upload landed: a link to show it, and the key the API knows it by. */
interface Uploaded {
  url: string;
  key: string;
}

export function PhotoPicker({
  label = 'Add a photo',
  kind = 'photo',
  purpose,
  onUploaded,
  multiple = false,
  maxFiles,
}: {
  label?: string;
  kind?: Kind;
  /** Let several be chosen at once; each is uploaded in turn. */
  multiple?: boolean;
  /** How many more may be added; extras chosen past it are left out. Zero disables picking. */
  maxFiles?: number;
  /**
   * `profile_photo` for a photograph of a person going onto a profile: the
   * server checks it for AI generation as soon as it lands, and a refusal is
   * shown here before `onUploaded` runs, so nothing appears as added.
   */
  purpose?: 'profile_photo';
  /** `key` is what a route that takes a storage key (the biodata reader) expects. */
  onUploaded: (url: string, key: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  /** Whatever went wrong, said in words the person can act on. */
  function report(err: unknown, fallback: string) {
    if (err instanceof UploadError) {
      setError(err.message);
    } else if (err instanceof Error && !('isAxiosError' in err)) {
      setError(err.message);
    } else {
      setError(apiMessage(err, fallback));
    }
  }

  async function run(source: 'library' | 'camera') {
    setError('');

    // Asked at the moment of use rather than at launch: a permission prompt a
    // person cannot connect to anything they just did is a permission prompt
    // they refuse.
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        source === 'camera'
          ? 'Camera access is off for this app. Turn it on in Settings to take a photo.'
          : 'Photo access is off for this app. Turn it on in Settings to choose one.',
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.85,
            allowsMultipleSelection: multiple,
            ...(multiple && maxFiles !== undefined ? { selectionLimit: Math.max(1, maxFiles) } : {}),
          });
    if (result.canceled || result.assets.length === 0) return;

    await uploadAll(
      result.assets.map((asset) => ({
        uri: asset.uri,
        name:
          asset.fileName ??
          `upload-${Date.now()}.${asset.uri.split('.').pop() ?? FALLBACK_EXTENSION}`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      })),
      kind,
      'That photo could not be uploaded.',
    );
  }

  /** Uploads the chosen files one after another, within `maxFiles`. */
  async function uploadAll(
    files: { uri: string; name: string; mimeType: string }[],
    as: Kind,
    fallback: string,
  ) {
    const room = maxFiles ?? Number.POSITIVE_INFINITY;
    const chosen = multiple ? files.slice(0, Math.max(0, room)) : files.slice(0, 1);
    const left = files.length - chosen.length;
    setBusy(true);
    setProgress(0);
    let failure = '';
    for (const file of chosen) {
      try {
        const { url, key } = await upload(file.uri, file.name, file.mimeType, as, setProgress, purpose);
        onUploaded(url, key);
      } catch (err) {
        report(err, fallback);
        failure = 'reported';
      }
      setProgress(0);
    }
    setBusy(false);
    if (!failure && multiple && left > 0) {
      setError(`Only ${chosen.length} more could be added; the rest were left out.`);
    }
  }

  /**
   * A file off the phone rather than a photograph of one.
   *
   * A registration certificate is a PDF that arrived by email, and telling a
   * vendor to photograph their screen was the previous answer to that.
   */
  async function pickDocument() {
    setError('');
    const result = await DocumentPicker.getDocumentAsync({
      type:
        kind === 'compliance'
          ? ['application/pdf', 'image/jpeg', 'image/png']
          : ['application/pdf', 'image/*'],
      // Copied into the app's own cache, so the uri stays readable after the
      // picker's temporary grant is gone.
      copyToCacheDirectory: true,
      multiple,
    });
    if (result.canceled || result.assets.length === 0) return;

    await uploadAll(
      result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name || `document-${Date.now()}.pdf`,
        mimeType: asset.mimeType ?? 'application/pdf',
      })),
      kind === 'compliance' ? 'compliance' : 'attachment',
      'That document could not be uploaded.',
    );
  }

  const full = maxFiles !== undefined && maxFiles <= 0;

  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button
          label={busy ? uploadingLabel(progress) : label}
          variant="outline"
          small
          busy={busy}
          disabled={full}
          onPress={() => void run('library')}
          style={{ flex: 1 }}
        />
        <Button
          label="Camera"
          variant="outline"
          small
          disabled={busy || full}
          onPress={() => void run('camera')}
        />
      </View>
      {kind === 'attachment' || kind === 'compliance' ? (
        <Button
          label="Choose a PDF or file"
          variant="outline"
          small
          disabled={busy || full}
          onPress={() => void pickDocument()}
        />
      ) : null}
      {busy ? <ProgressBar fraction={progress} /> : null}
      {error ? <Caption tone="critical">{error}</Caption> : null}
      {kind === 'biodata' ? (
        <Caption tone="faint">
          A clear photo or screenshot of your biodata: JPEG, PNG or WebP, up to 10MB. For a PDF,
          take a screenshot of the page first.
        </Caption>
      ) : null}
      {kind === 'attachment' ? (
        <Caption tone="faint">
          A PDF, or a photograph of the document — the officer checks what it says, not what it was
          scanned on. Up to 10MB.
        </Caption>
      ) : null}
    </View>
  );
}

/** "Uploading… 40%", or just "Uploading…" until the first byte is acknowledged. */
function uploadingLabel(fraction: number): string {
  return fraction > 0 ? `Uploading… ${Math.round(fraction * 100)}%` : 'Uploading…';
}

/**
 * How far the upload has got.
 *
 * A spinner on a ten-megabyte upload over a phone connection says only that
 * something is happening; after fifteen seconds of it people press the button
 * again, which is how two copies of the same photograph end up on a listing.
 */
function ProgressBar({ fraction }: { fraction: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      style={{
        height: 4,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: rgb(theme.surfaceSunken),
      }}
    >
      <View
        style={{
          height: '100%',
          width: `${Math.max(4, Math.round(fraction * 100))}%`,
          backgroundColor: rgb(theme.brand),
        }}
      />
    </View>
  );
}

/**
 * The photographs already on the listing.
 *
 * A horizontal strip rather than a wrapping grid: a portfolio grows, and a grid
 * that grows downwards pushes the rest of the form off the screen every time a
 * photograph is added.
 */
export function MediaStrip({
  urls,
  onRemove,
  primary,
  onMakePrimary,
}: {
  urls: string[];
  /** Absent makes the strip read-only, which is what a review screen wants. */
  onRemove?: (url: string) => void;
  /** The profile photo, marked in the strip. */
  primary?: string | null;
  /** Present offers "Set as profile photo" under every other photo. */
  onMakePrimary?: (url: string) => void;
}) {
  const theme = useTheme();
  if (urls.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
      {urls.map((url) => (
        <View key={url} style={{ width: 116 }}>
          <Image
            source={{ uri: reachable(url) }}
            style={{
              width: 116,
              height: 84,
              borderRadius: radius.sm,
              backgroundColor: rgb(theme.surfaceSunken),
              borderWidth: url === primary ? 2 : 0,
              borderColor: rgb(theme.brand),
            }}
            contentFit="cover"
            transition={150}
          />
          {url === primary ? (
            <Caption tone="brand" style={{ marginTop: space(1), textAlign: 'center' }}>
              Profile photo
            </Caption>
          ) : onMakePrimary ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set as profile photo"
              onPress={() => onMakePrimary(url)}
              hitSlop={8}
              style={({ pressed }) => [{ marginTop: space(1) }, pressed && { opacity: 0.6 }]}
            >
              <Caption style={{ textAlign: 'center', textDecorationLine: 'underline' }}>
                Set as profile photo
              </Caption>
            </Pressable>
          ) : null}
          {onRemove && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove this photo"
              onPress={() => onRemove(url)}
              // Its own 32pt target in the corner rather than a text link
              // under the picture, which at this size would be wider than the
              // picture itself.
              style={({ pressed }) => [
                {
                  position: 'absolute',
                  top: space(1),
                  right: space(1),
                  width: 28,
                  height: 28,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: rgba(theme.scrim, 0.6),
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <X size={14} weight="bold" color="#fff" />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

/** The stored file name, not the whole URL: a media path is not something anybody reads. */
export function documentName(url: string, index = 0): string {
  try {
    return decodeURIComponent(url.split('/').pop() ?? `Document ${index + 1}`);
  } catch {
    return `Document ${index + 1}`;
  }
}

/**
 * Compliance documents, as a list of openable rows.
 *
 * Opened in the system browser rather than in the app: these are PDFs and
 * photographs stored elsewhere, and an in-app viewer for them would be a viewer
 * to maintain for no benefit over the one the phone already has.
 */
export function DocumentList({
  urls,
  onRemove,
}: {
  urls: string[];
  onRemove?: (url: string) => void;
}) {
  const theme = useTheme();
  if (urls.length === 0) return null;

  return (
    <View
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: rgb(theme.border),
        borderRadius: radius.sm,
        overflow: 'hidden',
      }}
    >
      {urls.map((url, i) => (
        <View
          key={url}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(2),
            paddingHorizontal: space(3),
            paddingVertical: space(2),
            minHeight: 48,
            borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: rgb(theme.border),
          }}
        >
          <FileText size={18} color={rgb(theme.ink[400])} />
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              void WebBrowser.openBrowserAsync(reachable(url)).catch(() =>
                Alert.alert('That document could not be opened.'),
              );
            }}
            style={{ flex: 1, justifyContent: 'center', minHeight: 44 }}
          >
            <Body tone="brand" numberOfLines={1}>
              {documentName(url, i)}
            </Body>
          </Pressable>
          {onRemove && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${documentName(url, i)}`}
              onPress={() => onRemove(url)}
              style={({ pressed }) => [
                { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Trash size={17} color={rgb(theme.criticalFg)} />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
