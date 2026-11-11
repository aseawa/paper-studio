import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PracticeEngine,
  newPractice,
  totalMs,
  studyReport,
  hitsStroke,
  pdfPoint,
  PRESETS,
  type PaperPage,
  type Stroke,
} from '../src/lib/practice.ts';
import { parseBackup } from '../src/lib/storage.ts';
const page = (i = 0): PaperPage => ({
  kind: 'original',
  sourceIndex: i,
  label: `Paper page ${i + 1}`,
  width: 595,
  height: 842,
  transform: [1, 0, 0, -1, 0, 842],
  strokes: [],
  elapsedMs: 0,
});
const practice = () =>
  newPractice(
    {
      title: 'Test',
      filename: 'test.pdf',
      timerMode: 'countdown',
      presetId: 'math2',
      minutes: 75,
      source: PRESETS.find((p) => p.id === 'math2')!.source,
      format: 'mixed',
      mcCount: 3,
      mcChoices: 4,
      mcStart: 1,
    },
    [page(), page(1)],
  );
const line: Stroke = {
  id: 'a',
  colour: '#1967d2',
  width: 2,
  points: [
    { x: 10, y: 20, p: 0.2 },
    { x: 210, y: 20, p: 0.8 },
  ],
};
test('time accrues to exactly one displayed page, excluding pause and closed time', () => {
  const e = new PracticeEngine(practice());
  e.tick(500);
  assert.equal(totalMs(e.data), 0);
  e.start(1000);
  e.switchPage(1, 3000);
  e.tick(4500);
  e.freeze('manual_freeze', 5000);
  assert.deepEqual(
    e.data.pages.map((p) => p.elapsedMs),
    [2000, 2000],
  );
  e.tick(9000);
  assert.equal(totalMs(e.data), 4000);
  e.start(10000);
  e.tick(11000);
  assert.equal(totalMs(e.data), 5000);
  const restored = new PracticeEngine(e.data);
  restored.tick(900000);
  assert.equal(totalMs(restored.data), 5000);
  assert.equal(restored.data.status, 'frozen');
});
test('freeze blocks ink, erasure, undo, redo, answer changes and added sheets', () => {
  const e = new PracticeEngine(practice());
  e.start(0);
  e.commit({ kind: 'ink', page: 0, before: [], after: [line] });
  e.answer('1', 'C', 1000);
  e.freeze('manual_freeze', 1200);
  const before = structuredClone(e.data);
  assert.equal(e.commit({ kind: 'ink', page: 0, before: [line], after: [] }), false);
  e.answer('1', 'B', 1500);
  e.undo();
  e.redo();
  e.addAnswerPage(2000);
  assert.deepEqual(e.data, before);
});
test('time limit clamps exactly, locks answers and requires explicit overtime', () => {
  const s = practice();
  s.minutes = 1;
  const e = new PracticeEngine(s);
  e.start(0);
  for (let t = 4000; t <= 60000; t += 4000) e.tick(t);
  assert.equal(e.data.status, 'expired');
  assert.equal(totalMs(e.data), 60000);
  e.answer('1', 'A', 60500);
  assert.equal(e.data.answers['1'], undefined);
  e.start(61000);
  assert.equal(e.data.status, 'expired');
  e.start(62000, true);
  e.tick(64000);
  assert.equal(totalMs(e.data), 62000);
  assert.equal(studyReport(e.data).timing.overtimeSeconds, 2);
});
test('device sleep freezes without attributing an uncertain gap', () => {
  const e = new PracticeEngine(practice());
  e.start(0);
  e.tick(2000);
  e.tick(9000);
  assert.equal(totalMs(e.data), 2000);
  assert.equal(e.data.status, 'frozen');
  assert.equal(e.data.events.at(-1)!.type, 'device_or_tab_interrupted');
});
test('undo and redo restore the correct page and MC selection, including clearing', () => {
  const e = new PracticeEngine(practice());
  e.start(0);
  e.commit({ kind: 'ink', page: 0, before: [], after: [line] });
  e.switchPage(1, 1000);
  e.answer('2', 'D', 2000);
  e.answer('2', 'D', 2100);
  assert.equal(e.data.answers['2'], undefined);
  e.undo();
  assert.equal((e.data.answers as Record<string, { choice: string }>)['2'].choice, 'D');
  e.undo();
  assert.equal(e.data.answers['2'], undefined);
  e.undo();
  assert.equal(e.data.currentPage, 0);
  assert.equal(e.data.pages[0].strokes.length, 0);
  e.redo();
  assert.deepEqual(e.data.pages[0].strokes, [line]);
});
test('eraser hits a stroke segment between distant sample points', () => {
  assert.equal(hitsStroke(line, { x: 100, y: 21, p: 0.5 }), true);
  assert.equal(hitsStroke(line, { x: 100, y: 60, p: 0.5 }), false);
});
test('PDF coordinates invert page rotation, crop origin and user-unit scale', () => {
  for (const t of [
    [1, 0, 0, -1, 0, 842],
    [0, 1, 1, 0, -60, -50],
    [-1, 0, 0, 1, 595, 0],
    [0, -1, -1, 0, 842, 595],
    [2, 0, 0, -2, -100, 1684],
  ]) {
    const expected = { x: 123, y: 456 };
    const p = {
      x: t[0] * expected.x + t[2] * expected.y + t[4],
      y: t[1] * expected.x + t[3] * expected.y + t[5],
      p: 0.5,
    };
    assert.deepEqual(pdfPoint(p, t), expected);
  }
});
test('report contains accurate totals, unanswered MC items and overridden duration provenance', () => {
  const s = practice();
  s.minutes = 90;
  const e = new PracticeEngine(s);
  e.start(0);
  e.answer('2', 'D', 2500);
  e.switchPage(1, 3000);
  e.freeze('manual_freeze', 4800);
  const r = studyReport(e.data);
  assert.equal(r.timing.activeSeconds, 4.8);
  assert.equal(
    r.pages.reduce((sum, p) => sum + p.activeSeconds!, 0),
    4.8,
  );
  assert.equal(r.timing.durationOverridden, true);
  assert.equal(r.timing.presetMinutes, 75);
  assert.equal(r.timing.presetYear, 2026);
  assert.deepEqual(r.multipleChoice.unanswered, ['1', '3']);
});
test('editable backup restores as a new frozen copy and rejects invalid ink', () => {
  const s = practice();
  s.pages[0].strokes = [line];
  const raw = { format: 'paper-studio.backup.v2', practice: s, pdfBase64: btoa('%PDF-test') };
  const restored = parseBackup(JSON.stringify(raw));
  assert.notEqual(restored.practice.id, s.id);
  assert.equal(restored.practice.status, 'frozen');
  assert.deepEqual(restored.practice.pages[0].strokes, [line]);
  raw.practice.pages[0].strokes = [{ ...line, width: -3 }];
  assert.throws(() => parseBackup(JSON.stringify(raw)), /invalid handwriting/);
});
