import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, rgb } from 'pdf-lib';

test('PDF pages render when modern Map insertion methods are unavailable', async () => {
  // Exercise the same asset preparation used by the development and production builds.
  execFileSync(process.execPath, ['scripts/copy-pdf-assets.mjs']);
  const workerUrl = pathToFileURL(resolve('public/pdf/pdf.worker.min.mjs')).href;
  const workerSupport = await new Promise<{ map: string; weakMap: string }>((resolve, reject) => {
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        delete Map.prototype.getOrInsertComputed;
        delete WeakMap.prototype.getOrInsertComputed;
        import(workerData).then(
          () => parentPort.postMessage({
            map: typeof Map.prototype.getOrInsertComputed,
            weakMap: typeof WeakMap.prototype.getOrInsertComputed,
          }),
          (error) => { throw error; },
        );
      `,
      { eval: true, workerData: workerUrl },
    );
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`PDF worker exited with code ${code}.`));
    });
  });
  assert.deepEqual(workerSupport, { map: 'function', weakMap: 'function' });

  const source = await PDFDocument.create();
  source.addPage([100, 100]).drawRectangle({
    x: 20,
    y: 20,
    width: 60,
    height: 60,
    color: rgb(1, 0, 0),
  });
  const bytes = await source.save();

  // PDF.js uses a same-thread worker in Node. Remove the methods again before the
  // app's PDF module loads, so the display-side compatibility path is exercised.
  const workerModule = await import(workerUrl);
  const scope = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
  const previousWorker = scope.pdfjsWorker;
  scope.pdfjsWorker = { WorkerMessageHandler: workerModule.WorkerMessageHandler };
  const originals = [Map.prototype, WeakMap.prototype].map((prototype) => ({
    prototype,
    descriptor: Object.getOwnPropertyDescriptor(prototype, 'getOrInsertComputed'),
  }));
  for (const { prototype } of originals)
    delete (prototype as unknown as { getOrInsertComputed?: unknown }).getOrInsertComputed;

  try {
    const { inspectPdf } = await import('../src/lib/pdf.ts');
    const { pdf, pages } = await inspectPdf(bytes);
    try {
      assert.equal(pages.length, 1);
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(viewport.width, viewport.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
      const pixel = canvas.getContext('2d').getImageData(50, 50, 1, 1).data;
      assert.ok(pixel[0] > 200 && pixel[1] < 50 && pixel[2] < 50);
    } finally {
      await pdf.loadingTask.destroy();
    }
  } finally {
    for (const { prototype, descriptor } of originals) {
      if (descriptor) Object.defineProperty(prototype, 'getOrInsertComputed', descriptor);
      else delete (prototype as unknown as { getOrInsertComputed?: unknown }).getOrInsertComputed;
    }
    if (previousWorker === undefined) delete scope.pdfjsWorker;
    else scope.pdfjsWorker = previousWorker;
  }
});
