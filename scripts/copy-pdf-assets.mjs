import fs from 'node:fs/promises';

await fs.mkdir('public/pdf', { recursive: true });
await fs.copyFile(
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'public/pdf/pdf.worker.min.mjs',
);
await fs.copyFile('node_modules/pdfjs-dist/LICENSE', 'public/pdf/LICENSE');
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await fs.cp(`node_modules/pdfjs-dist/${directory}`, `public/pdf/${directory}`, {
    recursive: true,
  });
}
console.log('PDF worker, CMaps, fonts, WASM and licence copied.');
