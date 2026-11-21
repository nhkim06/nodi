import { icon } from '../utils/icons.js';
// 메인 워크스페이스 부트스트랩 + 렌더 루프
import { supabase } from '../supabase.js';
import { requireAuth, signOut } from '../auth.js';
import { h, render, $, toast } from '../utils/dom.js';
import { getState, setState, subscribe, ancestorsOf, PROJECT_KEY } from '../store.js';
import { startRouter, goHome, goFocus } from '../router.js';
import { getProject, loadWorkspace } from '../api/projects.js';
import { signalOffBeacon } from '../api/signals.js';
import { subscribeProject } from '../realtime.js';
import { initViewport, applyView, fitTo, zoomBy, resetZoom } from '../canvas/viewport.js';
import { initNodes, renderNodes } from '../canvas/renderNodes.js';
import { initEdges, renderEdges } from '../canvas/renderEdges.js';
import { initBubbles, renderBubbles } from '../canvas/bubbles.js';
import { initInteractions, selectInBox, blankClick } from '../canvas/interactions.js';
import { visibleNodeIds } from '../canvas/layout.js';
import { initSidebar, layoutSidebar, renderSidebar, refreshSignalTime, VIEWS } from '../panels/sidebar.js';
import { topNav } from '../panels/topnav.js';
import { renderInspector } from '../panels/inspector.js';
import { renderMembers } from '../panels/members.js';
import { openGenerateModal, openExperienceModal, onboardingSkipped } from '../panels/modals.js';
import { addChild, defaultParentId, clearSelection, aiDirection } from '../actions.js';
import { currentProjectId, rememberProjectLinks } from '../utils/project.js';

const PREFS_KEY = 'nodi.prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'); } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p })); } catch { /* 무시 */ } };

// 1) 인증 + 프로젝트 ---------------------------------------------------------------
const session = await requireAuth();
const pid = currentProjectId();
rememberProjectLinks();
if (!pid) location.replace('index.html');

setState({ user: session.user, session });
supabase.auth.onAuthStateChange((_e, sess) => {
  if (sess) setState({ session: sess, user: sess.user });
  else location.replace('index.html');
});

let project;
try {
  project = await getProject(pid);
} catch { project = null; }
if (!project) {
  document.body.replaceChildren(h('div', { class: 'setup-error' },
    h('h2', {}, '프로젝트를 열 수 없어요'),
    h('p', { style: { marginTop: '12px' } }, '프로젝트가 없거나 멤버가 아니에요. 초대코드로 참여했는지 확인해 주세요.'),
    h('p', { style: { marginTop: '12px' } }, h('a', { href: 'index.html#/projects' }, '← 프로젝트 목록으로'))));
  throw new Error('project not accessible');
}
document.title = `${project.name} · NO:DI`;

// 2) 초기 데이터 -------------------------------------------------------------------
const ws = await loadWorkspace(pid);
const tempMap = new Map(ws.temps.map((t) => [t.user_id, t]));
const assignees = new Map();
for (const a of ws.assignees) {
  if (!assignees.has(a.node_id)) assignees.set(a.node_id, new Map());
  assignees.get(a.node_id).set(a.user_id, a);
}
const aiComments = new Map();
for (const c of ws.comments) {
  const k = c.node_id ?? PROJECT_KEY;
  if (!aiComments.has(k)) aiComments.set(k, []);
  aiComments.get(k).push(c);
}
const experiences = new Map(ws.members.map((m) => [m.user_id, []]));
for (const ex of ws.experiences) experiences.get(ex.user_id)?.push(ex);
function groupTasks(rows) {
  const m = new Map();
  for (const t of rows) {
    if (!m.has(t.node_id)) m.set(t.node_id, []);
    m.get(t.node_id).push(t);
  }
  return m;
}
const prefs = loadPrefs();
setState({
  experiences,
  plans: new Map(ws.plans.map((p) => [p.node_id, { ...p, _full: false }])),
  tasks: groupTasks(ws.tasks),
  project,
  nodes: new Map(ws.nodes.map((n) => [n.id, n])),
  members: new Map(ws.members.map((m) => [m.user_id, {
    ...m,
    temperature: Number(tempMap.get(m.user_id)?.temperature ?? 36.5),
    praise_count: tempMap.get(m.user_id)?.praise_count ?? 0,
  }])),
  assignees,
  aiComments,
  requirements: ws.reqs,
  links: ws.links,
  docs: ws.docs,
  filters: { hideDiscarded: !!prefs.hideDiscarded, member: null, hideBubbles: !!prefs.hideBubbles },
  pageView: VIEWS.some((v) => v.id === prefs.pageView) ? prefs.pageView : 'map',
});

// 3) 화면 초기화 --------------------------------------------------------------------
const viewport = $('#viewport');
initViewport(viewport, $('#world'), { onBlankClick: blankClick, onMarquee: selectInBox });
initNodes($('#nodes'));
initEdges($('#edges'));
initBubbles($('#bubbles'));
initInteractions({ viewport, nodesLayer: $('#nodes') });
initSidebar({ nav: $('#side-nav'), side: $('#sidebar'), page: $('#page'), head: $('#proj-head') });

// 공통 플로팅 헤더 (NO:DI) — 프로젝트 상세는 Project 탭, setting 은 이 프로젝트 설정으로
$('#topnav').replaceWith(topNav({
  active: 'projects',
  userName: session.user.user_metadata?.full_name ?? session.user.email,
  onSignOut: signOut,
  links: { settings: `index.html#/settings/${pid}` },
}));

const app = $('#app');
const layoutState = { right: !!prefs.rightCollapsed };
function applyCollapse() {
  const dragging = getState().isDragging;
  // 드래그 중에는 팀원 패널(드롭 타겟)을 잠시 펼친다
  app.classList.toggle('app--right-collapsed', layoutState.right && !dragging);
  $('#toggle-right').textContent = layoutState.right ? '«' : '»';
}
$('#toggle-right').addEventListener('click', () => { layoutState.right = !layoutState.right; savePrefs({ rightCollapsed: layoutState.right }); applyCollapse(); });
applyCollapse();

/** 메뉴 전환: 아이디어 맵이면 캔버스 보드 + 오른쪽 패널, 나머지는 페이지 보드 */
function applyPageView(view) {
  const isMap = view === 'map';
  layoutSidebar(view);
  $('#board').hidden = !isMap;
  $('#page').hidden = isMap;
  app.classList.toggle('app--page', !isMap);
  savePrefs({ pageView: view });
  if (isMap) requestAnimationFrame(() => requestAnimationFrame(fitVisible));
  else clearSelection();
}

// 4) 렌더 루프 ----------------------------------------------------------------------
const ALL = new Set(['project', 'nodes', 'members', 'assignees', 'aiComments', 'requirements', 'docs', 'links',
  'coverage', 'selection', 'focus', 'view', 'filters', 'aiBusy', 'signalTime', 'helpRequests', 'dropTarget',
  'isDragging', 'expandedBubbles', 'user', 'experiences', 'plans', 'tasks', 'pageView']);

function renderAll(s, keys) {
  if (keys.has('pageView')) {
    applyPageView(s.pageView);
    keys = ALL;   // 부품 자리가 바뀌었으니 전부 다시 그린다
  }
  const has = (...k) => k.some((x) => keys.has(x));

  if (has('view')) { applyView(s.view); renderZoom(s); }

  const visible = visibleNodeIds(s);
  if (has('nodes', 'assignees', 'members', 'selection', 'filters', 'focus', 'aiBusy', 'aiComments', 'plans')) {
    renderNodes(s, visible);
    renderEdges(s, visible);
  }
  if (has('nodes', 'aiComments', 'filters', 'focus', 'requirements', 'expandedBubbles', 'selection', 'experiences', 'members')) {
    renderBubbles(s, visible);
  }

  renderSidebar(s, keys);

  if (has('focus', 'nodes')) renderBreadcrumb(s);
  if (has('filters', 'members', 'focus', 'selection')) renderToolbar(s);
  if (has('isDragging')) applyCollapse();

  // 오른쪽 패널: 선택 있으면 Inspector, 없거나 드래그 중이면 팀원 목록
  const showMembers = s.isDragging || s.selection.size === 0;
  const right = $('#right');
  // 드래그 중 노드 좌표만 바뀌는 프레임은 다시 그리지 않음
  const onlyMoving = s.isDragging && !has('isDragging', 'dropTarget', 'members', 'assignees');
  if (!onlyMoving && has('selection', 'nodes', 'members', 'assignees', 'links', 'aiComments', 'aiBusy',
    'requirements', 'isDragging', 'dropTarget', 'helpRequests', 'experiences', 'plans', 'tasks')) {
    if (showMembers) renderMembers(right, s);
    else renderInspector(right, s);
  }
}
subscribe(renderAll);

function renderBreadcrumb(s) {
  const focus = s.focus.filter((id) => s.nodes.has(id));
  const items = [h('button', { class: ['breadcrumb__item', !focus.length && 'breadcrumb__item--current'], onclick: () => goHome() }, icon('home'), 'Home')];
  if (focus.length) {
    const path = ancestorsOf(focus[0]).filter((n) => n.parent_id);   // 루트(=Home)는 제외
    for (const n of path) {
      items.push(h('span', { class: 'breadcrumb__sep' }, '›'),
        h('button', { class: 'breadcrumb__item', onclick: () => goFocus([n.id]), title: n.title }, n.title));
    }
    items.push(h('span', { class: 'breadcrumb__sep' }, '›'),
      h('span', { class: 'breadcrumb__item breadcrumb__item--current', title: focus.map((id) => s.nodes.get(id).title).join(', ') },
        focus.map((id) => s.nodes.get(id).title).join(', ')));
  }
  render($('#breadcrumb'), items);
}

function setFilter(patch) {
  const filters = { ...getState().filters, ...patch };
  setState({ filters });
  savePrefs({ hideDiscarded: filters.hideDiscarded, hideBubbles: filters.hideBubbles });
}

function renderToolbar(s) {
  const sel = [...s.selection];
  render($('#toolbar'),
    h('div', { class: 'toolbar__group' },
      h('button', { class: 'btn btn--sm', title: '선택한 노드(없으면 루트)의 자식 추가 (Tab)', onclick: () => addChild(defaultParentId()) }, '＋ 노드'),
      h('button', { class: 'btn btn--sm btn--primary', onclick: () => openGenerateModal(sel.length ? sel : s.focus) }, icon('sparkles'), 'AI 생성')),
    h('span', { class: 'toolbar__sep' }),
    h('div', { class: 'toolbar__group' },
      h('button', {
        class: ['btn', 'btn--sm', s.filters.hideDiscarded && 'btn--active'], 'aria-pressed': String(s.filters.hideDiscarded),
        onclick: () => setFilter({ hideDiscarded: !s.filters.hideDiscarded }),
      }, '버린 노드 숨기기'),
      h('select', {
        class: 'select', 'aria-label': '담당자 하이라이트', value: s.filters.member ?? '',
        onchange: (e) => setFilter({ member: e.target.value || null }),
      }, h('option', { value: '' }, '담당자: 전체'),
      [...s.members.values()].map((m) => h('option', { value: m.user_id }, `담당자: ${m.profile?.display_name ?? '팀원'}`))),
      h('button', {
        class: ['btn', 'btn--sm', s.filters.hideBubbles && 'btn--active'], 'aria-pressed': String(s.filters.hideBubbles),
        onclick: () => setFilter({ hideBubbles: !s.filters.hideBubbles }),
      }, 'AI 말풍선 숨기기')),
    h('span', { class: 'spacer' }),
    s.focus.length > 0 && h('div', { class: 'toolbar__group' },
      h('button', { class: 'btn btn--sm', onclick: () => aiDirection(s.focus) }, icon('compass'), '방향 추천'),
      h('button', { class: 'btn btn--sm', onclick: () => goHome() }, icon('home'), '홈으로')),
  );
}

function renderZoom(s) {
  render($('#zoom'),
    h('button', { class: 'icon-btn', title: '축소', 'aria-label': '축소', onclick: () => zoomBy(1 / 1.2) }, '−'),
    h('button', { class: 'zoom__label', title: '100%로', onclick: resetZoom }, `${Math.round(s.view.k * 100)}%`),
    h('button', { class: 'icon-btn', title: '확대', 'aria-label': '확대', onclick: () => zoomBy(1.2) }, '+'),
    h('button', { class: 'icon-btn', title: '화면에 맞추기', 'aria-label': '화면에 맞추기', onclick: fitVisible }, '⤢'));
}

function fitVisible() {
  fitTo([...visibleNodeIds()]);
}

// 첫 렌더: 모든 영역 그리기
renderAll(getState(), ALL);

// 5) 라우터 (포커스 뷰) — 바뀔 때마다 보이는 노드에 맞춤 --------------------------------
startRouter(() => {
  clearSelection();
  requestAnimationFrame(() => requestAnimationFrame(fitVisible));
});

// 6) Realtime + 신호등 -----------------------------------------------------------------
subscribeProject(pid);
refreshSignalTime();
setInterval(refreshSignalTime, 15_000);
// 오래된 green 보정 표시를 위해 주기적으로 팀원 패널 갱신
setInterval(() => setState({ members: getState().members }), 5 * 60_000);

window.addEventListener('pagehide', () => {
  const s = getState();
  const mine = s.members.get(s.user.id);
  if (mine && mine.signal !== 'off') signalOffBeacon(pid, s.user.id, s.session?.access_token);
});

// 경험 온보딩 (F16): 내 경험 카드가 0개면 한 번 권한다 (건너뛰기 가능)
const myExpCount = experiences.get(session.user.id)?.length ?? 0;
if (!myExpCount && !onboardingSkipped(session.user.id)) {
  setTimeout(() => openExperienceModal({ onboarding: true }), 400);
} else if (!ws.reqs.length && !ws.docs.length) {
  setTimeout(() => toast('왼쪽 "아이디어 맵 › 과제 요구사항"이나 설정의 "교수 요구사항"에 과제 공지를 넣으면 AI가 요구사항을 정리해 줘요.', { duration: 5000 }), 800);
}
