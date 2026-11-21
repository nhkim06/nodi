// DOM 헬퍼. 사용자 입력은 항상 textContent 로만 넣는다 (innerHTML 금지).

/**
 * h('div', { class: 'a', onclick: fn, dataset: { id } }, 'text', childEl, [more])
 * - 문자열/숫자 자식은 텍스트 노드로 들어간다.
 * - null/undefined/false 자식은 무시.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'value') value = v;   // 자식(option) 추가 후에 설정
    else if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 자식 교체. 포커스된 입력([data-key])의 값/커서를 보존한다. */
export function render(container, ...children) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset?.key : null;
  let saved = null;
  if (key && 'value' in active) {
    saved = { value: active.value, start: active.selectionStart, end: active.selectionEnd };
  }
  container.replaceChildren();
  append(container, children);
  if (key) {
    const next = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (next) {
      if (saved) {
        next.value = saved.value;
        next.focus();
        try { next.setSelectionRange(saved.start, saved.end); } catch { /* select 등 */ }
      } else next.focus();
    }
  }
}

// 토스트 ---------------------------------------------------------------------
let toastRoot;
export function toast(message, { type = 'info', duration = 2600 } = {}) {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  const t = h('div', { class: ['toast', type === 'error' && 'toast--error'] }, message);
  toastRoot.append(t);
  setTimeout(() => t.remove(), duration);
}

export const spinner = () => h('span', { class: 'spinner', 'aria-label': '로딩 중' });

/** http(s) URL 만 허용 (javascript: 등 차단) */
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
