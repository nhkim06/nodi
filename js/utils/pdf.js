// 과제 문서 텍스트 추출 (브라우저). pdf.js / mammoth 는 필요할 때 CDN에서 로드한다.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error(`스크립트를 불러오지 못했어요: ${src}`)); };
      document.head.append(s);
    }));
  }
  return loaded.get(src);
}

export async function extractPdfText(file) {
  await loadScript(PDFJS);
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    // hasEOL 로 줄바꿈 유지
    pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
  }
  return pages.join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractDocxText(file) {
  await loadScript(MAMMOTH);
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

export const ACCEPT = '.pdf,.docx,.txt,.md';
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 파일 종류에 맞게 텍스트 추출. 지원하지 않으면 안내 메시지와 함께 throw */
export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (file.size > MAX_FILE_SIZE) throw new Error('파일이 너무 커요. 10MB 이하로 올려 주세요.');
  if (name.endsWith('.hwp') || name.endsWith('.hwpx')) {
    throw new Error('HWP 파일은 지원하지 않아요. PDF로 저장해서 올리거나 텍스트를 붙여넣어 주세요.');
  }
  let text;
  if (name.endsWith('.pdf')) text = await extractPdfText(file);
  else if (name.endsWith('.docx')) text = await extractDocxText(file);
  else if (name.endsWith('.txt') || name.endsWith('.md')) text = (await file.text()).trim();
  else throw new Error('PDF, DOCX, TXT, MD 파일만 올릴 수 있어요.');

  if (name.endsWith('.pdf') && text.replace(/\s/g, '').length < 30) {
    throw new Error('이미지로 된 PDF라 글자를 읽을 수 없어요. 텍스트를 직접 붙여넣어 주세요.');
  }
  return text;
}

export function mimeOf(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}
