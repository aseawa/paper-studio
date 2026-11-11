import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { newPractice, type Practice } from '../src/lib/practice.ts';
import {
  DATABASE_NAME,
  closeDatabase,
  openDatabase,
  readPractice,
  readPdf,
} from '../src/lib/storage.ts';

Object.assign(globalThis, { indexedDB, IDBKeyRange });

async function removeTestDatabase() {
  closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
afterEach(removeTestDatabase);

function sample() {
  return newPractice(
    {
      title: 'Saved study',
      filename: 'saved.pdf',
      timerMode: 'countdown',
      minutes: 60,
      presetId: 'custom',
      source: '',
      format: 'mixed',
      mcCount: 2,
      mcChoices: 4,
      mcStart: 1,
    },
    [
      {
        kind: 'original',
        sourceIndex: 0,
        label: 'Page 1',
        width: 595,
        height: 842,
        transform: [1, 0, 0, -1, 0, 842],
        elapsedMs: 12345,
        strokes: [
          { id: 'stroke', colour: '#202124', width: 1.6, points: [{ x: 30, y: 100, p: 0.5 }] },
        ],
      },
    ],
  );
}

async function seedVersionOne(values: unknown[]) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('papers', { keyPath: 'id' });
      request.result.createObjectStore('pdfs');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['papers', 'pdfs'], 'readwrite');
    for (const value of values) transaction.objectStore('papers').put(value);
    transaction
      .objectStore('pdfs')
      .put(new Uint8Array([37, 80, 68, 70]), (values[0] as Practice).id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  return database;
}

test('database upgrade preserves PDF bytes, ink, times, answers and undo records', async () => {
  const { timerMode: _mode, preset: _preset, ...fields } = sample();
  const legacy = { ...fields, schemaVersion: 1 };
  legacy.answers['1'] = {
    choice: 'C',
    page: 1,
    activeMs: 12000,
    changedAt: new Date().toISOString(),
  };
  legacy.undo.push({ kind: 'ink', page: 0, before: [], after: legacy.pages[0].strokes });
  const oldDatabase = await seedVersionOne([legacy]);
  oldDatabase.close();
  const upgraded = await openDatabase();
  assert.equal(upgraded.version, 2);
  const practice = await readPractice(legacy.id);
  assert.equal(practice?.schemaVersion, 2);
  assert.equal(practice?.timerMode, 'countdown');
  assert.deepEqual(practice?.pages, legacy.pages);
  assert.deepEqual(practice?.answers, legacy.answers);
  assert.deepEqual(practice?.undo, legacy.undo);
  assert.deepEqual(await readPdf(legacy.id), new Uint8Array([37, 80, 68, 70]));
});

test('an older open tab blocks an upgrade with an actionable message', async () => {
  const { timerMode: _mode, preset: _preset, ...fields } = sample();
  const oldDatabase = await seedVersionOne([{ ...fields, schemaVersion: 1 }]);
  await assert.rejects(openDatabase(), /Close other Paper Studio tabs/);
  oldDatabase.close();
  const retry = await openDatabase();
  assert.equal(retry.version, 2);
  assert.equal((await readPractice(fields.id))?.pages[0].elapsedMs, 12345);
});

test('a failed migration rolls back every record and keeps the old database version', async () => {
  const { timerMode: _mode, preset: _preset, ...fields } = sample();
  const legacy = { ...fields, schemaVersion: 1 };
  const invalid = { ...legacy, id: 'unsupported-record', schemaVersion: 999 };
  const oldDatabase = await seedVersionOne([legacy, invalid]);
  oldDatabase.close();
  await assert.rejects(openDatabase(), /unsupported version/);
  // Inspect through a direct v1 open, preserving the aborted upgrade's records.
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const record = await new Promise<Practice>((resolve, reject) => {
    const request = database.transaction('papers').objectStore('papers').get(legacy.id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(record.schemaVersion, 1);
  assert.deepEqual(record.pages, legacy.pages);
  database.close();
});
