import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PracticeEngine,
  newPractice,
  totalMs,
  studyReport,
  migratePractice,
  PRESETS,
  type TimerMode,
  type LegacyPractice,
  type PaperPage,
} from '../src/lib/practice.ts';
import { parseBackup } from '../src/lib/storage.ts';

export function session(mode: TimerMode = 'stopwatch') {
  const pages: PaperPage[] = [0, 1].map((index) => ({
    kind: 'original',
    sourceIndex: index,
    label: `Page ${index + 1}`,
    width: 595,
    height: 842,
    transform: [1, 0, 0, -1, 0, 842],
    strokes: [],
    elapsedMs: 0,
  }));
  return newPractice(
    {
      title: 'Study notes',
      filename: 'notes.pdf',
      timerMode: mode,
      minutes: mode === 'countdown' ? 1 : null,
      presetId: 'custom',
      source: '',
      format: 'mixed',
      mcCount: 3,
      mcChoices: 4,
      mcStart: 1,
    },
    pages,
  );
}

test('stopwatch is the default and continues across pages without expiring', () => {
  const practice = session();
  const engine = new PracticeEngine(practice);
  engine.start(0);
  for (let now = 1000; now <= 65000; now += 1000) engine.tick(now);
  engine.switchPage(1, 66000);
  engine.freeze('manual_freeze', 68000);
  assert.equal(engine.data.timerMode, 'stopwatch');
  assert.equal(engine.data.minutes, null);
  assert.deepEqual(
    engine.data.pages.map((page) => page.elapsedMs),
    [66000, 2000],
  );
  assert.equal(studyReport(engine.data).timing.overtimeSeconds, null);
  engine.start(80000);
  engine.tick(81000);
  assert.equal(totalMs(engine.data), 69000);
});

test('timing off permits editing and exports null timing values', () => {
  const engine = new PracticeEngine(session('off'));
  engine.start(0);
  engine.answer('1', 'A', 3000);
  engine.addAnswerPage(4000);
  engine.freeze('manual_freeze', 5000);
  assert.equal(engine.data.pages.length, 3);
  assert.equal(totalMs(engine.data), 0);
  assert.equal(engine.data.answers['1'].activeMs, null);
  const report = studyReport(engine.data);
  assert.equal(report.timing.activeSeconds, null);
  assert.equal(report.timing.configuredMinutes, null);
  assert.ok(report.pages.every((page) => page.activeSeconds === null));
  assert.ok(report.events.every((event) => event.activeMs === null));
  engine.answer('1', 'B', 6000);
  engine.undo();
  assert.equal(engine.data.answers['1'].choice, 'A');
});

test('legacy records retain ink, times, answers, IDs and undo history as countdown sessions', () => {
  const practice = session('countdown');
  practice.pages[0].elapsedMs = 1450;
  const { timerMode: _mode, preset: _preset, ...fields } = practice;
  const legacy = {
    ...fields,
    schemaVersion: 1,
    minutes: 75,
    presetId: 'math2',
    source: PRESETS.find((preset) => preset.id === 'math2')!.source,
  } as LegacyPractice;
  const migrated = migratePractice(legacy);
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.timerMode, 'countdown');
  assert.equal(migrated.minutes, 75);
  assert.deepEqual(migrated.pages, legacy.pages);
  assert.deepEqual(migrated.undo, legacy.undo);
  assert.equal(migrated.preset?.examSystem, 'HKDSE');
  assert.equal(migrated.preset?.year, 2026);
  assert.equal(legacy.schemaVersion, 1);
});

test('legacy backup import creates a frozen copy with retained study data', () => {
  const { timerMode: _mode, preset: _preset, ...fields } = session('countdown');
  const legacy = { ...fields, schemaVersion: 1, minutes: 60 };
  const parsed = parseBackup(
    JSON.stringify({
      format: 'dse-paper-studio.backup.v1',
      practice: legacy,
      pdfBase64: btoa('%PDF-sample'),
    }),
  );
  assert.equal(parsed.practice.schemaVersion, 2);
  assert.equal(parsed.practice.timerMode, 'countdown');
  assert.equal(parsed.practice.status, 'frozen');
  assert.notEqual(parsed.practice.id, legacy.id);
  assert.equal(parsed.practice.minutes, 60);
});

test('version-two backups round-trip every timing mode', () => {
  for (const mode of ['stopwatch', 'countdown', 'off'] as TimerMode[]) {
    const practice = session(mode);
    const restored = parseBackup(
      JSON.stringify({
        format: 'paper-studio.backup.v2',
        practice,
        pdfBase64: btoa('%PDF-sample'),
      }),
    );
    assert.equal(restored.practice.timerMode, mode);
    assert.equal(restored.practice.minutes, practice.minutes);
    assert.deepEqual(restored.practice.pages, practice.pages);
  }
});

test('a source URL alone does not imply an official examination system or year', () => {
  const { timerMode: _mode, preset: _preset, ...fields } = session('countdown');
  const legacy = {
    ...fields,
    schemaVersion: 1,
    minutes: 60,
    presetId: 'unknown',
    source: 'https://example.com/instructions',
  } as LegacyPractice;
  const report = studyReport(migratePractice(legacy));
  assert.equal(report.timing.examSystem, null);
  assert.equal(report.timing.presetYear, null);
  assert.equal(report.timing.source, legacy.source);
});

test('out-of-range MC selections cannot enter a saved session', () => {
  const engine = new PracticeEngine(session());
  engine.start(0);
  assert.equal(engine.answer('4', 'A', 100), false);
  assert.equal(engine.answer('1', 'E', 200), false);
  assert.deepEqual(engine.data.answers, {});
});
