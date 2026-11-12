'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  FileText,
  Upload,
  Download,
  PenLine,
  Eraser,
  Undo2,
  Redo2,
  Hand,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pause,
  Play,
  Clock3,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ListChecks,
  ArrowLeft,
  Tablet,
  ShieldCheck,
  FolderOpen,
  FileJson,
  LockKeyhole,
  HelpCircle,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import InkSurface, { type InkTool } from './components/ink-surface';
import { Dialog, PenCheck, PdfPaper } from './components/practice-ui';
import {
  PracticeEngine,
  PRESETS,
  newPractice,
  timeLabel,
  totalMs,
  limitMs,
  studyReport,
  type Practice,
  type PaperPage,
  type TimerMode,
} from './lib/practice';
import {
  listPractices,
  savePractice,
  readPdf,
  readPractice,
  download,
  safeName,
  backup,
  parseBackup,
} from './lib/storage';
import { inspectPdf, openPdf, makeDemo, exportPdf } from './lib/pdf';
type Pending = { bytes: Uint8Array; pdf: PDFDocumentProxy; pages: PaperPage[]; filename: string };
export default function Studio() {
  const [library, setLibrary] = useState<Practice[]>([]),
    [engine, setEngine] = useState<PracticeEngine | null>(null),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [, rerender] = useState(0),
    refresh = () => rerender((n) => n + 1);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('Saved on this device');
  const [showUpdateNotice, setShowUpdateNotice] = useState(() => {
    try {
      return localStorage.getItem('paper-studio.dismissed-update') !== '2.0.1';
    } catch {
      return true;
    }
  });
  const [tool, setTool] = useState<InkTool>('pen'),
    [colour, setColour] = useState('#202124'),
    [width, setWidth] = useState(1.6);
  const [sidebar, setSidebar] = useState(true),
    [mcOpen, setMcOpen] = useState(false),
    [zoom, setZoom] = useState(0),
    [areaWidth, setAreaWidth] = useState(900),
    [pageReady, setPageReady] = useState(false);
  const [modal, setModal] = useState<'export' | 'pen' | 'help' | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const [timerMode, setTimerMode] = useState<TimerMode>('stopwatch');
  const [presetId, setPresetId] = useState('custom'),
    [minutes, setMinutes] = useState(60),
    [format, setFormat] = useState<Practice['format']>('written'),
    [title, setTitle] = useState(''),
    [count, setCount] = useState(10),
    [choices, setChoices] = useState(4),
    [first, setFirst] = useState(1);
  const [lockState, setLockState] = useState<'checking' | 'owned' | 'other'>('checking'),
    [inputInfo, setInputInfo] = useState('Tablet & mouse ready');
  const picker = useRef<HTMLInputElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    finish = useRef<(() => void) | null>(null),
    pdfBytes = useRef<Uint8Array | null>(null);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const revision = useRef(0),
    dirty = useRef(false),
    lockOwner = useRef<string | null>(null),
    lockRequest = useRef<Promise<unknown>>(Promise.resolve());
  const s = engine?.data,
    page = s?.pages[s.currentPage || 0],
    elapsed = s ? totalMs(s) : 0;
  const deadline = s ? limitMs(s) : null;
  const timerOff = s?.timerMode === 'off';
  const running = s?.status === 'running',
    editable = !!running && lockState === 'owned' && pageReady;
  const scale = page ? zoom || Math.min(1.6, Math.max(0.25, (areaWidth - 72) / page.width)) : 1;
  const persist = (e = engineRef.current) => {
    if (!e || lockOwner.current !== e.data.id) return Promise.resolve(true);
    const rev = ++revision.current;
    dirty.current = true;
    setSaved('Saving…');
    return savePractice(e.data)
      .then(() => {
        if (rev === revision.current) {
          dirty.current = false;
          setSaved('Saved on this device');
        }
        return true;
      })
      .catch(() => {
        setSaved('Not saved');
        setError(
          'Local saving failed. Keep this tab open and export an editable backup to protect your work.',
        );
        return false;
      });
  };
  const changed = () => {
    refresh();
    void persist();
  };
  const freeze = (reason = 'manual_freeze') => {
    finish.current?.();
    engineRef.current?.freeze(reason, performance.now());
    changed();
  };
  const navigate = (index: number) => {
    finish.current?.();
    engine?.switchPage(index, performance.now());
    setPageReady(false);
    if (viewport.current) {
      viewport.current.scrollTop = 0;
      viewport.current.scrollLeft = 0;
    }
    changed();
  };
  const applyPreset = (id: string) => {
    const p = PRESETS.find((p) => p.id === id)!;
    setPresetId(id);
    setMinutes(p.minutes);
    if (id !== 'custom') setFormat(p.format);
  };
  const loadLibrary = () =>
    listPractices()
      .then((list) => setLibrary(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))))
      .catch((error) =>
        setError(
          error instanceof Error
            ? error.message
            : 'Browser storage is unavailable. Enable storage for this site to save your papers.',
        ),
      );
  useEffect(() => {
    void loadLibrary();
    const storageChanged = () => {
      finish.current?.();
      engineRef.current?.freeze('storage_version_changed', performance.now());
      setLockState('other');
      setError('Paper Studio storage was upgraded in another tab. Refresh this page to continue.');
    };
    window.addEventListener('paper-studio-storage-updated', storageChanged);
    return () => window.removeEventListener('paper-studio-storage-updated', storageChanged);
  }, []);
  useEffect(() => {
    if (!engine) return;
    let cancelled = false,
      release: (() => void) | undefined;
    setLockState('checking');
    if (!navigator.locks) {
      setLockState('other');
      setError(
        'This browser cannot protect a paper from simultaneous edits. Please use current Chrome or Edge.',
      );
      return;
    }
    lockRequest.current = lockRequest.current
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        return navigator.locks.request(
          `dse-paper-${engine.data.id}`,
          { ifAvailable: true },
          async (lock) => {
            if (cancelled) return;
            if (!lock) {
              setLockState('other');
              return;
            }
            const fresh = await readPractice(engine.data.id);
            if (cancelled) return;
            if (fresh) engine.data = new PracticeEngine(fresh).data;
            lockOwner.current = engine.data.id;
            setLockState('owned');
            refresh();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        );
      })
      .catch((e) => {
        setError(`Could not lock this paper: ${e.message}`);
        setLockState('other');
      });
    return () => {
      cancelled = true;
      if (lockOwner.current === engine.data.id) lockOwner.current = null;
      release?.();
    };
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    let beats = 0;
    const timer = window.setInterval(() => {
      const was = engine.data.status,
        now = performance.now(),
        delta = engine.lastNow === null ? 0 : now - engine.lastNow;
      const limit = limitMs(engine.data);
      if (
        was === 'running' &&
        (delta > 5000 ||
          (limit !== null && !engine.data.overtimeAllowed && totalMs(engine.data) + delta >= limit))
      )
        finish.current?.();
      engine.tick(now);
      if (was === 'running') {
        refresh();
        if (engine.data.status !== 'running' || ++beats % 8 === 0) void persist(engine);
      }
    }, 250);
    const hidden = () => {
      if (document.hidden) freeze('tab_hidden');
    };
    const leave = () => freeze('page_left');
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    window.addEventListener('beforeunload', unload);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('beforeunload', unload);
    };
  }, [engine]);
  useEffect(() => {
    if (!viewport.current) return;
    const obs = new ResizeObserver(([entry]) => setAreaWidth(entry.contentRect.width));
    obs.observe(viewport.current);
    return () => obs.disconnect();
  }, [engine]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !engine ||
        modal ||
        pending ||
        /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName)
      )
        return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (!editable) return;
        finish.current?.();
        engine.tick(performance.now());
        if (key === 'y' || e.shiftKey) engine.redo();
        else engine.undo();
        changed();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (key === 'p') setTool('pen');
      if (key === 'e') setTool('eraser');
      if (key === 'h') setTool('hand');
      if (key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        if (engine.data.status === 'running') freeze();
        else if (lockState === 'owned' && pageReady) {
          engine.start(performance.now());
          changed();
        }
      }
      if (key === 'arrowright' && engine.data.currentPage < engine.data.pages.length - 1) {
        e.preventDefault();
        navigate(engine.data.currentPage + 1);
      }
      if (key === 'arrowleft' && engine.data.currentPage > 0) {
        e.preventDefault();
        navigate(engine.data.currentPage - 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [engine, modal, pending, editable, lockState, pageReady]);
  const activate = async (practice: Practice, bytes: Uint8Array, document?: PDFDocumentProxy) => {
    finish.current?.();
    if (engine) {
      engine.freeze('paper_changed', performance.now());
      if (!(await persist(engine)))
        throw new Error('Save an editable backup of the open paper before switching.');
    }
    const next = document || (await openPdf(bytes));
    const previous = pdf;
    pdfBytes.current = bytes;
    setPdf(next);
    setEngine(new PracticeEngine(practice));
    setPageReady(false);
    setMcOpen(practice.format !== 'written');
    setZoom(0);
    setModal(null);
    setSaved('Saved on this device');
    if (previous && previous !== next) void previous.loadingTask.destroy();
  };
  const importBytes = async (bytes: Uint8Array, filename: string, demo = false) => {
    if (bytes.byteLength > 150 * 1024 * 1024) throw new Error('Choose a PDF smaller than 150 MB.');
    const inspected = await inspectPdf(bytes);
    if (demo) {
      const practice = newPractice(
        {
          title: 'A little space to think',
          filename,
          timerMode: 'stopwatch',
          presetId: 'custom',
          minutes: null,
          source: '',
          format: 'mixed',
          mcCount: 2,
          mcChoices: 4,
          mcStart: 1,
        },
        inspected.pages,
      );
      await savePractice(practice, bytes);
      await activate(practice, bytes, inspected.pdf);
      await loadLibrary();
    } else {
      setPending({ bytes, filename, ...inspected });
      setTitle(filename.replace(/\.pdf$/i, '').slice(0, 160));
      applyPreset('custom');
      setTimerMode('stopwatch');
      setFormat('written');
      setCount(10);
      setChoices(4);
      setFirst(1);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    freeze('import_opened');
    setError('');
    setBusy('Opening your paper…');
    try {
      if (/\.json$/i.test(file.name)) {
        if (file.size > 220 * 1024 * 1024)
          throw new Error('This backup is too large (maximum 220 MB).');
        const restored = parseBackup(await file.text()),
          inspected = await inspectPdf(restored.bytes);
        const expected = restored.practice.pages.filter((p) => p.kind === 'original');
        if (
          expected.length !== inspected.pages.length ||
          expected.some(
            (p, i) =>
              p.sourceIndex !== i ||
              Math.abs(p.width - inspected.pages[i].width) > 0.1 ||
              Math.abs(p.height - inspected.pages[i].height) > 0.1 ||
              p.transform.some((v, j) => Math.abs(v - inspected.pages[i].transform[j]) > 0.01),
          )
        ) {
          await inspected.pdf.loadingTask.destroy();
          throw new Error('The backup pages do not match its original PDF.');
        }
        await savePractice(restored.practice, restored.bytes);
        await activate(restored.practice, restored.bytes, inspected.pdf);
        await loadLibrary();
      } else {
        if (file.size > 150 * 1024 * 1024) throw new Error('Choose a PDF smaller than 150 MB.');
        await importBytes(new Uint8Array(await file.arrayBuffer()), file.name);
      }
    } catch (e) {
      setError(
        `Could not import this file. ${(e as Error).message} Password-protected PDFs need an unlocked copy.`,
      );
    } finally {
      setBusy('');
      if (picker.current) picker.current.value = '';
    }
  };
  const create = async () => {
    if (
      !pending ||
      !title.trim() ||
      (timerMode === 'countdown' && (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 200 ||
      !Number.isInteger(first) ||
      first < 1 ||
      first > 999
    )
      return;
    setBusy('Saving your paper…');
    try {
      const preset = PRESETS.find((p) => p.id === presetId)!;
      const practice = newPractice(
        {
          title: title.trim(),
          filename: pending.filename,
          timerMode,
          presetId,
          minutes: timerMode === 'countdown' ? minutes : null,
          source: preset.source,
          format,
          mcCount: count,
          mcChoices: choices,
          mcStart: first,
        },
        pending.pages,
      );
      await savePractice(practice, pending.bytes);
      await activate(practice, pending.bytes, pending.pdf);
      setPending(null);
      await loadLibrary();
      void navigator.storage?.persist?.();
    } catch (e) {
      setError(`Could not save paper: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };
  const exportFile = async (kind: 'pdf' | 'json' | 'backup') => {
    if (!engine || !pdfBytes.current) return;
    freeze('export_opened');
    const snapshot = structuredClone(engine.data),
      name = safeName(snapshot.title);
    setBusy(kind === 'pdf' ? 'Preparing your annotated PDF…' : 'Preparing your download…');
    try {
      if (kind === 'pdf')
        download(
          new Uint8Array(await exportPdf(snapshot, pdfBytes.current)),
          `${name}-annotated.pdf`,
          'application/pdf',
        );
      if (kind === 'json')
        download(
          JSON.stringify(studyReport(snapshot), null, 2),
          `${name}-study-data.json`,
          'application/json',
        );
      if (kind === 'backup')
        download(
          await backup(snapshot, pdfBytes.current),
          `${name}.paperstudio.json`,
          'application/json',
        );
    } catch (e) {
      setError(
        `Export failed: ${(e as Error).message}. Your paper is still here; try the editable backup.`,
      );
    } finally {
      setBusy('');
    }
  };
  const home = async () => {
    freeze('library_opened');
    if (!(await persist())) return;
    setEngine(null);
    setPdf(null);
    if (pdf) void pdf.loadingTask.destroy();
    await loadLibrary();
  };
  const returnToPaper = async (id: string) => {
    setBusy('Opening saved paper…');
    setError('');
    try {
      const [p, b] = await Promise.all([readPractice(id), readPdf(id)]);
      if (!p || !b)
        throw new Error('The saved original PDF is missing. Restore an editable backup.');
      await activate(p, b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <main
      className="studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && !pending) void importFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={picker}
        type="file"
        accept="application/pdf,.pdf,.paperstudio.json,.dse.json,.json"
        className="sr-only"
        aria-label="Choose PDF or editable backup"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            if (s) void home();
          }}
          aria-label="Paper Studio library"
        >
          <span className="brand-mark">
            <FileText size={23} strokeWidth={1.7} />
          </span>
          <span>
            Paper Studio<small>PDF WORKSPACE</small>
          </span>
        </button>
        {s && (
          <div className="document-title">
            <span>{s.title}</span>
            <small>
              <span className={saved === 'Not saved' ? 'save-error' : 'save-dot'} />
              {saved}
            </small>
          </div>
        )}
        <div className="header-actions">
          <button
            className="quiet-button pen-check-button"
            onClick={() => {
              if (s) freeze('pen_check');
              setModal('pen');
            }}
          >
            <Tablet size={18} />
            <span>Pen check</span>
          </button>
          <button
            className="quiet-button"
            disabled={!!busy}
            onClick={() => {
              if (s) freeze('file_picker');
              picker.current?.click();
            }}
          >
            <Upload size={18} />
            <span>Import PDF</span>
          </button>
          {s && (
            <button
              className="primary-button export-button"
              disabled={!!busy}
              onClick={() => {
                freeze('export_opened');
                setModal('export');
              }}
            >
              <Download size={17} />
              Export
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" className="icon-button" onClick={() => setError('')}>
            <X size={17} />
          </button>
        </div>
      )}
      {!s && library.length > 0 && showUpdateNotice && (
        <div className="update-banner" role="status">
          <span>
            Paper Studio 2.0.1 improves PDF rendering on iPad.{' '}
            <a
              href="https://github.com/aseawa/paper-studio/releases"
              target="_blank"
              rel="noreferrer"
            >
              Release notes
            </a>
          </span>
          <button
            aria-label="Dismiss update notification"
            className="icon-button"
            onClick={() => {
              setShowUpdateNotice(false);
              try {
                localStorage.setItem('paper-studio.dismissed-update', '2.0.1');
              } catch {
                // The notification remains dismissed for this session.
              }
            }}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {!s ? (
        <div className="library-view">
          <div className="library-heading">
            <h1>Your PDF study workspace</h1>
            <p>Read, write and take your study notes with you.</p>
          </div>
          <div
            className="import-zone"
            onClick={() => picker.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') picker.current?.click();
            }}
            aria-label="Import a study PDF"
          >
            <div className="paper-stack">
              <div />
              <span>
                <FileText size={44} strokeWidth={1.15} />
                <i />
                <i />
                <i />
              </span>
            </div>
            <h2>Open a PDF</h2>
            <p>Drop a PDF here, or choose one from your device.</p>
            <button
              className="primary-button"
              onClick={(e) => {
                e.stopPropagation();
                picker.current?.click();
              }}
              disabled={!!busy}
            >
              <Plus size={19} />
              Import a PDF
            </button>
            <small>PDFs or editable .paperstudio.json backups · up to 150 MB per PDF</small>
          </div>
          <div className="library-details">
            <span>
              <ShieldCheck size={16} />
              Your papers stay in this browser on this device.
            </span>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={async () => {
                setBusy('Preparing a practice sheet…');
                try {
                  await importBytes(
                    new Uint8Array(await makeDemo()),
                    'Paper-Studio-practice.pdf',
                    true,
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              Try a sample PDF <ChevronRight size={15} />
            </button>
          </div>
          {library.length > 0 && (
            <section className="recent">
              <div className="section-head">
                <h2>Your papers</h2>
                <span>{library.length} saved on this device</span>
              </div>
              <div className="paper-list">
                {library.map((item) => (
                  <button
                    className="paper-row"
                    key={item.id}
                    onClick={() => void returnToPaper(item.id)}
                    disabled={!!busy}
                  >
                    <span className="file-icon">
                      <FileText size={23} />
                    </span>
                    <span className="paper-row-title">
                      <strong>{item.title}</strong>
                      <small>
                        {item.pages.length} pages ·{' '}
                        {item.timerMode === 'countdown'
                          ? `${item.minutes} min limit`
                          : item.timerMode === 'off'
                            ? 'Timing off'
                            : 'Stopwatch'}{' '}
                        · {new Date(item.updatedAt).toLocaleDateString('en-GB')}
                      </small>
                    </span>
                    {item.timerMode !== 'off' && (
                      <span className="paper-row-time">
                        <Clock3 size={14} />
                        {timeLabel(totalMs(item))}
                      </span>
                    )}
                    <ChevronRight size={19} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <footer className="library-footer">
            <button className="text-button" onClick={() => setModal('help')}>
              <HelpCircle size={15} />
              How it works
            </button>
          </footer>
        </div>
      ) : (
        <>
          <div className="study-bar">
            <div className="timer-block">
              <Clock3 size={20} />
              <div>
                <span className="timer-label">
                  {timerOff
                    ? 'READ & ANNOTATE'
                    : deadline === null
                      ? 'STUDY TIME'
                      : elapsed > deadline
                        ? 'OVERTIME'
                        : 'TIME REMAINING'}
                </span>
                <strong
                  className={
                    deadline !== null && elapsed >= deadline
                      ? 'overtime'
                      : timerOff
                        ? 'off-label'
                        : ''
                  }
                  data-testid="remaining-time"
                >
                  {timerOff
                    ? 'Timing off'
                    : timeLabel(deadline === null ? elapsed : Math.abs(deadline - elapsed))}
                </strong>
              </div>
              {deadline !== null && (
                <>
                  <span className="timer-divider" />
                  <div className="elapsed-label">
                    <span>
                      Worked <b data-testid="elapsed-time">{timeLabel(elapsed)}</b>
                    </span>
                    <small>
                      {s.minutes} min limit{s.preset ? ' · preset' : ''}
                    </small>
                  </div>
                </>
              )}
            </div>
            <button
              className={running ? 'freeze-button' : 'resume-button'}
              disabled={lockState !== 'owned' || (!running && !pageReady) || !!busy}
              onClick={() => {
                if (running) freeze();
                else {
                  engine!.start(performance.now(), s.status === 'expired');
                  changed();
                }
              }}
            >
              {running ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {running
                ? 'Freeze'
                : s.status === 'ready'
                  ? 'Start'
                  : s.status === 'expired'
                    ? 'Continue in overtime'
                    : 'Resume'}
            </button>
            <span className={`session-status ${running ? 'is-running' : ''}`}>
              <span />
              {running
                ? 'In progress'
                : s.status === 'ready'
                  ? 'Ready when you are'
                  : s.status === 'expired'
                    ? 'Time is up · answers locked'
                    : timerOff
                      ? 'Frozen · editing locked'
                      : 'Frozen · timer & editing locked'}
            </span>
            <div className="study-bar-right">
              <button
                className="quiet-button compact"
                disabled={!editable}
                onClick={() => {
                  finish.current?.();
                  engine!.addAnswerPage(performance.now());
                  setPageReady(false);
                  changed();
                }}
              >
                <Plus size={17} />
                <span>Answer sheet</span>
              </button>
              {s.format !== 'written' && (
                <button
                  className={`quiet-button compact ${mcOpen ? 'selected' : ''}`}
                  onClick={() => setMcOpen(!mcOpen)}
                >
                  <ListChecks size={17} />
                  <span>MC answers</span>
                </button>
              )}
            </div>
          </div>
          {lockState === 'other' && (
            <div className="info-banner">
              <LockKeyhole size={16} />
              This paper is open in another tab. Close it there, then reopen this paper to edit.
            </div>
          )}
          <div className="workspace">
            {sidebar && (
              <aside className="page-sidebar">
                <div className="sidebar-heading">
                  <span>PAGES</span>
                  <button
                    className="icon-button"
                    aria-label="Hide pages"
                    onClick={() => setSidebar(false)}
                  >
                    <PanelLeftClose size={17} />
                  </button>
                </div>
                <nav aria-label="Paper pages">
                  {s.pages.map((p, index) => (
                    <button
                      key={index}
                      className={`page-item ${s.currentPage === index ? 'active' : ''}`}
                      aria-current={s.currentPage === index ? 'page' : undefined}
                      onClick={() => {
                        if (index !== s.currentPage) navigate(index);
                      }}
                    >
                      <span className="page-number">
                        {index + 1}
                        {p.strokes.length > 0 && <i />}
                      </span>
                      <span>
                        <strong>{p.kind === 'answer' ? p.label : `Page ${index + 1}`}</strong>
                        <small>{timerOff ? 'Untimed' : timeLabel(p.elapsedMs)}</small>
                      </span>
                    </button>
                  ))}
                </nav>
                <button className="library-back" onClick={() => void home()}>
                  <ArrowLeft size={15} />
                  Your papers
                </button>
              </aside>
            )}
            <section className="paper-area">
              <div className="writing-toolbar">
                <div className="tools">
                  {!sidebar && (
                    <button
                      className="icon-button"
                      title="Show pages"
                      aria-label="Show pages"
                      onClick={() => setSidebar(true)}
                    >
                      <PanelLeftOpen size={19} />
                    </button>
                  )}
                  {(
                    [
                      { id: 'pen', label: 'Pen (P)', Icon: PenLine },
                      { id: 'eraser', label: 'Stroke eraser (E)', Icon: Eraser },
                      { id: 'hand', label: 'Move paper (H)', Icon: Hand },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      className={`tool-button ${tool === id ? 'active' : ''}`}
                      title={label}
                      aria-label={label}
                      aria-pressed={tool === id}
                      onClick={() => {
                        finish.current?.();
                        setTool(id);
                      }}
                    >
                      <Icon size={19} />
                    </button>
                  ))}
                  <span className="toolbar-divider" />
                  {['#202124', '#1967d2', '#c5221f'].map((c) => (
                    <button
                      key={c}
                      className={`colour ${colour === c ? 'chosen' : ''}`}
                      style={{ '--ink': c } as CSSProperties}
                      title={
                        c === '#202124' ? 'Black ink' : c === '#1967d2' ? 'Blue ink' : 'Red ink'
                      }
                      aria-label={
                        c === '#202124' ? 'Black ink' : c === '#1967d2' ? 'Blue ink' : 'Red ink'
                      }
                      aria-pressed={colour === c}
                      onClick={() => {
                        finish.current?.();
                        setColour(c);
                      }}
                    >
                      <span />
                    </button>
                  ))}
                  <select
                    className="width-select"
                    aria-label="Pen width"
                    value={width}
                    onChange={(e) => {
                      finish.current?.();
                      setWidth(Number(e.target.value));
                    }}
                  >
                    <option value={1}>Fine</option>
                    <option value={1.6}>Medium</option>
                    <option value={2.8}>Bold</option>
                  </select>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button"
                    title="Undo (Ctrl+Z)"
                    aria-label="Undo"
                    disabled={!editable || !s.undo.length}
                    onClick={() => {
                      finish.current?.();
                      engine!.tick(performance.now());
                      engine!.undo();
                      changed();
                    }}
                  >
                    <Undo2 size={19} />
                  </button>
                  <button
                    className="icon-button"
                    title="Redo (Ctrl+Shift+Z)"
                    aria-label="Redo"
                    disabled={!editable || !s.redo.length}
                    onClick={() => {
                      finish.current?.();
                      engine!.tick(performance.now());
                      engine!.redo();
                      changed();
                    }}
                  >
                    <Redo2 size={19} />
                  </button>
                </div>
                <div className="view-tools">
                  <select
                    aria-label="Zoom"
                    value={zoom}
                    onChange={(e) => {
                      finish.current?.();
                      setZoom(Number(e.target.value));
                    }}
                  >
                    <option value={0}>Fit width</option>
                    <option value={0.75}>75%</option>
                    <option value={1}>100%</option>
                    <option value={1.25}>125%</option>
                    <option value={1.5}>150%</option>
                    <option value={2}>200%</option>
                  </select>
                  <button
                    className="icon-button"
                    title="Help & shortcuts"
                    aria-label="Help and shortcuts"
                    onClick={() => {
                      freeze('help_opened');
                      setModal('help');
                    }}
                  >
                    <HelpCircle size={18} />
                  </button>
                </div>
              </div>
              <div className="paper-viewport" ref={viewport}>
                <div className="paper-caption">
                  <span>{page!.label}</span>
                  {!timerOff && (
                    <span>
                      <Clock3 size={13} />
                      On this page <b data-testid="page-time">{timeLabel(page!.elapsedMs)}</b>
                    </span>
                  )}
                </div>
                <div className="paper-centre" style={{ minWidth: page!.width * scale + 72 }}>
                  <div
                    className="paper-sheet"
                    style={{ width: page!.width * scale, height: page!.height * scale }}
                    key={`${s.id}-${s.currentPage}`}
                  >
                    {pdf && (
                      <PdfPaper
                        pdf={pdf}
                        page={page!}
                        scale={scale}
                        onReady={setPageReady}
                        onError={setError}
                      />
                    )}
                    <InkSurface
                      page={page!}
                      scale={scale}
                      tool={tool}
                      colour={colour}
                      width={width}
                      locked={!editable}
                      finishRef={finish}
                      onInput={(kind, pressure) => {
                        if (pressure > 0)
                          setInputInfo(
                            kind === 'pen'
                              ? `Pen connected · ${Math.round(pressure * 100)}% pressure`
                              : 'Mouse input · fixed pressure',
                          );
                      }}
                      onEdit={(before, after) => {
                        if (lockState !== 'owned') return;
                        engine!.commit({ kind: 'ink', page: s.currentPage, before, after });
                        engine!.tick(performance.now());
                        changed();
                      }}
                    />
                    {!pageReady && <div className="page-loading">Rendering page…</div>}
                  </div>
                </div>
                <div className="page-bottom">
                  <button
                    className="quiet-button"
                    disabled={s.currentPage === 0}
                    onClick={() => navigate(s.currentPage - 1)}
                  >
                    <ChevronLeft size={17} />
                    Previous
                  </button>
                  <span>
                    {s.currentPage + 1} of {s.pages.length}
                  </span>
                  <button
                    className="quiet-button"
                    disabled={s.currentPage === s.pages.length - 1}
                    onClick={() => navigate(s.currentPage + 1)}
                  >
                    Next
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="workspace-footer">
                <span>
                  <span className="connection-dot" />
                  {inputInfo}
                </span>
                <span className="shortcut-hint">P pen · E eraser · Ctrl+Z undo · Space freeze</span>
              </div>
            </section>
            {mcOpen && s.format !== 'written' && (
              <aside className="mc-panel">
                <div className="mc-heading">
                  <div>
                    <h2>MC answers</h2>
                    <p>
                      {Object.keys(s.answers).length} of {s.mcCount} answered
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Hide MC answers"
                    onClick={() => setMcOpen(false)}
                  >
                    <X size={17} />
                  </button>
                </div>
                <p className="mc-tip">Tap a choice. Tap again to clear.</p>
                <div className="mc-rows">
                  {Array.from({ length: s.mcCount }, (_, i) => String(i + s.mcStart)).map((q) => (
                    <div className="mc-row" key={q}>
                      <span>{q.padStart(2, '0')}</span>
                      <div role="group" aria-label={`Question ${q}`}>
                        {Array.from('ABCDEF'.slice(0, s.mcChoices)).map((choice) => (
                          <button
                            key={choice}
                            className={s.answers[q]?.choice === choice ? 'picked' : ''}
                            aria-label={`Question ${q}: ${choice}`}
                            aria-pressed={s.answers[q]?.choice === choice}
                            disabled={!editable}
                            onClick={() => {
                              finish.current?.();
                              engine!.answer(q, choice, performance.now());
                              changed();
                            }}
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mc-footer">
                  <FileText size={15} />
                  Answers are included in your PDF.
                </div>
              </aside>
            )}
          </div>
        </>
      )}
      {pending && (
        <Dialog
          title="Open your PDF"
          close={() => {
            void pending.pdf.loadingTask.destroy();
            setPending(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="file-summary">
              <FileText size={23} />
              <span>
                <strong>{pending.filename}</strong>
                <small>{pending.pages.length} pages</small>
              </span>
            </div>
            <label className="field">
              Document name
              <input
                required
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              Timing
              <select
                value={timerMode}
                onChange={(event) => {
                  setTimerMode(event.target.value as TimerMode);
                  if (event.target.value !== 'countdown') setPresetId('custom');
                }}
              >
                <option value="stopwatch">Stopwatch</option>
                <option value="countdown">Countdown</option>
                <option value="off">Off</option>
              </select>
            </label>
            {timerMode === 'countdown' && (
              <>
                <div className="field-row">
                  <label className="field">
                    Timing preset
                    <select value={presetId} onChange={(event) => applyPreset(event.target.value)}>
                      <option value="custom">Custom time limit</option>
                      <optgroup label="HKDSE — 2026">
                        {PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label} · {preset.minutes} min
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label className="field">
                    Time limit (minutes)
                    <input
                      type="number"
                      required
                      min={1}
                      max={1440}
                      step="any"
                      value={minutes || ''}
                      onChange={(event) => setMinutes(Number(event.target.value))}
                    />
                  </label>
                </div>
                {presetId !== 'custom' && (
                  <p className="setup-note">
                    Check the instructions for this paper’s year and any extra time.{' '}
                    <a
                      href={PRESETS.find((preset) => preset.id === presetId)!.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      2026 official source ↗
                    </a>
                  </p>
                )}
              </>
            )}
            <details className="paper-options">
              <summary>Paper options</summary>
              <label className="field">
                MC answer grid
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as Practice['format'])}
                >
                  <option value="written">Off</option>
                  <option value="mc">Multiple choice</option>
                  <option value="mixed">Mixed questions</option>
                </select>
              </label>
              {format !== 'written' && (
                <div className="mc-setup">
                  <div className="field-row thirds">
                    <label className="field">
                      Questions
                      <input
                        type="number"
                        required
                        min={1}
                        max={200}
                        value={count || ''}
                        onChange={(event) => setCount(Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      First number
                      <input
                        type="number"
                        required
                        min={1}
                        max={999}
                        value={first || ''}
                        onChange={(event) => setFirst(Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      Choices
                      <select
                        value={choices}
                        onChange={(event) => setChoices(Number(event.target.value))}
                      >
                        {[2, 3, 4, 5, 6].map((number) => (
                          <option key={number} value={number}>
                            A–{'ABCDEF'[number - 1]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </details>
            <div className="dialog-actions">
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  void pending.pdf.loadingTask.destroy();
                  setPending(null);
                }}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={!!busy}>
                Open PDF
                <ChevronRight size={17} />
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal === 'pen' && (
        <Dialog title="Check your pen" close={() => setModal(null)}>
          <PenCheck />
        </Dialog>
      )}
      {modal === 'export' && s && (
        <Dialog title="Take your work with you" close={() => setModal(null)}>
          <p className="muted">Your paper is frozen. Choose what you would like to save.</p>
          <button
            className="export-choice featured"
            disabled={!!busy}
            onClick={() => void exportFile('pdf')}
          >
            <span className="export-icon">
              <FileText size={27} />
            </span>
            <span>
              <strong>Annotated PDF</strong>
              <small>
                Original pages, handwriting, MC answers and a timing report. Study data is also
                attached inside.
              </small>
            </span>
            <Download size={20} />
          </button>
          <button
            className="export-choice"
            disabled={!!busy}
            onClick={() => void exportFile('json')}
          >
            <span className="export-icon">
              <FileJson size={24} />
            </span>
            <span>
              <strong>Study data for your agent</strong>
              <small>
                Study timing, MC selections and session history as JSON. Send it together with the
                PDF.
              </small>
            </span>
            <Download size={19} />
          </button>
          <button
            className="export-choice"
            disabled={!!busy}
            onClick={() => void exportFile('backup')}
          >
            <span className="export-icon">
              <FolderOpen size={24} />
            </span>
            <span>
              <strong>Editable backup</strong>
              <small>
                Original PDF, editable ink and all study data. Import this .paperstudio.json file to
                continue on another browser.
              </small>
            </span>
            <Download size={19} />
          </button>
          <div className="note">
            <ShieldCheck size={17} />
            <p>
              Downloads are created on your device. Nothing is sent to an agent automatically. Keep
              a backup before clearing browser data.
            </p>
          </div>
        </Dialog>
      )}
      {modal === 'help' && (
        <Dialog title="Using Paper Studio" close={() => setModal(null)}>
          <div className="help-list">
            <p>
              <b>Import a PDF.</b> Choose a stopwatch, countdown or timing off. Open Paper options
              if you want an MC grid.
            </p>
            <p>
              <b>Start and write.</b> Use your pen or mouse on any page. The eraser removes complete
              strokes. Ctrl+Z and Ctrl+Shift+Z undo and redo. Add an answer sheet for more space.
            </p>
            <p>
              <b>Freeze when needed.</b> It pauses timing and locks editing. You can browse pages
              while frozen. Hidden tabs and device interruptions freeze the session too.
            </p>
            <p>
              <b>Export your work.</b> Save an annotated PDF and study-data JSON for review. Save an
              editable backup to continue in another browser or at another address.
            </p>
          </div>
          <div className="note">
            <p>
              Time follows the displayed page while the session is running. A countdown locks
              editing at its limit. Use Continue in overtime for additional practice. Imported PDFs
              are stored in this browser on this device.
            </p>
          </div>
          <div className="shortcut-grid">
            <span>
              Pen <kbd>P</kbd>
            </span>
            <span>
              Eraser <kbd>E</kbd>
            </span>
            <span>
              Move paper <kbd>H</kbd>
            </span>
            <span>
              Freeze / resume <kbd>Space</kbd>
            </span>
            <span>
              Undo <kbd>Ctrl Z</kbd>
            </span>
            <span>
              Next page <kbd>→</kbd>
            </span>
          </div>
        </Dialog>
      )}
      {busy && (
        <div className="busy-toast" role="status">
          <span className="spinner" />
          {busy}
        </div>
      )}
    </main>
  );
}
