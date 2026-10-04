import { inflateSync } from 'zlib';

/**
 * What a file says about where it came from.
 *
 * Generators label their output, and most of them do it in the file rather
 * than in its name: Stable Diffusion front-ends write the prompt into a PNG
 * text chunk, ComfyUI writes its whole node graph, OpenAI, Adobe and Google
 * sign a C2PA manifest whose actions say "created by a trained model", and the
 * IPTC vocabulary that every photo tool reads has a value for exactly this
 * (`DigitalSourceType = trainedAlgorithmicMedia`). A file saved straight out of
 * a tool — which is what most people upload — still carries all of it.
 *
 * What this cannot do, and is not pretending to: a screenshot, a re-save
 * through an editor that drops metadata, or a messaging app's re-encode strips
 * every one of these markers and leaves only pixels. Catching those needs a
 * classifier that looks at the image itself, which is the hosted provider's job
 * (IMAGE_MODERATION_PROVIDER=hosted). This is the part that is free, instant,
 * has no false positives worth the name, and runs whichever provider is set.
 *
 * Plain Buffer walking, on purpose: the first few megabytes of a file are
 * untrusted input, and a parser that only ever reads lengths it has bounds-
 * checked is a smaller thing to trust than an EXIF library.
 */
export interface ProvenanceFinding {
  /** Where the marker was found, for the audit log — e.g. `png:tEXt:parameters`. */
  source: string;
  /** What it said, shortened. */
  marker: string;
}

/** How much of a file is read for its metadata. Every format here keeps it near the front. */
export const PROVENANCE_READ_BYTES = 4 * 1024 * 1024;

/**
 * IPTC's word for "made by a model". The composite form is a real photograph
 * with generated parts — a face swapped in, a background invented — which on a
 * profile is the same problem. Plain `algorithmicMedia` (a fractal, a chart)
 * is not a claim about a person and is not matched.
 */
const SYNTHETIC_SOURCE = /(?:digitalsourcetype\/)?(compositeWithTrainedAlgorithmicMedia|trainedAlgorithmicMedia)\b/i;

/**
 * Tools that only make images, named the way they sign their output (EXIF
 * Software/Make/Artist, XMP CreatorTool, a C2PA claim generator).
 *
 * Only ever matched against metadata fields, never against pixel data — a
 * four-letter name turns up by chance in a few megabytes of compressed bytes.
 * Ambiguous words are anchored to their vendor ("Imagen" is Spanish for
 * "image"; "Firefly" alone is a phone feature).
 */
const GENERATOR_NAME = new RegExp(
  [
    'midjourney',
    'dall[\\s·._-]?e',
    'openai',
    'chatgpt',
    'gpt-4o',
    'stable[\\s_-]?diffusion',
    '\\bsdxl\\b',
    'automatic1111',
    'comfyui',
    'invokeai',
    'fooocus',
    'dreamstudio',
    'adobe[\\s_]firefly',
    'firefly[\\s_]image',
    'google[\\s_]imagen',
    '\\bimagen\\s?[234]\\b',
    'imagefx',
    '\\bgemini\\b',
    'leonardo[\\s.]?ai',
    'novelai',
    'ideogram',
    'flux\\.1',
    '\\bflux[\\s_-](?:dev|pro|schnell)\\b',
    'black forest labs',
    'runwayml',
    'runway[\\s_](?:gen|ml|ai)',
    'bing image creator',
    'copilot designer',
    'microsoft designer',
    'canva[\\s_]ai',
    'magic media',
    'nightcafe',
    'artbreeder',
    'craiyon',
    'playground[\\s_]?ai',
    'starryai',
    'wombo',
    'gencraft',
    'thispersondoesnotexist',
    'generated\\.photos',
    'krea\\.ai',
  ].join('|'),
  'i',
);

/** The settings line Automatic1111 and its forks write after every prompt. */
const SD_PARAMETERS = /\b(?:steps:\s*\d+|sampler:\s*\w|cfg scale:\s*[\d.]+|negative prompt:)/i;

/**
 * PNG text keywords that only image generators write.
 *
 * `parameters` (Automatic1111, Forge, SD.Next) is checked for its settings
 * line rather than trusted by name; the rest are unique to their tool.
 */
const PNG_GENERATOR_KEYWORDS: Record<string, (text: string) => boolean> = {
  parameters: (t) => SD_PARAMETERS.test(t),
  // ComfyUI: the prompt graph and the workflow, both JSON.
  prompt: (t) => /^\s*[[{]/.test(t),
  workflow: (t) => /^\s*[[{]/.test(t),
  dream: () => true, // InvokeAI before 2.0
  'sd-metadata': () => true, // InvokeAI 2.x
  invokeai_metadata: () => true,
  invokeai_graph: () => true,
  'generation_data': () => true, // Civitai / TensorArt
  negative_prompt: () => true,
};

interface MetadataText {
  source: string;
  text: string;
}

/** What one walk of a container turned up, judged together afterwards. */
interface Collected {
  /** Ordinary metadata fields: EXIF, XMP, PNG text, comments. */
  texts: MetadataText[];
  /** C2PA manifest stores. */
  manifests: MetadataText[];
  /** Markers that are conclusive on their own, such as a generator's PNG keyword. */
  findings: ProvenanceFinding[];
}

/**
 * The first generator marker in the file, or null when it carries none.
 *
 * Null is "no label found", not "genuine": see the note at the top.
 */
export function inspectProvenance(buf: Buffer): ProvenanceFinding | null {
  if (!buf || buf.length < 8) return null;

  const c: Collected = { texts: [], manifests: [], findings: [] };
  const { texts, manifests } = c;

  try {
    if (isPng(buf)) readPng(buf, c);
    else if (isJpeg(buf)) readJpeg(buf, c);
    else if (isWebp(buf)) readWebp(buf, c);
  } catch {
    // A truncated or malformed container is not evidence either way; whatever
    // was collected before the parser gave up is still judged below.
  }

  // Containers this does not walk (HEIC, AVIF, TIFF) and anything the walk
  // missed: an XMP packet is delimited text wherever it sits, and a C2PA
  // store is a JUMBF box labelled `c2pa`. Both are long, specific byte
  // sequences, so finding them by scanning does not risk a chance match.
  const raw = buf.toString('latin1');
  for (const xmp of xmpPackets(raw)) texts.push({ source: 'xmp', text: xmp });
  const c2pa = c2paRegion(buf);
  if (c2pa) manifests.push({ source: 'c2pa', text: c2pa });

  if (c.findings.length) return c.findings[0];

  for (const m of manifests) {
    const source = SYNTHETIC_SOURCE.exec(m.text);
    if (source) return { source: m.source, marker: `digitalSourceType ${source[1]}` };
    const name = GENERATOR_NAME.exec(m.text);
    if (name) return { source: m.source, marker: `generator ${name[0]}` };
  }

  for (const t of texts) {
    if (/DigitalSourceType/i.test(t.text)) {
      const source = SYNTHETIC_SOURCE.exec(t.text);
      if (source) return { source: t.source, marker: `DigitalSourceType ${source[1]}` };
    }
    const name = GENERATOR_NAME.exec(t.text);
    if (name) return { source: t.source, marker: `generator ${name[0]}` };
    // A1111 writes the same settings into a JPEG's UserComment or a comment
    // segment; both lines together are its signature, not a coincidence.
    if (/\bsteps:\s*\d+/i.test(t.text) && /\bsampler:/i.test(t.text)) {
      return { source: t.source, marker: 'Stable Diffusion generation parameters' };
    }
    // NovelAI: Software "NovelAI" is caught above; its Comment is the prompt as JSON.
    if (/:comment$/i.test(t.source) && /"(?:prompt|uc|sampler|steps)"\s*:/.test(t.text)) {
      return { source: t.source, marker: 'generation settings in comment' };
    }
  }

  return null;
}

// ------------------------------------------------------------------- PNG

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a;
}

function readPng(buf: Buffer, { texts, manifests, findings }: Collected): void {
  let at = 8;
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const start = at + 8;
    const end = start + length;
    if (end > buf.length) break;
    const data = buf.subarray(start, end);

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const entry = pngText(type, data);
      if (entry) {
        const keyword = entry.keyword.toLowerCase();
        const rule = PNG_GENERATOR_KEYWORDS[keyword];
        if (rule && rule(entry.text)) {
          findings.push({ source: `png:${type}:${entry.keyword}`, marker: `generator text chunk "${entry.keyword}"` });
        }
        texts.push({ source: `png:${type}:${keyword}`, text: entry.text });
      }
    } else if (type === 'eXIf') {
      for (const t of tiffStrings(data)) texts.push({ source: `png:eXIf:${t.source}`, text: t.text });
    } else if (type === 'caBX') {
      // C2PA's PNG chunk: the JUMBF store, verbatim.
      manifests.push({ source: 'png:caBX', text: data.toString('latin1') });
    } else if (type === 'IEND') {
      break;
    }
    at = end + 4; // CRC
  }
}

function pngText(type: string, data: Buffer): { keyword: string; text: string } | null {
  const nul = data.indexOf(0);
  if (nul <= 0 || nul > 79) return null;
  const keyword = data.toString('latin1', 0, nul);
  if (type === 'tEXt') return { keyword, text: data.toString('latin1', nul + 1) };
  if (type === 'zTXt') {
    // nul, compression method (always 0 = zlib), compressed text.
    return { keyword, text: inflateSafe(data.subarray(nul + 2)).toString('latin1') };
  }
  // iTXt: nul, compression flag, method, language\0, translated keyword\0, text.
  const compressed = data[nul + 1] === 1;
  const langEnd = data.indexOf(0, nul + 3);
  if (langEnd < 0) return null;
  const transEnd = data.indexOf(0, langEnd + 1);
  if (transEnd < 0) return null;
  const body = data.subarray(transEnd + 1);
  return { keyword, text: (compressed ? inflateSafe(body) : body).toString('utf8') };
}

/**
 * Decompresses a text chunk, capped. A zTXt chunk is a few kilobytes of
 * prompt; a zlib bomb dressed as one is not inflated past a megabyte.
 */
function inflateSafe(data: Buffer): Buffer {
  try {
    return inflateSync(data, { maxOutputLength: 1024 * 1024 });
  } catch {
    return Buffer.alloc(0);
  }
}

// ------------------------------------------------------------------- JPEG

function isJpeg(buf: Buffer): boolean {
  return buf[0] === 0xff && buf[1] === 0xd8;
}

const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXT_NS = 'http://ns.adobe.com/xmp/extension/\0';

function readJpeg(buf: Buffer, { texts, manifests }: Collected): void {
  let at = 2;
  const jumbf: Buffer[] = [];
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) break;
    const marker = buf[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    // Start of scan: everything after is pixels. End of image: done.
    if (marker === 0xda || marker === 0xd9) break;

    const length = buf.readUInt16BE(at + 2);
    const start = at + 4;
    const end = at + 2 + length;
    if (length < 2 || end > buf.length) break;
    const data = buf.subarray(start, end);

    if (marker === 0xe1) {
      if (data.toString('latin1', 0, 6) === 'Exif\0\0') {
        for (const t of tiffStrings(data.subarray(6))) texts.push({ source: `jpeg:exif:${t.source}`, text: t.text });
      } else if (data.toString('latin1', 0, XMP_NS.length) === XMP_NS) {
        texts.push({ source: 'jpeg:xmp', text: data.toString('utf8', XMP_NS.length) });
      } else if (data.toString('latin1', 0, XMP_EXT_NS.length) === XMP_EXT_NS) {
        // GUID (32) + full length (4) + offset (4), then a slice of the packet.
        texts.push({ source: 'jpeg:xmp-extended', text: data.toString('utf8', XMP_EXT_NS.length + 40) });
      }
    } else if (marker === 0xeb) {
      // APP11: JPEG XT boxes, which is where C2PA puts its JUMBF store.
      // "JP" + instance (2) + sequence (4), then the box bytes.
      if (data[0] === 0x4a && data[1] === 0x50) jumbf.push(data.subarray(8));
    } else if (marker === 0xfe) {
      texts.push({ source: 'jpeg:comment', text: data.toString('latin1') });
    }
    at = end;
  }
  if (jumbf.length) {
    const store = Buffer.concat(jumbf).toString('latin1');
    if (/c2pa/i.test(store)) manifests.push({ source: 'jpeg:c2pa', text: store });
  }
}

// ------------------------------------------------------------------- WebP

function isWebp(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
}

function readWebp(buf: Buffer, { texts, manifests }: Collected): void {
  let at = 12;
  while (at + 8 <= buf.length) {
    const type = buf.toString('latin1', at, at + 4);
    const length = buf.readUInt32LE(at + 4);
    const start = at + 8;
    const end = start + length;
    if (end > buf.length) break;
    const data = buf.subarray(start, end);
    if (type === 'XMP ') texts.push({ source: 'webp:xmp', text: data.toString('utf8') });
    else if (type === 'EXIF') {
      const tiff = data.toString('latin1', 0, 6) === 'Exif\0\0' ? data.subarray(6) : data;
      for (const t of tiffStrings(tiff)) texts.push({ source: `webp:exif:${t.source}`, text: t.text });
    } else if (type === 'C2PA') {
      manifests.push({ source: 'webp:c2pa', text: data.toString('latin1') });
    }
    at = end + (length % 2); // chunks are padded to an even length
  }
}

// ------------------------------------------------------------- EXIF (TIFF)

/** The EXIF fields a tool signs its name into, by tag. */
const TIFF_TAGS: Record<number, string> = {
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x013b: 'Artist',
  0x9286: 'UserComment',
  0xa430: 'CameraOwnerName',
  0x9c9c: 'XPComment',
};
const EXIF_IFD_POINTER = 0x8769;

/**
 * The text fields of IFD0 and the EXIF sub-IFD.
 *
 * Every offset is checked against the buffer before it is read, and the walk
 * visits at most two directories, so a hostile file can neither read past the
 * end nor send this round a loop.
 */
function tiffStrings(tiff: Buffer): MetadataText[] {
  const out: MetadataText[] = [];
  if (tiff.length < 8) return out;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return out;
  const le = order === 'II';
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));

  const readIfd = (offset: number, followExif: boolean) => {
    if (offset < 8 || offset + 2 > tiff.length) return;
    const count = Math.min(u16(offset), 512);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > tiff.length) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      if (tag === EXIF_IFD_POINTER && followExif) {
        readIfd(u32(entry + 8), false);
        continue;
      }
      const name = TIFF_TAGS[tag];
      // ASCII (2), BYTE (1, used by the XP* tags) or UNDEFINED (7).
      if (!name || (type !== 2 && type !== 1 && type !== 7) || n === 0) continue;
      const at = n <= 4 ? entry + 8 : u32(entry + 8);
      const len = Math.min(n, 64 * 1024);
      if (at + len > tiff.length) continue;
      out.push({ source: name.toLowerCase(), text: decodeExifText(tiff.subarray(at, at + len), tag) });
    }
  };

  readIfd(u32(4), true);
  return out;
}

function decodeExifText(bytes: Buffer, tag: number): string {
  // UserComment: an 8-byte charset code, then the text. A1111 writes UNICODE.
  if (tag === 0x9286 && bytes.length >= 8) {
    const code = bytes.toString('latin1', 0, 8);
    const body = bytes.subarray(8);
    if (code.startsWith('UNICODE')) return utf16(body);
    return body.toString('utf8');
  }
  if (tag === 0x9c9c) return utf16(bytes, true);
  return bytes.toString('latin1').replace(/\0+$/, '');
}

/** UTF-16 of unknown byte order, decoded leniently: only the letters matter. */
function utf16(bytes: Buffer, littleEndian?: boolean): string {
  const le = littleEndian ?? (bytes.length >= 2 && bytes[0] !== 0 && bytes[1] === 0);
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode(le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
  }
  return s.replace(/\0/g, '');
}

// ------------------------------------------------------------ XMP & C2PA

/** Every XMP packet in the bytes, wherever the container put it. */
function xmpPackets(raw: string): string[] {
  const out: string[] = [];
  let from = 0;
  while (out.length < 8) {
    const start = raw.indexOf('<x:xmpmeta', from);
    if (start < 0) break;
    const close = raw.indexOf('</x:xmpmeta>', start);
    const end = close < 0 ? Math.min(raw.length, start + 256 * 1024) : close + 12;
    out.push(Buffer.from(raw.slice(start, end), 'latin1').toString('utf8'));
    from = end;
  }
  return out;
}

/**
 * The C2PA manifest store, found by its JUMBF description box: `jumd`, a
 * 16-byte type UUID, a toggles byte, then the label `c2pa`. Returned as text
 * so its assertions — stored as CBOR, whose strings are plain UTF-8 — can be
 * read without a CBOR decoder.
 */
function c2paRegion(buf: Buffer): string | null {
  let from = 0;
  while (from < buf.length) {
    const jumd = buf.indexOf('jumd', from, 'latin1');
    if (jumd < 0) return null;
    const label = buf.toString('latin1', jumd + 4 + 16 + 1, jumd + 4 + 16 + 1 + 4);
    if (label === 'c2pa') {
      return buf.toString('latin1', Math.max(0, jumd - 8), Math.min(buf.length, jumd + 512 * 1024));
    }
    from = jumd + 4;
  }
  return null;
}
