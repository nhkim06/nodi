// 공통 플로팅 헤더 (NO:DI 디자인): 로고 · Home / Project / Account / setting · 로그인 영역
// + 원근 그리드 배경(.bg-grid)을 body 맨 앞에 한 번 넣는다.
import { h } from '../utils/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/** 보라 팔각형 + 흰 둥근 사각형 로고 마크 */
export function logoMark(size = 28) {
  const id = `lg${Math.random().toString(36).slice(2, 7)}`;
  return svg('svg', { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': 'true', class: 'logo__mark' },
    svg('defs', {}, svg('linearGradient', { id, x1: '0', y1: '0', x2: '1', y2: '1' },
      svg('stop', { offset: '0', 'stop-color': '#9A82FA' }),
      svg('stop', { offset: '1', 'stop-color': '#6243E6' }))),
    svg('path', {
      d: 'M10 2h12l8 8v12l-8 8H10l-8-8V10z', fill: `url(#${id})`,
      stroke: `url(#${id})`, 'stroke-width': '3', 'stroke-linejoin': 'round',
    }),
    svg('rect', { x: '10', y: '9.5', width: '12.5', height: '13', rx: '3.2', fill: '#fff', transform: 'rotate(-6 16 16)' }));
}

export const logo = (href = 'index.html#/home') => h('a', { class: 'logo', href, 'aria-label': 'NO:DI 홈' }, logoMark(), h('span', {}, 'NO:DI'));

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
