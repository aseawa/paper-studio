import {
  migratePractice,
  limitMs,
  totalMs,
  type Practice,
  type LegacyPractice,
} from './practice.ts';

// Keep the original namespace so existing hosted installations retain their papers.
export const DATABASE_NAME = 'dse-paper-studio-v1';
export const DATABASE_VERSION = 2;
let opening: Promise<IDBDatabase> | undefined;

export function closeDatabase() {
  const pending = opening;
  opening = undefined;
  void pending?.then((database) => database.close()).catch(() => {});
}

export function openDatabase() {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let migrationError: unknown;
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      opening = undefined;
      reject(
        new Error(
          'Close other Paper Studio tabs or windows, then refresh to finish the storage upgrade.',
        ),
      );
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('papers'))
        database.createObjectStore('papers', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('pdfs')) database.createObjectStore('pdfs');
      const transaction = request.transaction!;
      const cursorRequest = transaction.objectStore('papers').openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        try {
          cursor.update(migratePractice(cursor.value as Practice | LegacyPractice));
          cursor.continue();
        } catch (error) {
          migrationError = error;
          transaction.abort();
        }
      };
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        opening = undefined;
        if (typeof window !== 'undefined')
          window.dispatchEvent(new Event('paper-studio-storage-updated'));
      };
      resolve(database);
    };
    request.onerror = () => {
      opening = undefined;
      reject(migrationError || request.error);
    };
  });
  return opening;
}

export async function savePractice(practice: Practice, bytes?: Uint8Array) {
  const copy = structuredClone(practice);
  copy.updatedAt = new Date().toISOString();
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(bytes ? ['papers', 'pdfs'] : ['papers'], 'readwrite');
    transaction.objectStore('papers').put(copy);
    if (bytes) transaction.objectStore('pdfs').put(bytes, practice.id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Save cancelled'));
  });
}

async function read<T>(store: string, id?: string): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const objectStore = database.transaction(store).objectStore(store);
    const request = id === undefined ? objectStore.getAll() : objectStore.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const listPractices = () => read<Practice[]>('papers');
export const readPdf = (id: string) => read<Uint8Array>('pdfs', id);
export const readPractice = (id: string) => read<Practice | undefined>('papers', id);

export function download(bytes: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function safeName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 110) || 'study';
}

export async function backup(practice: Practice, bytes: Uint8Array) {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)]));
  });
  return JSON.stringify({ format: 'paper-studio.backup.v2', practice, pdfBase64: base64 });
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validTimestamp = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export function parseBackup(text: string): { practice: Practice; bytes: Uint8Array } {
  const value: unknown = JSON.parse(text);
  if (
    !record(value) ||
    !['dse-paper-studio.backup.v1', 'paper-studio.backup.v2'].includes(String(value.format)) ||
    typeof value.pdfBase64 !== 'string' ||
    !record(value.practice)
  ) {
    throw new Error('Choose an editable Paper Studio backup (.paperstudio.json or .dse.json).');
  }
  const raw = value.practice;
  const legacy = value.format === 'dse-paper-studio.backup.v1';
  if (raw.schemaVersion !== (legacy ? 1 : 2))
    throw new Error('The backup version does not match its study record.');
  const timerMode = legacy ? 'countdown' : raw.timerMode;
  if (!['stopwatch', 'countdown', 'off'].includes(String(timerMode)))
    throw new Error('This backup has an invalid timer mode.');
  const validLimit =
    timerMode === 'countdown'
      ? finite(raw.minutes) && raw.minutes >= 1 && raw.minutes <= 1440
      : raw.minutes === null;
  if (
    !validLimit ||
    typeof raw.title !== 'string' ||
    !raw.title.trim() ||
    typeof raw.filename !== 'string' ||
    typeof raw.id !== 'string' ||
    !validTimestamp(raw.createdAt) ||
    !validTimestamp(raw.updatedAt) ||
    !(raw.startedAt === null || validTimestamp(raw.startedAt)) ||
    typeof raw.presetId !== 'string' ||
    typeof raw.source !== 'string' ||
    typeof raw.overtimeAllowed !== 'boolean' ||
    !['written', 'mc', 'mixed'].includes(String(raw.format)) ||
    !['ready', 'running', 'frozen', 'expired'].includes(String(raw.status))
  ) {
    throw new Error('This backup has invalid paper settings.');
  }
  if (
    !Array.isArray(raw.pages) ||
    raw.pages.length < 1 ||
    raw.pages.length > 1000 ||
    !Number.isInteger(raw.currentPage) ||
    Number(raw.currentPage) < 0 ||
    Number(raw.currentPage) >= raw.pages.length ||
    !Number.isInteger(raw.mcCount) ||
    Number(raw.mcCount) < 1 ||
    Number(raw.mcCount) > 200 ||
    !Number.isInteger(raw.mcChoices) ||
    Number(raw.mcChoices) < 2 ||
    Number(raw.mcChoices) > 6 ||
    !Number.isInteger(raw.mcStart) ||
    Number(raw.mcStart) < 1 ||
    Number(raw.mcStart) > 999
  ) {
    throw new Error('This backup has invalid page or MC settings.');
  }
  for (const page of raw.pages) {
    if (
      !record(page) ||
      !['original', 'answer'].includes(String(page.kind)) ||
      typeof page.label !== 'string' ||
      page.label.length > 120 ||
      !finite(page.elapsedMs) ||
      page.elapsedMs < 0 ||
      !finite(page.width) ||
      !finite(page.height) ||
      page.width < 1 ||
      page.height < 1 ||
      !Array.isArray(page.transform) ||
      page.transform.length !== 6 ||
      !page.transform.every(finite) ||
      Math.abs(page.transform[0] * page.transform[3] - page.transform[1] * page.transform[2]) <
        0.000001 ||
      !Array.isArray(page.strokes) ||
      (page.kind === 'original'
        ? !Number.isInteger(page.sourceIndex) || Number(page.sourceIndex) < 0
        : page.sourceIndex !== null)
    ) {
      throw new Error('This backup contains an invalid page.');
    }
    for (const stroke of page.strokes) {
      if (
        !record(stroke) ||
        typeof stroke.id !== 'string' ||
        typeof stroke.colour !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(stroke.colour) ||
        !finite(stroke.width) ||
        stroke.width < 0.1 ||
        stroke.width > 30 ||
        !Array.isArray(stroke.points) ||
        stroke.points.length < 1 ||
        !stroke.points.every(
          (point) =>
            record(point) &&
            finite(point.x) &&
            finite(point.y) &&
            finite(point.p) &&
            point.p >= 0 &&
            point.p <= 1,
        )
      ) {
        throw new Error('This backup contains invalid handwriting.');
      }
    }
  }
  if (
    !record(raw.answers) ||
    Object.entries(raw.answers).some(
      ([question, answer]) =>
        !/^\d+$/.test(question) ||
        Number(question) < Number(raw.mcStart) ||
        Number(question) >= Number(raw.mcStart) + Number(raw.mcCount) ||
        !record(answer) ||
        typeof answer.choice !== 'string' ||
        answer.choice.length !== 1 ||
        !'ABCDEF'.slice(0, Number(raw.mcChoices)).includes(answer.choice) ||
        !Number.isInteger(answer.page) ||
        Number(answer.page) < 1 ||
        Number(answer.page) > (raw.pages as unknown[]).length ||
        !(timerMode === 'off'
          ? answer.activeMs === null
          : finite(answer.activeMs) && answer.activeMs >= 0) ||
        !validTimestamp(answer.changedAt),
    )
  ) {
    throw new Error('This backup contains invalid answers.');
  }
  if (!legacy && raw.preset !== null) {
    const preset = raw.preset;
    if (
      !record(preset) ||
      typeof preset.id !== 'string' ||
      typeof preset.label !== 'string' ||
      preset.label.length > 120 ||
      !finite(preset.minutes) ||
      preset.minutes < 1 ||
      preset.minutes > 1440 ||
      typeof preset.source !== 'string' ||
      !['written', 'mc', 'mixed'].includes(String(preset.format)) ||
      !(preset.examSystem === null || typeof preset.examSystem === 'string') ||
      !(preset.year === null || Number.isInteger(preset.year))
    )
      throw new Error('This backup has invalid preset metadata.');
  }
  const practice = migratePractice(raw as unknown as Practice | LegacyPractice);
  practice.id = crypto.randomUUID();
  practice.title = practice.title.slice(0, 160);
  // Undo commands are recreated through editing after importing an external backup.
  practice.undo = [];
  practice.redo = [];
  const limit = limitMs(practice);
  practice.status =
    limit !== null && totalMs(practice) >= limit && !practice.overtimeAllowed
      ? 'expired'
      : 'frozen';
  practice.events = Array.isArray(raw.events)
    ? (raw.events
        .filter(
          (event) =>
            record(event) &&
            typeof event.type === 'string' &&
            event.type.length <= 100 &&
            validTimestamp(event.at) &&
            (timerMode === 'off'
              ? event.activeMs === null
              : finite(event.activeMs) && event.activeMs >= 0),
        )
        .slice(-10000) as Practice['events'])
    : [];
  if (value.pdfBase64.length > 210 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.pdfBase64))
    throw new Error('This backup has invalid PDF data.');
  const bytes = Uint8Array.from(atob(value.pdfBase64), (character) => character.charCodeAt(0));
  if (bytes.byteLength > 150 * 1024 * 1024)
    throw new Error('The PDF in this backup exceeds 150 MB.');
  return { practice, bytes };
}
