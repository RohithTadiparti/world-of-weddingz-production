/**
 * Copies the self-hosted OCR runtime into public/ocr before a dev server or a
 * build starts.
 *
 * Biodata import runs Tesseract in the browser. Its worker, core and English
 * language data are served from this origin rather than fetched from a
 * third-party CDN, but they are not committed: they are taken from the
 * packages in node_modules, so the files always match the versions pinned in
 * package-lock.json. The generated public/ocr folder is gitignored.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, 'public', 'ocr');

/** A package's directory, found the way Node would resolve it from here. */
function packageDir(name, from) {
  const paths = from ? [from] : undefined;
  return dirname(require.resolve(`${name}/package.json`, { paths }));
}

const tesseract = packageDir('tesseract.js');
// tesseract.js-core is a dependency of tesseract.js; resolve it from there in
// case it is not hoisted.
const core = packageDir('tesseract.js-core', tesseract);
const eng = packageDir('@tesseract.js-data/eng');

const files = [
  [join(tesseract, 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(core, 'tesseract-core.wasm.js'), join('core', 'tesseract-core.wasm.js')],
  [join(core, 'tesseract-core.wasm'), join('core', 'tesseract-core.wasm')],
  [join(eng, '4.0.0_best_int', 'eng.traineddata.gz'), join('lang', 'eng.traineddata.gz')],
];

for (const [from, to] of files) {
  const dest = join(target, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(from, dest);
}
console.log(`Copied ${files.length} OCR runtime files to public/ocr`);
