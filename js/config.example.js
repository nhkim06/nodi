// js/config.js 템플릿 (config.js 는 .gitignore 대상)
// 보통은 직접 만들 필요 없이 `node scripts/gen-config.mjs` 를 실행하면
// .env 의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 로 js/config.js 가 만들어진다.
// publishable(anon) key 는 공개되어도 되는 키입니다(RLS로 보호). secret / service_role 키는 절대 넣지 마세요.
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-PUBLISHABLE-OR-ANON-KEY';
