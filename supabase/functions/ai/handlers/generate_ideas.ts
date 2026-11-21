// A2. 선택/포커스 노드 기준 하위 아이디어 생성 → nodes insert (source='ai') + 간이 node_plans
import { callJSON } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import { baseContext, clamp, loadContext, resolve, resolveOne } from '../context.ts';
import { type Handler, baseModel, uuidList } from './_shared.ts';

const MAP_COL = 260;   // 부모 x → 자식 x
const MAP_ROW = 72;    // 형제 세로 간격

interface Idea {
  parent_ref: string; title: string; description: string;
  requirement_refs: string[]; experience_refs: string[];
  feasibility: number; how_we_do_it: string;
}
interface Out { ideas: Idea[] }

export const generateIdeas: Handler = async ({ admin, userId, projectId, input }) => {
  const ctx = await loadContext(admin, projectId);

  let parentIds = uuidList(input.parentIds, 4)
    .filter((id) => ctx.byId.has(id) && ctx.byId.get(id)!.status !== 'discarded');
  if (!parentIds.length) parentIds = [ctx.root.id];

  const count = Math.min(8, Math.max(1, Number.parseInt(input.count, 10) || 5));
  const hint = clamp(input.hint, 200);
  const parentRefs = parentIds.map((id) => ctx.nodeRef.get(id)!);

  const ctxText = await baseContext(admin, ctx, parentIds);
  const { data, usage } = await callJSON<Out>({
    ...baseModel(),
    system: SYSTEM,
    user: prompts.generate_ideas(ctxText, parentRefs, count, hint),
    schemaName: 'generate_ideas',
    schema: schemas.generate_ideas,
    temperature: 0.8, effort: 'low', maxTokens: 6000,
  });

  // 부모별로 묶고 검증
  const perParent = new Map<string, Idea[]>();
  for (const idea of data.ideas ?? []) {
    const pid = resolveOne(idea.parent_ref, ctx.refNode);
    if (!pid || !parentIds.includes(pid)) continue;
    if (!clamp(idea.title, 100)) continue;
    const list = perParent.get(pid) ?? [];
    if (list.length >= count) continue;
    list.push(idea);
    perParent.set(pid, list);
  }

  // 위치 (마인드맵, js/canvas/layout.js 와 같은 규칙):
  // 루트 자식은 오른쪽/왼쪽 중 적은 쪽에 번갈아, 그 아래는 부모와 같은 방향으로. 같은 방향 형제들 아래로 쌓는다.
  const rows: Record<string, unknown>[] = [];
  const ideasInOrder: Idea[] = [];
  for (const [pid, ideas] of perParent) {
    const parent = ctx.byId.get(pid)!;
    const placed = [...(ctx.children.get(pid) ?? [])].map((s) => ({ x: s.x, y: s.y }));
    ideas.forEach((idea) => {
      let side: number;
      if (!parent.parent_id) {
        const right = placed.filter((k) => k.x >= parent.x).length;
        side = right <= placed.length - right ? 1 : -1;
      } else {
        side = parent.x >= ctx.root.x ? 1 : -1;
      }
      const same = placed.filter((k) => (side > 0 ? k.x >= parent.x : k.x < parent.x));
      const pos = {
        x: Math.round(parent.x + side * MAP_COL),
        y: Math.round(same.length ? Math.max(...same.map((k) => k.y)) + MAP_ROW : parent.y),
      };
      placed.push(pos);
      ideasInOrder.push(idea);
      rows.push({
        project_id: projectId,
        parent_id: pid,
        title: clamp(idea.title, 100),
        description: clamp(idea.description, 2000) || null,
        source: 'ai',
        status: 'considering',
        ...pos,
        created_by: userId,
      });
    });
  }

  let nodes: { id: string }[] = [];
  let plans: unknown[] = [];
  if (rows.length) {
    const ins = await admin.from('nodes').insert(rows).select('*');
    if (ins.error) throw ins.error;
    nodes = ins.data ?? [];

    // 간이 실행 계획: 실행 가능성 + 한 줄 방법 + 근거 경험 (조사 방법/범위는 A8에서)
    const now = new Date().toISOString();
    const planRows = nodes.map((n, i) => {
      const idea = ideasInOrder[i];
      const f = Number(idea?.feasibility);
      return {
        node_id: n.id,
        project_id: projectId,
        feasibility: f >= 1 && f <= 5 ? f : null,
        feasibility_note: clamp(idea?.how_we_do_it, 300) || null,
        experience_ids: resolve(idea?.experience_refs, ctx.refExp),
        generated_by_ai: true,
        edited_by_user: false,
        generated_at: now,
      };
    });
    const pl = await admin.from('node_plans').insert(planRows).select('*');
    if (pl.error) console.error('node_plans insert failed', pl.error);
    else plans = pl.data ?? [];
  }
  return { data: { nodeIds: nodes.map((n) => n.id), nodes, plans }, usage };
};
