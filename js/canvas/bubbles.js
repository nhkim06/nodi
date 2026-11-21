// AI 코멘트 말풍선 — #world 안에 그려서 노드 이동/줌을 따라간다
import { h } from '../utils/dom.js';
import { BUBBLE_KINDS } from '../utils/color.js';
import { commentsOf, mutate } from '../store.js';
import { dismissComment, commentTitle, commentBody } from '../api/ai.js';
import { nodeSize } from './layout.js';
import { addNodeFromComment } from '../actions.js';
import { expLabelMap, expChip, reqChip } from '../utils/experience.js';

let layer;
const stacks = new Map();   // nodeId -> element

export function initBubbles(container) {
  layer = container;
  // 말풍선 위에서 캔버스 이동/선택이 시작되지 않게
  layer.addEventListener('pointerdown', (e) => e.stopPropagation());
  layer.addEventListener('dblclick', (e) => e.stopPropagation());
}

/** 요구사항 id → 'R3' 라벨 + 원문 */
export function reqLabelMap(requirements) {
  const m = new Map();
  requirements.forEach((r, i) => m.set(r.id, { label: `R${i + 1}`, content: r.content }));
  return m;
}

export function bubbleEl(c, reqMap, { compact = false, expMap = new Map() } = {}) {
  const kind = BUBBLE_KINDS[c.kind] ?? BUBBLE_KINDS.feedback;
  const titled = c.kind === 'gap' || c.kind === 'suggestion';
  const refs = (c.requirement_ids ?? []).map((id) => reqMap.get(id)).filter(Boolean);
  const exps = (c.experience_ids ?? []).map((id) => expMap.get(id)).filter(Boolean);

  return h('div', { class: ['bubble', `bubble--${c.kind}`], dataset: { commentId: c.id } },
    h('div', { class: 'bubble__head' },
      h('span', {}, kind.label),
      h('button', { class: 'bubble__x', title: '숨기기 (팀 전체)', 'aria-label': '말풍선 숨기기', onclick: () => dismissComment(c.id) }, '✕'),
    ),
    titled
      ? [h('div', { class: 'bubble__body', style: { fontWeight: '700' } }, commentTitle(c)),
        commentBody(c) && h('div', { class: 'bubble__body' }, commentBody(c))]
      : h('div', { class: 'bubble__body' }, c.content),
    (refs.length > 0 || exps.length > 0) && h('div', { class: 'bubble__refs' },
      refs.map(reqChip), exps.map(expChip)),
    !compact && titled && h('div', { class: 'bubble__actions' },
      h('button', { class: 'btn btn--sm', onclick: () => addNodeFromComment(c) },
        c.kind === 'gap' ? '＋ 노드로 추가' : '＋ 노드로 만들기')),
  );
}

export function renderBubbles(s, visible) {
  const show = !s.filters.hideBubbles;
  const reqMap = reqLabelMap(s.requirements);
  const expMap = expLabelMap(s);
  const expSig = [...expMap.values()].map((e) => `${e.label}${e.exp.id}`).join(',');
  const alive = new Set();

  if (show) {
    for (const id of visible) {
      const list = commentsOf(id);
      const node = s.nodes.get(id);
      if (!list.length || !node) continue;
      alive.add(id);

      const expanded = s.expandedBubbles.has(id);
      const sig = `${list.map((c) => c.id).join(',')}|${expanded}|${s.requirements.map((r) => r.id).join(',')}|${expSig}`;
      let el = stacks.get(id);
      if (!el) {
        el = h('div', { class: 'bubble-stack' });
        layer.append(el);
        stacks.set(id, el);
      }
      if (el._sig !== sig) {
        el._sig = sig;
        const shown = expanded ? list : list.slice(-1);   // 기본은 최신 1개
        el.replaceChildren(
          ...shown.map((c) => bubbleEl(c, reqMap, { expMap })),
          list.length > 1 && h('button', {
            class: 'bubble__more',
            onclick: () => mutate('expandedBubbles', (set) => (expanded ? set.delete(id) : set.add(id))),
          }, expanded ? '접기' : `+${list.length - 1}`),
        );
      }
      const { w } = nodeSize(id);
      el.style.left = `${node.x + w + 14}px`;
      el.style.top = `${node.y}px`;
    }
  }

  for (const [id, el] of stacks) {
    if (!alive.has(id)) { el.remove(); stacks.delete(id); }
  }
}
