// A8. 아이디어 구체화 — 팀 경험 기반 조사 방법 / 구현 범위 / 실행 가능성 / 리스크 → node_plans upsert
import { AppError, MODELS, callJSON } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import { baseContext, clamp, deadlineLabel, loadContext, planSummary, resolve } from '../context.ts';
import { type Handler, badRequest, isUuid, notFound } from './_shared.ts';

interface ScopeItem { item: string; why: string }
interface Out {
  feasibility: number;
  feasibility_note: string;
  research_methods: { method: string; why: string; experience_refs: string[]; owner_refs: string[]; requirement_refs: string[] }[];
  scope: { mvp: ScopeItem[]; stretch: ScopeItem[]; out_of_scope: ScopeItem[] };
  risks: { risk: string; mitigation: string }[];
  tasks: { content: string; owner_ref: string }[];
}

const scopeList = (list: ScopeItem[] | undefined, max: number) =>
  (list ?? []).slice(0, max)
    .map((s) => ({ item: clamp(s.item, 200), why: clamp(s.why, 300) }))
    .filter((s) => s.item);

export const concretizeNode: Handler = async ({ admin, projectId, input }) => {
  if (!isUuid(input.nodeId)) throw badRequest('nodeId가 필요해요.');
  const nodeId: string = input.nodeId;

  const ctx = await loadContext(admin, projectId);
  const node = ctx.byId.get(nodeId);
  if (!node) throw notFound('노드를 찾을 수 없어요.');

  // 사람이 직접 고친 계획은 확인 없이 덮어쓰지 않는다
  const { data: existing, error: exErr } = await admin.from('node_plans')
    .select('edited_by_user').eq('node_id', nodeId).maybeSingle();
  if (exErr) throw exErr;
  if (existing?.edited_by_user && input.overwrite !== true) {
    throw new AppError('plan edited by user', 409, '팀원이 직접 수정한 실행 계획이 있어요. 덮어쓸지 확인해 주세요.');
  }

  const owners = ctx.assignees.filter((a) => a.node_id === nodeId)
    .map((a) => ctx.memberRef.get(a.user_id)).filter(Boolean) as string[];

  const ctxText = await baseContext(admin, ctx, [nodeId], [await planSummary(admin, ctx, nodeId)]);
  const model = MODELS.concretize;
  const { data, usage } = await callJSON<Out>({
    model,
    fallbackModel: model === MODELS.base ? MODELS.fallback : MODELS.base,
    system: SYSTEM,
    user: prompts.concretize_node(ctxText, ctx.nodeRef.get(nodeId)!, deadlineLabel(ctx.project.due_date),
      owners.length ? owners.join(', ') : '없음'),
    schemaName: 'concretize_node',
    schema: schemas.concretize_node,
    temperature: 0.4, effort: 'medium', maxTokens: 8000,
  });

  // ref → UUID (매핑에 없는 ref는 버림). 텍스트 안의 'E3' 같은 표기는 화면에서 칩으로 보여주므로 그대로 둔다.
  const research_methods = (data.research_methods ?? []).slice(0, 4)
    .map((m) => ({
      method: clamp(m.method, 200),
      why: clamp(m.why, 300),
      experience_ids: resolve(m.experience_refs, ctx.refExp),
      owner_ids: resolve(m.owner_refs, ctx.refMember).slice(0, 3),
      requirement_ids: resolve(m.requirement_refs, ctx.refReq),
    }))
    .filter((m) => m.method);

  const scope = {
    mvp: scopeList(data.scope?.mvp, 6),
    stretch: scopeList(data.scope?.stretch, 5),
    out_of_scope: scopeList(data.scope?.out_of_scope, 5),
  };
  const risks = (data.risks ?? []).slice(0, 3)
    .map((r) => ({ risk: clamp(r.risk, 200), mitigation: clamp(r.mitigation, 300) }))
    .filter((r) => r.risk);

  // 근거 경험: 조사 방법의 ref + 텍스트 속 E 번호(실행가능성 근거, 범위 why)
  const textRefs = [
    data.feasibility_note,
    ...[...scope.mvp, ...scope.stretch, ...scope.out_of_scope].map((s) => s.why),
    ...risks.map((r) => r.mitigation),
  ].join(' ').match(/E\d+/g) ?? [];
  const experience_ids = [...new Set([
    ...research_methods.flatMap((m) => m.experience_ids),
    ...resolve(textRefs, ctx.refExp),
  ])];

  const f = Number(data.feasibility);
  const row = {
    node_id: nodeId,
    project_id: projectId,
    feasibility: f >= 1 && f <= 5 ? f : null,
    feasibility_note: clamp(data.feasibility_note, 300) || null,
    research_methods,
    scope,
    risks,
    experience_ids,
    generated_by_ai: true,
    edited_by_user: false,
    generated_at: new Date().toISOString(),
  };
  const up = await admin.from('node_plans').upsert(row, { onConflict: 'node_id' }).select('*').single();
  if (up.error) throw up.error;

  // 할 일 목록 (IA v2): 아직 끝내지 않은 이전 AI 할 일은 새 목록으로 바꾸고, 완료했거나 사람이 쓴 할 일은 남긴다
  const del = await admin.from('node_tasks').delete()
    .eq('node_id', nodeId).eq('source', 'ai').eq('done', false);
  if (del.error) throw del.error;
  const { data: kept, error: keptErr } = await admin.from('node_tasks')
    .select('sort_order').eq('node_id', nodeId).order('sort_order', { ascending: false }).limit(1);
  if (keptErr) throw keptErr;
  const base = (kept?.[0]?.sort_order ?? 0) + 1;
  const taskRows = (data.tasks ?? []).slice(0, 7)
    .map((t) => ({ content: clamp(t.content, 200), assignee_id: resolve([t.owner_ref], ctx.refMember)[0] ?? null }))
    .filter((t) => t.content)
    .map((t, i) => ({ ...t, project_id: projectId, node_id: nodeId, source: 'ai', sort_order: base + i, created_by: null }));
  let tasks: unknown[] = [];
  if (taskRows.length) {
    const ins = await admin.from('node_tasks').insert(taskRows).select('*');
    if (ins.error) throw ins.error;
    tasks = ins.data;
  }

  return { data: { plan: up.data, tasks }, usage };
};
