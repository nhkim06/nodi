// 부모-자식 연결선 (NO:DI 마인드맵): 둥근 모서리로 꺾인 선 + 자식 쪽 끝점
// 자식이 부모 옆(좌/우)에 있으면 가로로, 위아래에 있으면(예전 세로 배치) 세로로 꺾는다.
import { nodeSize } from './layout.js';

const NS = 'http://www.w3.org/2000/svg';
const R = 14;      // 꺾이는 모서리 반경
const STUB = 36;   // 부모에서 꺾이는 지점까지 거리
const DOT_GAP = 0; // 끝점을 자식 테두리에 붙임

let svg;
const edges = new Map();   // childId -> { g, path, dot }

export function initEdges(svgEl) {
  svg = svgEl;
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
}

/** 가로 꺾은 선: (x1,y1) 부모 옆면 → 꺾는 기둥 x=mx → (x2,y2) 자식 옆면 */
function hPath(x1, y1, x2, y2) {
  const sx = Math.sign(x2 - x1) || 1;
  const sy = Math.sign(y2 - y1);
  const mx = x1 + sx * Math.min(STUB, Math.abs(x2 - x1) / 2);
  const r = Math.min(R, Math.abs(y2 - y1) / 2, Math.abs(mx - x1), Math.abs(x2 - mx));
  if (!sy || r < 1) return `M${x1},${y1} L${x2},${y2}`;
  return `M${x1},${y1} H${mx - sx * r} Q${mx},${y1} ${mx},${y1 + sy * r}`
    + ` V${y2 - sy * r} Q${mx},${y2} ${mx + sx * r},${y2} H${x2}`;
}

/** 세로 꺾은 선 (위→아래 배치) */
function vPath(x1, y1, x2, y2) {
  const sy = Math.sign(y2 - y1) || 1;
  const sx = Math.sign(x2 - x1);
  const my = y1 + sy * Math.min(STUB, Math.abs(y2 - y1) / 2);
  const r = Math.min(R, Math.abs(x2 - x1) / 2, Math.abs(my - y1), Math.abs(y2 - my));
  if (!sx || r < 1) return `M${x1},${y1} L${x2},${y2}`;
  return `M${x1},${y1} V${my - sy * r} Q${x1},${my} ${x1 + sx * r},${my}`
    + ` H${x2 - sx * r} Q${x2},${my} ${x2},${my + sy * r} V${y2}`;
}

function geometry(parent, child) {
  const ps = nodeSize(parent.id);
  const cs = nodeSize(child.id);
  const pcx = parent.x + ps.w / 2;
  const pcy = parent.y + ps.h / 2;
  const ccy = child.y + cs.h / 2;
  if (child.x >= parent.x + ps.w + 8) {          // 오른쪽
    const x2 = child.x - DOT_GAP;
    return { d: hPath(parent.x + ps.w, pcy, x2, ccy), dot: [x2, ccy] };
  }
  if (child.x + cs.w <= parent.x - 8) {          // 왼쪽
    const x2 = child.x + cs.w + DOT_GAP;
    return { d: hPath(parent.x, pcy, x2, ccy), dot: [x2, ccy] };
  }
  const ccx = child.x + cs.w / 2;
  if (child.y >= parent.y + ps.h) {              // 아래
    return { d: vPath(pcx, parent.y + ps.h, ccx, child.y), dot: [ccx, child.y] };
  }
  return { d: vPath(pcx, parent.y, ccx, child.y + cs.h), dot: [ccx, child.y + cs.h] };  // 위
}

export function renderEdges(s, visible) {
  const alive = new Set();
  for (const id of visible) {
    const child = s.nodes.get(id);
    if (!child?.parent_id || !visible.has(child.parent_id)) continue;
    const parent = s.nodes.get(child.parent_id);
    if (!parent) continue;

    const { d, dot } = geometry(parent, child);
    let e = edges.get(id);
    if (!e) {
      const g = document.createElementNS(NS, 'g');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'edge');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', 'edge-dot');
      c.setAttribute('r', '4.5');
      g.append(path, c);
      svg.append(g);
      e = { g, path, dot: c };
      edges.set(id, e);
    }
    if (e.path.getAttribute('d') !== d) e.path.setAttribute('d', d);
    e.dot.setAttribute('cx', String(dot[0]));
    e.dot.setAttribute('cy', String(dot[1]));

    const dim = s.filters.member && !(s.assignees.get(id)?.has(s.filters.member));
    const cls = ['edge-g', child.status === 'discarded' && 'edge-g--discarded', dim && 'edge-g--dim'].filter(Boolean).join(' ');
    if (e.g.getAttribute('class') !== cls) e.g.setAttribute('class', cls);
    alive.add(id);
  }
  for (const [id, e] of edges) {
    if (!alive.has(id)) { e.g.remove(); edges.delete(id); }
  }
}
