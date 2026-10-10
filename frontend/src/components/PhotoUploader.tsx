import { ChangeEvent, useRef, useState } from 'react';
import { api, apiMessage } from '../lib/api';
import { StorageUploadError, putToStorage } from '../lib/storage-upload';

/** Kept in step with `UPLOAD_IMAGE_EXTENSIONS` on the API. */
const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'png', 'apng', 'webp',
  'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff',
];

/** A type worth passing on: an image, a video or a PDF, never a blank. */
const REPORTED_TYPE = /^(image|video)\/[a-z0-9.+-]+$|^application\/pdf$/i;

/**
 * Picks a file, uploads it, and hands back the URL it now lives at.
 *
 * The profile editors used to take a URL and nothing else, which meant an agent
 * had to upload the photograph somewhere else first and paste a link back in —
 * so in practice profiles had no photographs on them at all. The media module
 * had presigned uploads the whole time; the two were simply never connected.
 *
 * The file goes straight from the browser to storage. It never passes through
 * the API, which is what keeps a fifty-megabyte upload from occupying a request
 * worker for the length of somebody's phone connection.
 */
export default function PhotoUploader({
  onUploaded,
  label = 'Upload a photo',
  kind = 'photo',
  purpose,
  multiple = false,
  maxFiles,
  checkFile,
  accept,
  hint,
}: {
  /** Called once per file, in the order chosen, as each upload completes. */
  onUploaded: (url: string) => void | Promise<void>;
  label?: string;
  /** Let several files be chosen at once; each is uploaded in turn. */
  multiple?: boolean;
  /**
   * How many more files may be added. Extra files chosen past it are not
   * uploaded, and the person is told so. Zero disables the button.
   */
  maxFiles?: number;
  /** A stricter rule for this field (formats, size); its message is shown and the file skipped. */
  checkFile?: (file: File) => string | null;
  /** Overrides the file picker's filter, to match `checkFile`. */
  accept?: string;
  /** A line under the button, e.g. the formats accepted. */
  hint?: string;
  /**
   * What is being attached.
   *
   * A profile photograph must be an image — a PDF there renders as a broken
   * box on somebody's biodata. Evidence on a support case is whatever proves
   * the point, and in practice that is as often an invoice as a photograph.
   */
  kind?: 'photo' | 'attachment';
  /**
   * `profile_photo` for a photograph of a person going onto a profile. The
   * server then checks it for AI generation as soon as it lands, and a
   * refusal surfaces here — before `onUploaded`, so nothing is shown as added.
   */
  purpose?: 'profile_photo';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    if (chosen.length === 0) return;
    setError('');

    const room = maxFiles ?? Number.POSITIVE_INFINITY;
    const files = multiple ? chosen.slice(0, Math.max(0, room)) : chosen.slice(0, 1);
    const problems: string[] = [];
    if (multiple && chosen.length > files.length) {
      problems.push(
        files.length === 0
          ? 'No more files can be added.'
          : `Only ${files.length} more could be added; the rest were left out.`,
      );
    }

    setBusy(true);
    try {
      for (const file of files) {
        const problem = await uploadOne(file);
        if (problem) problems.push(files.length > 1 ? `${file.name}: ${problem}` : problem);
      }
    } finally {
      setBusy(false);
      setError(problems.join(' '));
      // Clearing the input matters: without it, choosing the same file twice
      // fires no change event and looks like the button has stopped working.
      if (input.current) input.current.value = '';
    }
  }

  /** Uploads one file; the reason it was refused, or null once it is attached. */
  async function uploadOne(file: File): Promise<string | null> {
    const ruled = checkFile?.(file);
    if (ruled) return ruled;
    /*
     * Judged on the extension as well as the reported type, because the type is
     * not always reported. Windows hands over an empty `file.type` for HEIC and
     * for AVIF unless the codec is installed, so a photograph straight off an
     * iPhone looked to this check like something that was not an image at all —
     * which is what "it is not taking all types of images" was describing.
     */
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const looksLikeImage = file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extension);
    const isDocument =
      kind === 'attachment' && (file.type === 'application/pdf' || extension === 'pdf');
    if (!looksLikeImage && !isDocument) {
      return kind === 'attachment'
        ? 'Choose an image or a PDF.'
        : 'Choose an image file: JPEG, PNG, WebP, HEIC and the rest are all fine.';
    }
    if (file.size > 10 * 1024 * 1024) {
      return 'That photo is over 10MB. Choose a smaller one.';
    }

    try {
      /*
       * The size and type go with the request so the storage can hold the
       * upload to them: on S3 both are signed into the upload URL, and a file
       * of any other length is refused there rather than stored and billed.
       * The type is only sent when the browser actually reported one.
       */
      const { data } = await api.post(
        kind === 'attachment' ? '/media/attachment/presign' : '/media/profile-photo/presign',
        {
          filename: file.name,
          size: file.size,
          ...(REPORTED_TYPE.test(file.type) ? { contentType: file.type } : {}),
        },
      );

      // A refusal from storage is reported as a refusal, never as a lost
      // connection: see StorageUploadError.
      await putToStorage(data.uploadUrl, file, data.headers ?? {});

      // The server reads the file back and refuses one that is not what it
      // claimed to be — or, for a profile photograph, one that is AI-generated
      // — before anything is attached to it. Its message is shown as it is.
      await api.post('/media/complete', { key: data.key, ...(purpose ? { purpose } : {}) });

      await onUploaded(data.publicUrl);
      return null;
    } catch (err) {
      return err instanceof StorageUploadError
        ? err.message
        : apiMessage(err, 'That file could not be uploaded.');
    }
  }

  const full = maxFiles !== undefined && maxFiles <= 0;

  return (
    <div>
      <input
        ref={input}
        type="file"
        /*
         * The extensions are listed alongside `image/*` rather than instead of
         * it: the picker on Windows will not offer a HEIC file under `image/*`
         * alone, so the file the person came to upload is greyed out.
         */
        multiple={multiple}
        accept={
          accept ??
          (kind === 'attachment'
            ? `image/*,application/pdf,.pdf,${IMAGE_EXTENSIONS.map((e) => `.${e}`).join(',')}`
            : `image/*,${IMAGE_EXTENSIONS.map((e) => `.${e}`).join(',')}`)
        }
        className="hidden"
        onChange={pick}
        disabled={busy || full}
      />
      <button
        type="button"
        className="btn-outline"
        disabled={busy || full}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Uploading…' : label}
      </button>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
