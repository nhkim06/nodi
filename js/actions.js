// 여러 화면(캔버스, 사이드바, Inspector, 말풍선)이 공유하는 고수준 동작
import { getState, setState, mutate, rootNode, descendantIds, me, PROJECT_KEY } from './store.js';
import { toast } from './utils/dom.js';
import * as nodesApi from './api/nodes.js';
import { addAssignee } from './api/assignees.js';
import { runAI, withBusy, replaceCommentsLocal, addCommentLocal, dismissComment, commentTitle } from './api/ai.js';
import { upsertPlanLocal } from './api/plans.js';
import { replaceAiTasksLocal } from './api/tasks.js';
import { nextChildPosition, visibleNodeIds } from './canvas/layout.js';
import { startEditing, flashNodes } from './canvas/renderNodes.js';
import { fitTo, centerOn } from './canvas/viewport.js';
import { goHome } from './router.js';
import { confirmModal, progressModal, showReviewResult, showRolesResult } from './panels/modals.js';

// 선택 ---------------------------------------------------------------------------
export const selectOnly = (id) => setState({ selection: new Set(id ? [id] : []) });
export const clearSelection = () => setState({ selection: new Set() });
export function toggleSelect(id) {
  mutate('selection', (s) => (s.has(id) ? s.delete(id) : s.add(id)));
}

/** 노드로 이동: 현재 뷰에서 안 보이면 홈으로 나간 뒤 가운데로 */
export function revealNode(id) {
  if (!getState().nodes.has(id)) return;
  const show = () => {
    selectOnly(id);
    requestAnimationFrame(() => requestAnimationFrame(() => centerOn(id)));
  };
  if (!visibleNodeIds().has(id)) {
    if (getState().filters.hideDiscarded) {
      setState({ filters: { ...getState().filters, hideDiscarded: false } });
    }
    if (getState().focus.length) {
      // 라우터가 홈으로 바꾸며 선택을 초기화한 다음에 선택/이동
      window.addEventListener('hashchange', () => setTimeout(show, 0), { once: true });
      goHome();
      return;
    }
  }
  show();
}

// 되돌리기 (Ctrl+Z) — 이번 세션에서 만든 노드 생성을 취소 ----------------------------------
const undoStack = [];
const UNDO_LIMIT = 50;

function pushCreated(ids) {
  if (!ids?.length) return;
  undoStack.push(ids);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

/** 가장 최근에 만든 노드(들)를 지운다. 이미 지워진 기록은 건너뜀 */
export async function undoLastCreate() {
  const { nodes } = getState();
  let ids = [];
  while (undoStack.length && !ids.length) {
    ids = undoStack.pop().filter((id) => nodes.has(id));
  }
  if (!ids.length) { toast('되돌릴 작업이 없어요.'); return; }
  // 조상이 같이 지워지는 노드는 따로 지울 필요 없음
  const topLevel = ids.filter((id) => {
    let cur = nodes.get(id);
    while (cur?.parent_id) {
      if (ids.includes(cur.parent_id)) return false;
      cur = nodes.get(cur.parent_id);
    }
    return true;
  });
  for (const id of topLevel) {
    try { await nodesApi.deleteNode(id); } catch { /* 토스트 처리됨 */ }
  }
  toast(ids.length > 1 ? `노드 ${ids.length}개 추가를 되돌렸어요.` : '노드 추가를 되돌렸어요.');
}

// 노드 생성 / 편집 ------------------------------------------------------------------
async function createAndEdit(parentId, pos) {
  const node = await nodesApi.createNode({ parent_id: parentId, title: '새 아이디어', x: pos.x, y: pos.y });
  pushCreated([node.id]);
  selectOnly(node.id);
  // 렌더된 다음 프레임에 편집 시작
  requestAnimationFrame(() => requestAnimationFrame(() => renameInteractive(node.id)));
  return node;
}

/** 기본 부모: 선택 노드 1개 → 포커스 첫 노드 → root */
export function defaultParentId() {
  const { selection, focus, nodes } = getState();
  if (selection.size === 1) return [...selection][0];
  const f = focus.find((id) => nodes.has(id));
  return f ?? rootNode()?.id;
}

export function addChild(parentId = defaultParentId()) {
  if (!parentId) return;
  return createAndEdit(parentId, nextChildPosition(parentId));
}

export function addSibling(id) {
  const node = getState().nodes.get(id);
  if (!node?.parent_id) return addChild(id);
  return createAndEdit(node.parent_id, nextChildPosition(node.parent_id));
}

export function createAt(parentId, x, y) {
  return createAndEdit(parentId, { x: x - 100, y: y - 28 });
}

export function renameInteractive(id) {
  startEditing(id, async (title) => {
    const node = getState().nodes.get(id);
    if (!title || !node || title === node.title) return;
    try { await nodesApi.updateNode(id, { title }); } catch { /* 토스트 처리됨 */ }
  }, {
    // 방금 만든 노드를 편집 중일 때만 Ctrl+Z 로 생성 취소 (기존 노드 이름 바꾸는 중엔 엉뚱한 노드가 지워지지 않게)
    onUndo: undoStack.at(-1)?.includes(id) ? () => undoLastCreate() : undefined,
    onDelete: () => {
      const node = getState().nodes.get(id);
      if (!node?.parent_id) return;
      // 하위 노드가 없으면 확인 없이 바로 삭제 (방금 만든 노드를 지우는 흐름)
      if (!descendantIds(id).length) {
        nodesApi.deleteNode(id).catch(() => {});
        return;
      }
      deleteWithConfirm([id]);
    },
  });
}

// 상태 ----------------------------------------------------------------------------
export async function setStatusMany(ids, status) {
  const { nodes } = getState();
  await Promise.all(ids.map((id) => {
    const n = nodes.get(id);
    if (!n || !n.parent_id && status === 'discarded') return null;
    if (status === 'restore') return n.status === 'discarded' ? nodesApi.restore(n) : null;
    return n.status === status ? null : nodesApi.setStatus(n, status);
  }).filter(Boolean)).catch(() => {});
}

export function toggleCandidate(id) {
  const n = getState().nodes.get(id);
  if (n) nodesApi.updateNode(id, { is_candidate: !n.is_candidate }).catch(() => {});
}

export async function deleteWithConfirm(ids) {
  const { nodes } = getState();
  const targets = ids.filter((id) => nodes.get(id)?.parent_id);
  if (!targets.length) {
    toast('프로젝트 주제(루트) 노드는 삭제할 수 없어요.');
    return;
  }
  const all = new Set();
  for (const id of targets) { all.add(id); descendantIds(id).forEach((d) => all.add(d)); }
  const extra = all.size - targets.length;
  const title = targets.length === 1 ? `'${nodes.get(targets[0]).title}'` : `노드 ${targets.length}개`;
  const ok = await confirmModal(
    `${title}를 삭제할까요?${extra ? `\n하위 노드 ${extra}개도 함께 삭제돼요.` : ''}\n삭제하면 되돌릴 수 없어요. 보관하려면 '버림'을 쓰세요.`,
    { okText: '삭제', danger: true },
  );
  if (!ok) return;
  // 조상이 같이 지워지는 노드는 따로 지울 필요 없음
  const topLevel = targets.filter((id) => {
    let cur = nodes.get(id);
    while (cur?.parent_id) {
      if (targets.includes(cur.parent_id)) return false;
      cur = nodes.get(cur.parent_id);
    }
    return true;
  });
  for (const id of topLevel) {
    try { await nodesApi.deleteNode(id); } catch { /* 토스트 처리됨 */ }
  }
}

// 담당자 ---------------------------------------------------------------------------
export async function assign(nodeIds, userId) {
  const member = getState().members.get(userId);
  const name = member?.profile?.display_name ?? '팀원';
  let added = 0;
  for (const id of nodeIds) {
    try { if (await addAssignee(id, userId)) added++; } catch { /* 토스트 처리됨 */ }
  }
  if (added) toast(`${name}님을 담당자로 지정했어요.`);
  else toast(`${name}님은 이미 담당자예요.`);
}

// AI -------------------------------------------------------------------------------
export async function aiGenerate(parentIds, { count = 5, hint = '' } = {}) {
  const ids = parentIds?.length ? parentIds : [defaultParentId()].filter(Boolean);
  try {
    const res = await withBusy(ids, () => runAI('generate_ideas', { parentIds: ids, count, hint }));
    for (const n of res.nodes ?? []) nodesApi.upsertNodeLocal(n);
    for (const p of res.plans ?? []) upsertPlanLocal(p, true);
    if (!res.nodeIds?.length) return toast('새 아이디어를 만들지 못했어요. 다른 요청으로 다시 시도해 보세요.');
    pushCreated(res.nodeIds);
    toast(`✨ 아이디어 ${res.nodeIds.length}개를 추가했어요.`);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      flashNodes(res.nodeIds);
      fitTo([...ids, ...res.nodeIds]);
    }));
  } catch { /* runAI 가 토스트 */ }
}

/** A8 아이디어 구체화. 팀원이 직접 고친 계획이면 덮어쓸지 먼저 묻는다. */
export async function aiConcretize(nodeId, { overwrite = false } = {}) {
  const plan = getState().plans.get(nodeId);
  if (!overwrite && plan?.edited_by_user) {
    const ok = await confirmModal('팀원이 직접 수정한 실행 계획이 있어요.\nAI가 새로 구체화한 내용으로 덮어쓸까요?', { okText: '덮어쓰기' });
    if (!ok) return;
    overwrite = true;
  }
  try {
    const res = await withBusy([nodeId], () =>
      runAI('concretize_node', { nodeId, overwrite }, { quietStatuses: [409] }));
    if (res.plan) upsertPlanLocal(res.plan, true);
    replaceAiTasksLocal(nodeId, res.tasks ?? []);
    toast(`우리 팀 기준 실행 계획${res.tasks?.length ? `과 할 일 ${res.tasks.length}개` : ''}를 만들었어요.`);
  } catch (e) {
    if (e.status === 409 && !overwrite) {
      const ok = await confirmModal('팀원이 직접 수정한 실행 계획이 있어요.\nAI가 새로 구체화한 내용으로 덮어쓸까요?', { okText: '덮어쓰기' });
      if (ok) return aiConcretize(nodeId, { overwrite: true });
    }
    /* 그 외는 runAI 가 토스트 */
  }
}

export async function aiFeedback(nodeId) {
  try {
    const res = await withBusy([nodeId], () => runAI('node_feedback', { nodeId }));
    replaceCommentsLocal([nodeId], res.comments ?? []);
    if (getState().filters.hideBubbles) toast('피드백이 도착했어요. (말풍선이 숨겨져 있어요)');
  } catch { /* runAI 가 토스트 */ }
}

export async function aiReview() {
  const { focus } = getState();
  const progress = progressModal('전체 점검 중', [
    '요구사항을 정리하는 중...',
    '아이디어 트리를 읽는 중...',
    '요구사항과 아이디어를 비교하는 중...',
    '팀 경험으로 실행할 수 있는지 확인하는 중...',
    '빠진 부분을 찾는 중...',
    '총평을 쓰는 중...',
  ]);
  try {
    const res = await runAI('review_all', focus.length ? { scope: 'focus', focusIds: focus } : { scope: 'home' });
    // 서버가 숨긴 것(프로젝트 전체 코멘트, 모든 gap, 새 코멘트가 달린 노드의 기존 코멘트)을 로컬에서도 정리
    const comments = res.comments ?? [];
    const touched = new Set(comments.map((c) => c.node_id).filter(Boolean));
    mutate('aiComments', (m) => {
      m.delete(PROJECT_KEY);
      for (const id of touched) m.delete(id);
      for (const [k, list] of m) {
        const next = list.filter((c) => c.kind !== 'gap');
        if (next.length) m.set(k, next); else m.delete(k);
      }
    });
    comments.forEach(addCommentLocal);
    setState({ coverage: new Map((res.coverage ?? []).map((c) => [c.requirement_id, c])) });
    progress.close();
    showReviewResult(res);
  } catch {
    progress.close();
  }
}

export async function aiDirection(focusIds) {
  const ids = focusIds?.length ? focusIds : [defaultParentId()].filter(Boolean);
  try {
    const res = await withBusy(ids, () => runAI('suggest_direction', { focusIds: ids }));
    mutate('aiComments', (m) => {
      for (const id of ids) {
        const next = (m.get(id) ?? []).filter((c) => c.kind !== 'suggestion');
        if (next.length) m.set(id, next); else m.delete(id);
      }
    });
    replaceCommentsLocal([], res.comments ?? []);
    if (res.comments?.length) {
      toast(`방향 ${res.comments.length}개를 추천했어요.`);
      mutate('expandedBubbles', (s) => ids.forEach((id) => s.add(id)));
    }
  } catch { /* runAI 가 토스트 */ }
}

export async function aiRoles() {
  const progress = progressModal('역할 분담 추천 중', [
    '팀원 경험과 기술을 살펴보는 중...',
    '업무량을 확인하는 중...',
    '담당자를 고르는 중...',
  ]);
  try {
    const res = await runAI('suggest_roles', {});
    progress.close();
    showRolesResult(res);
  } catch {
    progress.close();
  }
}

/** gap / suggestion 말풍선 → 노드로 추가 */
export async function addNodeFromComment(c) {
  const parentId = c.node_id && getState().nodes.has(c.node_id) ? c.node_id : rootNode()?.id;
  if (!parentId) return;
  const pos = nextChildPosition(parentId);
  try {
    const node = await nodesApi.createNode({
      parent_id: parentId,
      title: commentTitle(c),
      description: c.content.split('\n').slice(1).join('\n').trim().slice(0, 2000) || null,
      ...pos,
    });
    pushCreated([node.id]);
    dismissComment(c.id);
    selectOnly(node.id);
    requestAnimationFrame(() => requestAnimationFrame(() => flashNodes([node.id])));
    toast('노드로 추가했어요.');
  } catch { /* 토스트 처리됨 */ }
}

export const myId = () => getState().user?.id;
export const myMember = me;
