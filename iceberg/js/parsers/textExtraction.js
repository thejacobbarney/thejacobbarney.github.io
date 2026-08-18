/**
 * Text extraction from uploaded documents (PDF / DOCX / plain text).
 *
 * The heavy libraries (pdf.js, mammoth.js) are self-hosted under
 * iceberg/vendor/ — see vendor/VERSIONS.md — and loaded lazily on first
 * use so they never add weight to the initial page load. Both are only
 * ever asked to extract raw text; nothing here understands resume
 * structure — that's resumeParser.js's job.
 *
 * TO EXTEND: to support a new file type, add a branch to
 * `extractTextFromFile()` and a matching `extractTextFrom<Type>()`
 * function. Nothing else needs to change.
 */

let pdfjsPromise = null;
let mammothPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdfjs/pdf.min.mjs').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        '../../vendor/pdfjs/pdf.worker.min.mjs',
        import.meta.url
      ).href;
      return pdfjsLib;
    });
  }
  return pdfjsPromise;
}

function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      if (window.mammoth) {
        resolve(window.mammoth);
        return;
      }
      const script = document.createElement('script');
      script.src = new URL('../../vendor/mammoth/mammoth.browser.min.js', import.meta.url).href;
      script.onload = () => resolve(window.mammoth);
      script.onerror = () => reject(new Error('Failed to load the DOCX reader (mammoth.js).'));
      document.head.appendChild(script);
    });
  }
  return mammothPromise;
}

/**
 * Groups a PDF page's text items into visual lines by clustering on their
 * vertical (baseline) position, then orders each line left-to-right. This
 * is a heuristic — multi-column layouts can interleave — but it's a solid
 * approximation for the single-column resumes/LinkedIn exports this tool
 * targets.
 */
function groupTextItemsIntoLines(items) {
  const Y_TOLERANCE = 3;
  const sorted = [...items].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]
  );
  const lines = [];
  let current = null;
  let currentY = null;
  for (const item of sorted) {
    const y = item.transform[5];
    if (current === null || Math.abs(y - currentY) > Y_TOLERANCE) {
      current = [];
      lines.push(current);
      currentY = y;
    }
    current.push(item);
  }
  return lines
    .map((lineItems) =>
      lineItems
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

export async function extractTextFromPdf(file) {
  const pdfjsLib = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    lines.push(...groupTextItemsIntoLines(content.items));
  }
  return lines.join('\n');
}

export async function extractTextFromDocx(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export async function extractTextFromTxt(file) {
  return file.text();
}

/** Dispatches to the right extractor based on file extension. */
export async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return extractTextFromPdf(file);
  if (ext === 'docx') return extractTextFromDocx(file);
  if (ext === 'txt' || ext === 'md') return extractTextFromTxt(file);
  throw new Error(`Unsupported file type ".${ext}". Supported: PDF, DOCX, TXT/MD.`);
}
