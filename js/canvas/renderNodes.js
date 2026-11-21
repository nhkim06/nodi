// 노드 DOM 생성/갱신 (id 기준 keyed diff)
import { h } from '../utils/dom.js';
import { avatar } from '../utils/color.js';
import { assigneesOf, commentsOf, getState, touch } from '../store.js';
import { setNodeSize, forgetNodeSize } from './layout.js';

const els = new Map();   // nodeId -> element
let layer;
let editing = null;      // { id, onDone }

export function initNodes(container) {
  layer = container;
}

export const nodeEl = (id) => els.get(id);

function signature(node, s) {
  const as = assigneesOf(node.id).map((a) => `${a.user_id}:${s.members.get(a.user_id)?.color}`).join(',');
  const dim = s.filters.member && !s.assignees.get(node.id)?.has(s.filters.member);
  return [
    node.title, node.description, node.status, node.is_candidate, node.source, node.parent_id,
    as, s.selection.has(node.id), s.aiBusy.has(node.id), dim,
    commentsOf(node.id).length, s.filters.hideBubbles, s.plans.get(node.id)?.feasibility ?? '',
  ].join('|');
}

/** 실행 가능성 배지 ●●●●○ */
function feasBadge(f) {
  if (!f) return null;
  return h('span', { class: ['node__feas', `node__feas--${f}`], title: `우리 팀 기준 실행 가능성 ${f}/5` },
    '●'.repeat(f) + '○'.repeat(5 - f));
}

function fill(el, node, s) {
  const assignees = assigneesOf(node.id);
  const colors = assignees.map((a) => s.members.get(a.user_id)?.color).filter(Boolean);
  const dim = s.filters.member && !s.assignees.get(node.id)?.has(s.filters.member);
  const comments = commentsOf(node.id).length;
  const feas = s.plans.get(node.id)?.feasibility;

  el.className = [
    'node', `node--${node.status}`,
    !node.parent_id && 'node--root',
    s.selection.has(node.id) && 'node--selected',
    dim && 'node--dim',
    s.dragging.has(node.id) && 'node--dragging',
  ].filter(Boolean).join(' ');
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', node.title);

  // 조건부 자식(null/undefined/0/false)이 "null" 같은 글자로 찍히지 않게 DOM 노드만 넣는다
  el.replaceChildren(...[
    h('div', { class: 'node__stripe' }, colors.map((c) => h('span', { style: { background: c } }))),
    h('div', { class: 'node__badges' },
      node.is_candidate && h('span', { class: 'node__badge node__badge--candidate', title: '후보' }, '후보'),
      node.source === 'ai' && h('span', { class: 'node__badge node__badge--ai', title: 'AI가 만든 아이디어' }, 'AI'),
      node.status === 'adopted' && h('span', { class: 'node__badge node__badge--adopted', title: '채택' }, '✓'),
      node.status === 'discarded' && h('span', { class: 'node__badge node__badge--discarded', title: '버림' }, '✕'),
    ),
    h('div', { class: 'node__title' }, node.title),
    node.description && h('div', { class: 'node__desc' }, node.description),
    (assignees.length > 0 || !!feas || (comments > 0 && s.filters.hideBubbles)) && h('div', { class: 'node__footer' },
      h('div', { class: 'node__avatars' }, assignees.slice(0, 5).map((a) => avatar(s.members.get(a.user_id)))),
      feasBadge(feas),
      comments > 0 && s.filters.hideBubbles && h('span', { class: 'node__comments' }, `댓글 ${comments}개`),
    ),
    s.aiBusy.has(node.id) && h('div', { class: 'node__spinner' }, h('span', { class: 'spinner' })),
  ].filter((c) => c instanceof Node));
}

/** visible: Set<nodeId> */
export function renderNodes(s, visible) {
  for (const [id, el] of els) {
    if (!visible.has(id) || !s.nodes.has(id)) {
      if (editing?.id === id) editing = null;
      el.remove();
      els.delete(id);
      forgetNodeSize(id);
    }
  }

  const changed = [];
  for (const id of visible) {
    const node = s.nodes.get(id);
    if (!node) continue;
    let el = els.get(id);
    if (!el) {
      el = h('div', { class: 'node', dataset: { id }, tabindex: '-1' });
      layer.append(el);
      els.set(id, el);
    }
    if (editing?.id !== id) {
      const sig = signature(node, s);
      if (el._sig !== sig) {
        fill(el, node, s);
        el._sig = sig;
        changed.push(id);
      }
    }
    el.classList.toggle('node--dragging', s.dragging.has(id));
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
  }

  // 내용이 바뀐 노드만 크기 측정 (엣지/말풍선 위치 계산용)
  for (const id of changed) {
    const el = els.get(id);
    setNodeSize(id, el.offsetWidth, el.offsetHeight);
  }
  return changed.length > 0;
}

/** 드래그로 패널 위에 있을 때 표시 */
export function markDropOut(ids, on) {
  for (const id of ids) els.get(id)?.classList.toggle('node--drop-out', on);
}

export function flashNodes(ids) {
  for (const id of ids) {
    const el = els.get(id);
    if (!el) continue;
    el.classList.remove('node--flash');
    void el.offsetWidth;   // 애니메이션 재시작
    el.classList.add('node--flash');
    setTimeout(() => el.classList.remove('node--flash'), 1600);
  }
}

/**
 * 제목 인라인 편집. onDone(newTitle | null) — null = 취소
 */
export function startEditing(id, onDone) {
  const el = els.get(id);
  const node = getState().nodes.get(id);
  if (!el || !node) return false;
  finishEditing(true);
  const titleEl = el.querySelector('.node__title');
  if (!titleEl) return false;

  const input = h('input', { class: 'node__edit', value: node.title, maxlength: '100', 'aria-label': '노드 제목' });
  titleEl.replaceChildren(input);
  editing = { id, onDone, input };
  input.focus();
  input.select();

  const stop = (e) => e.stopPropagation();
  input.addEventListener('pointerdown', stop);
  input.addEventListener('dblclick', stop);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finishEditing(true); }
    if (e.key === 'Escape') { e.preventDefault(); finishEditing(false); }
    if (e.key === 'Tab') { e.preventDefault(); finishEditing(true); }
  });
  input.addEventListener('blur', () => finishEditing(true));
  return true;
}

export function finishEditing(commit) {
  if (!editing) return;
  const { id, onDone, input } = editing;
  editing = null;
  const value = input.value.trim();
  const el = els.get(id);
  if (el) el._sig = null;   // 다음 렌더에서 다시 그림
  touch('nodes');
  onDone?.(commit && value ? value.slice(0, 100) : null);
}

export const isEditing = () => !!editing;
