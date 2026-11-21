// 오른쪽 패널 (B): 선택 없음(또는 드래그 중) → 팀원 목록. 각 헤더는 드롭 타겟.
import { h, render } from '../utils/dom.js';
import { avatar, SIGNALS, TASK_STATES, effectiveSignal } from '../utils/color.js';
import { relTime } from '../utils/time.js';
import { mutate } from '../store.js';
import { updateMember } from '../api/projects.js';
import { revealNode } from '../actions.js';
import { openPraiseModal, openExperienceModal } from './modals.js';
import { EXP_KINDS, sortExperiences, levelDots, expTooltip } from '../utils/experience.js';

const openMembers = new Set();

export function renderMembers(container, s) {
  const list = [...s.members.values()];
  // 나 먼저, 그다음 가입 순
  list.sort((a, b) => (a.user_id === s.user.id ? -1 : b.user_id === s.user.id ? 1 : a.joined_at.localeCompare(b.joined_at)));

  // 담당 노드 묶기
  const byMember = new Map();
  for (const [nodeId, map] of s.assignees) {
    const node = s.nodes.get(nodeId);
    if (!node) continue;
    for (const a of map.values()) {
      if (!byMember.has(a.user_id)) byMember.set(a.user_id, []);
      byMember.get(a.user_id).push({ node, a });
    }
  }

  render(container,
    h('div', { class: 'panel-title' }, '👥 팀원', h('span', { class: 'side-sec__count' }, String(list.length))),
    h('p', { class: 'drop-hint' }, s.isDragging ? '👇 담당자로 지정할 팀원 위에 놓으세요' : '노드를 팀원 이름 위로 끌어다 놓으면 담당자로 지정돼요.'),
    list.map((m) => memberEl(s, m, byMember.get(m.user_id) ?? [])),
  );
}

function memberEl(s, m, tasks) {
  const isMe = m.user_id === s.user.id;
  const sig = effectiveSignal(m);
  const done = tasks.filter((t) => t.a.task_state === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const exps = sortExperiences(s.experiences.get(m.user_id) ?? []);
  const order = { doing: 0, todo: 1, done: 2 };
  tasks.sort((x, y) => order[x.a.task_state] - order[y.a.task_state]);

  const el = h('details', {
    class: ['member', s.dropTarget === m.user_id && 'member--drop', sig === 'red' && 'member--red', s.helpRequests.has(m.user_id) && 'member--help'],
    open: openMembers.has(m.user_id),
  },
  h('summary', { dataset: { dropMember: m.user_id } },
    h('span', { class: ['signal-light', `signal-light--${sig === 'stale' ? 'yellow' : sig}`], title: sig === 'stale' ? '자리 비움?' : SIGNALS[sig]?.label }),
    avatar(m),
    h('div', { class: 'grow', style: { minWidth: '0' } },
      h('div', { class: 'member__name ellipsis' }, m.profile?.display_name ?? '팀원', isMe ? ' (나)' : '', m.role === 'owner' ? ' 👑' : ''),
      h('div', { class: 'member__role ellipsis' },
        m.role_label || '역할 미정', ' · ', sig === 'stale' ? '자리 비움?' : SIGNALS[sig]?.label)),
    h('span', { class: 'member__temp', title: `받은 좋아요 ${m.praise_count ?? 0}번` }, `🌡️ ${(m.temperature ?? 36.5).toFixed(1)}℃`)),
  h('div', { class: 'member__body' },
    m.signal_message && h('div', { class: 'member__msg' }, `${SIGNALS[m.signal]?.emoji ?? ''} ${m.signal_message}`,
      h('span', { class: 'faint' }, ` · ${relTime(m.signal_changed_at)}`)),
    isMe && h('div', { class: 'field' }, h('label', {}, '내 역할 라벨'),
      h('input', {
        class: 'input', maxlength: '20', placeholder: '예) 기획, 디자인, 발표', value: m.role_label ?? '', dataset: { key: 'my-role' },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); },
        onchange: async (e) => {
          try {
            const row = await updateMember(s.project.id, m.user_id, { role_label: e.target.value.trim() || null });
            mutate('members', (mm) => mm.set(m.user_id, { ...mm.get(m.user_id), ...row }));
          } catch { /* 토스트 처리됨 */ }
        },
      })),
    h('div', { class: 'row small', style: { marginBottom: '4px' } },
      h('span', { class: 'grow muted' }, `담당 ${tasks.length}개 · 완료 ${done}개`), h('span', { class: 'muted' }, `${pct}%`)),
    h('div', { class: 'progress', style: { marginBottom: '8px' } }, h('div', { class: 'progress__bar', style: { width: `${pct}%` } })),
    tasks.length === 0 && h('p', { class: 'small faint' }, '담당 노드가 없어요.'),
    tasks.map(({ node, a }) => h('div', { class: 'task', onclick: () => revealNode(node.id) },
      h('span', { class: ['task__state', `task__state--${a.task_state}`] }, TASK_STATES[a.task_state]),
      h('span', { class: 'task__title' }, node.title))),
    h('div', { class: 'member__exp-title' }, '경험 카드'),
    exps.length === 0
      ? h('p', { class: 'small faint' }, isMe ? '아직 없어요. 경험을 넣으면 AI가 우리 팀에 맞는 범위를 제안해요.' : '경험 정보 없음')
      : h('div', { class: 'row row--wrap' }, exps.map((ex) => h('span', {
        class: 'exp-chip', title: expTooltip(ex),
      }, `${EXP_KINDS[ex.kind]?.icon ?? '📁'} ${ex.title} `, h('span', { class: 'exp-chip__level' }, levelDots(ex.level))))),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      isMe && h('button', { class: 'btn btn--sm', onclick: () => openExperienceModal() }, '🙋 내 경험 편집'),
      !isMe && h('button', { class: 'btn btn--sm', onclick: () => openPraiseModal(m.user_id) }, '👍 좋아요'),
      s.helpRequests.has(m.user_id) && h('button', {
        class: 'btn btn--sm', onclick: () => mutate('helpRequests', (set) => set.delete(m.user_id)),
      }, '도움 요청 확인'))));

  el.addEventListener('toggle', () => (el.open ? openMembers.add(m.user_id) : openMembers.delete(m.user_id)));
  return el;
}
