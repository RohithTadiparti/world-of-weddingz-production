import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'public', 'images');
const names = [
  'wow-home-hero.png',
  'wow-journey-v2.png',
  'wow-portal-floral.png',
  'wow-portal-hero.png',
  'wow-services-v2.png',
  'wow-wedding-services.png',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
for (const name of names) {
  const source = await readFile(path.join(root, name));
  const dataUrl = `data:image/png;base64,${source.toString('base64')}`;
  const result = await page.evaluate(async ({ dataUrl }) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.82).split(',')[1];
  }, { dataUrl });
  const output = path.join(root, name.replace(/\.png$/i, '.webp'));
  await writeFile(output, Buffer.from(result, 'base64'));
  console.log(`${name} -> ${path.basename(output)}`);
}
await browser.close();
