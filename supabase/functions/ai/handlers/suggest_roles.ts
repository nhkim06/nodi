// A6. 역할 분담 추천 — 저장하지 않고 제안만 반환 (적용은 클라이언트가 사용자 승인 후)
import { callJSON } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import { baseContext, clamp, loadContext, planSummaries, resolve, resolveOne } from '../context.ts';
import { type Handler, baseModel, uuidList } from './_shared.ts';

interface Out {
  assignments: { node_ref: string; member_refs: string[]; experience_refs: string[]; reason: string }[];
  balance_note: string;
}

export const suggestRoles: Handler = async ({ admin, projectId, input }) => {
  const ctx = await loadContext(admin, projectId);
  const assigned = new Set(ctx.assignees.map((a) => a.node_id));

  let targetIds = uuidList(input.nodeIds, 25)
    .filter((id) => ctx.byId.has(id) && ctx.byId.get(id)!.status !== 'discarded');
  if (!targetIds.length) {
    // 기본: 담당자가 없는 채택 노드 + 후보 노드
    targetIds = ctx.nodes
      .filter((n) => n.parent_id && n.status !== 'discarded' && !assigned.has(n.id) &&
        (n.status === 'adopted' || n.is_candidate))
      .slice(0, 25).map((n) => n.id);
  }
  if (!targetIds.length) {
    return {
      data: { assignments: [], balance_note: '담당자가 없는 채택/후보 노드가 없어요. 노드를 채택하거나 ⭐후보로 표시한 뒤 다시 시도해 주세요.' },
      usage: null,
    };
  }
  if (ctx.members.length < 1) return { data: { assignments: [], balance_note: '팀원이 없어요.' }, usage: null };

  const ctxText = await baseContext(admin, ctx, targetIds, [await planSummaries(admin, ctx, targetIds)]);
  const { data, usage } = await callJSON<Out>({
    ...baseModel(),
    system: SYSTEM,
    user: prompts.suggest_roles(ctxText, targetIds.map((id) => ctx.nodeRef.get(id)!)),
    schemaName: 'suggest_roles',
    schema: schemas.suggest_roles,
    temperature: 0.3, effort: 'medium', maxTokens: 6000,
  });

  const assignments = (data.assignments ?? [])
    .map((a) => ({
      node_id: resolveOne(a.node_ref, ctx.refNode),
      user_ids: resolve(a.member_refs, ctx.refMember).slice(0, 2),
      experience_ids: resolve(a.experience_refs, ctx.refExp),
      reason: clamp(a.reason, 200),
    }))
    .filter((a) => a.node_id && targetIds.includes(a.node_id) && a.user_ids.length);

  return { data: { assignments, balance_note: clamp(data.balance_note, 300) }, usage };
};
