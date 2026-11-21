// Supabase Edge Function: ai
// 브라우저 → (JWT) → 여기 → OpenAI. OpenAI 키는 이 함수의 secret(OPENAI_API_KEY 또는 OPEN_API_KEY)으로만 존재한다.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handlers } from './handlers/index.ts';
import { AppError } from './openai.ts';
import { isUuid } from './handlers/_shared.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',   // 배포 시 실제 도메인으로 제한
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // service role 클라이언트 하나로 인증 확인 + 멤버 확인 + AI 결과 기록을 모두 한다.
  // (anon/publishable 키 종류와 무관하게 동작하도록 사용자 클라이언트를 따로 만들지 않는다)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let action = '';
  let projectId = '';
  let userId = '';
  try {
    const body = await req.json().catch(() => ({}));
    ({ action, projectId } = body);
    const { action: _a, projectId: _p, ...input } = body;

    const handler = handlers[action];
    if (!handler) return json({ error: '알 수 없는 AI 기능이에요.' }, 400);
    if (!isUuid(projectId)) return json({ error: 'projectId가 필요해요.' }, 400);

    // 1) 요청자 인증: 브라우저가 보낸 사용자 JWT 검증
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    if (!user) return json({ error: '로그인이 필요해요.' }, 401);
    userId = user.id;

    // 2) 멤버십 확인
    const { data: member } = await admin.from('project_members')
      .select('user_id').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
    if (!member) return json({ error: '이 프로젝트의 멤버가 아니에요.' }, 403);

    // 3) 사용량 제한
    await assertRateLimit(admin, user.id, projectId);

    // 4) 실행 (컨텍스트 빌드 → OpenAI → 검증 → DB 저장)
    const result = await handler({ admin, userId: user.id, projectId, input });

    // 5) 사용량 기록
    if (result.usage) {
      await admin.from('ai_requests').insert({
        project_id: projectId, user_id: user.id, action,
        model: result.usage.model,
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
      });
    }
    return json(result.data);
  } catch (e) {
    console.error(action, e);
    const err = e as AppError;
    const status = err.status ?? 500;
    // 서버/AI 쪽 실패만 기록 (입력 오류·확인 요청(409)·한도 초과는 기록하면 한도만 줄어듦)
    if (userId && isUuid(projectId) && status >= 500) {
      await admin.from('ai_requests').insert({
        project_id: projectId, user_id: userId, action, ok: false,
        error: String(err.message ?? e).slice(0, 500),
      }).then(() => {}, () => {});
    }
    return json({ error: err.publicMessage ?? 'AI 요청 처리 중 오류가 발생했어요.' }, status);
  }
});

async function assertRateLimit(admin: SupabaseClient, userId: string, projectId: string) {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const [{ count: u }, { count: p }] = await Promise.all([
    admin.from('ai_requests').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', hourAgo),
    admin.from('ai_requests').select('*', { count: 'exact', head: true }).eq('project_id', projectId).gte('created_at', dayAgo),
  ]);
  if ((u ?? 0) >= Number(Deno.env.get('AI_USER_HOURLY_LIMIT') ?? 30) ||
      (p ?? 0) >= Number(Deno.env.get('AI_PROJECT_DAILY_LIMIT') ?? 200)) {
    throw new AppError('rate limited', 429, 'AI 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.');
  }
}
