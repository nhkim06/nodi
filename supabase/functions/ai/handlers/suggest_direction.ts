// A5. 포커스 노드에서 다음에 고민할 방향 추천 (팀 경험으로 실행 가능한 방향 우선)
import { callJSON } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import { baseContext, clamp, loadContext, resolve, resolveOne } from '../context.ts';
import { type Handler, baseModel, dismissExisting, uuidList } from './_shared.ts';

interface Out {
  directions: {
    focus_ref: string; title: string; why: string; next_questions: string[];
    requirement_refs: string[]; experience_refs: string[];
  }[];
}

export const suggestDirection: Handler = async ({ admin, userId, projectId, input }) => {
  const ctx = await loadContext(admin, projectId);
  let focusIds = uuidList(input.focusIds, 5).filter((id) => ctx.byId.has(id));
  if (!focusIds.length) focusIds = [ctx.root.id];

  const ctxText = await baseContext(admin, ctx, focusIds);
  const { data, usage } = await callJSON<Out>({
    ...baseModel(),
    system: SYSTEM,
    user: prompts.suggest_direction(ctxText, focusIds.map((id) => ctx.nodeRef.get(id)!)),
    schemaName: 'suggest_direction',
    schema: schemas.suggest_direction,
    temperature: 0.6, effort: 'low',
  });

  const rows = (data.directions ?? []).slice(0, 3 * focusIds.length)
    .map((d) => {
      const nodeId = resolveOne(d.focus_ref, ctx.refNode);
      const questions = (d.next_questions ?? []).slice(0, 2).map((q) => `- ${clamp(q, 150)}`).join('\n');
      return {
        project_id: projectId,
        node_id: nodeId && focusIds.includes(nodeId) ? nodeId : focusIds[0],
        kind: 'suggestion',
        // 첫 줄 = 제목(노드로 만들기용), 이후 = 이유 + 토론 질문
        content: [clamp(d.title, 100), clamp(d.why, 300), questions].filter(Boolean).join('\n'),
        requirement_ids: resolve(d.requirement_refs, ctx.refReq),
        experience_ids: resolve(d.experience_refs, ctx.refExp),
        requested_by: userId,
      };
    })
    .filter((r) => r.content.trim());

  await dismissExisting(admin, projectId, { nodeIds: focusIds, kinds: ['suggestion'] });
  let comments: unknown[] = [];
  if (rows.length) {
    const ins = await admin.from('ai_comments').insert(rows).select('*');
    if (ins.error) throw ins.error;
    comments = ins.data ?? [];
  }
  return { data: { comments }, usage };
};
