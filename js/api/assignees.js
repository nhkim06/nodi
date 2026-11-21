import { supabase } from '../supabase.js';
import { getState, mutate } from '../store.js';
import { q } from './client.js';

export function setAssigneeLocal(row) {
  mutate('assignees', (m) => {
    if (!m.has(row.node_id)) m.set(row.node_id, new Map());
    m.get(row.node_id).set(row.user_id, row);
  });
}

export function removeAssigneeLocal(nodeId, userId) {
  mutate('assignees', (m) => {
    m.get(nodeId)?.delete(userId);
    if (m.get(nodeId)?.size === 0) m.delete(nodeId);
  });
}

/** 담당자 추가. 이미 담당자면 false 반환 */
export async function addAssignee(nodeId, userId) {
  if (getState().assignees.get(nodeId)?.has(userId)) return false;
  const rows = await q(
    supabase.from('node_assignees')
      .upsert({ node_id: nodeId, project_id: getState().project.id, user_id: userId },
        { onConflict: 'node_id,user_id', ignoreDuplicates: true })
      .select(),
    '담당자를 지정하지 못했어요.',
  );
  if (!rows?.length) return false;
  setAssigneeLocal(rows[0]);
  return true;
}

export async function removeAssignee(nodeId, userId) {
  await q(
    supabase.from('node_assignees').delete().eq('node_id', nodeId).eq('user_id', userId),
    '담당자를 해제하지 못했어요.',
  );
  removeAssigneeLocal(nodeId, userId);
}

export async function updateAssignee(nodeId, userId, patch) {
  const row = await q(
    supabase.from('node_assignees').update(patch).eq('node_id', nodeId).eq('user_id', userId).select().single(),
    '작업 상태를 바꾸지 못했어요.',
  );
  if (getState().project) setAssigneeLocal(row);
  return row;
}

/** 개인 페이지: 내 담당 노드 */
export const listMine = (pid, uid) => q(
  supabase.from('node_assignees')
    .select('node_id, task_state, note, assigned_at, node:nodes(id, title, status, description)')
    .eq('project_id', pid).eq('user_id', uid).order('assigned_at', { ascending: false }),
  '내 작업을 불러오지 못했어요.',
);
