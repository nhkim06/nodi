import { supabase } from '../supabase.js';
import { getState, mutate } from '../store.js';
import { q } from './client.js';

const pid = () => getState().project.id;

/** 서버 응답 행을 store 에 반영 (updated_at 이 더 오래된 이벤트는 무시) */
export function upsertNodeLocal(row) {
  mutate('nodes', (m) => {
    const cur = m.get(row.id);
    if (cur && cur.updated_at && row.updated_at && row.updated_at < cur.updated_at) return;
    m.set(row.id, { ...cur, ...row });
  });
}

export async function createNode({ parent_id, title, description = null, x, y }) {
  const row = await q(
    supabase.from('nodes')
      .insert({ project_id: pid(), parent_id, title, description, x: Math.round(x), y: Math.round(y) })
      .select().single(),
    '노드를 만들지 못했어요.',
  );
  upsertNodeLocal(row);
  return row;
}

/** 낙관적 업데이트 → 실패 시 되돌림 */
export async function updateNode(id, patch) {
  const before = getState().nodes.get(id);
  if (!before) return null;
  mutate('nodes', (m) => m.set(id, { ...before, ...patch }));
  try {
    const row = await q(
      supabase.from('nodes').update(patch).eq('id', id).select().single(),
      '노드를 저장하지 못했어요.',
    );
    upsertNodeLocal(row);
    return row;
  } catch (e) {
    mutate('nodes', (m) => m.set(id, before));
    throw e;
  }
}

/** 여러 노드 좌표 저장 (드래그 종료 시) */
export async function saveNodePositions(list) {
  await Promise.all(list.map(({ id, x, y }) =>
    q(supabase.from('nodes').update({ x: Math.round(x), y: Math.round(y) }).eq('id', id).select('id, updated_at').single(),
      '위치를 저장하지 못했어요.')
      .then((row) => mutate('nodes', (m) => {
        const cur = m.get(id);
        if (cur) m.set(id, { ...cur, updated_at: row.updated_at });
      }))
      .catch(() => {})));
}

export const setStatus = (node, status) => updateNode(node.id, { status });

export const discard = (node) => updateNode(node.id, { status: 'discarded' });

export const restore = (node) => updateNode(node.id, { status: node.status_before_discard ?? 'considering' });

export async function deleteNode(id) {
  await q(supabase.from('nodes').delete().eq('id', id), '노드를 삭제하지 못했어요.');
  removeNodeLocal(id);
}

/** 노드 + 하위 노드를 store 에서 제거 */
export function removeNodeLocal(id) {
  const { nodes } = getState();
  if (!nodes.has(id)) return;
  const kids = new Map();
  for (const n of nodes.values()) {
    if (!n.parent_id) continue;
    if (!kids.has(n.parent_id)) kids.set(n.parent_id, []);
    kids.get(n.parent_id).push(n.id);
  }
  const doomed = [id];
  for (let i = 0; i < doomed.length; i++) doomed.push(...(kids.get(doomed[i]) ?? []));
  mutate('nodes', (m) => doomed.forEach((d) => m.delete(d)));
  mutate('selection', (s) => doomed.forEach((d) => s.delete(d)));
  mutate('assignees', (m) => doomed.forEach((d) => m.delete(d)));
  mutate('aiComments', (m) => doomed.forEach((d) => m.delete(d)));
  mutate('plans', (m) => doomed.forEach((d) => m.delete(d)));
}
