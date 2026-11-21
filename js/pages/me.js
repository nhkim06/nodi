// 나의 작업 (프로젝트 상세 › 나의 작업): 담당 노드 확인(칸반) / 내 할 일 / 작업 상태 시간 / 활동 내역 / 받은 좋아요
// 나의 정보 · 프로젝트 경험 입력은 HOME › account 로 옮겼다 (IA v2).
import { supabase } from '../supabase.js';
import { requireAuth, signOut } from '../auth.js';
import { topNav } from '../panels/topnav.js';
import { h, render, $ } from '../utils/dom.js';
import { todayKST, fmtDuration, relTime } from '../utils/time.js';
import { TASK_STATES, STATUS, SIGNALS } from '../utils/color.js';
import { getProject, getMyProfile, listMembers } from '../api/projects.js';
import { listMine, updateAssignee } from '../api/assignees.js';
import { listMyTasks, updateTask } from '../api/tasks.js';
import { signalTime } from '../api/signals.js';
import { listReceived } from '../api/praises.js';
import { q } from '../api/client.js';
import { currentProjectId, rememberProjectLinks } from '../utils/project.js';

const root = $('#root');
const session = await requireAuth();
const uid = session.user.id;
const pid = currentProjectId();
rememberProjectLinks();
if (!pid) location.replace('index.html#/projects');

const state = {
  project: null, profile: null, members: [], assigned: [], todos: [], today: {}, week: {}, activity: [], praises: [],
};

async function load() {
  const [project, profile, members, assigned, todos, today, week, activity, praises] = await Promise.all([
    getProject(pid),
    getMyProfile(uid),
    listMembers(pid),
    listMine(pid, uid),
    listMyTasks(pid, uid).catch(() => []),
    signalTime(pid, uid, todayKST(), todayKST()),
    signalTime(pid, uid, todayKST(-6), todayKST()),
    q(supabase.from('activity_logs').select('*').eq('project_id', pid).eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(40), '활동 내역을 불러오지 못했어요.'),
    listReceived(pid, uid),
  ]);
  if (!project) {
    render(root, h('div', { class: 'setup-error' }, h('h2', {}, '프로젝트를 열 수 없어요'),
      h('p', { style: { marginTop: '12px' } }, h('a', { href: 'index.html#/projects' }, '← 전체 프로젝트로'))));
    return false;
  }
  Object.assign(state, {
    project, profile, members, assigned: assigned.filter((t) => t.node), todos: todos.filter((t) => t.node), today, week, activity, praises,
  });
  document.title = `나의 작업 · ${project.name} · NO:DI`;
  return true;
}

const ACTIONS = {
  node_created: (m) => `'${m.title}'노드를 만들었어요${m.source === 'ai' ? ' (AI)' : ''}`,
  node_status_changed: (m) => `'${m.title}'상태: ${STATUS[m.from] ?? m.from} → ${STATUS[m.to] ?? m.to}`,
  node_assigned: (m) => `'${m.title}'담당자가 됐어요`,
  task_state_changed: (m) => `'${m.title}'작업: ${TASK_STATES[m.from] ?? m.from} → ${TASK_STATES[m.to] ?? m.to}`,
};

function kanban() {
  const cols = ['todo', 'doing', 'done'];
  const move = async (t, to) => {
    try {
      await updateAssignee(t.node_id, uid, { task_state: to });
      t.task_state = to;
      draw();
    } catch { /* 토스트 처리됨 */ }
  };
  return h('div', { class: 'kanban' }, cols.map((col, i) => {
    const list = state.assigned.filter((t) => t.task_state === col);
    return h('div', { class: 'kanban__col' },
      h('div', { class: 'kanban__title' }, TASK_STATES[col], h('span', { class: 'faint' }, String(list.length))),
      list.length === 0 && h('div', { class: 'empty small' }, '없음'),
      list.map((t) => h('div', { class: 'kcard' },
        h('a', { class: 'kcard__title', href: `app.html?project=${pid}#/focus/${t.node_id}` }, t.node.title),
        h('div', { class: 'small faint' }, `노드 상태: ${STATUS[t.node.status]}`),
        t.node.description && h('div', { class: 'small muted', style: { marginTop: '4px' } }, t.node.description.slice(0, 120)),
        h('div', { class: 'kcard__actions' },
          i > 0 && h('button', { class: 'btn btn--sm', onclick: () => move(t, cols[i - 1]) }, `← ${TASK_STATES[cols[i - 1]]}`),
          h('span', { class: 'spacer' }),
          i < cols.length - 1 && h('button', { class: 'btn btn--sm', onclick: () => move(t, cols[i + 1]) }, `${TASK_STATES[cols[i + 1]]} →`)))));
  }));
}

function todoList() {
  if (!state.todos.length) return h('p', { class: 'muted small' }, '나에게 배정된 할 일이 없어요. 아이디어 맵에서 노드를 선택하고 AI로 할 일 목록을 만들어 보세요.');
  return state.todos.map((t) => h('label', { class: ['todo', t.done && 'todo--done'] },
    h('input', {
      type: 'checkbox', checked: t.done,
      onchange: async (e) => {
        try { await updateTask(t.id, { done: e.target.checked }); t.done = e.target.checked; draw(); } catch { e.target.checked = t.done; }
      },
    }),
    h('span', { class: 'todo__text' }, t.content),
    h('span', { class: 'small faint ellipsis', style: { maxWidth: '40%' } }, t.node.title)));
}

function signalBars(times) {
  const max = Math.max(1, times.green ?? 0, times.yellow ?? 0, times.red ?? 0);
  return ['green', 'yellow', 'red'].map((sig) => h('div', { class: 'bar-row' },
    h('span', { class: 'bar-row__label' }, SIGNALS[sig].label.split('·')[0]),
    h('div', { class: 'bar-row__track' }, h('div', { class: ['bar-row__fill', `bar-row__fill--${sig}`], style: { width: `${((times[sig] ?? 0) / max) * 100}%` } })),
    h('span', { class: 'bar-row__value' }, fmtDuration(times[sig]))));
}

function draw() {
  const memberName = (id) => state.members.find((m) => m.user_id === id)?.profile?.display_name ?? '팀원';
  const done = state.assigned.filter((t) => t.task_state === 'done').length;
  const todoDone = state.todos.filter((t) => t.done).length;
  render(root, topNav({ active: 'projects', userName: state.profile.display_name, onSignOut: signOut, links: { settings: `index.html#/settings/${pid}` } }), h('div', { class: 'page page--narrow' },
    h('header', { class: 'page__header' },
      h('a', { href: `app.html?project=${pid}` }, '← 프로젝트 상세'),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted small' }, state.project.name),
      h('a', { class: 'btn btn--ghost btn--sm', href: 'index.html#/account' }, '나의 정보')),
    h('h1', { class: 'page__title', style: { marginBottom: '16px' } }, `${state.profile.display_name}님의 작업`),

    h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('div', { class: 'card__title' }, `담당 노드 · ${done}/${state.assigned.length} 완료`),
      state.assigned.length === 0
        ? h('p', { class: 'muted small' }, '아직 담당 노드가 없어요. 아이디어 맵에서 노드를 팀원 목록의 내 이름 위로 끌어다 놓아 보세요.')
        : kanban()),

    h('div', { class: 'grid grid--2' },
      h('div', { class: 'card' },
        h('div', { class: 'card__title' }, `내 할 일 · ${todoDone}/${state.todos.length}`),
        todoList()),
      h('div', { class: 'card' },
        h('div', { class: 'card__title' }, '작업 상태 시간'),
        h('div', { class: 'small muted', style: { marginBottom: '6px' } }, '오늘'),
        signalBars(state.today),
        h('div', { class: 'small muted', style: { margin: '12px 0 6px' } }, '최근 7일'),
        signalBars(state.week)),
      h('div', { class: 'card' },
        h('div', { class: 'card__title' }, `받은 좋아요 (${state.praises.length})`),
        state.praises.length === 0 && h('p', { class: 'muted small' }, '아직 받은 좋아요가 없어요.'),
        state.praises.slice(0, 20).map((p) => h('div', { class: 'feed-item' },
          h('div', {},
            h('b', {}, memberName(p.from_user)), p.tag ? ` #${p.tag}` : '',
            p.message && h('div', {}, p.message)),
          h('span', { class: 'feed-item__time' }, relTime(p.created_at))))),
      h('div', { class: 'card' },
        h('div', { class: 'card__title' }, '내 활동 내역'),
        state.activity.length === 0 && h('p', { class: 'muted small' }, '아직 활동이 없어요.'),
        state.activity.map((a) => h('div', { class: 'feed-item' },
          h('span', {}, (ACTIONS[a.action] ?? ((m) => `${a.action} ${m.title ?? ''}`))(a.meta ?? {})),
          h('span', { class: 'feed-item__time' }, relTime(a.created_at))))))));
}

if (await load()) draw();
