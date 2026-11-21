// 프롬프트 컨텍스트 빌더: DB → 짧은 ref(N*, R*, M*, E*) + 텍스트 블록
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export interface NodeRow {
  id: string; parent_id: string | null; title: string; description: string | null;
  status: 'considering' | 'adopted' | 'discarded'; is_candidate: boolean; source: string;
  x: number; y: number; created_at: string;
}
export interface ReqRow {
  id: string; category: string; content: string; importance: number; sort_order: number;
}
export interface MemberRow {
  user_id: string; role_label: string | null; color: string; joined_at: string;
  profile: { display_name: string; major: string | null; skills: string[] } | null;
}
export interface ExpRow {
  id: string; user_id: string; kind: string; title: string; detail: string | null;
  level: number; tags: string[]; created_at: string;
}

export interface Ctx {
  projectId: string;
  project: { id: string; name: string; description: string | null; course_name: string | null; due_date: string | null };
  nodes: NodeRow[];
  byId: Map<string, NodeRow>;
  children: Map<string, NodeRow[]>;
  root: NodeRow;
  reqs: ReqRow[];
  assignees: { node_id: string; user_id: string; task_state: string }[];
  members: MemberRow[];
  experiences: Map<string, ExpRow[]>;      // userId -> 정렬·제한된 경험 카드 (E 번호 순)
  feasibility: Map<string, number>;        // nodeId -> 실행 가능성 1~5
  nodeRef: Map<string, string>;  refNode: Map<string, string>;
  reqRef: Map<string, string>;   refReq: Map<string, string>;
  memberRef: Map<string, string>; refMember: Map<string, string>;
  expRef: Map<string, string>;   refExp: Map<string, string>;
}

const MAX_TREE_NODES = 80;
const MAX_REQS = 40;
const DESC_LIMIT = 150;
const MAX_EXP_PER_MEMBER = 6;
const EXP_DETAIL_LIMIT = 60;

const CATEGORY_KO: Record<string, string> = {
  topic: '주제', deliverable: '제출물', constraint: '제약', criteria: '평가기준', deadline: '일정', etc: '기타',
};
const IMPORTANCE_KO: Record<number, string> = { 3: '필수', 2: '중요', 1: '보통' };
const STATUS_KO: Record<string, string> = { considering: '고민중', adopted: '채택', discarded: '버림' };
export const EXP_KIND_KO: Record<string, string> = {
  project: '프로젝트', research: '리서치', tool: '도구', domain: '도메인', role: '역할',
};
const EXP_KIND_AREA: Record<string, string> = {
  project: '프로젝트 수행', research: '조사·리서치', tool: '도구·기술', domain: '도메인 지식', role: '발표·문서 등 역할',
};

const cut = (s: string | null | undefined, n: number) =>
  !s ? '' : s.length > n ? s.slice(0, n) + '…' : s;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 경험 카드 정렬 규칙 — 프론트(js/utils/experience.js)와 반드시 같아야 E 번호가 일치한다 */
export function sortExperiences(list: ExpRow[]): ExpRow[] {
  return [...list]
    .sort((a, b) => b.level - a.level || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(0, MAX_EXP_PER_MEMBER);
}

export async function loadContext(admin: SupabaseClient, projectId: string): Promise<Ctx> {
  const [p, n, r, a, m, plans] = await Promise.all([
    admin.from('projects').select('id,name,description,course_name,due_date').eq('id', projectId).single(),
    admin.from('nodes').select('id,parent_id,title,description,status,is_candidate,source,x,y,created_at')
      .eq('project_id', projectId).order('created_at'),
    admin.from('requirements').select('id,category,content,importance,sort_order')
      .eq('project_id', projectId).order('importance', { ascending: false }).order('sort_order'),
    admin.from('node_assignees').select('node_id,user_id,task_state').eq('project_id', projectId),
    admin.from('project_members')
      .select('user_id,role_label,color,joined_at,profile:profiles(display_name,major,skills)')
      .eq('project_id', projectId).order('joined_at').order('user_id'),
    admin.from('node_plans').select('node_id,feasibility').eq('project_id', projectId),
  ]);
  for (const res of [p, n, r, a, m, plans]) if (res.error) throw res.error;

  const nodes = (n.data ?? []) as NodeRow[];
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const children = new Map<string, NodeRow[]>();
  let root: NodeRow | undefined;
  for (const node of nodes) {
    if (!node.parent_id) { root = node; continue; }
    if (!children.has(node.parent_id)) children.set(node.parent_id, []);
    children.get(node.parent_id)!.push(node);
  }
  for (const list of children.values()) list.sort((a, b) => a.x - b.x || a.created_at.localeCompare(b.created_at));
  if (!root) throw new Error('root node missing');

  // DFS 순서로 N 번호 부여
  const nodeRef = new Map<string, string>(), refNode = new Map<string, string>();
  let i = 0;
  const walk = (node: NodeRow) => {
    const ref = `N${++i}`;
    nodeRef.set(node.id, ref); refNode.set(ref, node.id);
    for (const c of children.get(node.id) ?? []) walk(c);
  };
  walk(root);

  const reqs = ((r.data ?? []) as ReqRow[]).slice(0, MAX_REQS);
  const reqRef = new Map<string, string>(), refReq = new Map<string, string>();
  reqs.forEach((req, idx) => { reqRef.set(req.id, `R${idx + 1}`); refReq.set(`R${idx + 1}`, req.id); });

  const members = (m.data ?? []) as unknown as MemberRow[];
  const memberRef = new Map<string, string>(), refMember = new Map<string, string>();
  members.forEach((mem, idx) => { memberRef.set(mem.user_id, `M${idx + 1}`); refMember.set(`M${idx + 1}`, mem.user_id); });

  // 경험 카드: 팀원 순서(가입순) → 숙련도 높은 순으로 E 번호
  const experiences = new Map<string, ExpRow[]>();
  const expRef = new Map<string, string>(), refExp = new Map<string, string>();
  if (members.length) {
    const e = await admin.from('member_experiences')
      .select('id,user_id,kind,title,detail,level,tags,created_at')
      .in('user_id', members.map((x) => x.user_id));
    if (e.error) throw e.error;
    const byUser = new Map<string, ExpRow[]>();
    for (const row of (e.data ?? []) as ExpRow[]) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id)!.push(row);
    }
    let k = 0;
    for (const mem of members) {
      const list = sortExperiences(byUser.get(mem.user_id) ?? []);
      experiences.set(mem.user_id, list);
      for (const ex of list) { const ref = `E${++k}`; expRef.set(ex.id, ref); refExp.set(ref, ex.id); }
    }
  }

  const feasibility = new Map<string, number>();
  for (const pl of plans.data ?? []) if (pl.feasibility) feasibility.set(pl.node_id, pl.feasibility);

  return {
    projectId, project: p.data!, nodes, byId, children, root, reqs,
    assignees: a.data ?? [], members, experiences, feasibility,
    nodeRef, refNode, reqRef, refReq, memberRef, refMember, expRef, refExp,
  };
}

/** AI가 돌려준 ref 목록 → UUID. 매핑에 없는 ref는 버린다(환각 방어). */
export function resolve(refs: unknown, map: Map<string, string>): string[] {
  if (!Array.isArray(refs)) return [];
  const out = new Set<string>();
  for (const r of refs) {
    const id = typeof r === 'string' ? map.get(r.trim().toUpperCase()) : undefined;
    if (id) out.add(id);
  }
  return [...out];
}
export function resolveOne(ref: unknown, map: Map<string, string>): string | null {
  return typeof ref === 'string' ? map.get(ref.trim().toUpperCase()) ?? null : null;
}

/** 마감까지 남은 기간 'D-23' (KST) */
export function deadlineLabel(due: string | null): string {
  if (!due) return '마감일 미정';
  const today = new Date(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00Z');
  const diff = Math.round((new Date(due + 'T00:00:00Z').getTime() - today.getTime()) / 86400_000);
  if (diff === 0) return 'D-DAY (오늘 마감)';
  return diff > 0 ? `D-${diff} (${due})` : `마감 ${-diff}일 지남 (${due})`;
}

export function projectBlock(ctx: Ctx): string {
  const p = ctx.project;
  const lines = [`## 프로젝트`, `이름: ${p.name}`];
  if (p.course_name) lines.push(`과목: ${p.course_name}`);
  lines.push(`마감: ${deadlineLabel(p.due_date)}`);
  if (p.description) lines.push(`설명: ${cut(oneLine(p.description), 300)}`);
  return lines.join('\n');
}

export function requirementsBlock(ctx: Ctx): string {
  if (!ctx.reqs.length) return '## 과제 요구사항\n(아직 등록된 요구사항이 없음 — 일반적인 대학 팀 과제 기준으로 판단)';
  const lines = ctx.reqs.map((r) =>
    `${ctx.reqRef.get(r.id)} [${CATEGORY_KO[r.category] ?? '기타'}][${IMPORTANCE_KO[r.importance] ?? '보통'}] ${oneLine(r.content)}`);
  return ['## 과제 요구사항', ...lines].join('\n');
}

/** 노드 트리 블록. focusIds가 있으면 노드가 많을 때 포커스 하위 트리를 우선한다. */
export function treeBlock(ctx: Ctx, focusIds: string[] = []): string {
  const assigneeMap = new Map<string, string[]>();
  for (const a of ctx.assignees) {
    const ref = ctx.memberRef.get(a.user_id);
    if (!ref) continue;
    if (!assigneeMap.has(a.node_id)) assigneeMap.set(a.node_id, []);
    assigneeMap.get(a.node_id)!.push(ref);
  }

  const active = ctx.nodes.filter((x) => x.status !== 'discarded');
  const discarded = ctx.nodes.filter((x) => x.status === 'discarded');

  let include: Set<string> | null = null;      // null = 전부
  const titleOnly = new Set<string>();
  if (active.length > MAX_TREE_NODES) {
    include = new Set([ctx.root.id]);
    const addSubtree = (id: string) => {
      include!.add(id);
      for (const c of ctx.children.get(id) ?? []) addSubtree(c.id);
    };
    const validFocus = focusIds.filter((id) => ctx.byId.has(id));
    if (validFocus.length) {
      for (const id of validFocus) {
        addSubtree(id);
        let cur = ctx.byId.get(id)!;
        while (cur.parent_id) { include.add(cur.parent_id); cur = ctx.byId.get(cur.parent_id)!; }
      }
      for (const c of ctx.children.get(ctx.root.id) ?? []) {
        if (!include.has(c.id)) { include.add(c.id); titleOnly.add(c.id); }
      }
    } else {
      const queue = [ctx.root];
      while (queue.length && include.size < MAX_TREE_NODES) {
        const cur = queue.shift()!;
        include.add(cur.id);
        queue.push(...(ctx.children.get(cur.id) ?? []).filter((c) => c.status !== 'discarded'));
      }
    }
  }

  const lines: string[] = ['## 현재 아이디어 트리'];
  const render = (node: NodeRow, depth: number) => {
    const isDiscarded = node.status === 'discarded';
    let nextDepth = depth;
    if (!isDiscarded && (!include || include.has(node.id))) {
      const tags: string[] = [];
      if (!node.parent_id) tags.push('ROOT');
      else tags.push(STATUS_KO[node.status]);
      if (node.is_candidate) tags.push('⭐후보');
      if (focusIds.includes(node.id)) tags.push('포커스');
      const f = ctx.feasibility.get(node.id);
      if (f) tags.push(`실행가능성 ${f}/5`);
      const who = assigneeMap.get(node.id);
      let line = `${'  '.repeat(depth)}${ctx.nodeRef.get(node.id)} ${oneLine(node.title)} ${tags.map((t) => `[${t}]`).join('')}`;
      if (who?.length) line += ` (담당: ${who.join(', ')})`;
      if (titleOnly.has(node.id)) {
        lines.push(line + ' (하위 생략)');
        return;
      }
      if (node.description) line += `\n${'  '.repeat(depth + 1)}└ ${cut(oneLine(node.description), DESC_LIMIT)}`;
      lines.push(line);
      nextDepth = depth + 1;
    }
    // 버린 노드의 살아있는 자식은 한 단계 위로 올려서 보여준다
    for (const c of ctx.children.get(node.id) ?? []) render(c, nextDepth);
  };
  render(ctx.root, 0);

  if (discarded.length) {
    lines.push('', '## 버린 아이디어 (다시 제안하지 말 것)');
    for (const d of discarded.slice(0, 40)) lines.push(`- ${oneLine(d.title)}`);
  }
  return lines.join('\n');
}

/**
 * 팀 경험 블록 (A1을 뺀 모든 action) — 팀원 + 경험 카드(E*) + 이 팀플에서 한 일 + 팀 역량 요약.
 */
export async function experienceBlock(admin: SupabaseClient, ctx: Ctx): Promise<string> {
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const [work, acts] = await Promise.all([
    admin.from('member_workload').select('user_id,assigned_count,done_count').eq('project_id', ctx.projectId),
    admin.from('activity_logs').select('user_id,action').eq('project_id', ctx.projectId).gte('created_at', since).limit(3000),
  ]);
  const workMap = new Map((work.data ?? []).map((w) => [w.user_id, w]));
  const created = new Map<string, number>();
  for (const a of acts.data ?? []) {
    if (a.user_id && a.action === 'node_created') created.set(a.user_id, (created.get(a.user_id) ?? 0) + 1);
  }
  const doneTitles = new Map<string, string[]>();
  for (const a of ctx.assignees) {
    if (a.task_state !== 'done') continue;
    const t = ctx.byId.get(a.node_id)?.title;
    if (!t) continue;
    if (!doneTitles.has(a.user_id)) doneTitles.set(a.user_id, []);
    doneTitles.get(a.user_id)!.push(t);
  }

  const totalExp = [...ctx.experiences.values()].reduce((s, l) => s + l.length, 0);
  const lines = ['## 팀원과 경험 (숙련도: 1 해봤음 / 2 혼자 가능 / 3 가르칠 수 있음)'];

  for (const m of ctx.members) {
    const p = m.profile;
    const w = workMap.get(m.user_id);
    const head = [
      `${ctx.memberRef.get(m.user_id)} ${p?.display_name ?? '이름없음'}`,
      p?.major || '전공 미입력',
      `담당 ${w?.assigned_count ?? 0}개(완료 ${w?.done_count ?? 0})`,
    ];
    if (m.role_label) head.push(`역할: ${m.role_label}`);
    if (p?.skills?.length) head.push(`태그: ${p.skills.slice(0, 8).join(', ')}`);
    lines.push(head.join(' | '));

    const exps = ctx.experiences.get(m.user_id) ?? [];
    if (!exps.length) lines.push('   (경험 정보 없음)');
    for (const ex of exps) {
      const detail = ex.detail ? ` — ${cut(oneLine(ex.detail), EXP_DETAIL_LIMIT)}` : '';
      lines.push(`   ${ctx.expRef.get(ex.id)} [${EXP_KIND_KO[ex.kind] ?? ex.kind}] ${oneLine(ex.title)} (${ex.level})${detail}`);
    }
    const made = created.get(m.user_id) ?? 0;
    const done = doneTitles.get(m.user_id) ?? [];
    if (made || done.length) {
      lines.push(`   (이 팀플에서 한 일: 노드 ${made}개 생성, 완료 ${done.length}${done.length ? ` — ${done.slice(0, 3).map((t) => `'${cut(t, 20)}'`).join(', ')}` : ''})`);
    }
  }

  lines.push('', '## 팀 역량 요약');
  if (!totalExp) {
    lines.push('- 경험 정보 없음: 아직 아무도 경험 카드를 입력하지 않았다.',
      '  → 가장 진입장벽이 낮은 조사 방법과 보수적인 구현 범위를 제안하고, 팀원들에게 경험 카드 입력을 권할 것.');
    return lines.join('\n');
  }
  const strong: string[] = [];
  const strongKinds = new Set<string>();
  const weakOnly = new Set<string>();
  for (const list of ctx.experiences.values()) {
    for (const ex of list) {
      if (ex.level >= 2) { strong.push(`${oneLine(ex.title)}(${ctx.expRef.get(ex.id)})`); strongKinds.add(ex.kind); }
      else weakOnly.add(ex.kind);
    }
  }
  const missing = Object.keys(EXP_KIND_AREA).filter((k) => !strongKinds.has(k));
  lines.push(`- 강함: ${strong.length ? strong.slice(0, 10).join(', ') : '(숙련도 2 이상인 경험 없음)'}`);
  if (missing.length) {
    lines.push(`- 약함/없음: ${missing.map((k) => `${EXP_KIND_AREA[k]}${weakOnly.has(k) ? '(해본 정도)' : ''}`).join(', ')}`);
  }
  return lines.join('\n');
}

/** 노드 실행 계획 요약 (있는 것만). 여러 노드를 한 번에 읽는다. */
export async function planSummaries(admin: SupabaseClient, ctx: Ctx, nodeIds: string[]): Promise<string> {
  if (!nodeIds.length) return '';
  const { data, error } = await admin.from('node_plans')
    .select('node_id,feasibility,feasibility_note,research_methods,scope,risks').in('node_id', nodeIds);
  if (error) throw error;
  const blocks: string[] = [];
  for (const id of nodeIds) {
    const pl = (data ?? []).find((x) => x.node_id === id);
    if (!pl) continue;
    const lines = [`## ${ctx.nodeRef.get(id) ?? ''} 실행 계획 (현재)`];
    if (pl.feasibility) lines.push(`실행 가능성: ${pl.feasibility}/5${pl.feasibility_note ? ` — ${cut(oneLine(pl.feasibility_note), 120)}` : ''}`);
    // deno-lint-ignore no-explicit-any
    const methods = (pl.research_methods ?? []) as any[];
    if (methods.length) lines.push(`조사 방법: ${methods.map((m) => cut(oneLine(m.method ?? ''), 50)).join(' / ')}`);
    // deno-lint-ignore no-explicit-any
    const scope = (pl.scope ?? {}) as Record<string, any[]>;
    const items = (k: string) => (scope[k] ?? []).map((x) => cut(oneLine(x.item ?? ''), 40)).join(', ');
    if (scope.mvp?.length) lines.push(`MVP: ${items('mvp')}`);
    if (scope.out_of_scope?.length) lines.push(`범위 밖: ${items('out_of_scope')}`);
    // deno-lint-ignore no-explicit-any
    const risks = (pl.risks ?? []) as any[];
    if (risks.length) lines.push(`리스크: ${risks.map((r) => cut(oneLine(r.risk ?? ''), 40)).join(' / ')}`);
    if (lines.length > 1) blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

export const planSummary = (admin: SupabaseClient, ctx: Ctx, nodeId: string) => planSummaries(admin, ctx, [nodeId]);

/** 공통 컨텍스트: 프로젝트 + 요구사항 + 팀 경험 + 노드 트리 (+ 추가 블록) */
export async function baseContext(
  admin: SupabaseClient, ctx: Ctx, focusIds: string[] = [], extra: string[] = [],
): Promise<string> {
  return [
    projectBlock(ctx),
    requirementsBlock(ctx),
    await experienceBlock(admin, ctx),
    treeBlock(ctx, focusIds),
    ...extra,
  ].filter(Boolean).join('\n\n');
}

export const clamp = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);
