// URL hash 기반 포커스 뷰: #/home, #/focus/<id>,<id>
import { setState } from './store.js';

const UUID = /^[0-9a-f-]{36}$/i;

export function parseHash(hash = location.hash) {
  const m = hash.match(/^#\/focus\/(.+)$/);
  if (!m) return [];
  return m[1].split(',').map(decodeURIComponent).filter((id) => UUID.test(id));
}

export function goHome() {
  location.hash = '#/home';
}

export function goFocus(ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return goHome();
  location.hash = `#/focus/${list.join(',')}`;
}

export function startRouter(onChange) {
  const apply = () => {
    const focus = parseHash();
    setState({ focus });
    onChange?.(focus);
  };
  window.addEventListener('hashchange', apply);
  if (!location.hash) history.replaceState(null, '', '#/home');
  apply();
}
