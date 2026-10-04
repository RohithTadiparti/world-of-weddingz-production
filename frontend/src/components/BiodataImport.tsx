import { ChangeEvent, useRef, useState } from 'react';
import { api, apiMessage } from '../lib/api';
import { readBiodata } from '../lib/biodata-import';

interface BiodataImportProps {
  busy?: boolean;
  onBusy?: (busy: boolean) => void;
  onImported: (fields: Record<string, string>, documentUrl: string, key: string) => Promise<void> | void;
}

function contentTypeFor(file: File): string {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return 'application/pdf';
  if (/\.docx$/i.test(file.name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (/\.xlsx$/i.test(file.name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (/\.xls$/i.test(file.name)) return 'application/vnd.ms-excel';
  if (/\.csv$/i.test(file.name)) return 'text/csv';
  if (/\.png$/i.test(file.name)) return 'image/png';
  return 'image/jpeg';
}

export default function BiodataImport({ busy = false, onBusy, onImported }: BiodataImportProps) {
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    setError('');
    setStatus('Reading biodata document...');
    onBusy?.(true);

    try {
      const fields = await readBiodata(file);
      const contentType = contentTypeFor(file);

      // 2. Upload file to media storage to obtain biodataDocumentUrl
      setStatus('Uploading document...');
      const { data: presign } = await api.post('/media/biodata/presign', {
        filename: file.name,
        size: file.size,
        contentType,
      });

      const uploadRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': contentType,
          ...(presign.headers ?? {}),
        },
      });

      if (!uploadRes.ok) {
        throw new Error(`Upload failed with status ${uploadRes.status}`);
      }

      const { data: completed } = await api.post('/media/complete', { key: presign.key });

      const docUrl = completed.ref;
      setStatus('Preparing extracted fields for review...');
      await onImported(fields, docUrl, presign.key);
      setStatus('');
    } catch (err) {
      setError(err instanceof Error && !('response' in err)
        ? err.message : apiMessage(err, 'Failed to process document. You can still fill in the details manually.'));
    } finally {
      onBusy?.(false);
      setStatus('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="card border-dashed bg-amber-50/30 p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Import a biodata document</h3>
          <p className="text-xs text-gray-500">
            Choose a PDF, Word or Excel file (or a clear image). We fill recognised values into the existing steps and flag the rest for review.
          </p>
        </div>
        <div className="shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.xls,.csv,image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={handleFile}
            disabled={busy}
          />
          <button
            type="button"
            className="btn-outline text-xs py-1.5 px-3"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {busy ? 'Processing…' : 'Choose Biodata File'}
          </button>
        </div>
      </div>

      {status && (
        <div className="mt-2 flex items-center gap-2 text-xs text-brand-dark">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span>{status}</span>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-rose-600 font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
