// 보이는 노드 계산 / 새 노드 위치 / 영역 계산
import { getState, childrenOf, descendantIds, rootNode } from '../store.js';

export const NODE_W = 200;
export const NODE_H = 72;          // 측정 전 기본 높이

const sizes = new Map();           // nodeId -> { w, h } (renderNodes 가 측정해서 채움)
export const setNodeSize = (id, w, h) => sizes.set(id, { w, h });
export const nodeSize = (id) => sizes.get(id) ?? { w: NODE_W, h: NODE_H };
export const forgetNodeSize = (id) => sizes.delete(id);

/** 현재 포커스/필터 기준으로 보이는 노드 id 집합 */
export function visibleNodeIds(state = getState()) {
  const { nodes, focus, filters } = state;
  const out = new Set();
  const validFocus = focus.filter((id) => nodes.has(id));

  let candidates;
  if (validFocus.length) {
    candidates = new Set();
    for (const id of validFocus) {
      candidates.add(id);
      for (const d of descendantIds(id)) candidates.add(d);
    }
  } else {
    candidates = new Set(nodes.keys());
  }

  if (!filters.hideDiscarded) return candidates;

  // 버린 노드는 하위 트리째 숨김 (포커스 루트 자체는 남긴다)
  const hidden = new Set();
  for (const id of candidates) {
    const n = nodes.get(id);
    if (n.status === 'discarded' && !validFocus.includes(id)) {
      hidden.add(id);
      for (const d of descendantIds(id)) hidden.add(d);
    }
  }
  for (const id of candidates) if (!hidden.has(id)) out.add(id);
  return out;
}

// 마인드맵 배치 (NO:DI): 루트 자식은 오른쪽/왼쪽에 번갈아, 그 아래는 부모와 같은 방향으로 펼친다.
// supabase/functions/ai/handlers/generate_ideas.ts 의 배치 규칙과 맞춘다.
export const MAP_COL = 260;   // 부모 x → 자식 x 거리
export const MAP_ROW = 72;    // 형제 사이 세로 간격

/** parent 아래 새 자식이 들어갈 위치: 정한 방향의 형제들 아래 */
export function nextChildPosition(parentId) {
  const { nodes } = getState();
  const parent = nodes.get(parentId);
  if (!parent) return { x: 0, y: 0 };
  const root = rootNode();
  const kids = childrenOf(parentId);
  let side;
  if (!parent.parent_id || !root) {
    const right = kids.filter((k) => k.x >= parent.x).length;
    side = right <= kids.length - right ? 1 : -1;
  } else {
    side = parent.x >= root.x ? 1 : -1;
  }
  const sameSide = kids.filter((k) => (side > 0 ? k.x >= parent.x : k.x < parent.x));
  return {
    x: parent.x + side * MAP_COL,
    y: sameSide.length ? Math.max(...sameSide.map((k) => k.y)) + MAP_ROW : parent.y,
  };
}

/** 여러 노드의 경계 상자 (world 좌표) */
export function boundsOf(ids) {
  const { nodes } = getState();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const n = nodes.get(id);
    if (!n) continue;
    const { w, h } = nodeSize(id);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }
  if (minX === Infinity) {
    const r = rootNode();
    return r ? { minX: r.x, minY: r.y, maxX: r.x + NODE_W, maxY: r.y + NODE_H } : { minX: 0, minY: 0, maxX: NODE_W, maxY: NODE_H };
  }
  return { minX, minY, maxX, maxY };
}
