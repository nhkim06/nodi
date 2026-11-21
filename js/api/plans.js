// 노드 실행 계획 (node_plans) — 노드 카드엔 feasibility 만, 상세는 Inspector 를 열 때만 읽는다
import { supabase } from '../supabase.js';
import { getState, mutate } from '../store.js';
import { q } from './client.js';

export const PLAN_LIGHT_COLS = 'node_id, feasibility, generated_at, edited_by_user, updated_at';

/** full=true 면 상세까지 받은 행 */
export function upsertPlanLocal(row, full = true) {
  mutate('plans', (m) => {
    const cur = m.get(row.node_id);
    if (cur?._full && !full && cur.updated_at && row.updated_at && row.updated_at < cur.updated_at) return;
    m.set(row.node_id, { ...cur, ...row, _empty: false, _full: full || (!!cur?._full && !cur?._empty) });
  });
}

export const removePlanLocal = (nodeId) => mutate('plans', (m) => m.delete(nodeId));

const loading = new Set();
/** Inspector 에서 상세 계획이 필요할 때 한 번만 읽는다 */
export async function ensurePlan(nodeId) {
  const cur = getState().plans.get(nodeId);
  if (cur?._full || loading.has(nodeId)) return;
  loading.add(nodeId);
  try {
    const row = await q(
      supabase.from('node_plans').select('*').eq('node_id', nodeId).maybeSingle(),
      '실행 계획을 불러오지 못했어요.',
    );
    if (row) upsertPlanLocal(row, true);
    else mutate('plans', (m) => m.set(nodeId, { node_id: nodeId, _full: true, _empty: true }));
  } catch { /* 토스트 처리됨 */ } finally {
    loading.delete(nodeId);
  }
}

/** 직접 수정 저장 (없으면 새로 만든다). DB 트리거가 update 시 edited_by_user=true 로 바꾼다. */
export async function savePlan(nodeId, patch) {
  const existing = getState().plans.get(nodeId);
  const body = {
    feasibility: patch.feasibility ?? null,
    feasibility_note: patch.feasibility_note || null,
    research_methods: patch.research_methods ?? [],
    scope: patch.scope ?? { mvp: [], stretch: [], out_of_scope: [] },
    risks: patch.risks ?? [],
  };
  const row = existing && !existing._empty
    ? await q(supabase.from('node_plans').update(body).eq('node_id', nodeId).select().single(), '실행 계획을 저장하지 못했어요.')
    : await q(supabase.from('node_plans').insert({
      ...body, node_id: nodeId, project_id: getState().project.id, generated_by_ai: false, edited_by_user: true,
    }).select().single(), '실행 계획을 저장하지 못했어요.');
  upsertPlanLocal(row, true);
  return row;
}
