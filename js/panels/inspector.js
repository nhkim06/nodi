import { icon } from '../utils/icons.js';
// 오른쪽 패널 (A): 노드 선택 시 Inspector — [상세] / [🧭 실행 계획] 탭
import { h, render, safeUrl, spinner } from '../utils/dom.js';
import { avatar, STATUS, TASK_STATES, LINK_KINDS, BUBBLE_KINDS } from '../utils/color.js';
import { relTime } from '../utils/time.js';
import { assigneesOf, commentsOf, touch } from '../store.js';
import { updateNode } from '../api/nodes.js';
import { removeAssignee, updateAssignee } from '../api/assignees.js';
import { deleteLink } from '../api/links.js';
import { dismissComment } from '../api/ai.js';
import { ensurePlan } from '../api/plans.js';
import { tasksOf, addTask, updateTask, deleteTask } from '../api/tasks.js';
import { goFocus } from '../router.js';
import { reqLabelMap } from '../canvas/bubbles.js';
import { expLabelMap, expChip, reqChip, latestExperienceUpdate, totalExperiences } from '../utils/experience.js';
import {
  setStatusMany, toggleCandidate, deleteWithConfirm, assign, aiFeedback, aiDirection, aiConcretize, clearSelection,
} from '../actions.js';
import { openGenerateModal, openLinkModal, openPlanEditModal, openExperienceModal } from './modals.js';

let tab = 'detail';   // 'detail' | 'plan'
const setTab = (t) => { tab = t; touch('selection'); };

export function renderInspector(container, s) {
  const ids = [...s.selection].filter((id) => s.nodes.has(id));
  if (ids.length === 1) return render(container, single(s, s.nodes.get(ids[0])));
  return render(container, multi(s, ids));
}

function single(s, node) {
  const isRoot = !node.parent_id;
  const busy = s.aiBusy.has(node.id);
  const reqMap = reqLabelMap(s.requirements);
  const expMap = expLabelMap(s);
  const creator = s.members.get(node.created_by)?.profile?.display_name;
  const plan = s.plans.get(node.id);

  const title = h('input', {
    class: 'insp-title', value: node.title, maxlength: '100', dataset: { key: `title-${node.id}` }, 'aria-label': '제목',
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); if (e.key === 'Escape') { e.target.value = node.title; e.target.blur(); } },
    onblur: (e) => {
      const v = e.target.value.trim();
      if (v && v !== node.title) updateNode(node.id, { title: v.slice(0, 100) }).catch(() => {});
      else e.target.value = node.title;
    },
  });
  const desc = h('textarea', {
    class: 'textarea insp-desc', maxlength: '2000', rows: '3', placeholder: '설명을 적어 보세요', value: node.description ?? '',
    dataset: { key: `desc-${node.id}` }, 'aria-label': '설명',
    onblur: (e) => {
      const v = e.target.value.trim();
      if (v !== (node.description ?? '')) updateNode(node.id, { description: v || null }).catch(() => {});
    },
  });

  const head = h('div', { class: 'panel-sec' },
    title,
    h('div', { style: { marginTop: '4px' } }, desc),
    h('div', { class: 'small faint', style: { marginTop: '4px' } },
      node.source === 'ai' ? 'AI가 제안한 아이디어' : creator ? `${creator}님이 만듦` : '', ' · ', relTime(node.created_at)));

  const tabs = h('div', { class: 'insp-tabs', role: 'tablist' },
    h('button', {
      class: ['insp-tab', tab === 'detail' && 'insp-tab--on'], role: 'tab', 'aria-selected': String(tab === 'detail'),
      onclick: () => setTab('detail'),
    }, '상세'),
    h('button', {
      class: ['insp-tab', tab === 'plan' && 'insp-tab--on'], role: 'tab', 'aria-selected': String(tab === 'plan'),
      onclick: () => setTab('plan'),
    }, icon('compass'), '실행 계획', plan?.feasibility ? h('span', { class: 'insp-tab__feas' }, `${plan.feasibility}/5`) : null));

  const footer = h('div', { class: 'panel-sec stack' },
    h('button', { class: 'btn btn--block', onclick: () => goFocus([node.id]) }, icon('search'), '이 노드를 루트로 보기'),
    !isRoot && h('button', { class: 'btn btn--danger btn--block', onclick: () => deleteWithConfirm([node.id]) }, icon('trash'), '삭제'));

  if (tab === 'plan') return [head, tabs, planTab(s, node, { busy, reqMap, expMap }), footer];
  return [head, tabs, ...detailTab(s, node, { busy, reqMap, expMap, isRoot }), footer];
}

// 상세 탭 ---------------------------------------------------------------------------
function detailTab(s, node, { busy, reqMap, expMap, isRoot }) {
  const assignees = assigneesOf(node.id);
  const assignedIds = new Set(assignees.map((a) => a.user_id));
  const unassigned = [...s.members.values()].filter((m) => !assignedIds.has(m.user_id));
  const links = s.links.filter((l) => l.node_id === node.id);
  const comments = commentsOf(node.id);

  return [
    !isRoot && h('div', { class: 'panel-sec' },
      h('div', { class: 'panel-sec__title' }, '상태'),
      node.status === 'discarded'
        ? h('div', { class: 'row' },
          h('span', { class: 'grow muted small' }, `버린 아이디어예요 (이전: ${STATUS[node.status_before_discard ?? 'considering']})`),
          h('button', { class: 'btn btn--sm', onclick: () => setStatusMany([node.id], 'restore') }, '복구'))
        : h('div', { class: 'status-btns' },
          ['adopted', 'considering', 'discarded'].map((st) => h('button', {
            class: ['status-btn', `status-btn--${st}`, node.status === st && 'status-btn--on'],
            onclick: () => setStatusMany([node.id], st),
          }, { adopted: '✓ 채택', considering: '고민중', discarded: '✕ 버림' }[st]))),
      h('label', { class: 'row', style: { marginTop: '8px', cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: node.is_candidate, onchange: () => toggleCandidate(node.id) }),
        h('span', {}, '후보로 표시 (이어서 아이디에이션할 노드)'))),

    h('div', { class: 'panel-sec' },
      h('div', { class: 'panel-sec__title' }, '담당자'),
      assignees.length === 0 && h('p', { class: 'small faint' }, '아직 없어요. 노드를 팀원 이름 위로 끌어다 놓아도 돼요.'),
      assignees.map((a) => {
        const m = s.members.get(a.user_id);
        return h('div', { class: 'assignee' },
          avatar(m),
          h('span', { class: 'grow ellipsis' }, m?.profile?.display_name ?? '(나간 팀원)'),
          h('select', {
            class: 'select', value: a.task_state, 'aria-label': '작업 상태',
            onchange: (e) => updateAssignee(node.id, a.user_id, { task_state: e.target.value }).catch(() => {}),
          }, Object.entries(TASK_STATES).map(([k, v]) => h('option', { value: k }, v))),
          h('button', { class: 'chip__x', title: '담당 해제', 'aria-label': '담당 해제', onclick: () => removeAssignee(node.id, a.user_id).catch(() => {}) }, '✕'));
      }),
      unassigned.length > 0 && h('select', {
        class: 'select', style: { marginTop: '6px' }, 'aria-label': '담당자 추가',
        onchange: (e) => { if (e.target.value) assign([node.id], e.target.value); e.target.value = ''; },
      }, h('option', { value: '' }, '＋ 담당자 추가'),
      unassigned.map((m) => h('option', { value: m.user_id }, m.profile?.display_name ?? '팀원')))),

    !isRoot && todoSection(s, node, busy),

    h('div', { class: 'panel-sec' },
      h('div', { class: 'panel-sec__title' }, '연결된 작업 링크', h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: () => openLinkModal(node.id) }, '＋')),
      links.length === 0 && h('p', { class: 'small faint' }, '노션, 회의록, 피그마 링크를 연결해 보세요.'),
      links.map((l) => h('div', { class: 'link-item' },
        h('span', { class: 'small muted' }, LINK_KINDS[l.kind]?.label ?? '기타'),
        h('a', { href: safeUrl(l.url) ?? '#', target: '_blank', rel: 'noopener noreferrer' }, l.title),
        h('button', { class: 'icon-btn', title: '삭제', onclick: () => deleteLink(l.id).catch(() => {}) }, '✕')))),

    h('div', { class: 'panel-sec' },
      h('div', { class: 'panel-sec__title' }, icon('sparkles'), 'AI'),
      h('div', { class: 'stack' },
        h('button', {
          class: 'btn btn--sm btn--block btn--primary', disabled: busy,
          onclick: () => { setTab('plan'); aiConcretize(node.id); },
        }, busy ? 'AI 처리 중...' : [icon('compass'), '우리 팀 기준으로 구체화']),
        h('button', { class: 'btn btn--sm btn--block', disabled: busy, onclick: () => aiFeedback(node.id) }, icon('message'), '이 노드 피드백 받기'),
        h('button', { class: 'btn btn--sm btn--block', disabled: busy, onclick: () => openGenerateModal([node.id]) }, icon('bulb'), '하위 아이디어 생성'),
        h('button', { class: 'btn btn--sm btn--block', disabled: busy, onclick: () => aiDirection([node.id]) }, icon('compass'), '다음 방향 추천')),
      comments.length > 0 && h('div', { style: { marginTop: '10px' } },
        comments.map((c) => h('div', { class: ['comment-item', `comment-item--${c.kind}`] },
          h('div', { class: 'row' }, h('span', { class: 'grow small faint' }, relTime(c.created_at)),
            h('button', { class: 'chip__x', title: '숨기기', onclick: () => dismissComment(c.id) }, '✕')),
          h('div', { class: 'comment-item__body' }, `${BUBBLE_KINDS[c.kind]?.label ?? '댓글'} · ${c.content}`),
          refChips(c.requirement_ids, c.experience_ids, reqMap, expMap))))),
  ];
}

// ✅ 할 일 목록 (IA v2: 아이디어 추가 → AI 추천 의견 · 할 일 목록 제작) ------------------------
function todoSection(s, node, busy) {
  const list = tasksOf(node.id);
  const done = list.filter((t) => t.done).length;
  const memberOpts = () => [h('option', { value: '' }, '담당 없음'),
    ...[...s.members.values()].map((m) => h('option', { value: m.user_id }, m.profile?.display_name ?? '팀원'))];

  const input = h('input', {
    class: 'input', maxlength: '200', placeholder: '할 일 추가 후 Enter', dataset: { key: `todo-${node.id}` },
    onkeydown: async (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const v = e.target.value.trim();
      if (!v) return;
      e.target.value = '';
      try { await addTask(node.id, v); } catch { e.target.value = v; }
    },
  });

  return h('div', { class: 'panel-sec' },
    h('div', { class: 'panel-sec__title' }, icon('check'), '할 일 목록',
      list.length > 0 && h('span', { class: 'side-sec__count' }, `${done}/${list.length}`),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn btn--ghost btn--sm', disabled: busy, title: '팀 경험 기준으로 실행 계획과 할 일을 만들어요',
        onclick: () => aiConcretize(node.id),
      }, busy ? spinner() : [icon('sparkles'), 'AI로 만들기'])),
    list.length === 0 && h('p', { class: 'small faint' }, '아직 없어요. AI로 만들면 실행 계획과 함께 할 일을 나눠 줘요.'),
    list.map((t) => h('div', { class: ['todo', t.done && 'todo--done'] },
      h('input', {
        type: 'checkbox', checked: t.done, 'aria-label': '완료',
        onchange: (e) => updateTask(t.id, { done: e.target.checked }).catch(() => {}),
      }),
      h('span', { class: 'todo__text', title: t.source === 'ai' ? 'AI가 추천한 할 일' : '' }, t.content),
      h('select', {
        class: 'select todo__who', 'aria-label': '담당자', value: t.assignee_id ?? '',
        onchange: (e) => updateTask(t.id, { assignee_id: e.target.value || null }).catch(() => {}),
      }, memberOpts()),
      h('button', { class: 'chip__x', title: '삭제', 'aria-label': '할 일 삭제', onclick: () => deleteTask(t.id).catch(() => {}) }, '✕'))),
    h('div', { style: { marginTop: '6px' } }, input));
}

function refChips(reqIds, expIds, reqMap, expMap) {
  const r = (reqIds ?? []).map((id) => reqChip(reqMap.get(id))).filter(Boolean);
  const e = (expIds ?? []).map((id) => expChip(expMap.get(id))).filter(Boolean);
  if (!r.length && !e.length) return null;
  return h('div', { class: 'bubble__refs' }, r, e);
}

// 실행 계획 탭 (F15) -------------------------------------------------------------------
const feasDots = (f) => '●'.repeat(f) + '○'.repeat(5 - f);

function planTab(s, node, { busy, reqMap, expMap }) {
  const plan = s.plans.get(node.id);
  if (!plan?._full) {
    ensurePlan(node.id);
    return h('div', { class: 'panel-sec empty' }, spinner());
  }
  const noExp = totalExperiences(s) === 0;
  const hasPlan = !plan._empty;
  const detailed = hasPlan && ((plan.research_methods ?? []).length > 0 ||
    ['mvp', 'stretch', 'out_of_scope'].some((k) => (plan.scope?.[k] ?? []).length > 0));
  const latestExp = latestExperienceUpdate(s);
  const stale = hasPlan && plan.generated_at && latestExp && latestExp > plan.generated_at;
  const assigned = new Set(assigneesOf(node.id).map((a) => a.user_id));

  const concretizeBtn = h('button', {
    class: 'btn btn--sm btn--primary', disabled: busy, onclick: () => aiConcretize(node.id),
  }, busy ? spinner() : [icon('sparkles'), detailed ? '다시 구체화' : '우리 팀 기준으로 구체화']);
  const editBtn = h('button', { class: 'btn btn--sm', onclick: () => openPlanEditModal(node.id) }, [icon('edit'), hasPlan ? '직접 수정' : '직접 작성']);

  const banners = [
    noExp && h('div', { class: 'plan-banner' },
      '팀 경험 카드가 아직 없어서 AI가 가장 보수적인 범위로 제안해요. ',
      h('button', { class: 'btn btn--ghost btn--sm', onclick: () => openExperienceModal() }, '내 경험 입력')),
    stale && h('div', { class: 'plan-banner plan-banner--stale' },
      '팀 경험이 바뀌었어요 — ',
      h('button', { class: 'btn btn--ghost btn--sm', disabled: busy, onclick: () => aiConcretize(node.id) }, icon('sparkles'), '다시 구체화')),
  ];

  if (!hasPlan) {
    return h('div', { class: 'panel-sec' }, banners,
      h('p', { class: 'small muted', style: { marginBottom: '8px' } },
        '이 아이디어를 우리 팀이 실제로 할 수 있는 형태로 바꿔 봐요. 팀원 경험을 근거로 조사 방법, 구현 범위(MVP / 여유 있으면 / 범위 밖), 리스크를 정리해 줘요.'),
      h('div', { class: 'row' }, concretizeBtn, editBtn));
  }

  const memberName = (uid) => s.members.get(uid)?.profile?.display_name ?? '팀원';
  const methods = plan.research_methods ?? [];
  const scope = plan.scope ?? {};
  const risks = plan.risks ?? [];
  const scopeRow = (label, items, cls) => items?.length > 0 && h('div', { class: ['plan-scope', cls] },
    h('div', { class: 'plan-scope__label' }, label),
    h('ul', { class: 'plan-list' }, items.map((it) => h('li', {},
      h('span', { class: 'plan-list__item' }, it.item),
      it.why && h('span', { class: 'small muted' }, ` — ${it.why}`)))));

  return h('div', { class: 'panel-sec plan' },
    banners,
    plan.feasibility && h('div', { class: 'plan-feas' },
      h('span', { class: 'plan-feas__label' }, '실행 가능성'),
      h('span', { class: ['plan-feas__dots', `node__feas--${plan.feasibility}`], title: `${plan.feasibility}/5` }, feasDots(plan.feasibility))),
    plan.feasibility_note && h('p', { class: 'small', style: { margin: '4px 0 0' } }, plan.feasibility_note),
    (plan.experience_ids ?? []).length > 0 && h('div', { class: 'bubble__refs' },
      plan.experience_ids.map((id) => expChip(expMap.get(id)))),

    h('div', { class: 'plan-sec__title' }, '조사 방법'),
    methods.length === 0 && h('p', { class: 'small faint' }, detailed ? '없음' : '아직 없어요. 구체화하면 팀 경험에 맞는 조사 방법을 제안해요.'),
    methods.map((m) => h('div', { class: 'plan-item' },
      h('div', { class: 'plan-item__title' }, m.method),
      m.why && h('div', { class: 'small muted' }, m.why),
      refChips(m.requirement_ids, m.experience_ids, reqMap, expMap),
      (m.owner_ids ?? []).filter((uid) => s.members.has(uid)).length > 0 && h('div', { class: 'row row--wrap small', style: { marginTop: '4px' } },
        h('span', { class: 'muted' }, '추천 담당:'),
        m.owner_ids.filter((uid) => s.members.has(uid)).map((uid) => h('span', { class: 'row', style: { gap: '4px' } },
          avatar(s.members.get(uid), { size: 18 }), memberName(uid),
          assigned.has(uid)
            ? h('span', { class: 'faint' }, '(담당 중)')
            : h('button', { class: 'btn btn--ghost btn--sm', onclick: () => assign([node.id], uid) }, '지정')))))),

    (detailed || scope.mvp?.length) && h('div', { class: 'plan-sec__title' }, '구현 범위'),
    scopeRow('MVP', scope.mvp, 'plan-scope--mvp'),
    scopeRow('여유 있으면', scope.stretch, 'plan-scope--stretch'),
    scopeRow('범위 밖', scope.out_of_scope, 'plan-scope--out'),

    risks.length > 0 && h('div', { class: 'plan-sec__title' }, '리스크'),
    risks.map((r) => h('div', { class: 'plan-risk' },
      h('div', {}, r.risk),
      r.mitigation && h('div', { class: 'small muted' }, `→ ${r.mitigation}`))),

    h('div', { class: 'small faint', style: { marginTop: '10px' } },
      plan.edited_by_user ? '팀원이 직접 수정한 계획' : plan.generated_by_ai ? 'AI가 만든 계획' : '',
      plan.updated_at ? ` · ${relTime(plan.updated_at)}` : ''),
    h('div', { class: 'row', style: { marginTop: '8px' } }, editBtn, h('span', { class: 'spacer' }), concretizeBtn));
}

// 다중 선택 ---------------------------------------------------------------------------
function multi(s, ids) {
  const nodes = ids.map((id) => s.nodes.get(id));
  const anyDiscarded = nodes.some((n) => n.status === 'discarded');
  return [
    h('div', { class: 'panel-sec' },
      h('div', { style: { fontWeight: '800', fontSize: '16px' } }, `노드 ${ids.length}개 선택됨`),
      h('div', { class: 'small muted', style: { marginTop: '4px' } }, nodes.map((n) => n.title).join(', '))),
    h('div', { class: 'panel-sec' },
      h('div', { class: 'panel-sec__title' }, '일괄 상태 변경'),
      h('div', { class: 'status-btns' },
        h('button', { class: 'status-btn status-btn--adopted', onclick: () => setStatusMany(ids, 'adopted') }, '✓ 채택'),
        h('button', { class: 'status-btn status-btn--considering', onclick: () => setStatusMany(ids, 'considering') }, '고민중'),
        h('button', { class: 'status-btn status-btn--discarded', onclick: () => setStatusMany(ids, 'discarded') }, '✕ 버림')),
      anyDiscarded && h('button', { class: 'btn btn--sm', style: { marginTop: '6px' }, onclick: () => setStatusMany(ids, 'restore') }, '버린 노드 복구')),
    h('div', { class: 'panel-sec stack' },
      h('button', { class: 'btn btn--primary btn--block', onclick: () => goFocus(ids) }, icon('search'), '선택한 노드들로 이어서 아이디에이션'),
      h('button', { class: 'btn btn--block', onclick: () => openGenerateModal(ids) }, icon('bulb'), '각각 하위 아이디어 생성'),
      h('button', { class: 'btn btn--block', onclick: () => aiDirection(ids) }, icon('compass'), '방향 추천'),
      h('p', { class: 'small faint' }, '팀원 이름 위로 끌어다 놓으면 한꺼번에 담당자로 지정돼요.'),
      h('button', { class: 'btn btn--danger btn--block', onclick: () => deleteWithConfirm(ids) }, icon('trash'), '선택 삭제'),
      h('button', { class: 'btn btn--ghost btn--block', onclick: clearSelection }, '선택 해제')),
  ];
}
