// 프로젝트 id 를 URL(?project=) 에서 읽는다.
// 예전 serve.json(cleanUrls 전체)이 `app.html?project=X` → `/app` 으로 301 을 보냈고, 브라우저가 이 영구 리다이렉트를
// 캐시해 두면 쿼리가 사라진 채 `/app` 으로 들어온다. 그래서 마지막으로 연 프로젝트를 sessionStorage 에도 남겨 대체값으로 쓴다.
const KEY = 'nodi.lastProject';

const save = (pid) => { try { sessionStorage.setItem(KEY, pid); } catch { /* 무시 */ } };
const load = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };

/** 현재 페이지의 프로젝트 id (쿼리 → 없으면 방금 연 프로젝트) */
export function currentProjectId() {
  const pid = new URLSearchParams(location.search).get('project');
  if (pid) { save(pid); return pid; }
  return load();
}

/** 이동 직전에 프로젝트 id 를 기억 (코드로 이동할 때) */
export const rememberProject = (pid) => { if (pid) save(pid); };

/** `?project=` 가 붙은 링크를 누르면 그 프로젝트 id 를 기억해 둔다 */
export function rememberProjectLinks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href*="project="]');
    if (!a) return;
    try { rememberProject(new URL(a.href).searchParams.get('project')); } catch { /* 무시 */ }
  }, true);
}
