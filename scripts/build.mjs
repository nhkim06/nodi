// 배포용 빌드: js/config.js 생성 → 공개할 파일만 dist/ 로 복사
// (Vercel 이 vercel.json 의 buildCommand 로 실행. 로컬에서도 `node scripts/build.mjs` 로 확인 가능)
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// 1) .env / 배포 환경변수 → js/config.js
await import('./gen-config.mjs');

// 2) 브라우저가 쓰는 파일만 복사 (md, scripts, supabase 등은 배포하지 않음)
const PUBLIC = ['index.html', 'app.html', 'me.html', 'favicon.svg', 'css', 'js'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const p of PUBLIC) {
  const src = join(root, p);
  if (!existsSync(src)) { console.error(`✗ ${p} 가 없어요.`); process.exit(1); }
  cpSync(src, join(dist, p), { recursive: true });
}
if (!existsSync(join(dist, 'js', 'config.js'))) {
  console.error('✗ dist/js/config.js 가 만들어지지 않았어요.');
  process.exit(1);
}
console.log(`✓ dist/ 준비 완료 (${PUBLIC.join(', ')})`);
