// .env (또는 배포 환경변수) → js/config.js 생성
// 빌드 과정이 없는 순수 정적 앱이라 브라우저는 .env 를 읽을 수 없다. 이 스크립트가 공개해도 되는 값만 골라
// js/config.js 로 옮긴다. (OPEN_API_KEY / OPENAI_API_KEY 같은 비밀 값은 절대 옮기지 않는다)
//
//   node scripts/gen-config.mjs          # 로컬: .env 에서 읽음
//   (Vercel/Netlify 빌드 명령으로 쓰면 대시보드 환경변수에서 읽음)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = { ...parseEnv(join(root, '.env')), ...parseEnv(join(root, '.env.local')), ...process.env };
const pick = (...names) => names.map((n) => env[n]).find((v) => v && v.trim())?.trim();

const url = pick('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
const key = pick('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');

if (!url || !key) {
  console.error('✗ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 를 .env 에서 찾지 못했어요.');
  process.exit(1);
}
if (/^sb_secret_/.test(key) || /service_role/.test(Buffer.from(key.split('.')[1] ?? '', 'base64').toString('utf8'))) {
  console.error('✗ 공개 키 자리에 secret/service_role 키가 들어 있어요. publishable(anon) 키를 넣어 주세요.');
  process.exit(1);
}

const out = `// 자동 생성 파일 — scripts/gen-config.mjs 가 .env 에서 만든다. 직접 고치지 말고 .env 를 고친 뒤 다시 실행하세요.
// publishable(anon) 키는 공개되어도 되는 키입니다(RLS로 보호).
export const SUPABASE_URL = ${JSON.stringify(url)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(key)};
`;
writeFileSync(join(root, 'js', 'config.js'), out);
console.log(`✓ js/config.js 생성 (${new URL(url).host})`);
