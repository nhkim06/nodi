// A4. 전체 점검: 요구사항 커버리지 / 팀 역량 공백 / 노드별 코멘트 / 빠진 부분 / 총평
import { callJSON } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import { baseContext, clamp, loadContext, resolve, resolveOne } from '../context.ts';
import { type Handler, dismissExisting, pickHeavyModel, uuidList } from './_shared.ts';

const KINDS = ['praise', 'warning', 'suggestion', 'feedback'];
const COVERAGE = ['covered', 'partial', 'missing'];

interface Out {
  summary: string;
  coverage: { requirement_ref: string; status: string; node_refs: string[]; reason: string }[];
  capability_gaps: { skill: string; node_refs: string[]; requirement_refs: string[]; mitigation: string; learner_refs: string[] }[];
  node_comments: { node_ref: string; kind: string; content: string; requirement_refs: string[] }[];
  gaps: { title: string; why: string; suggested_parent_ref: string | null; requirement_refs: string[] }[];
}

export const reviewAll: Handler = async ({ admin, userId, projectId, input }) => {
  const ctx = await loadContext(admin, projectId);
  const focusIds = input.scope === 'focus' ? uuidList(input.focusIds, 10).filter((id) => ctx.byId.has(id)) : [];

  const ctxText = await baseContext(admin, ctx, focusIds);
  const { data, usage } = await callJSON<Out>({
    ...(await pickHeavyModel(admin)),
    system: SYSTEM,
    user: prompts.review_all(ctxText, focusIds.map((id) => ctx.nodeRef.get(id)!)),
    schemaName: 'review_all',
    schema: schemas.review_all,
    temperature: 0.3, effort: 'medium', maxTokens: 12000,
  });

  const summary = clamp(data.summary, 1000);
  const memberName = (id: string) =>
    ctx.members.find((m) => m.user_id === id)?.profile?.display_name ?? '팀원';

  const coverage = (data.coverage ?? [])
    .map((c) => ({
      requirement_id: resolveOne(c.requirement_ref, ctx.refReq),
      status: COVERAGE.includes(c.status) ? c.status : 'missing',
      node_ids: resolve(c.node_refs, ctx.refNode),
      reason: clamp(c.reason, 300),
    }))
    .filter((c) => c.requirement_id);

  const capability_gaps = (data.capability_gaps ?? []).slice(0, 3)
    .map((g) => ({
      skill: clamp(g.skill, 100),
      node_ids: resolve(g.node_refs, ctx.refNode),
      requirement_ids: resolve(g.requirement_refs, ctx.refReq),
      mitigation: clamp(g.mitigation, 300),
      learner_ids: resolve(g.learner_refs, ctx.refMember).slice(0, 3),
    }))
    .filter((g) => g.skill);

  // 역량 공백 → 첫 번째 영향 노드(없으면 프로젝트 전체)에 warning 말풍선
  const capRows = capability_gaps.map((g) => {
    const learners = g.learner_ids.map(memberName);
    return {
      project_id: projectId,
      node_id: g.node_ids[0] ?? null,
      kind: 'warning',
      content: [
        `역량 공백: ${g.skill}`,
        g.mitigation,
        learners.length ? `배우면 좋을 팀원: ${learners.join(', ')}` : '',
      ].filter(Boolean).join('\n'),
      requirement_ids: g.requirement_ids,
      requested_by: userId,
    };
  });

  const nodeRows = (data.node_comments ?? []).slice(0, 5)
    .map((c) => ({
      project_id: projectId,
      node_id: resolveOne(c.node_ref, ctx.refNode),
      kind: KINDS.includes(c.kind) ? c.kind : 'feedback',
      content: clamp(c.content, 300),
      requirement_ids: resolve(c.requirement_refs, ctx.refReq),
      requested_by: userId,
    }))
    .filter((r) => r.node_id && r.content);

  const gapRows = (data.gaps ?? []).slice(0, 3)
    .map((g) => ({
      project_id: projectId,
      node_id: resolveOne(g.suggested_parent_ref, ctx.refNode),
      kind: 'gap',
      // 첫 줄 = 노드로 추가할 때 쓸 제목, 둘째 줄 = 이유
      content: `${clamp(g.title, 100)}\n${clamp(g.why, 300)}`,
      requirement_ids: resolve(g.requirement_refs, ctx.refReq),
      requested_by: userId,
    }))
    .filter((r) => r.content.trim());

  // 이전 점검 결과는 숨기고 최신 것만 남긴다
  const touched = [...new Set([...capRows, ...nodeRows, ...gapRows].map((r) => r.node_id).filter(Boolean))] as string[];
  await dismissExisting(admin, projectId, { projectLevel: true });
  const oldGaps = await admin.from('ai_comments').update({ dismissed: true })
    .eq('project_id', projectId).eq('dismissed', false).eq('kind', 'gap');
  if (oldGaps.error) throw oldGaps.error;
  if (touched.length) await dismissExisting(admin, projectId, { nodeIds: touched });

  const rows = [
    ...(summary ? [{ project_id: projectId, node_id: null, kind: 'feedback', content: summary, requirement_ids: [], requested_by: userId }] : []),
    ...capRows,
    ...nodeRows,
    ...gapRows,
  ];
  let comments: unknown[] = [];
  if (rows.length) {
    const ins = await admin.from('ai_comments').insert(rows).select('*');
    if (ins.error) throw ins.error;
    comments = ins.data ?? [];
  }

  return { data: { summary, coverage, capability_gaps, comments }, usage };
};
