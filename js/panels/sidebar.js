import { icon } from '../utils/icons.js';
// 프로젝트 상세 왼쪽 메뉴 + 부품 (NO:DI 디자인)
//   메뉴: 🗺️ 아이디어 맵 / 📄 과제 요구사항 / 👥 팀원 / 🔗 작업 링크 모음 / ✅ 나의 작업
//   부품: 노드 트리 · AI 도구 · 과제 요구사항 · 내 작업 상태 · 팀원 카드 · 링크 · 나의 작업
//   메뉴마다 부품을 왼쪽 보조 패널(접히는 카드) 또는 메인 보드(펼친 섹션)에 배치한다 → LAYOUT
import { h, render, toast, safeUrl, spinner } from '../utils/dom.js';
import { dday, fmtDuration, relTime } from '../utils/time.js';
import { LINK_KINDS, REQ_CATEGORIES, IMPORTANCE, SIGNALS, TASK_STATES, avatar, effectiveSignal } from '../utils/color.js';
import { EXP_KINDS, sortExperiences, expTooltip } from '../utils/experience.js';
import { sendPraise } from '../api/praises.js';
import { updateTask } from '../api/tasks.js';
import { refreshTemperatures } from '../realtime.js';
import { getState, setState, mutate, rootNode, childrenOf, me, PROJECT_KEY } from '../store.js';
import { goHome } from '../router.js';
import { deleteLink } from '../api/links.js';
import { setSignal, signalTime } from '../api/signals.js';
import { addRequirement, updateRequirement, deleteRequirement, deleteDoc, openDocFile } from '../api/docs.js';
import { isRunning } from '../api/ai.js';
import { revealNode, aiReview, aiDirection, aiRoles, addNodeFromComment } from '../actions.js';
import {
  openDocModal, openGenerateModal, openLinkModal, openPraiseModal, openHelpModal,
  openRequirementModal, confirmModal, analyzeDoc, openExperienceModal,
} from './modals.js';
import { totalExperiences } from '../utils/experience.js';

const openState = loadOpenState();
function loadOpenState() {
  try { return JSON.parse(localStorage.getItem('nodi.sidebar') ?? '{}'); } catch { return {}; }
}

// 프로젝트 상세 메뉴 (IA v2 4개 영역 + 과제 요구사항). 각 메뉴가 부품(parts)을 왼쪽 보조 패널(side) / 메인 보드(page)에 배치한다.
export const VIEWS = [
  { id: 'map', label: '아이디어 맵', icon: 'home' },
  { id: 'docs', label: '과제 요구사항', icon: 'doc' },
  { id: 'team', label: '팀원', icon: 'users' },
  { id: 'links', label: '작업 링크 모음', icon: 'link' },
  { id: 'mine', label: '나의 작업', icon: 'check' },
];
const LAYOUT = {
  map: { side: ['tree', 'ai'], page: [] },
  docs: { side: ['tree'], page: ['docs'] },
  team: { side: ['signal'], page: ['team'] },
  links: { side: [], page: ['links'] },
  mine: { side: ['signal'], page: ['mine'] },
};
const placeOf = new Map();   // partId -> 'side' | 'page'

/** 왼쪽 보조 패널에서는 접히는 카드, 메인 보드에서는 펼친 페이지 섹션 */
function section(id, title, count, body, defaultOpen = false) {
  if (placeOf.get(id) === 'page') {
    return h('section', { class: 'page-sec' },
      h('h2', { class: 'page-sec__title' }, title, count != null && h('span', { class: 'side-sec__count' }, String(count))),
      h('div', { class: 'page-sec__body' }, body));
  }
  const el = h('details', { class: 'side-sec', open: openState[id] ?? defaultOpen },
    h('summary', {}, title, count != null && h('span', { class: 'side-sec__count' }, String(count))),
    h('div', { class: 'side-sec__body' }, body));
  el.addEventListener('toggle', () => {
    openState[id] = el.open;
    try { localStorage.setItem('nodi.sidebar', JSON.stringify(openState)); } catch { /* 무시 */ }
  });
  return el;
}

const parts = {};
const slots = {};
let treeSig = '';

export function initSidebar({ nav, side, page, head }) {
  Object.assign(slots, { nav, side, page, head });
  for (const k of ['tree', 'docs', 'ai', 'signal', 'team', 'links', 'mine']) parts[k] = h('div', { class: `part part--${k}` });
}

/** 메뉴 전환: 부품을 제자리에 옮겨 끼운다. 다음 renderSidebar(ALL) 에서 모양(카드/섹션)이 다시 그려진다. */
export function layoutSidebar(view) {
  const lay = LAYOUT[view] ?? LAYOUT.map;
  placeOf.clear();
  lay.side.forEach((k) => placeOf.set(k, 'side'));
  lay.page.forEach((k) => placeOf.set(k, 'page'));
  treeSig = '';
  slots.side.replaceChildren(...lay.side.map((k) => parts[k]));
  slots.page.replaceChildren(...lay.page.map((k) => parts[k]));
}

export function renderSidebar(s, keys) {
  const has = (...k) => k.some((x) => keys.has(x));
  if (has('project', 'pageView')) renderHead(s);
  if (has('project', 'pageView', 'requirements', 'members', 'links', 'assignees', 'user')) renderNav(s);
  if (has('nodes', 'selection', 'project', 'pageView')) renderTree(s);
  if (has('docs', 'requirements', 'coverage', 'project', 'pageView')) renderDocs(s);
  if (has('aiComments', 'nodes', 'focus', 'selection', 'project', 'aiBusy', 'experiences', 'members', 'pageView')) renderAI(s);
  if (has('links', 'nodes', 'project', 'pageView')) renderLinks(s);
  if (has('members', 'signalTime', 'project', 'pageView')) renderSignal(s);
  if (has('members', 'assignees', 'experiences', 'project', 'pageView')) renderTeam(s);
  if (has('assignees', 'tasks', 'nodes', 'project', 'user', 'pageView')) renderMine(s);
}

// 보드 위 프로젝트 제목 줄 ---------------------------------------------------------------
function renderHead(s) {
  const p = s.project;
  const d = dday(p.due_date);
  render(slots.head,
    h('h1', { class: 'proj-bar__name ellipsis', title: p.name }, p.name),
    p.course_name && h('span', { class: 'proj-bar__chip' }, p.course_name),
    p.completed_at
      ? h('span', { class: 'proj-bar__chip' }, '종료됨')
      : d && h('span', { class: ['proj-bar__chip', 'dday', d.days <= 3 && 'dday--urgent'], title: p.due_date }, d.label),
    h('span', { class: 'spacer' }),
    s.pageView === 'map' && h('button', { class: 'btn btn--sm btn--ghost', onclick: () => goHome() }, '⤢ 맵 전체 보기'),
    h('a', { class: 'btn btn--sm', href: `index.html#/settings/${p.id}`, title: '프로젝트 기본 정보 · 팀원 관리 · 초대 링크' }, '설정'));
}

// 왼쪽 메뉴 (Dashboard 스타일 알약 목록) ----------------------------------------------------
function renderNav(s) {
  const counts = {
    docs: s.requirements.length || null,
    team: s.members.size,
    links: s.links.length || null,
    mine: [...s.assignees.values()].filter((m) => m.has(s.user.id)).length || null,
  };
  render(slots.nav, VIEWS.map((v) => h('button', {
    class: ['side-nav__item', s.pageView === v.id && 'side-nav__item--on'],
    'aria-current': s.pageView === v.id ? 'page' : null,
    onclick: () => { if (getState().pageView !== v.id) setState({ pageView: v.id }); },
  },
  icon(v.icon, 'side-nav__icon'),
  s.pageView === v.id && h('span', { class: 'side-nav__dot' }),
  h('span', { class: 'side-nav__label' }, v.label),
  counts[v.id] != null && h('span', { class: 'side-nav__count' }, String(counts[v.id])))));
}

// 👥 팀원 카드 (팀원 작업 상태 · 좋아요 · 전공/역할) ------------------------------------------
function renderTeam(s) {
  if (placeOf.get('team') !== 'page') return;
  const list = [...s.members.values()].sort((a, b) =>
    (a.user_id === s.user.id ? -1 : b.user_id === s.user.id ? 1 : a.joined_at.localeCompare(b.joined_at)));
  const work = new Map();
  for (const map of s.assignees.values()) {
    for (const a of map.values()) {
      const w = work.get(a.user_id) ?? { total: 0, done: 0 };
      w.total += 1;
      if (a.task_state === 'done') w.done += 1;
      work.set(a.user_id, w);
    }
  }
  const invite = () => copyInvite(s.project.invite_code);

  render(parts.team, h('section', { class: 'page-sec' },
    h('div', { class: 'page-sec__head' },
      h('h2', { class: 'page-sec__title' }, '팀원', h('span', { class: 'side-sec__count' }, String(list.length))),
      h('span', { class: 'spacer' }),
      list.length > 1 && h('button', { class: 'btn btn--sm', onclick: () => openPraiseModal() }, icon('heart'), '메시지와 함께 좋아요'),
      h('button', { class: 'btn btn--sm', onclick: aiRoles }, icon('users'), 'AI 역할 분담 추천')),
    h('div', { class: 'team-grid' },
      list.map((m) => teamCard(s, m, work.get(m.user_id) ?? { total: 0, done: 0 })),
      h('button', { class: 'team-card team-card--add', onclick: invite, title: '초대 링크 복사' },
        h('span', { class: 'team-card__plus' }, '+'), h('span', { class: 'small muted' }, '초대 링크 복사')))));
}

function teamCard(s, m, w) {
  const isMe = m.user_id === s.user.id;
  const sig = effectiveSignal(m);
  const sigKey = sig === 'stale' ? 'yellow' : sig;
  const exps = sortExperiences(s.experiences.get(m.user_id) ?? []).slice(0, 3);
  return h('article', { class: ['team-card', sig === 'red' && 'team-card--red'] },
    h('div', { class: 'team-card__head' },
      avatar(m, { size: 48 }),
      h('div', { class: 'grow', style: { minWidth: '0' } },
        h('div', { class: 'team-card__name ellipsis' }, m.profile?.display_name ?? '팀원', isMe ? ' (나)' : '', m.role === 'owner' ? [' ', icon('crown'), '(팀장)'] : ''),
        h('div', { class: 'team-card__handle ellipsis' }, m.signal_message || (sig === 'stale' ? '자리 비움?' : SIGNALS[sig]?.label))),
      h('span', { class: 'team-card__status', title: `작업 상태: ${sig === 'stale' ? '자리 비움?' : SIGNALS[sig]?.label}` },
        h('span', { class: ['signal-light', `signal-light--${sigKey}`] }))),
    h('button', {
      class: 'team-card__like', disabled: isMe, title: isMe ? '받은 좋아요' : '좋아요 보내기 (하루 한 번)',
      onclick: (e) => sendLike(m, e.currentTarget),
    }, thumb(), String(m.praise_count ?? 0)),
    h('div', { class: 'team-card__lines' },
      h('div', {}, m.profile?.major || '전공 미입력'),
      h('div', {}, m.role_label || '역할 미정', ` · 담당 ${w.total}개 · 완료 ${w.done}개`)),
    exps.length > 0 && h('div', { class: 'row row--wrap', style: { marginTop: '10px' } },
      exps.map((ex) => h('span', { class: 'exp-chip', title: expTooltip(ex) }, `${EXP_KINDS[ex.kind]?.label ?? '기타'} · ${ex.title}`))));
}

/** 다른 메뉴에서 노드를 누르면 아이디어 맵으로 돌아가 그 노드를 보여준다 (보드가 보인 뒤에 위치 계산) */
function goNode(id) {
  if (getState().pageView === 'map') return revealNode(id);
  setState({ pageView: 'map' });
  requestAnimationFrame(() => requestAnimationFrame(() => revealNode(id)));
}

async function copyInvite(code) {
  const url = new URL(`index.html?join=${encodeURIComponent(code)}`, location.href).href;
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요. 팀원에게 보내 주세요!'); } catch { toast(url, { duration: 8000 }); }
}

function thumb() {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', 'thumb');
  el.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M2 10h4v11H2z M8 21V10l4.6-7.2c.3-.5 1-.7 1.5-.4 1 .5 1.4 1.6 1.1 2.6L14.3 9H20a2 2 0 0 1 2 2.3l-1.3 7.9A2.2 2.2 0 0 1 18.5 21z');
  el.append(p);
  return el;
}

// 노드 트리 -------------------------------------------------------------------------
function renderTree(s) {
  const r = rootNode();
  const sig = [...s.nodes.values()].map((n) => `${n.id}${n.parent_id}${n.title}${n.status}`).join('|') +
    [...s.selection].join(',');
  if (sig === treeSig) return;
  treeSig = sig;

  const items = [];
  const walk = (node, depth) => {
    items.push(h('div', {
      class: ['tree__item', s.selection.has(node.id) && 'tree__item--selected', node.status === 'discarded' && 'tree__item--discarded'],
      style: { paddingLeft: `${4 + depth * 14}px` },
      title: node.title,
      onclick: () => goNode(node.id),
    },
    h('span', { class: ['tree__status', `tree__status--${node.status}`] }),
    h('span', { class: 'tree__label' }, `${node.is_candidate ? '[후보] ' : ''}${node.title}`)));
    for (const c of childrenOf(node.id)) walk(c, depth + 1);
  };
  if (r) walk(r, 0);
  render(parts.tree, section('tree', '노드 트리', s.nodes.size,
    h('div', { class: 'tree' }, items.length ? items : h('div', { class: 'empty' }, '노드가 없어요')), true));
}

// 과제 문서 + 요구사항 ------------------------------------------------------------------
function renderDocs(s) {
  const groups = new Map();
  for (const r of s.requirements) {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category).push(r);
  }
  const indexOf = new Map(s.requirements.map((r, i) => [r.id, i + 1]));

  const docList = s.docs.map((d) => h('div', { class: 'link-item' },
    h('span', { class: 'small muted' }, d.analyzed_at ? [icon('doc'), '분석 완료'] : [icon('clock'), '분석 전']),
    h('a', {
      href: '#', title: d.file_name,
      onclick: (e) => { e.preventDefault(); if (d.storage_path) openDocFile(d); else toast('붙여넣은 텍스트라 원본 파일이 없어요.'); },
    }, d.file_name),
    !d.analyzed_at && h('button', { class: 'icon-btn', title: '다시 분석', onclick: () => analyzeDoc(d.id) }, '↻'),
    h('button', {
      class: 'icon-btn', title: '문서 삭제',
      onclick: async () => { if (await confirmModal(`'${d.file_name}' 문서를 삭제할까요?\n추출된 요구사항은 남아 있어요.`, { okText: '삭제', danger: true })) deleteDoc(d).catch(() => {}); },
    }, '✕')));

  const reqItems = [...groups.entries()].map(([cat, list]) => h('div', { class: 'req-group' },
    h('div', { class: 'req-group__title' }, REQ_CATEGORIES[cat] ?? cat),
    list.map((r) => reqRow(r, indexOf.get(r.id), s.coverage.get(r.id)))));

  render(parts.docs, section('docs', [icon('doc'), '과제 요구사항'], s.requirements.length || null, [
    h('button', { class: 'btn btn--sm btn--block', onclick: openDocModal }, '＋ 과제 문서 올리기'),
    docList.length > 0 && h('div', { style: { marginTop: '6px' } }, docList),
    s.requirements.length === 0
      ? h('p', { class: 'small faint', style: { marginTop: '8px' } }, '과제 공지를 올리면 AI가 요구사항을 정리해요. 모든 AI 피드백의 기준이 돼요.')
      : reqItems,
    h('button', { class: 'btn btn--ghost btn--sm', style: { marginTop: '6px' }, onclick: () => openRequirementModal(addRequirement) }, '＋ 요구사항 직접 추가'),
  ], s.requirements.length === 0));
}

function reqRow(r, idx, cov) {
  const text = h('span', { class: 'req__text', title: r.source_quote ? `원문: ${r.source_quote}` : '클릭해서 수정' }, `R${idx} ${r.content}`);
  const row = h('div', { class: 'req' },
    h('button', {
      class: ['req__imp', `req__imp--${r.importance}`], title: '중요도 바꾸기',
      onclick: () => updateRequirement(r.id, { importance: r.importance === 3 ? 1 : r.importance + 1 }).catch(() => {}),
    }, IMPORTANCE[r.importance]),
    text,
    cov && h('span', {
      class: ['req__cov', `req__cov--${cov.status}`],
      title: `${{ covered: '충분', partial: '일부', missing: '없음' }[cov.status]} — ${cov.reason}\n(클릭: 관련 노드 선택)`,
      onclick: () => { if (cov.node_ids.length) setState({ selection: new Set(cov.node_ids.filter((id) => getState().nodes.has(id))) }); },
    }),
    h('button', {
      class: 'icon-btn req__del', title: '삭제',
      onclick: async () => { if (await confirmModal('이 요구사항을 삭제할까요?', { okText: '삭제', danger: true })) deleteRequirement(r.id).catch(() => {}); },
    }, '✕'));

  text.addEventListener('click', () => {
    const input = h('textarea', { class: 'textarea', rows: '3', maxlength: '500', dataset: { key: `req-${r.id}` } });
    input.value = r.content;
    text.replaceWith(input);
    input.focus();
    let finished = false;
    const done = (save) => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      input.replaceWith(text);
      if (save && v && v !== r.content) updateRequirement(r.id, { content: v }).catch(() => {});
    };
    input.addEventListener('blur', () => done(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    });
  });
  return row;
}

// AI 도구 -------------------------------------------------------------------------
function renderAI(s) {
  const projectComments = s.aiComments.get(PROJECT_KEY) ?? [];
  const summary = [...projectComments].reverse().find((c) => c.kind === 'feedback');
  const rootGaps = projectComments.filter((c) => c.kind === 'gap');
  const reviewing = isRunning('review_all', s.focus.length ? { scope: 'focus', focusIds: s.focus } : { scope: 'home' });
  const selected = [...s.selection];
  const expCount = totalExperiences(s);
  const withExp = [...s.members.keys()].filter((id) => (s.experiences.get(id) ?? []).length > 0).length;
  const mineEmpty = !(s.experiences.get(s.user.id) ?? []).length;

  render(parts.ai, section('ai', [icon('sparkles'), 'AI 도구'], null, [
    h('div', { class: ['team-exp', expCount === 0 && 'team-exp--empty'] },
      h('div', { class: 'grow' },
        h('div', { class: 'small', style: { fontWeight: '700' } }, `팀 경험 카드 ${expCount}개`),
        h('div', { class: 'small muted' }, expCount === 0
          ? 'AI가 보수적인 범위로만 제안해요'
          : `팀원 ${s.members.size}명 중 ${withExp}명 입력 · AI 구체화 근거`)),
      h('button', { class: 'btn btn--sm', onclick: () => openExperienceModal() }, mineEmpty ? '입력' : '편집')),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn--sm btn--block', onclick: () => openGenerateModal(selected.length ? selected : s.focus) }, icon('bulb'), '아이디어 생성'),
      h('button', { class: 'btn btn--sm btn--block', disabled: reviewing, onclick: aiReview }, reviewing ? spinner() : [icon('search'), '전체 점검 (요구사항 · 팀 역량)']),
      h('button', { class: 'btn btn--sm btn--block', onclick: () => aiDirection(selected.length ? selected : s.focus) }, icon('compass'), '방향 추천'),
      h('button', { class: 'btn btn--sm btn--block', onclick: aiRoles }, icon('users'), '역할 분담 추천'),
    ),
    summary && h('div', { style: { marginTop: '10px' } },
      h('div', { class: 'small muted', style: { fontWeight: '700' } }, `최근 점검 · ${relTime(summary.created_at)}`),
      h('div', { class: 'small', style: { whiteSpace: 'pre-wrap', marginTop: '2px' } }, summary.content)),
    rootGaps.length > 0 && h('div', { style: { marginTop: '8px' } },
      h('div', { class: 'small muted', style: { fontWeight: '700' } }, '빠진 부분'),
      rootGaps.map((g) => h('div', { class: 'row small', style: { marginTop: '4px' } },
        h('span', { class: 'grow', title: g.content }, g.content.split('\n')[0]),
        h('button', { class: 'btn btn--sm', onclick: () => addNodeFromComment(g) }, '＋')))),
  ], true));
}

// 작업 링크 모음 — 노션 · 회의록 · 피그마 … 종류별로 묶어서 ------------------------------
function renderLinks(s) {
  const byKind = new Map(Object.keys(LINK_KINDS).map((k) => [k, []]));
  for (const l of s.links) (byKind.get(l.kind) ?? byKind.get('other')).push(l);
  const groups = [...byKind.entries()].filter(([, list]) => list.length).map(([kind, list]) => h('div', { class: 'link-group' },
    h('div', { class: 'req-group__title' }, LINK_KINDS[kind].label),
    list.map((l) => {
      const url = safeUrl(l.url);
      const node = l.node_id ? s.nodes.get(l.node_id) : null;
      return h('div', { class: 'link-item' },
        h('a', { href: url ?? '#', target: '_blank', rel: 'noopener noreferrer', title: node ? `${l.title} · ${node.title}` : l.title }, l.title),
        h('button', { class: 'icon-btn', title: '삭제', onclick: () => deleteLink(l.id).catch(() => {}) }, '✕'));
    })));
  render(parts.links, section('links', [icon('link'), '링크'], s.links.length || null, [
    groups.length === 0 && h('p', { class: 'small faint' }, '노션, 회의록, 피그마 링크를 한곳에 모아 두세요.'),
    groups,
    h('button', { class: 'btn btn--ghost btn--sm', onclick: () => openLinkModal(null) }, '＋ 링크 추가'),
  ], s.links.length > 0));
}

// 내 신호등 -------------------------------------------------------------------------
function renderSignal(s) {
  const mine = me();
  if (!mine) return;
  const change = async (signal) => {
    const msgInput = parts.signal.querySelector('[data-key="signal-msg"]');
    const message = msgInput?.value.trim() ?? mine.signal_message;
    try {
      const row = await setSignal(s.project.id, s.user.id, signal, message);
      mutate('members', (m) => m.set(s.user.id, { ...m.get(s.user.id), ...row }));
      refreshSignalTime();
    } catch { /* 토스트 처리됨 */ }
  };
  const msg = h('input', {
    class: 'input', maxlength: '80', placeholder: '한 줄 상태 (예: API 연동에서 막힘)',
    value: mine.signal_message ?? '', dataset: { key: 'signal-msg' },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); },
    onchange: (e) => { if ((e.target.value.trim() || null) !== (mine.signal_message || null)) change(mine.signal); },
  });
  const t = s.signalTime ?? {};
  render(parts.signal, section('signal', [icon('clock'), `내 작업 상태 · ${SIGNALS[mine.signal]?.label ?? SIGNALS.off.label}`], null, [
    h('div', { class: 'signal-btns' },
      ['green', 'yellow', 'red'].map((sig) => h('button', {
        class: ['signal-btn', mine.signal === sig && 'signal-btn--on'],
        onclick: () => change(mine.signal === sig ? 'off' : sig),
        title: mine.signal === sig ? '한 번 더 누르면 오프라인' : SIGNALS[sig].label,
      }, h('span', { class: ['signal-light', `signal-light--${sig}`] }), SIGNALS[sig].label))),
    h('div', { style: { marginTop: '6px' } }, msg),
    mine.signal === 'red' && h('button', { class: 'btn btn--sm btn--block', style: { marginTop: '6px' }, onclick: () => openHelpModal(msg.value || mine.signal_message) }, icon('sparkles'), 'AI 도움 받기'),
    h('div', { class: 'signal-time', title: '상태를 켜 둔 시간이 자동으로 측정돼요' }, h('span', {}, '오늘'),
      h('span', {}, `진행 중 ${fmtDuration(t.green)} · 쉬는 중 ${fmtDuration(t.yellow)} · 도움 필요 ${fmtDuration(t.red)}`)),
  ], true));
}

/** 오늘 내 신호등 누적 시간 다시 읽기 */
export async function refreshSignalTime() {
  const { project, user } = getState();
  if (!project || !user) return;
  try {
    setState({ signalTime: await signalTime(project.id, user.id) });
  } catch { /* 조용히 무시 */ }
}

async function sendLike(m, btn) {
  const { project } = getState();
  btn.disabled = true;
  try {
    await sendPraise({ projectId: project.id, toUser: m.user_id });
    toast(`${m.profile?.display_name ?? '팀원'}님에게 좋아요를 보냈어요!`);
    refreshTemperatures(project.id);
  } catch { btn.disabled = false; }
}

// 나의 작업 — 담당 노드 확인 + 나에게 배정된 할 일 ---------------------------------------
function renderMine(s) {
  const uid = s.user.id;
  const mineNodes = [];
  for (const [nodeId, map] of s.assignees) {
    const a = map.get(uid);
    const node = s.nodes.get(nodeId);
    if (a && node) mineNodes.push({ node, a });
  }
  const order = { doing: 0, todo: 1, done: 2 };
  mineNodes.sort((x, y) => order[x.a.task_state] - order[y.a.task_state]);
  const myTasks = [...s.tasks.values()].flat().filter((t) => t.assignee_id === uid && !t.done && s.nodes.has(t.node_id));
  const done = mineNodes.filter((x) => x.a.task_state === 'done').length;

  render(parts.mine, section('mine', [icon('check'), '담당 노드'], mineNodes.length || null, [
    mineNodes.length === 0
      ? h('p', { class: 'small faint' }, '아직 담당 노드가 없어요. 노드를 오른쪽 팀원 목록의 내 이름 위로 끌어다 놓아 보세요.')
      : [
        h('div', { class: 'small muted', style: { marginBottom: '4px' } }, `완료 ${done}/${mineNodes.length}`),
        mineNodes.map(({ node, a }) => h('div', { class: 'task', onclick: () => goNode(node.id) },
          h('span', { class: ['task__state', `task__state--${a.task_state}`] }, TASK_STATES[a.task_state]),
          h('span', { class: 'task__title' }, node.title))),
      ],
    myTasks.length > 0 && h('div', { style: { marginTop: '8px' } },
      h('div', { class: 'req-group__title' }, `내 할 일 ${myTasks.length}`),
      myTasks.slice(0, 8).map((t) => h('label', { class: 'todo' },
        h('input', { type: 'checkbox', onchange: () => updateTask(t.id, { done: true }).catch(() => {}) }),
        h('span', { class: 'todo__text', title: s.nodes.get(t.node_id)?.title }, t.content)))),
    h('a', { class: 'btn btn--sm', style: { marginTop: '12px' }, href: `me.html?project=${s.project.id}` }, '칸반 · 작업 기록 보기 →'),
  ], true));
}

