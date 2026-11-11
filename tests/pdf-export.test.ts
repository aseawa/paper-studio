import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, rgb, PDFDict } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { exportPdf, makeDemo } from '../src/lib/pdf.ts';
import { newPractice, PRESETS, type PaperPage } from '../src/lib/practice.ts';
test('PDF export preserves native, rotated/cropped and scanned pages with ink and a study report', async () => {
  const source = await PDFDocument.create(),
    font = await source.embedFont(StandardFonts.Helvetica);
  const first = source.addPage([595, 842]);
  first.drawText('Original vector text. Blue stroke should appear below this.', {
    x: 40,
    y: 760,
    font,
    size: 13,
  });
  const rotated = source.addPage([595, 842]);
  rotated.setCropBox(50, 60, 450, 640);
  rotated.setRotation(degrees(90));
  rotated.drawText('ROTATED ORIGINAL', { x: 90, y: 110, size: 18, font });
  const canvas = createCanvas(595, 842),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 595, 842);
  ctx.fillStyle = '#333';
  ctx.font = '20px sans-serif';
  ctx.fillText('Scanned page example', 40, 70);
  const png = await source.embedPng(canvas.toBuffer('image/png'));
  source.addPage([595, 842]).drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  const bytes = await source.save();
  const pages: PaperPage[] = [0, 1, 2].map((i) => ({
    kind: 'original',
    sourceIndex: i,
    label: `Paper page ${i + 1}`,
    width: i === 1 ? 640 : 595,
    height: i === 1 ? 450 : 842,
    transform: i === 1 ? [0, 1, 1, 0, -60, -50] : [1, 0, 0, -1, 0, 842],
    elapsedMs: (i + 1) * 34000,
    strokes: [
      {
        id: String(i),
        colour: '#1967d2',
        width: 3,
        points: [
          { x: 40, y: 130, p: 0.3 },
          { x: 230, y: 140, p: 0.8 },
        ],
      },
    ],
  }));
  const s = newPractice(
    {
      title: 'Export verification',
      filename: 'fixture.pdf',
      timerMode: 'countdown',
      presetId: 'math2',
      minutes: 75,
      source: PRESETS.find((p) => p.id === 'math2')!.source,
      format: 'mixed',
      mcCount: 45,
      mcChoices: 4,
      mcStart: 1,
    },
    pages,
  );
  s.answers['1'] = { choice: 'C', page: 1, activeMs: 24000, changedAt: new Date().toISOString() };
  s.status = 'frozen';
  s.pages.push({
    kind: 'answer',
    sourceIndex: null,
    label: 'Answer sheet 1',
    width: 595,
    height: 842,
    transform: [1, 0, 0, -1, 0, 842],
    strokes: pages[0].strokes,
    elapsedMs: 8000,
  });
  const result = await exportPdf(s, bytes),
    read = await PDFDocument.load(result);
  assert.ok(read.getPageCount() >= 6);
  assert.equal(read.getPage(1).getRotation().angle, 90);
  assert.deepEqual(read.getPage(1).getCropBox(), rotated.getCropBox());
  assert.ok(read.catalog.lookupMaybe(read.context.obj('Names'), PDFDict));
  await fs.mkdir('outputs/qa', { recursive: true });
  await fs.writeFile('outputs/qa/export-verification.pdf', result);
  await fs.writeFile('outputs/qa/import-fixture.pdf', bytes);
  await fs.writeFile('outputs/qa/demo.pdf', await makeDemo());
});
