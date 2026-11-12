'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import InkSurface from './ink-surface';
import type { PaperPage } from '../lib/practice';
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Close dialogue">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function PenCheck() {
  const [page, setPage] = useState<PaperPage>({
    kind: 'answer',
    sourceIndex: null,
    label: 'Pen test',
    width: 480,
    height: 190,
    transform: [1, 0, 0, -1, 0, 190],
    strokes: [],
    elapsedMs: 0,
  });
  const [input, setInput] = useState('Waiting for a stroke'),
    finish = useRef<(() => void) | null>(null);
  return (
    <>
      <p className="muted">
        Write in the box with your tablet. This does not change your paper or timer.
      </p>
      <div className="pen-test">
        <InkSurface
          page={page}
          scale={1}
          tool="pen"
          colour="#1967d2"
          width={2.5}
          locked={false}
          finishRef={finish}
          onEdit={(_, strokes) => setPage((p) => ({ ...p, strokes }))}
          onInput={(kind, pressure) => {
            if (pressure > 0)
              setInput(
                `${kind === 'pen' ? 'Pen detected' : `${kind} input`} · pressure ${Math.round(pressure * 100)}%`,
              );
          }}
        />
        {!page.strokes.length && <span>Try a light stroke, then a firmer one.</span>}
      </div>
      <div className="pen-readout">
        <span className={input.startsWith('Pen') ? 'success' : ''}>{input}</span>
        <button className="text-button" onClick={() => setPage((p) => ({ ...p, strokes: [] }))}>
          Clear test
        </button>
      </div>
      <div className="note">
        <strong>Using a Huion tablet?</strong>
        <p>
          Enable Windows Ink in the Huion driver for pen pressure. Mouse input still writes at a
          fixed width. Finger touches never create ink.
        </p>
        <a
          href="https://support.huion.com/en/support/solutions/articles/44002618549-what-to-do-if-the-pen-pressure-function-is-not-available-on-the-application"
          target="_blank"
          rel="noreferrer"
        >
          Huion pressure guidance ↗
        </a>
      </div>
    </>
  );
}
export function PdfPaper({
  pdf,
  page,
  scale,
  onReady,
  onError,
}: {
  pdf: PDFDocumentProxy;
  page: PaperPage;
  scale: number;
  onReady: (ready: boolean) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false,
      task: { cancel: () => void; promise: Promise<void> } | undefined;
    onReady(false);
    (async () => {
      const canvas = ref.current!;
      if (page.kind === 'answer') {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(page.width * scale * dpr);
        canvas.height = Math.ceil(page.height * scale * dpr);
        const ctx = canvas.getContext('2d')!;
        ctx.scale(scale * dpr, scale * dpr);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, page.width, page.height);
        ctx.font = '12px Arial';
        ctx.fillStyle = '#566579';
        ctx.fillText(page.label, 40, 40);
        ctx.strokeStyle = '#dce3ee';
        ctx.lineWidth = 0.5;
        for (let y = 80; y < page.height - 50; y += 24) {
          ctx.beginPath();
          ctx.moveTo(40, y);
          ctx.lineTo(page.width - 40, y);
          ctx.stroke();
        }
      } else {
        const p = await pdf.getPage(page.sourceIndex! + 1);
        if (cancelled) return;
        const viewport = p.getViewport({ scale: scale * Math.min(devicePixelRatio || 1, 2) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        task = p.render({ canvas, viewport });
        await task.promise;
      }
      if (!cancelled) onReady(true);
    })().catch((e) => {
      if (!cancelled && e.name !== 'RenderingCancelledException')
        onError(`This page could not be rendered: ${e.message}`);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page.kind, page.sourceIndex, page.width, page.height, scale]);
  return <canvas ref={ref} className="pdf-page" aria-label={page.label} />;
}
