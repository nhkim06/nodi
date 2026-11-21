// 공통 플로팅 헤더 (NO:DI 디자인): 로고 · Home / Project / Account / setting · 로그인 영역
// + 원근 그리드 배경(.bg-grid)을 body 맨 앞에 한 번 넣는다.
import { h } from '../utils/dom.js';

export const logo = (href = 'index.html#/home') => h('a', { class: 'logo', href, 'aria-label': 'NO:DI 홈' },
  h('img', { class: 'logo__mark', src: 'logo.svg', width: 114, height: 32, alt: '' }));

const LINKS = [
  { id: 'home', label: 'Home', href: 'index.html#/home' },
  { id: 'projects', label: 'Project', href: 'index.html#/projects' },
  { id: 'account', label: 'Account', href: 'index.html#/account' },
  { id: 'settings', label: 'setting', href: 'index.html#/settings' },
];

/** 원근 그리드 배경을 한 번만 넣는다 */
export function ensureBackground() {
  if (document.querySelector('.bg-grid')) return;
  document.body.prepend(h('div', { class: 'bg-grid', 'aria-hidden': 'true' },
    h('i', { class: 'bg-grid__plane bg-grid__plane--ceil' }),
    h('i', { class: 'bg-grid__plane bg-grid__plane--floor' })));
}

/**
 * active: 'home' | 'projects' | 'account' | 'settings' | null
 * user: 로그인 사용자 (없으면 Sign in / Sign up)
 * links: 각 탭 href 덮어쓰기 (예: { settings: 'index.html#/settings/<id>' })
 */
export function topNav({ active = null, userName = null, onSignIn, onSignUp, onSignOut, links = {} } = {}) {
  ensureBackground();
  return h('header', { class: 'topnav' },
    h('div', { class: 'topnav__bar' },
      logo(),
      h('nav', { class: 'topnav__links', 'aria-label': '주요 메뉴' },
        LINKS.map((l) => h('a', {
          class: ['topnav__link', l.id === active && 'topnav__link--on'],
          href: links[l.id] ?? l.href,
          'aria-current': l.id === active ? 'page' : null,
        }, l.label))),
      h('div', { class: 'topnav__auth' },
        userName
          ? [h('span', { class: 'topnav__user ellipsis', title: userName }, userName),
            h('button', { class: 'btn topnav__cta', onclick: onSignOut }, 'Sign out')]
          : [h('button', { class: 'topnav__signin', onclick: onSignIn }, 'Sign in'),
            h('button', { class: 'btn topnav__cta', onclick: onSignUp ?? onSignIn }, 'Sign up for free')])));
}
