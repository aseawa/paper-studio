import { PRESETS, type Preset, type QuestionFormat } from './presets.ts';
export { PRESETS } from './presets.ts';

export type TimerMode = 'stopwatch' | 'countdown' | 'off';
export type Point = { x: number; y: number; p: number };
export type Stroke = { id: string; colour: string; width: number; points: Point[] };
export type PaperPage = {
  kind: 'original' | 'answer';
  sourceIndex: number | null;
  label: string;
  width: number;
  height: number;
  transform: number[];
  strokes: Stroke[];
  elapsedMs: number;
};
export type Answer = { choice: string; page: number; activeMs: number | null; changedAt: string };
export type Edit =
  | { kind: 'ink'; page: number; before: Stroke[]; after: Stroke[] }
  | { kind: 'answer'; question: string; before?: Answer; after?: Answer };
export type Practice = {
  schemaVersion: 2;
  id: string;
  title: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  timerMode: TimerMode;
  minutes: number | null;
  presetId: string;
  source: string;
  preset: Preset | null;
  format: QuestionFormat;
  mcCount: number;
  mcChoices: number;
  mcStart: number;
  currentPage: number;
  pages: PaperPage[];
  answers: Record<string, Answer>;
  status: 'ready' | 'running' | 'frozen' | 'expired';
  overtimeAllowed: boolean;
  events: { at: string; type: string; activeMs: number | null }[];
  undo: Edit[];
  redo: Edit[];
};
export type LegacyPractice = Omit<
  Practice,
  'schemaVersion' | 'timerMode' | 'preset' | 'minutes'
> & {
  schemaVersion: 1;
  minutes: number;
};
type PracticeConfig = Pick<
  Practice,
  'title' | 'filename' | 'presetId' | 'source' | 'format' | 'mcCount' | 'mcChoices' | 'mcStart'
> & {
  timerMode?: TimerMode;
  minutes: number | null;
};

export const totalMs = (practice: Practice) =>
  practice.pages.reduce((sum, page) => sum + page.elapsedMs, 0);
export const limitMs = (practice: Practice) =>
  practice.timerMode === 'countdown' && practice.minutes !== null ? practice.minutes * 60000 : null;

export function timeLabel(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  return `${hours ? `${hours}:` : ''}${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function presetSnapshot(id: string, source: string) {
  const preset = PRESETS.find((candidate) => candidate.id === id && candidate.source === source);
  return preset && preset.id !== 'custom' ? structuredClone(preset) : null;
}

export function migratePractice(value: Practice | LegacyPractice): Practice {
  if (value.schemaVersion === 2) return structuredClone(value);
  if (value.schemaVersion !== 1)
    throw new Error('This study record was created by an unsupported version.');
  return {
    ...structuredClone(value),
    schemaVersion: 2,
    timerMode: 'countdown',
    preset: presetSnapshot(value.presetId, value.source),
  };
}

export function newPractice(config: PracticeConfig, pages: PaperPage[]): Practice {
  const timerMode = config.timerMode || 'stopwatch';
  const presetId = timerMode === 'countdown' ? config.presetId : 'custom';
  const source = timerMode === 'countdown' ? config.source : '';
  const now = new Date().toISOString();
  return {
    ...config,
    schemaVersion: 2,
    timerMode,
    minutes: timerMode === 'countdown' ? config.minutes : null,
    presetId,
    source,
    preset: presetSnapshot(presetId, source),
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    currentPage: 0,
    pages,
    answers: {},
    status: 'ready',
    overtimeAllowed: false,
    events: [],
    undo: [],
    redo: [],
  };
}

export class PracticeEngine {
  data: Practice;
  lastNow: number | null = null;

  constructor(data: Practice | LegacyPractice) {
    this.data = migratePractice(data);
    if (this.data.status === 'running') {
      this.data.status = 'frozen';
      this.event('reopened_frozen');
    }
  }

  event(type: string) {
    this.data.events.push({
      at: new Date().toISOString(),
      type,
      activeMs: this.data.timerMode === 'off' ? null : totalMs(this.data),
    });
  }

  tick(now: number) {
    if (this.data.status !== 'running') {
      this.lastNow = null;
      return;
    }
    const delta = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    if (delta > 5000) {
      this.freeze('device_or_tab_interrupted');
      return;
    }
    if (this.data.timerMode === 'off') return;

    const limit = limitMs(this.data);
    const remaining = limit === null ? Infinity : Math.max(0, limit - totalMs(this.data));
    this.data.pages[this.data.currentPage].elapsedMs += this.data.overtimeAllowed
      ? delta
      : Math.min(delta, remaining);
    if (limit !== null && !this.data.overtimeAllowed && totalMs(this.data) >= limit) {
      this.data.status = 'expired';
      this.lastNow = null;
      this.event('time_limit_reached');
    }
  }

  start(now: number, overtime = false) {
    if (this.data.status === 'running') return;
    const limit = limitMs(this.data);
    if (limit !== null && totalMs(this.data) >= limit && !this.data.overtimeAllowed && !overtime)
      return;
    if (overtime && limit !== null) {
      this.data.overtimeAllowed = true;
      this.event('overtime_started');
    }
    this.data.startedAt ||= new Date().toISOString();
    this.event(this.data.status === 'ready' ? 'started' : 'resumed');
    this.data.status = 'running';
    this.lastNow = now;
  }

  freeze(reason = 'manual_freeze', now?: number) {
    if (now !== undefined) this.tick(now);
    if (this.data.status === 'running') {
      this.data.status = 'frozen';
      this.event(reason);
    }
    this.lastNow = null;
  }

  switchPage(index: number, now: number) {
    this.tick(now);
    if (Number.isInteger(index) && index >= 0 && index < this.data.pages.length)
      this.data.currentPage = index;
  }

  commit(edit: Edit) {
    if (this.data.status !== 'running') return false;
    this.apply(edit, true);
    this.data.undo.push(edit);
    if (this.data.undo.length > 100) this.data.undo.shift();
    this.data.redo = [];
    return true;
  }

  apply(edit: Edit, forward: boolean) {
    if (edit.kind === 'ink') {
      this.data.pages[edit.page].strokes = forward ? edit.after : edit.before;
      return;
    }
    const answer = forward ? edit.after : edit.before;
    if (answer) this.data.answers[edit.question] = answer;
    else delete this.data.answers[edit.question];
  }

  undo() {
    if (this.data.status !== 'running') return;
    const edit = this.data.undo.pop();
    if (!edit) return;
    this.apply(edit, false);
    this.data.redo.push(edit);
    if (edit.kind === 'ink') this.data.currentPage = edit.page;
  }

  redo() {
    if (this.data.status !== 'running') return;
    const edit = this.data.redo.pop();
    if (!edit) return;
    this.apply(edit, true);
    this.data.undo.push(edit);
    if (edit.kind === 'ink') this.data.currentPage = edit.page;
  }

  answer(question: string, choice: string, now: number) {
    this.tick(now);
    const number = Number(question);
    if (
      this.data.format === 'written' ||
      !Number.isInteger(number) ||
      number < this.data.mcStart ||
      number >= this.data.mcStart + this.data.mcCount ||
      choice.length !== 1 ||
      !'ABCDEF'.slice(0, this.data.mcChoices).includes(choice)
    )
      return false;
    const before = this.data.answers[question];
    const after =
      before?.choice === choice
        ? undefined
        : {
            choice,
            page: this.data.currentPage + 1,
            activeMs: this.data.timerMode === 'off' ? null : totalMs(this.data),
            changedAt: new Date().toISOString(),
          };
    return this.commit({ kind: 'answer', question, before, after });
  }

  addAnswerPage(now: number) {
    this.tick(now);
    if (this.data.status !== 'running' || this.data.pages.length >= 1000) return;
    const number = this.data.pages.filter((page) => page.kind === 'answer').length + 1;
    this.data.pages.push({
      kind: 'answer',
      sourceIndex: null,
      label: `Answer sheet ${number}`,
      width: 595.28,
      height: 841.89,
      transform: [1, 0, 0, -1, 0, 841.89],
      strokes: [],
      elapsedMs: 0,
    });
    this.data.currentPage = this.data.pages.length - 1;
  }
}

export function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const position = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(point.x - start.x - position * dx, point.y - start.y - position * dy);
}

export function hitsStroke(stroke: Stroke, point: Point, radius = 9) {
  return stroke.points.some(
    (sample, index) =>
      segmentDistance(point, sample, stroke.points[Math.max(0, index - 1)]) <=
      radius + stroke.width / 2,
  );
}

export function pdfPoint(point: Point, transform: number[]) {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  return {
    x: (d * (point.x - e) - c * (point.y - f)) / determinant,
    y: (-b * (point.x - e) + a * (point.y - f)) / determinant,
  };
}

export function studyReport(practice: Practice) {
  const limit = limitMs(practice);
  const recording = practice.timerMode !== 'off';
  return {
    schema: 'paper-studio.study-report.v2',
    paper: practice.title,
    filename: practice.filename,
    exportedAt: new Date().toISOString(),
    startedAt: practice.startedAt,
    status: practice.status,
    timing: {
      mode: practice.timerMode,
      preset: practice.preset?.label || null,
      examSystem: practice.preset?.examSystem || null,
      presetYear: practice.preset?.year || null,
      source: practice.source || null,
      presetMinutes: practice.preset?.minutes ?? null,
      configuredMinutes: practice.minutes,
      durationOverridden: !!practice.preset && practice.minutes !== practice.preset.minutes,
      activeSeconds: recording ? totalMs(practice) / 1000 : null,
      overtimeSeconds: limit === null ? null : Math.max(0, totalMs(practice) - limit) / 1000,
      method: recording
        ? 'Only the displayed page accrues time while running. Frozen, hidden-tab and closed-app time is excluded. A gap over five seconds freezes the session and excludes that uncertain interval.'
        : 'Timing was disabled for this session.',
    },
    pages: practice.pages.map((page, index) => ({
      page: index + 1,
      label: page.label,
      kind: page.kind,
      originalPage: page.sourceIndex === null ? null : page.sourceIndex + 1,
      activeSeconds: recording ? page.elapsedMs / 1000 : null,
      inkStrokes: page.strokes.length,
    })),
    multipleChoice: {
      firstQuestion: practice.mcStart,
      questionCount: practice.format === 'written' ? 0 : practice.mcCount,
      choices: 'ABCDEF'.slice(0, practice.mcChoices),
      answers: practice.answers,
      unanswered:
        practice.format === 'written'
          ? []
          : Array.from({ length: practice.mcCount }, (_, index) =>
              String(index + practice.mcStart),
            ).filter((question) => !practice.answers[question]),
    },
    events: practice.events,
    reviewInstructions:
      'Review the annotated PDF together with this report. Explain relevant ideas, check written working where present, identify unclear handwriting and suggest focused revision. Page timing records attention to a page. MC timestamps record cumulative study time. Use a supplied mark scheme when assigning marks.',
  };
}
