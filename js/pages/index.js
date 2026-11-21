// HOME (IA v2 + NO:DI 디자인): 로그아웃이면 랜딩(히어로), 로그인 후 공통 헤더 탭 4개
//   #/home              프로젝트 현황 (진행 중 / 지난 프로젝트)
//   #/projects          전체 프로젝트 목록 + 새 프로젝트 + 초대코드 참여 → 카드 클릭 = 프로젝트 상세(app.html)
//   #/account           나의 정보 + 나의 프로젝트 경험 입력
//   #/settings[/<pid>]  프로젝트 기본 정보(이름·과목명·마감일·교수 요구사항) + 팀원 관리 + 초대 링크 공유
import { supabase } from '../supabase.js';
import { getSession, signInWithEmail, signInWithGoogle, signOut } from '../auth.js';
import { h, render, $, toast, spinner } from '../utils/dom.js';
import { dday, fmtDate, isPastProject } from '../utils/time.js';
import { avatar } from '../utils/color.js';
import {
  listMyProjects, createProject, joinProject, getMyProfile, updateProfile,
  getProject, updateProject, listMembers, removeMember, updateMember, inviteUrl, myProgressByProject,
} from '../api/projects.js';
import { countMyExperiences } from '../api/experiences.js';
import { q } from '../api/client.js';
import { experienceEditor, skipOnboarding, onboardingSkipped } from '../panels/experiences.js';
import { topNav } from '../panels/topnav.js';
import { openModal } from '../panels/modals.js';
import { rememberProject, rememberProjectLinks } from '../utils/project.js';

const root = $('#root');
rememberProjectLinks();
const params = new URLSearchParams(location.search);

const TABS = [
  { id: 'home', title: '프로젝트 현황' },
  { id: 'projects', title: '전체 프로젝트' },
  { id: 'account', title: '나의 정보' },
  { id: 'settings', title: '프로젝트 설정' },
];

/** 로그인 후 돌아갈 곳 (같은 사이트의 상대 경로만 허용) */
function nextUrl() {
  const next = params.get('next');
  if (next && /^(app|me)\.html\?/.test(next)) return next;
  return null;
}

const openProject = (id) => { rememberProject(id); location.href = `app.html?project=${id}`; };

/** 프로젝트에 들어가기 전, 내 경험 카드가 0개면 경험 온보딩 단계를 먼저 보여준다 (F16) */
async function goProject(id, user) {
  if (!user || onboardingSkipped(user.id) || (await countMyExperiences(user.id)) !== 0) return openProject(id);
  renderOnboarding(id, user);
}

function renderOnboarding(projectId, user) {
  const editor = experienceEditor({
    userId: user.id,
    onChange: (list) => { next.textContent = list.length ? `프로젝트로 이동 (${list.length}개 입력)` : '프로젝트로 이동'; },
  });
  const next = h('button', { class: 'btn btn--primary', onclick: () => openProject(projectId) }, '프로젝트로 이동');
  render(root, topNav({ active: 'projects', userName: user.email, onSignOut: signOut }), h('div', { class: 'page', style: { maxWidth: '720px' } },
    h('h1', { class: 'page__title' }, '🙋 우리 팀 AI가 실행 가능한 범위를 정하려면 경험이 필요해요'),
    h('p', { class: 'muted', style: { margin: '8px 0 16px' } },
      '설문 분석을 해 봤다면 정량 설문을, 처음이면 인터뷰 5명부터. 프론트엔드 경험이 있으면 실제 동작하는 MVP를, 없으면 Figma 프로토타입까지. ',
      'AI는 팀원들의 경험을 근거로 아이디어의 조사 방법과 구현 범위를 정해요. 최소 1개 입력을 권장해요. (나중에 account 탭에서 고칠 수 있어요)'),
    h('div', { class: 'card' }, editor.el),
    h('div', { class: 'row', style: { marginTop: '16px' } },
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn--ghost', onclick: () => { skipOnboarding(user.id); openProject(projectId); } }, '건너뛰기'),
      next)));
}

// 랜딩 (로그아웃) — "Save time and energy with NO:DI" ----------------------------------------
function heroTitle() {
  return h('h1', { class: 'hero__title' }, 'Save time and energy', h('br'), 'with', h('span', { class: 'hero__pill' }, 'NO:DI'));
}

function renderLogin() {
  document.title = 'NO:DI — Make ideation easier';
  render(root,
    topNav({ active: null, onSignIn: openLogin, onSignUp: openLogin }),
    h('main', { class: 'hero' },
      h('p', { class: 'hero__eyebrow' }, 'Make ideation easier.'),
      heroTitle(),
      h('p', { class: 'hero__sub' }, 'A space where ideas connect, evolve, and become reality.'),
      params.get('join') && h('p', { class: 'small muted', style: { marginTop: '16px' } }, '🔑 초대 링크로 들어왔어요. 로그인하면 바로 프로젝트에 참여해요.'),
      h('button', { class: 'btn btn--soft hero__cta', onclick: openLogin }, 'Start your NO:DI')));
  if (params.get('join')) openLogin();
}

/** 로그인 / 가입 모달 (이메일 매직링크 · Google) — 처음 로그인하면 계정이 만들어진다 */
function openLogin() {
  const email = h('input', { class: 'input', type: 'email', placeholder: '학교 이메일', autocomplete: 'email', required: true });
  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, '이메일로 로그인 링크 받기');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const v = email.value.trim();
      if (!v) return;
      btn.disabled = true;
      btn.replaceChildren(spinner(), ' 보내는 중...');
      const { error } = await signInWithEmail(v);
      btn.disabled = false;
      btn.textContent = '이메일로 로그인 링크 받기';
      if (error) {
        console.error(error);
        toast('로그인 링크를 보내지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error' });
      } else {
        toast(`${v} 로 로그인 링크를 보냈어요. 메일함을 확인하세요!`, { duration: 6000 });
      }
    },
  }, h('div', { class: 'field' }, email), btn);

  const m = openModal({
    title: 'NO:DI 시작하기',
    body: [
      h('p', { class: 'small muted', style: { marginBottom: '14px' } },
        '처음이면 로그인할 때 계정이 만들어져요. 과제 공지를 올리면 AI가 요구사항을 정리하고, 팀 아이디어를 노드로 펼쳐 줘요.'),
      form,
      h('div', { class: 'divider' }, '또는'),
      h('button', {
        class: 'btn btn--block',
        onclick: async () => {
          const { error } = await signInWithGoogle();
          if (error) { console.error(error); toast('Google 로그인을 시작하지 못했어요.', { type: 'error' }); }
        },
      }, 'Google 계정으로 계속하기'),
    ],
  });
  loginModal = m;
}
let loginModal = null;

// HOME 셸 -------------------------------------------------------------------------
const ctx = { user: null, profile: null, projects: [], progress: {} };

function parseRoute() {
  const [, tab = 'home', arg = null] = location.hash.match(/^#\/([a-z]+)(?:\/([0-9a-f-]{36}))?/i) ?? [];
  return { tab: TABS.some((t) => t.id === tab) ? tab : 'home', arg };
}

function shell(tab, ...content) {
  return [
    topNav({ active: tab, userName: ctx.profile?.display_name ?? ctx.user.email, onSignOut: signOut }),
    h('main', { class: ['page', tab !== 'projects' && 'page--narrow'] }, content),
  ];
}

async function route() {
  const { tab, arg } = parseRoute();
  document.title = `${TABS.find((t) => t.id === tab).title} · NO:DI`;
  if (tab === 'home') return render(root, shell(tab, homeView()));
  if (tab === 'projects') return render(root, shell(tab, projectsView()));
  if (tab === 'account') return render(root, shell(tab, accountView()));
  if (tab === 'settings') {
    render(root, shell(tab, h('div', { class: 'empty' }, spinner())));
    const view = await settingsView(arg);
    if (parseRoute().tab === 'settings') render(root, shell(tab, view));
  }
}

async function reloadProjects() {
  [ctx.projects, ctx.progress] = await Promise.all([
    listMyProjects(ctx.user.id),
    myProgressByProject(ctx.user.id).catch(() => ({})),
  ]);
}

// 프로젝트 카드 (썸네일 + 제목) ------------------------------------------------------------
const THUMB_COLORS = ['#0F2A3F', '#C8202F', '#6C4FEF', '#1F8A70', '#E07A1F', '#2B5DD8'];
function hashStr(s) { let x = 0; for (const c of s) x = (x * 31 + c.codePointAt(0)) | 0; return Math.abs(x); }

/** 로고 이미지가 없으니 과목명(없으면 프로젝트 이름)으로 모노그램 썸네일을 만든다 */
function thumb(p) {
  const label = (p.course_name || p.name).trim();
  const mono = /^[A-Za-z0-9\s]+$/.test(label)
    ? label.split(/\s+/).map((w) => w[0]).join('').slice(0, 4).toUpperCase() || label.slice(0, 4).toUpperCase()
    : label.replace(/\s+/g, '').slice(0, 4);
  return { mono: mono.length >= 2 ? mono : label.slice(0, 6), color: THUMB_COLORS[hashStr(p.id) % THUMB_COLORS.length], sub: label };
}

function projectCard(p) {
  const d = dday(p.due_date);
  const pr = ctx.progress[p.id];
  const pct = pr?.total ? Math.round((pr.done / pr.total) * 100) : 0;
  const past = isPastProject(p);
  const t = thumb(p);
  return h('a', { class: ['proj-card', past && 'proj-card--past'], href: `app.html?project=${p.id}`, title: p.name },
    h('div', { class: 'proj-card__thumb' },
      h('span', { class: 'proj-card__mono', style: { color: t.color } }, t.mono),
      h('span', { class: 'proj-card__sub ellipsis' }, t.sub),
      p.completed_at
        ? h('span', { class: 'proj-card__badge proj-card__badge--muted' }, '종료')
        : d && h('span', { class: ['proj-card__badge', !past && d.days <= 3 && 'dday--urgent'] }, d.label)),
    h('div', { class: 'proj-card__body' },
      h('div', { class: 'proj-card__name ellipsis' }, p.name, p.my_role === 'owner' ? ' 👑' : ''),
      h('div', { class: 'proj-card__meta' },
        p.due_date && h('span', {}, `마감 ${fmtDate(p.due_date)}`),
        pr?.total > 0 && h('span', {}, `내 담당 ${pr.done}/${pr.total}`)),
      pr?.total > 0 && h('div', { class: 'proj-card__progress' },
        h('div', { class: 'progress' }, h('div', { class: 'progress__bar', style: { width: `${pct}%` } })))));
}

const addCard = () => h('button', { class: 'proj-card proj-card--add', onclick: openNewProject, title: '새 프로젝트 / 초대코드로 참여' },
  h('span', { class: 'proj-card__plus' }, '+'), h('span', { class: 'small muted' }, '새 프로젝트 · 초대코드 참여'));

// home: 프로젝트 현황 (과거~현재 프로젝트 나열) ---------------------------------------------
function homeView() {
  const now = ctx.projects.filter((p) => !isPastProject(p))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const past = ctx.projects.filter((p) => isPastProject(p))
    .sort((a, b) => (b.completed_at ?? b.due_date ?? '').localeCompare(a.completed_at ?? a.due_date ?? ''));
  const urgent = now.filter((p) => { const d = dday(p.due_date); return d && d.days <= 7; }).length;

  return [
    h('section', { class: 'hero hero--compact' },
      h('p', { class: 'hero__eyebrow' }, 'Make ideation easier.'),
      heroTitle(),
      h('p', { class: 'hero__sub' }, `${ctx.profile?.display_name ?? ''}님, 오늘도 아이디어를 이어가 볼까요?`),
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('div', { class: 'stat__num' }, String(now.length)), h('div', { class: 'stat__label' }, '진행 중')),
        h('div', { class: 'stat' }, h('div', { class: 'stat__num' }, String(urgent)), h('div', { class: 'stat__label' }, '마감 7일 이내')),
        h('div', { class: 'stat' }, h('div', { class: 'stat__num' }, String(past.length)), h('div', { class: 'stat__label' }, '지난 프로젝트')))),

    h('h2', { class: 'section-title' }, '진행 중인 프로젝트'),
    h('div', { class: 'grid grid--projects' }, now.map(projectCard), now.length === 0 && addCard()),

    h('h2', { class: 'section-title' }, '지난 프로젝트'),
    past.length === 0
      ? h('p', { class: 'small faint' }, '마감일이 지났거나 설정에서 종료한 프로젝트가 여기에 모여요.')
      : h('div', { class: 'grid grid--projects' }, past.map(projectCard)),
  ];
}

// project: 전체 프로젝트 목록 (+ 카드로 생성 · 참여) ------------------------------------------
function projectsView() {
  return [
    h('div', { class: 'grid grid--projects', style: { marginTop: '24vh' } }, ctx.projects.map(projectCard), addCard()),
  ];
}

function openNewProject() {
  const name = h('input', { class: 'input', maxlength: '60', placeholder: '예) 26-2 YCC 해커톤', required: true });
  const course = h('input', { class: 'input', maxlength: '60', placeholder: '예) YCC' });
  const due = h('input', { class: 'input', type: 'date' });
  const createBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, '만들기');
  const createForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      createBtn.disabled = true;
      try {
        const p = await createProject({ name: name.value.trim(), course: course.value.trim(), due: due.value });
        m.close();
        goProject(p.id, ctx.user);
      } catch {
        createBtn.disabled = false;
      }
    },
  },
  h('div', { class: 'field' }, h('label', {}, '프로젝트(과제) 이름'), name),
  h('div', { class: 'row' },
    h('div', { class: 'field grow' }, h('label', {}, '과목명 · 동아리'), course),
    h('div', { class: 'field grow' }, h('label', {}, '마감일'), due)),
  h('p', { class: 'small faint', style: { marginBottom: '12px' } }, '교수님 요구사항과 팀원 초대는 만든 뒤 setting 에서 할 수 있어요.'),
  h('div', { class: 'row' }, h('span', { class: 'spacer' }), createBtn));

  const code = h('input', { class: 'input', maxlength: '6', placeholder: '6자리 코드', style: { textTransform: 'uppercase', fontFamily: 'var(--font-mono)' } });
  const joinForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (code.value.trim().length < 6) return toast('초대코드 6자리를 넣어 주세요.', { type: 'error' });
      try {
        const p = await joinProject(code.value.trim());
        m.close();
        goProject(p.id, ctx.user);
      } catch { /* 토스트 처리됨 */ }
    },
  },
  h('div', { class: 'row' }, code, h('button', { class: 'btn btn--primary', type: 'submit' }, '참여')),
  h('p', { class: 'small faint', style: { marginTop: '12px' } }, '팀장이 setting › 팀원 관리에서 초대 링크나 코드를 공유해 줄 거예요.'));

  const pane = h('div', {}, createForm);
  const tabs = [['new', '새 프로젝트'], ['join', '초대코드로 참여']].map(([id, label]) => h('button', {
    class: ['seg__btn', id === 'new' && 'seg__btn--on'], type: 'button',
    onclick: (e) => {
      tabs.forEach((b) => b.classList.toggle('seg__btn--on', b === e.currentTarget));
      pane.replaceChildren(id === 'new' ? createForm : joinForm);
      (id === 'new' ? name : code).focus();
    },
  }, label));
  const m = openModal({ title: '프로젝트 시작하기', body: [h('div', { class: 'seg' }, tabs), pane] });
}

// account: 나의 정보 → 나의 프로젝트 경험 입력 -------------------------------------------------
let expEditor = null;   // 탭을 오가도 입력 중인 내용이 날아가지 않게 한 번만 만든다

function accountView() {
  const p = ctx.profile;
  const name = h('input', { class: 'input', maxlength: '30', value: p.display_name });
  const major = h('input', { class: 'input', maxlength: '60', value: p.major ?? '', placeholder: '예) 시각디자인' });
  const skills = h('input', { class: 'input', value: (p.skills ?? []).join(', '), placeholder: '쉼표로 구분: figma, react, 발표, 자료조사' });
  const save = h('button', { class: 'btn btn--primary', type: 'submit' }, '저장');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return toast('이름을 입력해 주세요.', { type: 'error' });
      save.disabled = true;
      try {
        ctx.profile = await updateProfile(ctx.user.id, {
          display_name: name.value.trim(),
          major: major.value.trim() || null,
          skills: skills.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20),
        });
        toast('나의 정보를 저장했어요.');
      } catch { /* 토스트 처리됨 */ }
      save.disabled = false;
    },
  },
  h('div', { class: 'field' }, h('label', {}, '이름'), name),
  h('div', { class: 'field' }, h('label', {}, '이메일'), h('input', { class: 'input', value: ctx.user.email ?? '', disabled: true })),
  h('div', { class: 'field' }, h('label', {}, '전공'), major),
  h('div', { class: 'field' }, h('label', {}, '기술 스택'), skills),
  save);

  expEditor ??= experienceEditor({ userId: ctx.user.id });
  return [
    h('h1', { class: 'page__title', style: { marginBottom: '16px' } }, '나의 정보'),
    h('div', { class: 'grid grid--account' },
      h('div', { class: 'card' },
        h('div', { class: 'card__title' }, '🙋 프로필'),
        h('p', { class: 'small faint', style: { marginBottom: '12px' } }, '같은 프로젝트 팀원에게 보여요.'),
        form),
      h('div', { class: 'card', id: 'experiences' },
        h('div', { class: 'card__title' }, '🧰 나의 프로젝트 경험'),
        h('p', { class: 'small faint', style: { marginBottom: '12px' } },
          'AI가 아이디어 구체화(조사 방법 · 구현 범위 · 할 일), 역할 추천, 막힘 도우미 추천에 근거로 써요. ',
          '프로젝트가 아니라 나에게 저장돼서 모든 팀플에서 그대로 쓰이고, 같은 프로젝트 팀원에게만 보여요.'),
        expEditor.el)),
  ];
}

// setting: 프로젝트 기본 정보 + 교수 요구사항 / 팀원 관리 → 초대 링크 공유 -----------------------
async function settingsView(pid) {
  if (!ctx.projects.length) {
    return [h('h1', { class: 'page__title' }, '프로젝트 설정'),
      h('div', { class: 'card empty', style: { marginTop: '16px' } }, '설정할 프로젝트가 없어요. ', h('a', { href: '#/projects' }, '먼저 프로젝트를 만들어 주세요 →'))];
  }
  if (!pid || !ctx.projects.some((p) => p.id === pid)) {
    pid = ctx.projects.find((p) => !isPastProject(p))?.id ?? ctx.projects[0].id;
    history.replaceState(null, '', `#/settings/${pid}`);
  }

  let project; let members; let reqs;
  try {
    [project, members, reqs] = await Promise.all([
      getProject(pid),
      listMembers(pid),
      q(supabase.from('requirements').select('id, category, content, importance').eq('project_id', pid).order('sort_order'), '요구사항을 불러오지 못했어요.'),
    ]);
  } catch {
    return h('div', { class: 'card empty' }, '프로젝트 정보를 불러오지 못했어요.');
  }
  const isOwner = members.some((m) => m.user_id === ctx.user.id && m.role === 'owner');

  const picker = h('select', {
    class: 'select', 'aria-label': '설정할 프로젝트', value: pid,
    onchange: (e) => { location.hash = `#/settings/${e.target.value}`; },
  }, ctx.projects.map((p) => h('option', { value: p.id }, `${p.name}${isPastProject(p) ? ' (지난 프로젝트)' : ''}`)));

  return [
    h('div', { class: 'row', style: { marginBottom: '16px' } },
      h('h1', { class: 'page__title grow' }, '프로젝트 설정'),
      picker,
      h('a', { class: 'btn btn--sm', href: `app.html?project=${pid}` }, '프로젝트 상세 →')),
    !isOwner && h('p', { class: 'plan-banner', style: { marginBottom: '16px' } }, '👑 기본 정보 수정과 팀원 내보내기는 팀장만 할 수 있어요.'),
    h('div', { class: 'grid grid--2' },
      basicInfoCard(project, isOwner),
      h('div', { class: 'stack-lg' }, inviteCard(project), membersCard(project, members, isOwner))),
    requirementCard(project, reqs, isOwner),
    isOwner && dangerCard(project),
  ];
}

function basicInfoCard(p, editable) {
  const name = h('input', { class: 'input', maxlength: '60', value: p.name, disabled: !editable, required: true });
  const course = h('input', { class: 'input', maxlength: '60', value: p.course_name ?? '', disabled: !editable, placeholder: '예) HCI' });
  const due = h('input', { class: 'input', type: 'date', value: p.due_date ?? '', disabled: !editable });
  const desc = h('textarea', { class: 'textarea', rows: '3', maxlength: '500', disabled: !editable, placeholder: '한두 줄 소개 (AI가 요구사항을 분석하면 자동으로 채워져요)' });
  desc.value = p.description ?? '';
  const save = h('button', { class: 'btn btn--primary', type: 'submit', disabled: !editable }, '저장');
  return h('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return toast('프로젝트 이름을 입력해 주세요.', { type: 'error' });
      save.disabled = true;
      try {
        await updateProject(p.id, {
          name: name.value.trim(), course_name: course.value.trim() || null,
          due_date: due.value || null, description: desc.value.trim() || null,
        });
        await reloadProjects();
        toast('기본 정보를 저장했어요.');
      } catch { /* 토스트 처리됨 */ }
      save.disabled = false;
    },
  },
  h('div', { class: 'card__title' }, '📋 프로젝트 기본 정보'),
  h('div', { class: 'field' }, h('label', {}, '프로젝트 이름'), name),
  h('div', { class: 'row' },
    h('div', { class: 'field grow' }, h('label', {}, '과목명'), course),
    h('div', { class: 'field grow' }, h('label', {}, '마감일'), due)),
  h('div', { class: 'field' }, h('label', {}, '소개'), desc),
  editable && save);
}

/** 교수 요구사항: 원문을 projects.professor_note 에 보관 → AI가 요구사항(R*)으로 정리 */
function requirementCard(p, reqs, isOwner) {
  const note = h('textarea', {
    class: 'textarea', rows: '8', maxlength: '10000',
    placeholder: '교수님 과제 공지 / 요구사항을 그대로 붙여넣으세요.\n예) 주제: 대학생의 일상 문제 해결 앱 기획 · 제출물: 기획서(10p 이내) + 프로토타입 · 평가: 문제 정의 30%, 사용자 조사 30% …',
  });
  note.value = p.professor_note ?? '';
  const status = h('div', { class: 'small muted', style: { minHeight: '20px', marginTop: '6px' } });
  const analyzeBtn = h('button', { class: 'btn btn--primary', type: 'button' }, '✨ 저장하고 AI로 요구사항 정리');
  const saveBtn = h('button', { class: 'btn', type: 'button' }, '저장만');

  const saveNote = async () => {
    const v = note.value.trim() || null;
    if (v === (p.professor_note ?? null)) return true;
    try {
      const row = await updateProject(p.id, { professor_note: v });
      p.professor_note = row.professor_note;
      return true;
    } catch { return false; }
  };

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    if (await saveNote()) toast('교수 요구사항을 저장했어요.');
    saveBtn.disabled = false;
  });

  analyzeBtn.addEventListener('click', async () => {
    const text = note.value.trim();
    if (text.length < 20) return toast('교수님 요구사항을 20자 이상 넣어 주세요.', { type: 'error' });
    analyzeBtn.disabled = true;
    saveBtn.disabled = true;
    status.replaceChildren(spinner(), ' AI가 요구사항을 정리하는 중... (10~30초)');
    try {
      if (isOwner && !(await saveNote())) throw new Error('save failed');
      const doc = await q(
        supabase.from('assignment_docs').insert({
          project_id: p.id, file_name: '교수 요구사항 (설정)', mime_type: 'text/plain', extracted_text: text,
        }).select('id').single(),
        '요구사항 원문을 저장하지 못했어요.',
      );
      const { data, error } = await supabase.functions.invoke('ai', { body: { action: 'analyze_doc', projectId: p.id, docId: doc.id } });
      if (error) {
        let msg = 'AI 요청 처리 중 오류가 발생했어요.';
        try { msg = (await error.context?.json?.())?.error ?? msg; } catch { /* 본문 없음 */ }
        throw Object.assign(new Error(msg), { toastMsg: msg });
      }
      toast(`📄 요구사항 ${data.requirements?.length ?? 0}개를 정리했어요.`, { duration: 4000 });
      route();
    } catch (e) {
      if (e.toastMsg) toast(e.toastMsg, { type: 'error', duration: 4000 });
      status.textContent = '';
      analyzeBtn.disabled = false;
      saveBtn.disabled = false;
    }
  });

  return h('div', { class: 'card', style: { marginTop: '16px' } },
    h('div', { class: 'card__title' }, '🎓 교수 요구사항'),
    h('p', { class: 'small faint', style: { marginBottom: '8px' } },
      'AI가 아이디어 생성 · 피드백 · 점검 · 할 일 목록을 만들 때 기준이 돼요. PDF/DOCX 파일은 프로젝트 상세 › 아이디어 맵 › 과제 요구사항에서 올릴 수 있어요.',
      !isOwner && ' (원문 저장은 팀장만, AI 정리는 누구나 할 수 있어요)'),
    note,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'spacer' }), isOwner && saveBtn, analyzeBtn),
    status,
    reqs.length > 0 && h('div', { style: { marginTop: '12px' } },
      h('div', { class: 'small muted', style: { fontWeight: '700', marginBottom: '4px' } }, `정리된 요구사항 ${reqs.length}개`),
      h('ol', { class: 'req-preview' }, reqs.slice(0, 12).map((r) => h('li', {}, r.content))),
      reqs.length > 12 && h('p', { class: 'small faint' }, `… 외 ${reqs.length - 12}개는 프로젝트 상세에서 확인·수정하세요.`)));
}

function inviteCard(p) {
  const url = inviteUrl(p.invite_code);
  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); toast(`${label} 복사했어요.`); } catch { toast(text); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__title' }, '🔗 초대 링크 공유'),
    h('p', { class: 'small faint', style: { marginBottom: '8px' } }, '링크를 받은 팀원은 로그인만 하면 바로 프로젝트에 참여해요.'),
    h('div', { class: 'row' },
      h('input', { class: 'input grow', value: url, readonly: true, 'aria-label': '초대 링크', onfocus: (e) => e.target.select() }),
      h('button', { class: 'btn btn--primary', onclick: () => copy(url, '초대 링크를') }, '복사')),
    h('div', { class: 'row small muted', style: { marginTop: '8px' } },
      h('span', {}, '초대코드'),
      h('button', { class: 'invite', onclick: () => copy(p.invite_code, '초대코드를') }, p.invite_code)));
}

function membersCard(p, members, isOwner) {
  return h('div', { class: 'card' },
    h('div', { class: 'card__title' }, `👥 팀원 관리 (${members.length})`),
    members.map((m) => {
      const isMe = m.user_id === ctx.user.id;
      const editable = isMe || isOwner;
      return h('div', { class: 'member-row' },
        avatar(m),
        h('div', { class: 'grow', style: { minWidth: '0' } },
          h('div', { class: 'ellipsis', style: { fontWeight: '700' } }, m.profile?.display_name ?? '팀원', isMe ? ' (나)' : '', m.role === 'owner' ? ' 👑' : ''),
          h('input', {
            class: 'input input--sm', maxlength: '20', placeholder: '역할 (예: 기획, 디자인, 발표)', value: m.role_label ?? '', disabled: !editable,
            onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); },
            onchange: (e) => updateMember(p.id, m.user_id, { role_label: e.target.value.trim() || null })
              .then(() => toast('역할을 저장했어요.')).catch(() => {}),
          })),
        isOwner && !isMe && h('button', {
          class: 'btn btn--ghost btn--sm', onclick: async () => {
            if (!confirm(`${m.profile?.display_name ?? '팀원'}님을 프로젝트에서 내보낼까요?\n담당 노드와 할 일 배정도 함께 풀려요.`)) return;
            try { await removeMember(p.id, m.user_id); toast('팀원을 내보냈어요.'); route(); } catch { /* 토스트 처리됨 */ }
          },
        }, '내보내기'),
        isMe && !isOwner && h('button', {
          class: 'btn btn--ghost btn--sm', onclick: async () => {
            if (!confirm('이 프로젝트에서 나갈까요?')) return;
            try { await removeMember(p.id, m.user_id); await reloadProjects(); location.hash = '#/projects'; } catch { /* 토스트 처리됨 */ }
          },
        }, '나가기'));
    }));
}

function dangerCard(p) {
  const done = !!p.completed_at;
  return h('div', { class: 'card', style: { marginTop: '16px' } },
    h('div', { class: 'card__title' }, '🗂️ 프로젝트 종료'),
    h('div', { class: 'row' },
      h('p', { class: 'small muted grow' }, done
        ? `${fmtDate(p.completed_at)}에 종료한 프로젝트예요. HOME의 '지난 프로젝트'에 보여요.`
        : "과제를 제출했다면 종료 처리하세요. HOME의 '지난 프로젝트'로 옮겨지고, 내용은 그대로 남아요."),
      h('button', {
        class: ['btn', done ? '' : 'btn--primary'], onclick: async () => {
          try {
            await updateProject(p.id, { completed_at: done ? null : new Date().toISOString() });
            await reloadProjects();
            toast(done ? '다시 진행 중으로 바꿨어요.' : '프로젝트를 종료했어요. 수고했어요! 🎉');
            route();
          } catch { /* 토스트 처리됨 */ }
        },
      }, done ? '다시 진행하기' : '프로젝트 종료')));
}

// 시작 ---------------------------------------------------------------------------
async function start() {
  const session = await getSession();
  if (!session) return renderLogin();
  const next = nextUrl();
  if (next) return location.replace(next);

  ctx.user = session.user;
  render(root, h('div', { class: 'empty', style: { marginTop: '20vh' } }, spinner()));
  try {
    [ctx.profile] = await Promise.all([getMyProfile(ctx.user.id), reloadProjects()]);
  } catch {
    return render(root, h('div', { class: 'setup-error' },
      h('h2', {}, '데이터를 불러오지 못했어요'),
      h('p', { style: { marginTop: '12px' } }, 'Supabase에 마이그레이션(supabase/migrations)이 적용됐는지 확인해 주세요.'),
      h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: signOut }, '로그아웃')));
  }

  // 초대 링크로 들어온 경우 (?join=CODE) → 참여 후 바로 프로젝트 상세로
  const joinCode = params.get('join');
  if (joinCode) {
    history.replaceState(null, '', location.pathname + location.hash);
    try {
      const p = await joinProject(joinCode);
      return goProject(p.id, ctx.user);
    } catch { /* 토스트 처리됨 */ }
  }

  if (!location.hash) history.replaceState(null, '', '#/home');
  window.addEventListener('hashchange', route);
  route();
}

supabase.auth.onAuthStateChange((event) => {
  // 랜딩(로그인 전 화면)에서 로그인이 끝났을 때만 다시 시작한다
  if (event === 'SIGNED_IN' && !ctx.user && root.querySelector('.hero:not(.hero--compact)')) { loginModal?.close(); start(); }
});
start();
