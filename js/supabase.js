// Supabase 클라이언트 단일 인스턴스
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let cfg;
try {
  cfg = await import('./config.js');
} catch {
  cfg = null;
}

function showSetupError(msg) {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'setup-error';
  const h = document.createElement('h2');
  h.textContent = '설정이 필요해요';
  const p = document.createElement('p');
  p.style.marginTop = '12px';
  p.textContent = msg;
  box.append(h, p);
  document.body.append(box);
}

const valid = cfg && cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT-REF') && cfg.SUPABASE_ANON_KEY;
if (!valid) {
  showSetupError('js/config.js 가 없어요. 터미널에서 `node scripts/gen-config.mjs` 를 실행해 .env 의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 로 만들거나, js/config.example.js 를 복사해 값을 채운 뒤 새로고침하세요.');
  throw new Error('Supabase config missing');
}

export const SUPABASE_URL = cfg.SUPABASE_URL;
export const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY;
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
