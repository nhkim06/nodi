// pan / zoom (CSS transform). 상태는 store.view = { x, y, k }
import { getState, setState } from '../store.js';
import { boundsOf } from './layout.js';

const MIN_K = 0.25;
const MAX_K = 2;

let vp;
let world;
let spaceDown = false;

export const isSpaceDown = () => spaceDown;
export const viewportEl = () => vp;

export function initViewport(viewportEl, worldEl, { onBlankClick, onMarquee } = {}) {
  vp = viewportEl;
  world = worldEl;

  // 휠: Ctrl/⌘ = 줌, 그 외 = 이동
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX, e.clientY, factor);
    } else {
      const { x, y, k } = getState().view;
      setState({ view: { x: x - e.deltaX, y: y - e.deltaY, k } });
    }
  }, { passive: false });

  // 빈 공간 드래그 = 이동 / Shift+드래그 = 범위 선택 / Space(또는 가운데 버튼)+드래그 = 어디서든 이동
  vp.addEventListener('pointerdown', (e) => {
    const onBlank = e.target === vp || e.target === world || e.target.closest('.edges');
    const panAnywhere = spaceDown || e.button === 1;
    if (!(onBlank || panAnywhere) || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault();

    if (onBlank && e.shiftKey && !panAnywhere) return startMarquee(e, onMarquee);

    const start = { cx: e.clientX, cy: e.clientY, ...getState().view };
    let moved = false;
    vp.setPointerCapture(e.pointerId);
    vp.classList.add('viewport--panning');

    const move = (ev) => {
      const dx = ev.clientX - start.cx;
      const dy = ev.clientY - start.cy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setState({ view: { x: start.x + dx, y: start.y + dy, k: start.k } });
    };
    const up = () => {
      vp.removeEventListener('pointermove', move);
      vp.removeEventListener('pointerup', up);
      vp.removeEventListener('pointercancel', up);
      vp.classList.remove('viewport--panning');
      if (!moved && onBlank) onBlankClick?.();
    };
    vp.addEventListener('pointermove', move);
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
  });

  // Space 누르는 동안 이동 모드
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e.target)) {
      e.preventDefault();
      if (!spaceDown) { spaceDown = true; vp.classList.add('viewport--space'); }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; vp.classList.remove('viewport--space'); }
  });
  window.addEventListener('blur', () => { spaceDown = false; vp.classList.remove('viewport--space'); });
}

function startMarquee(e, onMarquee) {
  const rect = vp.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'marquee';
  vp.append(box);
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  vp.setPointerCapture(e.pointerId);
  let cur = { x: sx, y: sy };

  const draw = () => {
    Object.assign(box.style, {
      left: `${Math.min(sx, cur.x)}px`, top: `${Math.min(sy, cur.y)}px`,
      width: `${Math.abs(cur.x - sx)}px`, height: `${Math.abs(cur.y - sy)}px`,
    });
  };
  const move = (ev) => { cur = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }; draw(); };
  const up = () => {
    vp.removeEventListener('pointermove', move);
    vp.removeEventListener('pointerup', up);
    vp.removeEventListener('pointercancel', up);
    box.remove();
    const a = screenToWorld(rect.left + Math.min(sx, cur.x), rect.top + Math.min(sy, cur.y));
    const b = screenToWorld(rect.left + Math.max(sx, cur.x), rect.top + Math.max(sy, cur.y));
    onMarquee?.({ minX: a.x, minY: a.y, maxX: b.x, maxY: b.y });
  };
  draw();
  vp.addEventListener('pointermove', move);
  vp.addEventListener('pointerup', up);
  vp.addEventListener('pointercancel', up);
}

export const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export function applyView({ x, y, k }) {
  if (world) world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
}

export function screenToWorld(clientX, clientY) {
  const rect = vp.getBoundingClientRect();
  const { x, y, k } = getState().view;
  return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k };
}

export function zoomAt(clientX, clientY, factor) {
  const rect = vp.getBoundingClientRect();
  const { x, y, k } = getState().view;
  const nk = Math.min(MAX_K, Math.max(MIN_K, k * factor));
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  // 커서 아래 world 좌표가 그대로 유지되도록
  setState({ view: { k: nk, x: px - ((px - x) / k) * nk, y: py - ((py - y) / k) * nk } });
}

export function zoomBy(factor) {
  const rect = vp.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

export function resetZoom() {
  const { k } = getState().view;
  zoomBy(1 / k);
}

/** 주어진 노드들이 화면에 다 들어오게 */
export function fitTo(ids, { padding = 80, maxK = 1 } = {}) {
  if (!vp) return;
  const b = boundsOf(ids);
  const rect = vp.getBoundingClientRect();
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const k = Math.min(maxK, Math.max(MIN_K, Math.min((rect.width - padding * 2) / w, (rect.height - padding * 2) / h)));
  setState({
    view: {
      k,
      x: rect.width / 2 - (b.minX + w / 2) * k,
      y: rect.height / 2 - (b.minY + h / 2) * k,
    },
  });
}

/** 노드 하나를 화면 가운데로 (줌 유지) */
export function centerOn(id) {
  const n = getState().nodes.get(id);
  if (!n || !vp) return;
  const rect = vp.getBoundingClientRect();
  const { k } = getState().view;
  setState({ view: { k, x: rect.width / 2 - (n.x + 100) * k, y: rect.height / 2 - (n.y + 36) * k } });
}
