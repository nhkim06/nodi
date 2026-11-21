// 노드 할 일 목록 (node_tasks) — 아이디어 맵: 후보 노드 → 아이디어 추가 → AI 추천 의견 · 할 일 목록 제작
import { supabase } from '../supabase.js';
import { getState, mutate } from '../store.js';
import { q } from './client.js';

const sortTasks = (list) => list.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

export function upsertTaskLocal(row) {
  mutate('tasks', (m) => {
    const list = (m.get(row.node_id) ?? []).filter((t) => t.id !== row.id);
    list.push(row);
    m.set(row.node_id, sortTasks(list));
  });
}

export function removeTaskLocal(id) {
  mutate('tasks', (m) => {
    for (const [nodeId, list] of m) {
      const next = list.filter((t) => t.id !== id);
      if (next.length === list.length) continue;
      if (next.length) m.set(nodeId, next); else m.delete(nodeId);
    }
  });
}

/** AI 구체화 직후: 끝내지 않은 이전 AI 할 일은 서버에서 지워졌으므로 로컬도 정리하고 새 목록을 넣는다 */
export function replaceAiTasksLocal(nodeId, rows) {
  mutate('tasks', (m) => {
    const kept = (m.get(nodeId) ?? []).filter((t) => !(t.source === 'ai' && !t.done));
    const list = sortTasks([...kept, ...rows]);
    if (list.length) m.set(nodeId, list); else m.delete(nodeId);
  });
}

export const tasksOf = (nodeId) => getState().tasks.get(nodeId) ?? [];

export async function addTask(nodeId, content, assigneeId = null) {
  const max = Math.max(0, ...tasksOf(nodeId).map((t) => t.sort_order));
  const row = await q(
    supabase.from('node_tasks').insert({
      project_id: getState().project.id, node_id: nodeId, content, assignee_id: assigneeId, sort_order: max + 1,
    }).select().single(),
    '할 일을 추가하지 못했어요.',
  );
  upsertTaskLocal(row);
  return row;
}

export async function updateTask(id, patch) {
  const row = await q(
    supabase.from('node_tasks').update(patch).eq('id', id).select().single(),
    '할 일을 수정하지 못했어요.',
  );
  if (getState().project) upsertTaskLocal(row);
  return row;
}

export async function deleteTask(id) {
  await q(supabase.from('node_tasks').delete().eq('id', id), '할 일을 삭제하지 못했어요.');
  removeTaskLocal(id);
}

/** 나의 작업 페이지: 나에게 배정된 할 일 */
export const listMyTasks = (pid, uid) => q(
  supabase.from('node_tasks')
    .select('*, node:nodes(id, title, status)')
    .eq('project_id', pid).eq('assignee_id', uid)
    .order('done').order('created_at'),
  '내 할 일을 불러오지 못했어요.',
);
