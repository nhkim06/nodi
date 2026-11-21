// 선택, 드래그 이동, 팀원 패널로 드롭(담당자 지정), 더블클릭 생성, 단축키
import { getState, setState, mutate } from '../store.js';
import { h } from '../utils/dom.js';
import { saveNodePositions } from '../api/nodes.js';
import { isSpaceDown, isTyping, screenToWorld } from './viewport.js';
import { markDropOut, isEditing } from './renderNodes.js';
import { visibleNodeIds, nodeSize } from './layout.js';
import {
  selectOnly, toggleSelect, clearSelection, addChild, addSibling, createAt, defaultParentId,
  renameInteractive, deleteWithConfirm, assign, undoLastCreate,
} from '../actions.js';

const DRAG_THRESHOLD = 4;

// 빈 곳 클릭으로 선택이 풀린 직후의 더블클릭은 "선택했던 노드의 자식 생성"으로 본다
let lastCleared = { ids: [], at: 0 };

/** 빈 곳 클릭 → 선택 해제 (직전 선택은 더블클릭용으로 기억) */
export function blankClick() {
  const ids = [...getState().selection];
  if (ids.length) lastCleared = { ids, at: Date.now() };
  clearSelection();
}

export function initInteractions({ viewport, nodesLayer }) {
  // 노드 pointerdown → 선택 + 드래그 준비
  nodesLayer.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.node');
    if (!el || e.button !== 0 || isSpaceDown() || e.target.closest('input')) return;
    e.stopPropagation();
    const id = el.dataset.id;
    const { selection } = getState();

    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSelect(id);
      return;   // 다중 선택 토글 시에는 드래그하지 않음
    }
    if (!selection.has(id)) selectOnly(id);
    startDrag(e, id, viewport);
  });

  // 노드 더블클릭 = 제목 편집
  nodesLayer.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.node');
    if (!el) return;
    e.stopPropagation();
    renameInteractive(el.dataset.id);
  });

  // 빈 곳 더블클릭 = 새 노드 (선택된 노드가 있으면 그 자식)
  viewport.addEventListener('dblclick', (e) => {
    if (e.target.closest('.node, .bubble-stack, .zoom')) return;
    const recent = Date.now() - lastCleared.at < 600 && lastCleared.ids.length === 1 ? lastCleared.ids[0] : null;
    const parentId = recent && getState().nodes.has(recent) ? recent : defaultParentId();
    if (!parentId) return;
    const p = screenToWorld(e.clientX, e.clientY);
    createAt(parentId, p.x, p.y);
  });

  // 단축키
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || isEditing() || document.querySelector('.modal-backdrop')) return;
    // 버튼/링크에 포커스가 있으면 Enter·Space 는 그 요소의 기본 동작
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button, a, summary')) return;
    const sel = [...getState().selection];
    const single = sel.length === 1 ? sel[0] : null;

    if (e.key === 'Tab' && single) { e.preventDefault(); addChild(single); }
    else if (e.key === 'Enter' && single && !e.isComposing) { e.preventDefault(); addSibling(single); }
    else if (e.key === 'F2' && single) { e.preventDefault(); renameInteractive(single); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); deleteWithConfirm(sel); }
    else if (e.key === 'Escape') clearSelection();
    else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      undoLastCreate();
    }
    else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setState({ selection: new Set(visibleNodeIds()) });
    }
  });
}

function idsInBox(box) {
  const { nodes } = getState();
  const ids = [];
  for (const id of visibleNodeIds()) {
    const n = nodes.get(id);
    const { w, h: ht } = nodeSize(id);
    if (n.x < box.maxX && n.x + w > box.minX && n.y < box.maxY && n.y + ht > box.minY) ids.push(id);
  }
  return ids;
}

/** Shift+드래그 범위 선택 결과 */
export function selectInBox(box) {
  const ids = idsInBox(box);
  mutate('selection', (s) => ids.forEach((id) => s.add(id)));
}

/**
 * 우클릭: 드래그했으면 범위 안 노드를 선택(Shift 면 추가), 그냥 클릭이면 그 노드를 선택.
 * 선택된 노드가 있으면 그 자리에 삭제 메뉴를 띄운다.
 */
export function rightSelect({ box, nodeId, clientX, clientY, additive }) {
  closeContextMenu();
  if (box) {
    const ids = idsInBox(box);
    if (additive) mutate('selection', (s) => ids.forEach((id) => s.add(id)));
    else setState({ selection: new Set(ids) });
  } else if (nodeId) {
    if (!getState().selection.has(nodeId)) selectOnly(nodeId);
  } else {
    return;
  }
  const sel = [...getState().selection].filter((id) => getState().nodes.has(id));
  if (!sel.length) return;
  openContextMenu(clientX, clientY, sel);
}

let ctxMenu = null;
function closeContextMenu() {
  if (!ctxMenu) return;
  ctxMenu.cleanup();
  ctxMenu = null;
}

function openContextMenu(x, y, ids) {
  const el = h('div', { class: 'ctx-menu', role: 'menu' },
    h('div', { class: 'ctx-menu__label' }, `노드 ${ids.length}개 선택됨`),
    h('button', {
      class: 'ctx-menu__item ctx-menu__item--danger', role: 'menuitem',
      onclick: () => { closeContextMenu(); deleteWithConfirm(ids); },
    }, `🗑 ${ids.length > 1 ? `${ids.length}개 ` : ''}삭제`));
  document.body.append(el);
  // 화면 밖으로 나가지 않게
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  el.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;

  const onDown = (e) => { if (!el.contains(e.target)) closeContextMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeContextMenu(); } };
  setTimeout(() => {
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
  }, 0);
  ctxMenu = {
    cleanup: () => {
      el.remove();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    },
  };
}

function startDrag(e, id, viewport) {
  const state = getState();
  const ids = [...state.selection].filter((x) => state.nodes.has(x));
  if (!ids.includes(id)) ids.push(id);
  const origin = new Map(ids.map((x) => [x, { x: state.nodes.get(x).x, y: state.nodes.get(x).y }]));
  const start = { cx: e.clientX, cy: e.clientY };
  let dragging = false;
  let ghost = null;
  let dropTarget = null;

  viewport.setPointerCapture(e.pointerId);

  const findDropTarget = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const inPanel = el?.closest('.app__right');
    const target = el?.closest('[data-drop-member]');
    return { inPanel: !!inPanel, userId: target?.dataset.dropMember ?? null };
  };

  const move = (ev) => {
    const dx = ev.clientX - start.cx;
    const dy = ev.clientY - start.cy;
    if (!dragging) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      dragging = true;
      mutate('dragging', (s) => ids.forEach((x) => s.add(x)));
      setState({ isDragging: true });
    }
    const { k } = getState().view;
    mutate('nodes', (m) => {
      for (const x of ids) {
        const o = origin.get(x);
        const n = m.get(x);
        if (n) m.set(x, { ...n, x: o.x + dx / k, y: o.y + dy / k });
      }
    });

    // 오른쪽 패널 위면 고스트 표시 + 드롭 대상 하이라이트
    const { inPanel, userId } = findDropTarget(ev);
    if (inPanel) {
      if (!ghost) {
        const title = ids.length > 1 ? `노드 ${ids.length}개` : getState().nodes.get(id)?.title;
        ghost = h('div', { class: 'drag-ghost' }, `👤 ${title}`);
        document.body.append(ghost);
        markDropOut(ids, true);
      }
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    } else if (ghost) {
      ghost.remove();
      ghost = null;
      markDropOut(ids, false);
    }
    if (userId !== dropTarget) {
      dropTarget = userId;
      setState({ dropTarget });
    }
  };

  const up = async (ev) => {
    viewport.removeEventListener('pointermove', move);
    viewport.removeEventListener('pointerup', up);
    viewport.removeEventListener('pointercancel', up);
    ghost?.remove();
    markDropOut(ids, false);
    if (!dragging) {
      // 다중 선택 중 한 노드를 그냥 클릭하면 그 노드만 선택
      if (ev.type === 'pointerup' && getState().selection.size > 1) selectOnly(id);
      return;
    }

    const { inPanel, userId } = ev.type === 'pointercancel' ? { inPanel: true, userId: null } : findDropTarget(ev);
    if (inPanel) {
      // 패널 위에서 놓으면 노드는 원래 위치로 (이동하지 않음)
      mutate('nodes', (m) => {
        for (const x of ids) {
          const n = m.get(x);
          if (n) m.set(x, { ...n, ...origin.get(x) });
        }
      });
    }
    mutate('dragging', (s) => s.clear());
    setState({ isDragging: false, dropTarget: null });

    if (inPanel) {
      if (userId) await assign(ids, userId);
      return;
    }
    const nodes = getState().nodes;
    const moved = ids.map((x) => nodes.get(x)).filter(Boolean).map((n) => ({ id: n.id, x: n.x, y: n.y }));
    await saveNodePositions(moved);
  };

  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
}
