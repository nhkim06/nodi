// A7. 🔴 막힘 신호 → 해결 힌트 + 관련 경험이 있는 팀원 추천 (저장 안 함)
import { callJSON } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import {
  clamp, experienceBlock, loadContext, planSummaries, projectBlock, requirementsBlock, resolve,
} from '../context.ts';
import { type Handler, badRequest, baseModel } from './_shared.ts';

interface Out { tips: string[]; helper_refs: string[]; helper_reason: string }

export const helpBlocked: Handler = async ({ admin, userId, projectId, input }) => {
  const message = clamp(input.message, 300);
  if (!message) throw badRequest('어떤 부분에서 막혔는지 적어 주세요.');

  const ctx = await loadContext(admin, projectId);
  const myRef = ctx.memberRef.get(userId) ?? 'M?';

  const mineIds = ctx.assignees.filter((a) => a.user_id === userId && ctx.byId.has(a.node_id)).map((a) => a.node_id);
  const mine = mineIds.map((id) => {
    const n = ctx.byId.get(id)!;
    return `- ${ctx.nodeRef.get(id)} ${n.title}${n.description ? ` — ${clamp(n.description, 100)}` : ''}`;
  });

  const ctxText = [
    projectBlock(ctx), requirementsBlock(ctx),
    `## ${myRef}의 담당 노드\n${mine.length ? mine.join('\n') : '(없음)'}`,
    await planSummaries(admin, ctx, mineIds.slice(0, 5)),
    await experienceBlock(admin, ctx),
  ].filter(Boolean).join('\n\n');

  const { data, usage } = await callJSON<Out>({
    ...baseModel(),
    system: SYSTEM,
    user: prompts.help_blocked(ctxText, myRef, message),
    schemaName: 'help_blocked',
    schema: schemas.help_blocked,
    temperature: 0.5, effort: 'low',
  });

  const helpers = resolve(data.helper_refs, ctx.refMember).filter((id) => id !== userId).slice(0, 2);
  return {
    data: {
      tips: (data.tips ?? []).slice(0, 3).map((t) => clamp(t, 300)).filter(Boolean),
      helpers,
      helper_reason: helpers.length ? clamp(data.helper_reason, 200) : '',
    },
    usage,
  };
};
