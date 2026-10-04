import { deflateSync } from 'zlib';
import { inspectProvenance } from './provenance';
import { HeuristicImageModerationProvider } from './image-moderation.provider';

/*
 * Small synthetic files, built byte by byte the way each format lays them out.
 * None carries pixels worth decoding — the detector never looks at pixels —
 * but every container is walked exactly as a real one would be.
 */

const latin1 = (s: string) => Buffer.from(s, 'latin1');

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function pngChunk(type: string, data: Buffer): Buffer {
  return Buffer.concat([u32be(data.length), latin1(type), data, u32be(0)]);
}

function png(...chunks: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13)),
    ...chunks,
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const tEXt = (keyword: string, text: string) => pngChunk('tEXt', latin1(`${keyword}\0${text}`));

function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

function jpeg(...segments: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, latin1('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...segments,
    // Start of scan, a few bytes of "pixels", end of image.
    jpegSegment(0xda, Buffer.alloc(10)),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0xd9]),
  ]);
}

/** A little-endian TIFF with the given ASCII tags in IFD0 (and optional UserComment in the EXIF IFD). */
function tiff(tags: Record<number, string>, userComment?: Buffer): Buffer {
  const entries = Object.entries(tags).map(([tag, value]) => ({ tag: Number(tag), type: 2, data: latin1(`${value}\0`) }));
  const exifPointer = userComment !== undefined;
  const ifd0Count = entries.length + (exifPointer ? 1 : 0);
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifIfdSize = exifPointer ? 2 + 12 + 4 : 0;
  let dataAt = 8 + ifd0Size + exifIfdSize;

  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
  const ifd0 = Buffer.alloc(ifd0Size);
  const exifIfd = Buffer.alloc(exifIfdSize);
  const blobs: Buffer[] = [];
  ifd0.writeUInt16LE(ifd0Count, 0);
  entries.forEach((e, i) => {
    const at = 2 + i * 12;
    ifd0.writeUInt16LE(e.tag, at);
    ifd0.writeUInt16LE(e.type, at + 2);
    ifd0.writeUInt32LE(e.data.length, at + 4);
    ifd0.writeUInt32LE(dataAt, at + 8);
    blobs.push(e.data);
    dataAt += e.data.length;
  });
  if (exifPointer) {
    const at = 2 + entries.length * 12;
    ifd0.writeUInt16LE(0x8769, at);
    ifd0.writeUInt16LE(4, at + 2);
    ifd0.writeUInt32LE(1, at + 4);
    ifd0.writeUInt32LE(8 + ifd0Size, at + 8);
    exifIfd.writeUInt16LE(1, 0);
    exifIfd.writeUInt16LE(0x9286, 2);
    exifIfd.writeUInt16LE(7, 4);
    exifIfd.writeUInt32LE(userComment.length, 6);
    exifIfd.writeUInt32LE(dataAt, 10);
    blobs.push(userComment);
  }
  return Buffer.concat([head, ifd0, exifIfd, ...blobs]);
}

const exif = (t: Buffer) => jpegSegment(0xe1, Buffer.concat([latin1('Exif\0\0'), t]));

const xmpPacket = (body: string) =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description ${body}/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

const xmpSegment = (body: string) =>
  jpegSegment(0xe1, Buffer.concat([latin1('http://ns.adobe.com/xap/1.0/\0'), Buffer.from(xmpPacket(body), 'utf8')]));

/** A C2PA store in JPEG APP11: JPEG XT header, then a `jumb` superbox labelled `c2pa`. */
function c2paSegment(manifestText: string): Buffer {
  const label = latin1('c2pa\0');
  const jumd = Buffer.concat([u32be(8 + 16 + 1 + label.length), latin1('jumd'), Buffer.alloc(16, 0x11), Buffer.from([0x03]), label]);
  const content = Buffer.from(manifestText, 'utf8');
  const jumb = Buffer.concat([u32be(8 + jumd.length + content.length), latin1('jumb'), jumd, content]);
  return jpegSegment(0xeb, Buffer.concat([latin1('JP'), Buffer.from([0, 1]), u32be(1), jumb]));
}

function webp(...chunks: [string, Buffer][]): Buffer {
  const body = Buffer.concat(
    chunks.map(([type, data]) => {
      const head = Buffer.alloc(8);
      head.write(type, 0, 'latin1');
      head.writeUInt32LE(data.length, 4);
      return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    }),
  );
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
}

const A1111 =
  'portrait photo of a young woman, natural light\nNegative prompt: blurry\n' +
  'Steps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234, Size: 512x768, Model: realisticVision';

describe('inspectProvenance', () => {
  describe('refuses a file that says it was generated', () => {
    it('a PNG with the Stable Diffusion "parameters" text chunk', () => {
      expect(inspectProvenance(png(tEXt('parameters', A1111)))).toMatchObject({ source: 'png:tEXt:parameters' });
    });

    it('a PNG whose parameters are zlib-compressed (zTXt)', () => {
      const data = Buffer.concat([latin1('parameters\0\0'), deflateSync(Buffer.from(A1111))]);
      expect(inspectProvenance(png(pngChunk('zTXt', data)))).toMatchObject({ source: 'png:zTXt:parameters' });
    });

    it('a PNG carrying a ComfyUI prompt graph', () => {
      const graph = JSON.stringify({ 3: { class_type: 'KSampler', inputs: { seed: 1 } } });
      expect(inspectProvenance(png(tEXt('prompt', graph)))).toMatchObject({ source: 'png:tEXt:prompt' });
    });

    it('a PNG with InvokeAI metadata', () => {
      expect(inspectProvenance(png(tEXt('invokeai_metadata', '{"model":"sd-1.5"}')))).not.toBeNull();
    });

    it('a NovelAI PNG: Software names it', () => {
      expect(inspectProvenance(png(tEXt('Software', 'NovelAI'), tEXt('Comment', '{"prompt":"a girl","steps":28}'))))
        .toMatchObject({ marker: expect.stringMatching(/novelai/i) });
    });

    it('a JPEG whose XMP declares DigitalSourceType trainedAlgorithmicMedia', () => {
      const file = jpeg(
        xmpSegment(
          'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
            'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"',
        ),
      );
      expect(inspectProvenance(file)).toMatchObject({ marker: 'DigitalSourceType trainedAlgorithmicMedia' });
    });

    it('a JPEG whose XMP declares a composite with generated parts', () => {
      const file = jpeg(
        xmpSegment(
          'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"',
        ),
      );
      expect(inspectProvenance(file)).toMatchObject({ marker: expect.stringContaining('compositeWithTrainedAlgorithmicMedia') });
    });

    it('a JPEG with EXIF Software "Midjourney"', () => {
      expect(inspectProvenance(jpeg(exif(tiff({ 0x0131: 'Midjourney' }))))).toMatchObject({
        source: 'jpeg:exif:software',
        marker: 'generator Midjourney',
      });
    });

    it('a JPEG whose EXIF UserComment holds Automatic1111 settings (UNICODE)', () => {
      const comment = Buffer.concat([latin1('UNICODE\0'), Buffer.from(A1111, 'utf16le')]);
      expect(inspectProvenance(jpeg(exif(tiff({ 0x010f: 'Unknown' }, comment))))).toMatchObject({
        source: 'jpeg:exif:usercomment',
      });
    });

    it('a JPEG with a C2PA manifest whose action is "created by a trained model"', () => {
      const manifest =
        'c2pa.actions{"action":"c2pa.created","digitalSourceType":' +
        '"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia","softwareAgent":"GPT-4o"}';
      expect(inspectProvenance(jpeg(c2paSegment(manifest)))).toMatchObject({
        source: 'jpeg:c2pa',
        marker: 'digitalSourceType trainedAlgorithmicMedia',
      });
    });

    it('a C2PA manifest whose claim generator is an image generator', () => {
      const manifest = 'c2pa.claim{"claim_generator":"Adobe_Firefly/1.0 c2pa-rs/0.32","c2pa.actions":[{"action":"c2pa.created"}]}';
      expect(inspectProvenance(jpeg(c2paSegment(manifest)))).toMatchObject({ source: 'jpeg:c2pa' });
    });

    it('a WebP whose XMP names the generator as CreatorTool', () => {
      const file = webp(['VP8 ', Buffer.alloc(10)], ['XMP ', Buffer.from(xmpPacket('xmp:CreatorTool="DALL·E 3"'), 'utf8')]);
      expect(inspectProvenance(file)).toMatchObject({ source: 'webp:xmp' });
    });

    it('any container with an embedded XMP packet (found by scanning)', () => {
      const heicLike = Buffer.concat([
        latin1('\0\0\0\x18ftypheic\0\0\0\0mif1heic'),
        Buffer.from(xmpPacket('photoshop:Credit="Made with Google AI" Iptc4xmpExt:DigitalSourceType="trainedAlgorithmicMedia"')),
      ]);
      expect(inspectProvenance(heicLike)).not.toBeNull();
    });
  });

  describe('lets a photograph through', () => {
    it('a clean camera JPEG with ordinary EXIF and editor XMP', () => {
      const file = jpeg(
        exif(tiff({ 0x010f: 'Canon', 0x0110: 'Canon EOS R6', 0x0131: 'Adobe Photoshop Lightroom Classic 13.0' })),
        xmpSegment(
          'xmp:CreatorTool="Adobe Photoshop Lightroom Classic 13.0" ' +
            'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"',
        ),
      );
      expect(inspectProvenance(file)).toBeNull();
    });

    it('a phone JPEG with a C2PA manifest from the camera', () => {
      const manifest =
        'c2pa.actions{"action":"c2pa.created","digitalSourceType":' +
        '"http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture","softwareAgent":"Leica M11-P"}';
      expect(inspectProvenance(jpeg(exif(tiff({ 0x010f: 'Leica' })), c2paSegment(manifest)))).toBeNull();
    });

    it('a clean PNG with ordinary text chunks', () => {
      expect(
        inspectProvenance(png(tEXt('Software', 'GIMP 2.10.36'), tEXt('Comment', 'Holiday in Goa'), tEXt('Title', 'prompt'))),
      ).toBeNull();
    });

    it('a PNG whose "parameters" chunk is not a generator settings line', () => {
      expect(inspectProvenance(png(tEXt('parameters', 'exposure=+0.3')))).toBeNull();
    });

    it('a plain WebP', () => {
      expect(inspectProvenance(webp(['VP8 ', Buffer.alloc(30)]))).toBeNull();
    });

    it('truncated or garbage input, without throwing', () => {
      expect(inspectProvenance(Buffer.alloc(0))).toBeNull();
      expect(inspectProvenance(jpeg(exif(tiff({ 0x0131: 'Canon' }))).subarray(0, 30))).toBeNull();
      const broken = png(tEXt('Software', 'GIMP'));
      broken.writeUInt32BE(0xffffffff, 8); // IHDR claims to be 4 GB long
      expect(inspectProvenance(broken)).toBeNull();
      expect(inspectProvenance(Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)))).toBeNull();
    });
  });
});

describe('HeuristicImageModerationProvider', () => {
  const provider = new HeuristicImageModerationProvider();

  it('refuses on the file contents even when the name is innocent', async () => {
    await expect(provider.check('media://users/u1/profile/1-a-IMG_2041.png', png(tEXt('parameters', A1111))))
      .resolves.toMatchObject({ allowed: false, reason: 'This looks like an AI-generated image.' });
  });

  it('still refuses on the name when there are no contents to read', async () => {
    await expect(provider.check('https://cdn.example/midjourney_portrait.png')).resolves.toMatchObject({ allowed: false });
  });

  it('allows a clean file with a clean name', async () => {
    await expect(provider.check('media://users/u1/profile/1-a-me.jpg', jpeg(exif(tiff({ 0x010f: 'Apple' })))))
      .resolves.toEqual({ allowed: true, reason: null, syntheticScore: null });
  });
});
