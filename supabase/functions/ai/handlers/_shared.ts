import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { AppError, MODELS, type Usage } from '../openai.ts';

export interface HandlerArgs {
  admin: SupabaseClient;
  userId: string;
  projectId: string;
  // deno-lint-ignore no-explicit-any
  input: Record<string, any>;
}
export interface HandlerResult {
  data: unknown;
  usage: Usage | null;   // null = AI를 호출하지 않음 (사용량 기록 안 함)
}
export type Handler = (args: HandlerArgs) => Promise<HandlerResult>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const uuidList = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? [...new Set(v.filter(isUuid))].slice(0, max) : [];

export const badRequest = (msg: string) => new AppError(msg, 400, msg);
export const notFound = (msg: string) => new AppError(msg, 404, msg);

/** 오늘(KST) 0시의 ISO 문자열 */
export function kstDayStartISO(): string {
  const KST = 9 * 3600_000;
  const d = new Date(Date.now() + KST);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - KST).toISOString();
}

/**
 * 문서 분석 / 전체 점검용 모델 선택.
 * 서비스 전체 HEAVY 호출 수가 일일 상한을 넘으면 mini 그룹으로 자동 전환한다.
 */
export async function pickHeavyModel(admin: SupabaseClient): Promise<{ model: string; fallbackModel: string }> {
  const limit = Number(Deno.env.get('AI_HEAVY_DAILY_LIMIT') ?? 20);
  const { count } = await admin.from('ai_requests')
    .select('*', { count: 'exact', head: true })
    .eq('model', MODELS.heavy).eq('ok', true)
    .gte('created_at', kstDayStartISO());
  if ((count ?? 0) >= limit) return { model: MODELS.base, fallbackModel: MODELS.fallback };
  return { model: MODELS.heavy, fallbackModel: MODELS.base };
}

export const baseModel = () => ({ model: MODELS.base, fallbackModel: MODELS.fallback });

export function sumUsage(list: Usage[]): Usage | null {
  if (!list.length) return null;
  return {
    model: list[0].model,
    prompt_tokens: list.reduce((s, u) => s + u.prompt_tokens, 0),
    completion_tokens: list.reduce((s, u) => s + u.completion_tokens, 0),
  };
}

/** 같은 노드(들)에 달린 기존 말풍선을 숨긴다 → 항상 최신 피드백만 보이게 */
export async function dismissExisting(
  admin: SupabaseClient, projectId: string,
  opts: { nodeIds?: string[]; projectLevel?: boolean; kinds?: string[] },
) {
  const jobs = [];
  if (opts.nodeIds?.length) {
    let q = admin.from('ai_comments').update({ dismissed: true })
      .eq('project_id', projectId).eq('dismissed', false).in('node_id', opts.nodeIds);
    if (opts.kinds) q = q.in('kind', opts.kinds);
    jobs.push(q);
  }
  if (opts.projectLevel) {
    let q = admin.from('ai_comments').update({ dismissed: true })
      .eq('project_id', projectId).eq('dismissed', false).is('node_id', null);
    if (opts.kinds) q = q.in('kind', opts.kinds);
    jobs.push(q);
  }
  const results = await Promise.all(jobs);
  for (const r of results) if (r.error) throw r.error;
}
