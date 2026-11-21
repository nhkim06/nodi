// 전역 상태 + pub/sub. Supabase 가 원본이고 이 store 는 캐시다.
// 구독자는 (state, changedKeys:Set) 를 받고, 한 프레임에 한 번만 호출된다.

const state = {
  user: null,              // auth user
  session: null,
  project: null,
  members: new Map(),      // userId -> member (+profile, temperature, praise_count)
  nodes: new Map(),        // nodeId -> node
  assignees: new Map(),    // nodeId -> Map<userId, assigneeRow>
  aiComments: new Map(),   // nodeId | '__project__' -> comment[]
  requirements: [],
  docs: [],
  links: [],
  coverage: new Map(),     // requirementId -> { status, node_ids, reason } (최근 전체 점검)
  experiences: new Map(),  // userId -> member_experiences[] (팀원 경험 카드)
  plans: new Map(),        // nodeId -> node_plans 행 (_full=false 면 feasibility 등 요약만 있음)
  tasks: new Map(),        // nodeId -> node_tasks[] (할 일 목록, sort_order 순)
  pageView: 'map',         // 프로젝트 상세 메뉴: map | docs | team | links | mine
  selection: new Set(),    // 선택된 nodeId
  focus: [],               // 포커스 루트 nodeId[] (빈 배열 = 홈)
  view: { x: 0, y: 0, k: 1 },
  filters: { hideDiscarded: false, member: null, hideBubbles: false },
  aiBusy: new Set(),       // AI 처리 중인 nodeId (스피너)
  signalTime: {},          // 오늘 내 신호등 상태별 누적 초 { green, yellow, red }
  helpRequests: new Set(), // 나에게 도움 요청한 userId
  dropTarget: null,        // 드래그 중 hover 된 팀원 userId
  dragging: new Set(),     // 드래그 중인 nodeId (이 동안 Realtime 위치 갱신 무시)
  isDragging: false,       // 드래그 중엔 오른쪽 패널을 팀원 목록(드롭 타겟)으로
  expandedBubbles: new Set(),
};

const listeners = new Set();
let pending = new Set();
let scheduled = false;

export const getState = () => state;

function flush() {
  scheduled = false;
  const keys = pending;
  pending = new Set();
  for (const l of listeners) {
    try { l(state, keys); } catch (e) { console.error(e); }
  }
}

function schedule(keys) {
  for (const k of keys) pending.add(k);
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(flush);
  }
}

/** 얕은 병합 + 알림 */
export function setState(patch) {
  Object.assign(state, patch);
  schedule(Object.keys(patch));
}

/** Map/Set 등을 제자리에서 바꾼 뒤 알림 */
export function mutate(key, fn) {
  fn(state[key]);
  schedule([key]);
}

/** 키만 알림 (외부에서 이미 바꾼 경우) */
export const touch = (...keys) => schedule(keys);

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 편의 셀렉터 -------------------------------------------------------------------
export const PROJECT_KEY = '__project__';

export function rootNode() {
  for (const n of state.nodes.values()) if (!n.parent_id) return n;
  return null;
}

export function childrenOf(id) {
  const out = [];
  for (const n of state.nodes.values()) if (n.parent_id === id) out.push(n);
  return out.sort((a, b) => a.x - b.x || a.created_at?.localeCompare(b.created_at));
}

export function ancestorsOf(id) {
  const out = [];
  let cur = state.nodes.get(id);
  while (cur?.parent_id) {
    cur = state.nodes.get(cur.parent_id);
    if (cur) out.unshift(cur);
  }
  return out;
}

export function descendantIds(id) {
  const kids = new Map();
  for (const n of state.nodes.values()) {
    if (!n.parent_id) continue;
    if (!kids.has(n.parent_id)) kids.set(n.parent_id, []);
    kids.get(n.parent_id).push(n.id);
  }
  const out = [];
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop();
    out.push(cur);
    stack.push(...(kids.get(cur) ?? []));
  }
  return out;
}

export const assigneesOf = (nodeId) => [...(state.assignees.get(nodeId)?.values() ?? [])];
export const commentsOf = (nodeId) => state.aiComments.get(nodeId) ?? [];
export const me = () => state.members.get(state.user?.id);
export const planOf = (nodeId) => state.plans.get(nodeId) ?? null;

