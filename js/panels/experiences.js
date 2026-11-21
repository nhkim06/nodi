// 경험 카드 편집기 (F16) — 온보딩(index), 개인 페이지(me), 워크스페이스 모달에서 함께 쓴다.
// 경험 카드는 사용자 단위라 한 번 입력하면 다른 팀플에서도 그대로 쓰인다.
import { h, toast, spinner } from '../utils/dom.js';
import { EXP_KINDS, EXP_LEVELS, EXP_EXAMPLES, levelDots } from '../utils/experience.js';
import { listMyExperiences, addExperience, updateExperience, deleteExperience } from '../api/experiences.js';

// 경험 온보딩 "나중에 할게요" 기억 (사용자별, 이 브라우저에서만)
const ONBOARD_KEY = (uid) => `nodi.expOnboarding.${uid}`;
export function skipOnboarding(uid) {
  try { localStorage.setItem(ONBOARD_KEY(uid), 'skipped'); } catch { /* 무시 */ }
}
export function onboardingSkipped(uid) {
  try { return localStorage.getItem(ONBOARD_KEY(uid)) === 'skipped'; } catch { return false; }
}

/**
 * const editor = experienceEditor({ userId, onChange });
 * container.append(editor.el);
 * onChange(list) — 카드가 추가/수정/삭제될 때마다 현재 목록으로 호출
 */
export function experienceEditor({ userId, onChange, compact = false }) {
  const el = h('div', { class: 'exp-editor' });
  let list = [];
  let editingId = null;   // null = 새 카드 폼, id = 그 카드 수정 중
  let loaded = false;

  const changed = () => onChange?.(list);

  async function load() {
    try {
      list = await listMyExperiences(userId);
    } catch { list = []; }
    loaded = true;
    draw();
    changed();
  }

  function cardForm(initial, { onSubmit, onCancel, submitText }) {
    const kind = h('select', { class: 'select', 'aria-label': '종류' },
      Object.entries(EXP_KINDS).map(([k, v]) => h('option', { value: k }, `${v.icon} ${v.label}`)));
    kind.value = initial.kind ?? 'project';
    const title = h('input', { class: 'input', maxlength: '60', placeholder: '예) 교내 앱 공모전 UI 디자인', value: initial.title ?? '' });
    const level = h('select', { class: 'select', 'aria-label': '숙련도' },
      Object.entries(EXP_LEVELS).map(([k, v]) => h('option', { value: k }, `${levelDots(Number(k))} ${v}`)));
    level.value = String(initial.level ?? 1);
    const detail = h('textarea', {
      class: 'textarea', rows: '2', maxlength: '500',
      placeholder: '무엇을 했고 결과가 어땠는지 (예: 학회 설문 120명 응답을 엑셀로 교차분석)',
      value: initial.detail ?? '',
    });
    const tags = h('input', { class: 'input', placeholder: '태그 (쉼표로 구분: figma, 설문)', value: (initial.tags ?? []).join(', ') });
    const submit = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, submitText);

    const form = h('form', {
      class: 'exp-form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!title.value.trim()) { toast('경험 제목을 적어 주세요.', { type: 'error' }); title.focus(); return; }
        submit.disabled = true;
        submit.replaceChildren(spinner());
        try {
          await onSubmit({
            kind: kind.value,
            title: title.value,
            level: Number(level.value),
            detail: detail.value,
            tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
          });
        } catch {
          submit.disabled = false;
          submit.textContent = submitText;
        }
      },
    },
    h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('label', {}, '종류'), kind),
      h('div', { class: 'field grow' }, h('label', {}, '숙련도'), level)),
    h('div', { class: 'field' }, h('label', {}, '제목'), title),
    h('div', { class: 'field' }, h('label', {}, '상세 (선택)'), detail),
    !compact && h('div', { class: 'field' }, h('label', {}, '태그 (선택)'), tags),
    h('div', { class: 'row' }, h('span', { class: 'spacer' }),
      onCancel && h('button', { class: 'btn btn--sm', type: 'button', onclick: onCancel }, '취소'),
      submit));
    form._title = title;
    form._fill = (ex) => {
      kind.value = ex.kind; title.value = ex.title; tags.value = (ex.tags ?? []).join(', ');
      title.focus();
    };
    return form;
  }

  function cardEl(ex) {
    if (editingId === ex.id) {
      return cardForm(ex, {
        submitText: '저장',
        onCancel: () => { editingId = null; draw(); },
        onSubmit: async (card) => {
          const row = await updateExperience(ex.id, card);
          list = list.map((x) => (x.id === ex.id ? row : x));
          editingId = null;
          draw(); changed();
        },
      });
    }
    return h('div', { class: 'exp-card' },
      h('span', { class: 'exp-card__icon', title: EXP_KINDS[ex.kind]?.label }, EXP_KINDS[ex.kind]?.icon ?? '📁'),
      h('div', { class: 'grow' },
        h('div', { class: 'exp-card__title' }, ex.title,
          h('span', { class: 'exp-card__level', title: EXP_LEVELS[ex.level] }, ` ${levelDots(ex.level)} ${EXP_LEVELS[ex.level] ?? ''}`)),
        ex.detail && h('div', { class: 'small muted' }, ex.detail),
        (ex.tags ?? []).length > 0 && h('div', { class: 'row row--wrap', style: { marginTop: '4px' } },
          ex.tags.map((t) => h('span', { class: 'chip chip--sm' }, `#${t}`)))),
      h('button', { class: 'icon-btn', title: '수정', 'aria-label': '경험 카드 수정', onclick: () => { editingId = ex.id; draw(); } }, '✏️'),
      h('button', {
        class: 'icon-btn', title: '삭제', 'aria-label': '경험 카드 삭제',
        onclick: async () => {
          try {
            await deleteExperience(ex.id);
            list = list.filter((x) => x.id !== ex.id);
            draw(); changed();
          } catch { /* 토스트 처리됨 */ }
        },
      }, '✕'));
  }

  function draw() {
    if (!loaded) return el.replaceChildren(h('div', { class: 'empty' }, spinner()));
    const addForm = editingId === null && cardForm({}, {
      submitText: '＋ 경험 추가',
      onSubmit: async (card) => {
        const row = await addExperience(card);
        list = [...list, row];
        draw(); changed();
        toast('경험 카드를 추가했어요.');
      },
    });
    el.replaceChildren(
      list.length === 0
        ? h('p', { class: 'small faint' }, '아직 경험 카드가 없어요. 잘하는 것, 해 본 것을 하나씩 적어 주세요.')
        : h('div', { class: 'exp-list' }, list.map(cardEl)),
      addForm && h('div', { class: 'exp-add' },
        h('div', { class: 'small muted', style: { margin: '8px 0 4px' } }, '빠른 입력'),
        h('div', { class: 'row row--wrap', style: { marginBottom: '8px' } },
          EXP_EXAMPLES.map((ex) => h('button', {
            class: 'chip', type: 'button',
            onclick: () => addForm._fill(ex),
          }, `${EXP_KINDS[ex.kind].icon} ${ex.title}`))),
        addForm),
    );
  }

  draw();
  load();
  return { el, get list() { return list; } };
}
