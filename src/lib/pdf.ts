import { PDFDocument, StandardFonts, rgb, LineCapStyle, type PDFPage, type PDFFont } from 'pdf-lib';
import {
  pdfPoint,
  studyReport,
  timeLabel,
  totalMs,
  type Practice,
  type PaperPage,
} from './practice.ts';
let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | undefined;
export async function openPdf(bytes: Uint8Array) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = import.meta.env?.BASE_URL || '/';
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf/pdf.worker.min.mjs?version=${pdfjs.version}-legacy`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: `${base}pdf/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdf/standard_fonts/`,
    wasmUrl: `${base}pdf/wasm/`,
  });
  try {
    return await task.promise;
  } catch (e) {
    await task.destroy();
    throw e;
  }
}
export async function inspectPdf(bytes: Uint8Array) {
  // Validate export compatibility before accepting a practice file.
  await PDFDocument.load(bytes);
  const pdf = await openPdf(bytes);
  if (pdf.numPages > 500) {
    await pdf.loadingTask.destroy();
    throw new Error('Please split this PDF into papers of 500 pages or fewer.');
  }
  const pages: PaperPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i),
      v = p.getViewport({ scale: 1 });
    pages.push({
      kind: 'original',
      sourceIndex: i - 1,
      label: `Paper page ${i}`,
      width: v.width,
      height: v.height,
      transform: [...v.transform],
      strokes: [],
      elapsedMs: 0,
    });
  }
  return { pdf, pages };
}
export async function makeDemo() {
  const d = await PDFDocument.create(),
    font = await d.embedFont(StandardFonts.Helvetica),
    bold = await d.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 3; i++) {
    const p = d.addPage([595.28, 841.89]);
    p.drawText('PAPER STUDIO', {
      x: 48,
      y: 790,
      size: 10,
      font: bold,
      color: rgb(0.25, 0.39, 0.56),
    });
    p.drawText('A little space to think.', { x: 48, y: 745, size: 25, font: bold });
    p.drawText('Original sample document for reading, handwriting and study', {
      x: 48,
      y: 720,
      size: 9,
      font,
      color: rgb(0.4, 0.43, 0.46),
    });
    const lines =
      i === 0
        ? [
            '1.  Solve 2x + 5 = 17. Show your working.',
            '',
            '',
            '',
            '2.  Factorise x^2 - 5x + 6.',
            '',
            '',
            '',
            '3.  A rectangle has sides x and x + 3. Its area is 40.',
            '     Find x and state why the other root is rejected.',
          ]
        : i === 1
          ? [
              'Multiple choice',
              '',
              '1.  Which value satisfies x^2 = 9 and x > 0?',
              '     A. -9       B. -3       C. 3       D. 9',
              '',
              '2.  What is the gradient of y = 2x + 7?',
              '     A. 2        B. 7        C. -2      D. 1/2',
              '',
              'Use the MC answers panel to record your choices.',
            ]
          : [
              'Extended response',
              '',
              'A ball is projected vertically. Its height is modelled by',
              'h(t) = 20t - 5t^2 metres, for 0 <= t <= 4.',
              '',
              '(a) Find the maximum height.',
              '(b) Find when the ball returns to its starting height.',
              '(c) Sketch a graph and explain your reasoning.',
            ];
    lines.forEach((line, j) => {
      if (line) p.drawText(line, { x: 48, y: 667 - j * 30, size: 12, font });
    });
    for (let y = i === 0 ? 575 : 350; y > 75; y -= 25)
      if (i !== 0 || y < 300)
        p.drawLine({
          start: { x: 48, y },
          end: { x: 547, y },
          thickness: 0.4,
          color: rgb(0.86, 0.89, 0.93),
        });
    p.drawText(`${i + 1} / 3`, { x: 520, y: 37, size: 9, font });
  }
  return d.save();
}
export async function exportPdf(s: Practice, bytes: Uint8Array) {
  const source = await PDFDocument.load(bytes),
    doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  async function drawLabel(
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    width = 508,
  ) {
    try {
      font.encodeText(value);
      page.drawText(value, { x, y, size, font, color: rgb(0.2, 0.25, 0.32) });
    } catch {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * 3);
      canvas.height = Math.ceil(size * 1.6 * 3);
      const context = canvas.getContext('2d')!;
      context.font = `${font === bold ? 'bold ' : ''}${size * 3}px sans-serif`;
      context.fillStyle = '#334052';
      context.fillText(value, 0, size * 3, width * 3);
      const image = await doc.embedPng(canvas.toDataURL('image/png'));
      page.drawImage(image, { x, y: y - size * 0.6, width, height: size * 1.6 });
    }
  }

  for (const page of s.pages) {
    let p: PDFPage;
    if (page.kind === 'original' && page.sourceIndex !== null) {
      const [copy] = await doc.copyPages(source, [page.sourceIndex]);
      p = doc.addPage(copy);
    } else {
      p = doc.addPage([page.width, page.height]);
      await drawLabel(p, page.label, 40, page.height - 40, 12, bold, page.width - 80);
      for (let y = page.height - 80; y > 50; y -= 24)
        p.drawLine({
          start: { x: 40, y },
          end: { x: page.width - 40, y },
          color: rgb(0.86, 0.89, 0.93),
          thickness: 0.4,
        });
    }
    const scale = Math.hypot(page.transform[0], page.transform[1]) || 1;
    for (const line of page.strokes) {
      const c = line.colour.match(/\w\w/g)!.map((v) => parseInt(v, 16) / 255),
        colour = rgb(c[0], c[1], c[2]);
      if (line.points.length === 1) {
        const pt = pdfPoint(line.points[0], page.transform);
        p.drawCircle({
          x: pt.x,
          y: pt.y,
          size: (line.width * (0.45 + line.points[0].p * 0.85)) / scale / 2,
          color: colour,
        });
      }
      for (let j = 1; j < line.points.length; j++) {
        const a = line.points[j - 1],
          b = line.points[j];
        p.drawLine({
          start: pdfPoint(a, page.transform),
          end: pdfPoint(b, page.transform),
          thickness: (line.width * (0.45 + ((a.p + b.p) / 2) * 0.85)) / scale,
          color: colour,
          lineCap: LineCapStyle.Round,
        });
      }
    }
  }

  const report = studyReport(s);
  let page: PDFPage;
  let y = 0;
  let reportPage = 0;
  function newPage() {
    page = doc.addPage([595.28, 841.89]);
    reportPage++;
    y = 755;
    page.drawText('PAPER STUDIO  /  STUDY REPORT', {
      x: 44,
      y: 794,
      size: 10,
      font: bold,
      color: rgb(0.12, 0.32, 0.65),
    });
    page.drawText(`Study report ${reportPage}  |  Annotated pages precede this report`, {
      x: 44,
      y: 27,
      size: 8,
      font: normal,
    });
  }
  function ensure(height = 22) {
    if (y - height < 58) newPage();
  }
  async function text(value: string, size = 10, heavy = false) {
    const maximum = Math.floor(980 / size);
    const characters = Array.from(value);
    do {
      let length = Math.min(maximum, characters.length);
      const font = heavy ? bold : normal;
      try {
        while (
          length > 1 &&
          font.widthOfTextAtSize(characters.slice(0, length).join(''), size) > 508
        )
          length--;
      } catch {
        length = Math.min(length, Math.floor(508 / size));
      }
      if (length < characters.length) {
        const space = characters.slice(0, length).lastIndexOf(' ');
        if (space > maximum / 2) length = space + 1;
      }
      const line = characters.splice(0, length).join('').trimEnd();
      ensure(size + 9);
      await drawLabel(page, line, 44, y, size, heavy ? bold : normal);
      y -= size + 9;
    } while (characters.length);
  }
  newPage();
  await text(s.title, 18, true);
  await text(
    `Exported ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC | ${s.pages.length} study pages`,
    9,
  );
  y -= 7;
  if (s.timerMode === 'off') {
    await text('Timing was disabled for this session.', 11, true);
  } else {
    await text(`Mode ${s.timerMode} | Active time ${timeLabel(totalMs(s))}`, 11, true);
    if (s.timerMode === 'countdown')
      await text(
        `Limit ${s.minutes} min | Overtime ${timeLabel((report.timing.overtimeSeconds || 0) * 1000)}`,
        10,
      );
    await text(
      'Time follows the displayed page while running. Frozen and hidden-tab time is excluded.',
      9,
    );
    await text('Closed-app time and uncertain gaps over five seconds are excluded.', 9);
  }
  if (report.timing.preset) {
    await text(
      `Preset ${report.timing.preset} | ${report.timing.examSystem || ''} ${report.timing.presetYear || ''}`,
      10,
    );
    if (report.timing.durationOverridden)
      await text(
        `Duration adjusted from ${report.timing.presetMinutes} min to ${s.minutes} min.`,
        10,
      );
  }
  if (s.source) {
    await text('Timing source', 8, true);
    await text(s.source, 7);
  }
  await text(`State at export ${s.status}`, 10);
  y -= 10;
  ensure(65);
  await text(s.timerMode === 'off' ? 'Pages and handwriting' : 'Time by page', 13, true);
  for (let index = 0; index < s.pages.length; index++) {
    const entry = s.pages[index];
    const duration = s.timerMode === 'off' ? 'Timing off' : timeLabel(entry.elapsedMs);
    await text(
      `${index + 1}   ${entry.label}   |   ${duration}   |   ${entry.strokes.length} ink strokes`,
      10,
    );
  }
  if (s.format !== 'written') {
    y -= 10;
    ensure(90);
    await text(
      `Multiple-choice answers (${Object.keys(s.answers).length}/${s.mcCount} answered)`,
      13,
      true,
    );
    await text('Selection timestamps record cumulative active study time.', 9);
    function row(values: string[], heavy = false) {
      values.forEach((value, index) =>
        page.drawText(value, {
          x: [44, 104, 164, 300][index],
          y,
          size: 9,
          font: heavy ? bold : normal,
        }),
      );
      y -= 17;
    }
    const heading = () =>
      row(['Question', 'Answer', 'Page when selected', 'Active time when selected'], true);
    heading();
    for (let question = s.mcStart; question < s.mcStart + s.mcCount; question++) {
      if (y - 18 < 58) {
        newPage();
        await text('Multiple-choice answers (continued)', 13, true);
        heading();
      }
      const answer = s.answers[String(question)];
      row([
        String(question),
        answer?.choice || '-',
        answer ? String(answer.page) : '-',
        !answer
          ? 'Unanswered'
          : answer.activeMs === null
            ? 'Timing off'
            : timeLabel(answer.activeMs),
      ]);
    }
  }
  y -= 10;
  ensure(70);
  await text('Session events', 13, true);
  if (!s.events.length) await text('No session events recorded.');
  const events = s.events.slice(-40);
  if (events.length < s.events.length)
    await text(
      `Most recent 40 of ${s.events.length} events. The JSON contains the full history.`,
      9,
    );
  for (const event of events)
    await text(
      `${event.at.replace('T', ' ').slice(0, 19)} UTC | ${event.type.replace(/_/g, ' ')} | ${event.activeMs === null ? 'Timing off' : timeLabel(event.activeMs)}`,
      8.4,
    );
  y -= 12;
  ensure(100);
  await text('For your study agent', 13, true);
  await text(
    'Review the annotated document and study data together. Explain relevant concepts, check working where present, identify unclear handwriting and suggest focused revision. Use a supplied mark scheme when assigning marks.',
    10,
  );
  doc.setTitle(s.title);
  doc.setSubject('Annotated PDF with optional study timing and multiple-choice answers');
  doc.setProducer('Paper Studio');
  await doc.attach(new TextEncoder().encode(JSON.stringify(report, null, 2)), 'study-data.json', {
    mimeType: 'application/json',
    description: 'Study timing, MC responses and session events',
  });
  return doc.save();
}
