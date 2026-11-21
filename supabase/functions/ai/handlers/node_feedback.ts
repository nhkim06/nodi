// A3. 노드 1개에 대한 말풍선 피드백 (요구사항 + 팀 실행 가능성 관점)
import { callJSON } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import { baseContext, clamp, loadContext, planSummary, resolve } from '../context.ts';
import { type Handler, badRequest, baseModel, dismissExisting, isUuid, notFound } from './_shared.ts';

const KINDS = ['praise', 'warning', 'suggestion', 'feedback'];

interface Out { comments: { kind: string; content: string; requirement_refs: string[]; experience_refs: string[] }[] }

export const nodeFeedback: Handler = async ({ admin, userId, projectId, input }) => {
  if (!isUuid(input.nodeId)) throw badRequest('nodeId가 필요해요.');
  const ctx = await loadContext(admin, projectId);
  if (!ctx.byId.has(input.nodeId)) throw notFound('노드를 찾을 수 없어요.');

  const ctxText = await baseContext(admin, ctx, [input.nodeId], [await planSummary(admin, ctx, input.nodeId)]);
  const { data, usage } = await callJSON<Out>({
    ...baseModel(),
    system: SYSTEM,
    user: prompts.node_feedback(ctxText, ctx.nodeRef.get(input.nodeId)!),
    schemaName: 'node_feedback',
    schema: schemas.node_feedback,
    temperature: 0.4, effort: 'low',
  });

  const rows = (data.comments ?? []).slice(0, 3)
    .map((c) => ({
      project_id: projectId,
      node_id: input.nodeId,
      kind: KINDS.includes(c.kind) ? c.kind : 'feedback',
      content: clamp(c.content, 300),
      requirement_ids: resolve(c.requirement_refs, ctx.refReq),
      experience_ids: resolve(c.experience_refs, ctx.refExp),
      requested_by: userId,
    }))
    .filter((r) => r.content);

  await dismissExisting(admin, projectId, { nodeIds: [input.nodeId] });
  let comments: unknown[] = [];
  if (rows.length) {
    const ins = await admin.from('ai_comments').insert(rows).select('*');
    if (ins.error) throw ins.error;
    comments = ins.data ?? [];
  }
  return { data: { comments }, usage };
};
