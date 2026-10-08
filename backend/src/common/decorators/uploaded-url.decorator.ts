import { ValidateBy, ValidationOptions, buildMessage, isURL } from 'class-validator';
import { isUploadedMedia } from '../../platform/storage/uploaded-media';
import { isMediaRef } from '../../platform/storage/storage-keys';

/**
 * A URL for something that was uploaded — a photograph, a document, evidence.
 *
 * `@IsUrl({ require_protocol: true })` looks like the obvious choice and is
 * subtly wrong for these fields, because it also requires a top-level domain.
 * The platform's own presign hands back
 * `http://localhost:3000/mock-storage/...` in development, and an internal
 * hostname like `http://minio:9000/...` in a self-hosted deployment — neither
 * has a TLD, so every field that stored an uploaded file refused the URL the
 * platform had just issued for it.
 *
 * It survived because the live suites post literal `https://cdn.example.com/…`
 * strings, which do have a TLD. Nothing ever fed a real presigned URL back into
 * the API the way the browser does, so the whole upload path passed its tests
 * and failed for every user on a deployment whose storage host was not a public
 * domain. The reported symptom — "attaching a photo to a support case does not
 * work" — was this.
 *
 * The protocol is still required, and limited to http(s): that is what stops
 * `javascript:` and a bare path being stored and later rendered.
 *
 * A `media://{key}` reference is accepted as well. On a private store that is
 * what an upload is stored as: the API turns the signed link a client sends
 * back into its reference before validation runs (MediaUrlInterceptor), and
 * signs it again on the way out.
 *
 * A well-formed URL is not enough on its own. It used to be, and
 * `https://evil.example.com/x.jpg` was stored as a profile photograph: a
 * hotlink that never went through presign or any check made on an upload.
 * Only addresses the platform's own storage hands out pass now — the CDN base,
 * the local store's public path, the bucket's own hosts (isUploadedMedia).
 */
export function IsUploadedUrl(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isUploadedUrl',
      validator: {
        validate: (value: unknown) => isUploadedMedia(value),
        defaultMessage: buildMessage((each) => `${each}$property must be a file uploaded here`, options),
      },
    },
    options,
  );
}

/**
 * Shaped like an upload — a `media://` reference or an http(s) URL — without
 * the origin check IsUploadedUrl makes.
 *
 * Only for a field whose service has the stored value in hand and enforces
 * the origin rule there (see platform/storage/kept-media.ts): a form that
 * sends its whole photo list back must be able to resend a photo stored before
 * uploads were enforced, while anything new still has to be an upload. A field
 * with this decorator and no such service check accepts outside links, so do
 * not use it anywhere else.
 */
export function IsMediaUrlShape(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isMediaUrlShape',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          (isMediaRef(value) ||
            isURL(value, { protocols: ['http', 'https'], require_protocol: true, require_tld: false })),
        defaultMessage: buildMessage((each) => `${each}$property must be a file uploaded here`, options),
      },
    },
    options,
  );
}
