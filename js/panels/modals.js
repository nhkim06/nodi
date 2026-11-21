import { icon } from '../utils/icons.js';
// 모달: 공통 틀 + 문서 업로드, AI 생성, 점검 결과, 역할 추천, 링크, 칭찬, 막힘 도움
import { h, toast, spinner } from '../utils/dom.js';
import { getState, setState, rootNode } from '../store.js';
import { extractText, ACCEPT } from '../utils/pdf.js';
import { saveDoc, reloadRequirements } from '../api/docs.js';
import { runAI } from '../api/ai.js';
import { addAssignee } from '../api/assignees.js';
import { addLink } from '../api/links.js';
import { sendPraise, PRAISE_TAGS } from '../api/praises.js';
import { sendHelpRequest, refreshTemperatures } from '../realtime.js';
import { LINK_KINDS, REQ_CATEGORIES, avatar } from '../utils/color.js';
import { reqLabelMap } from '../canvas/bubbles.js';
import { aiGenerate, aiConcretize, revealNode, addNodeFromComment, selectOnly } from '../actions.js';
import { savePlan } from '../api/plans.js';
import { expLabelMap, expChip } from '../utils/experience.js';
import { experienceEditor, skipOnboarding, onboardingSkipped } from './experiences.js';

// 공통 ---------------------------------------------------------------------------
export function openModal({ title, body, footer = [], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  const close = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  const modal = h('div', { class: ['modal', wide && 'modal--wide'], role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal__head' },
      h('div', { class: 'modal__title' }, title),
      h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'modal__body' }, body),
    footer.length > 0 && h('div', { class: 'modal__foot' }, footer),
  );
  const backdrop = h('div', { class: 'modal-backdrop', onpointerdown: (e) => { if (e.target === backdrop) close(); } }, modal);
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey, true);
  setTimeout(() => modal.querySelector('input, textarea, select, button.btn--primary')?.focus(), 0);
  return { close, modal };
}

export function confirmModal(message, { okText = '확인', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const cancelBtn = h('button', { class: 'btn', onclick: () => m.close() }, '취소');
    const okBtn = h('button', { class: ['btn', danger ? 'btn--danger' : 'btn--primary'], onclick: () => { result = true; m.close(); } }, okText);
    // Enter = 확인 (취소 버튼에 포커스가 있으면 취소)
    const onEnter = (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement === cancelBtn) m.close();
      else okBtn.click();
    };
    const m = openModal({
      title: '확인',
      body: h('p', { style: { whiteSpace: 'pre-wrap' } }, message),
      footer: [cancelBtn, okBtn],
      onClose: () => { window.removeEventListener('keydown', onEnter, true); resolve(result); },
    });
    window.addEventListener('keydown', onEnter, true);
    setTimeout(() => okBtn.focus(), 0);
  });
}

/** 오래 걸리는 AI 작업용 진행 모달 (단계 문구가 바뀜) */
export function progressModal(title, steps) {
  const label = h('span', {}, steps[0]);
  let i = 0;
  const timer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    label.textContent = steps[i];
  }, 4000);
  const m = openModal({
    title,
    body: [h('div', { class: 'progress-msg' }, spinner(), label),
      h('p', { class: 'small muted' }, '10~30초 정도 걸릴 수 있어요. 창을 닫아도 결과는 저장돼요.')],
    onClose: () => clearInterval(timer),
  });
  return { close: () => { clearInterval(timer); m.close(); } };
}

// 📄 과제 문서 업로드 + 분석 ----------------------------------------------------------
export function openDocModal() {
  let file = null;
  const fileInput = h('input', { type: 'file', accept: ACCEPT, hidden: true });
  const status = h('div', { class: 'small muted', style: { minHeight: '20px' } });
  const textArea = h('textarea', {
    class: 'textarea', rows: '12', placeholder: '과제 공지/요구사항 텍스트를 붙여넣거나, 위에서 파일을 올리면 추출된 텍스트가 여기에 보여요.\n(HWP는 PDF로 저장해서 올려 주세요)',
  });
  const zone = h('div', { class: 'drop-zone', tabindex: '0', onclick: () => fileInput.click() },
    'PDF / DOCX / TXT / MD 파일을 끌어다 놓거나 클릭해서 선택');

  const pick = async (f) => {
    if (!f) return;
    status.replaceChildren(spinner(), ' 텍스트를 추출하는 중...');
    try {
      const text = await extractText(f);
      file = f;
      textArea.value = text;
      status.textContent = `✓ ${f.name} — ${text.length.toLocaleString()}자 추출됨. 아래 내용을 확인하고 분석을 시작하세요.`;
    } catch (e) {
      file = null;
      status.textContent = e.message;
    }
  };
  fileInput.addEventListener('change', () => pick(fileInput.files[0]));
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop-zone--over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-zone--over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drop-zone--over');
    pick(e.dataTransfer.files[0]);
  });
  textArea.addEventListener('input', () => { if (!textArea.value.trim()) file = null; });

  const submit = h('button', { class: 'btn btn--primary' }, icon('sparkles'), '요구사항 분석');
  const m = openModal({
    title: '과제 문서 올리기',
    wide: true,
    body: [zone, fileInput, status, h('div', { class: 'field', style: { marginTop: '8px' } }, h('label', {}, '추출된 텍스트 (수정 가능)'), textArea)],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), submit],
  });

  submit.addEventListener('click', async () => {
    const text = textArea.value.trim();
    if (text.length < 20) return toast('과제 공지 내용을 20자 이상 넣어 주세요.', { type: 'error' });
    submit.disabled = true;
    submit.replaceChildren(spinner(), ' 저장 중...');
    let doc;
    try {
      // 원본 파일은 Storage 에, 사용자가 확인/수정한 텍스트는 extracted_text 로 저장
      doc = await saveDoc({ file, text, fileName: file?.name });
    } catch {
      submit.disabled = false;
      submit.replaceChildren(icon('sparkles'), '요구사항 분석');
      return;
    }
    m.close();
    await analyzeDoc(doc.id);
  });
}

export async function analyzeDoc(docId) {
  const progress = progressModal('과제 문서 분석 중', [
    '문서를 읽는 중...',
    '요구사항을 찾는 중...',
    '마감일·분량·평가 비율을 확인하는 중...',
    '요구사항을 정리하는 중...',
  ]);
  try {
    const res = await runAI('analyze_doc', { docId });
    await reloadRequirements();
    setState({ docs: getState().docs.map((d) => (d.id === docId ? { ...d, analyzed_at: new Date().toISOString() } : d)) });
    progress.close();
    toast(`요구사항 ${res.requirements?.length ?? 0}개를 추출했어요.${res.truncated ? ' (문서가 너무 길어 뒷부분은 생략됐어요)' : ''}`, { duration: 4000 });
    if (res.summary) {
      const project = getState().project;
      if (!project.description) setState({ project: { ...project, description: res.summary } });
    }
  } catch {
    progress.close();
  }
}

// ✨ AI 아이디어 생성 -------------------------------------------------------------
export function openGenerateModal(parentIds) {
  const { nodes } = getState();
  const ids = (parentIds ?? []).filter((id) => nodes.has(id));
  const targets = ids.length ? ids : [rootNode()?.id].filter(Boolean);
  const count = h('select', { class: 'select' }, [3, 5, 8].map((n) => h('option', { value: String(n) }, `${n}개`)));
  count.value = '5';
  const hint = h('input', { class: 'input', maxlength: '200', placeholder: '예) 수익모델 위주로, 더 엉뚱하게, 사용자 조사 방법' });
  const go = () => { m.close(); aiGenerate(targets, { count: Number(count.value), hint: hint.value.trim() }); };
  hint.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) go(); });
  const m = openModal({
    title: [icon('sparkles'), 'AI 아이디어 생성'],
    body: [
      h('p', { class: 'small muted', style: { marginBottom: '12px' } },
        '부모 노드: ', targets.map((id) => nodes.get(id)?.title).join(', ')),
      h('div', { class: 'field' }, h('label', {}, '부모마다 몇 개?'), count),
      h('div', { class: 'field' }, h('label', {}, '원하는 방향 (선택)'), hint),
    ],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn btn--primary', onclick: go }, '생성')],
  });
}

// 🔍 전체 점검 결과 -------------------------------------------------------------
export function showReviewResult(res) {
  const { requirements, nodes } = getState();
  const reqMap = reqLabelMap(requirements);
  const covIcon = { covered: '충분', partial: '일부', missing: '없음' };
  const gaps = (res.comments ?? []).filter((c) => c.kind === 'gap');
  const capGaps = res.capability_gaps ?? [];
  const { members } = getState();

  const m = openModal({
    title: [icon('search'), '전체 점검 결과'],
    wide: true,
    body: [
      res.summary && h('div', { class: 'summary-box' }, res.summary),
      h('div', { class: 'card__title', style: { marginTop: '8px' } }, '요구사항 커버리지'),
      !res.coverage?.length
        ? h('p', { class: 'muted small' }, '요구사항이 없어요. 과제 문서를 먼저 올려 주세요.')
        : h('div', {}, res.coverage.map((c) => {
          const r = reqMap.get(c.requirement_id);
          return h('div', { class: 'cov-row' },
            h('span', { class: ['req__cov', `req__cov--${c.status}`], title: covIcon[c.status] }),
            h('div', { class: 'grow' },
              h('div', {}, h('b', {}, `${r?.label ?? ''} `), r?.content ?? ''),
              h('div', { class: 'small muted' }, `${covIcon[c.status]} — ${c.reason}`),
              c.node_ids.length > 0 && h('div', { class: 'row row--wrap', style: { marginTop: '4px' } },
                c.node_ids.filter((id) => nodes.has(id)).map((id) => h('button', {
                  class: 'chip', onclick: () => { m.close(); revealNode(id); },
                }, nodes.get(id).title))),
            ));
        })),
      capGaps.length > 0 && h('div', { class: 'card__title', style: { marginTop: '16px' } }, '팀 역량 공백'),
      capGaps.map((g) => {
        const targets = g.node_ids.filter((id) => nodes.has(id));
        return h('div', { class: 'check-row', style: { cursor: 'default' } },
          h('div', { class: 'grow' },
            h('b', {}, g.skill),
            h('div', { class: 'small muted' }, g.mitigation),
            g.learner_ids.length > 0 && h('div', { class: 'small faint' }, '배우면 좋을 팀원: ',
              g.learner_ids.map((id) => members.get(id)?.profile?.display_name).filter(Boolean).join(', ')),
            targets.length > 0 && h('div', { class: 'row row--wrap', style: { marginTop: '4px' } },
              targets.map((id) => h('button', { class: 'chip', onclick: () => { m.close(); revealNode(id); } }, nodes.get(id).title)))),
          targets.length > 0 && h('button', {
            class: 'btn btn--sm',
            onclick: (e) => { e.target.disabled = true; m.close(); selectOnly(targets[0]); aiConcretize(targets[0]); },
          }, '이 노드 다시 구체화'));
      }),
      gaps.length > 0 && h('div', { class: 'card__title', style: { marginTop: '16px' } }, '빠진 부분'),
      gaps.map((g) => h('div', { class: 'check-row', style: { cursor: 'default' } },
        h('div', { class: 'grow' },
          h('b', {}, g.content.split('\n')[0]),
          h('div', { class: 'small muted' }, g.content.split('\n').slice(1).join(' ')),
          h('div', { class: 'small faint' }, '추가 위치: ', nodes.get(g.node_id)?.title ?? '루트')),
        h('button', { class: 'btn btn--sm', onclick: (e) => { e.target.disabled = true; addNodeFromComment(g); } }, '＋ 노드로 추가'))),
      h('p', { class: 'small faint', style: { marginTop: '12px' } }, '노드별 코멘트는 캔버스의 말풍선으로 표시돼요. 커버리지는 사이드바 요구사항 옆 점으로도 볼 수 있어요.'),
    ],
    footer: [h('button', { class: 'btn btn--primary', onclick: () => m.close() }, '확인')],
  });
}

// 👥 역할 분담 추천 결과 ---------------------------------------------------------
export function showRolesResult(res) {
  const { nodes, members } = getState();
  const rows = (res.assignments ?? []).filter((a) => nodes.has(a.node_id));
  const checks = [];
  const expMap = expLabelMap(getState());

  const body = [
    res.balance_note && h('div', { class: 'summary-box' }, res.balance_note),
    !rows.length && h('p', { class: 'muted' }, '추천 결과가 없어요.'),
    rows.map((a) => a.user_ids.filter((uid) => members.has(uid)).map((uid) => {
      const cb = h('input', { type: 'checkbox', checked: true });
      checks.push({ cb, nodeId: a.node_id, userId: uid });
      return h('label', { class: 'check-row' }, cb,
        h('div', { class: 'grow' },
          h('div', { class: 'row' }, h('b', {}, nodes.get(a.node_id).title), h('span', { class: 'muted' }, '→'),
            avatar(members.get(uid)), h('span', {}, members.get(uid).profile?.display_name ?? '')),
          h('div', { class: 'small muted' }, a.reason),
          (a.experience_ids ?? []).length > 0 && h('div', { class: 'bubble__refs' },
            a.experience_ids.map((id) => expChip(expMap.get(id))))));
    })),
    rows.length > 0 && h('p', { class: 'small faint', style: { marginTop: '8px' } }, 'AI는 제안만 해요. 팀원과 상의한 뒤 적용할 항목만 체크하세요.'),
  ];

  const apply = h('button', { class: 'btn btn--primary', disabled: !rows.length }, '선택 항목 적용');
  const m = openModal({
    title: [icon('users'), '역할 분담 추천'], wide: true, body,
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '닫기'), apply],
  });
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    let n = 0;
    for (const { cb, nodeId, userId } of checks) {
      if (!cb.checked) continue;
      try { if (await addAssignee(nodeId, userId)) n++; } catch { /* 토스트 처리됨 */ }
    }
    m.close();
    toast(`담당자 ${n}건을 지정했어요.`);
  });
}

// 🔗 링크 추가 --------------------------------------------------------------------
export function openLinkModal(nodeId = null) {
  const kind = h('select', { class: 'select' }, Object.entries(LINK_KINDS).map(([k, v]) => h('option', { value: k }, v.label)));
  const title = h('input', { class: 'input', maxlength: '80', placeholder: '예) 1차 회의록' });
  const url = h('input', { class: 'input', type: 'url', placeholder: 'https://' });
  url.addEventListener('input', () => {
    const v = url.value;
    if (/notion\.(so|site)/.test(v)) kind.value = 'notion';
    else if (/figma\.com/.test(v)) kind.value = 'figma';
    else if (/github\.com/.test(v)) kind.value = 'github';
    else if (/drive\.google|docs\.google/.test(v)) kind.value = 'drive';
  });
  const node = nodeId ? getState().nodes.get(nodeId) : null;
  const save = async () => {
    const u = url.value.trim();
    if (!/^https?:\/\//i.test(u)) return toast('http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.', { type: 'error' });
    const t = title.value.trim() || new URL(u).hostname;
    try {
      await addLink({ kind: kind.value, title: t.slice(0, 80), url: u, node_id: nodeId });
      m.close();
    } catch { /* 토스트 처리됨 */ }
  };
  const m = openModal({
    title: [icon('link'), '작업 링크 추가'],
    body: [
      node && h('p', { class: 'small muted', style: { marginBottom: '8px' } }, `연결할 노드: ${node.title}`),
      h('div', { class: 'field' }, h('label', {}, '주소'), url),
      h('div', { class: 'field' }, h('label', {}, '제목'), title),
      h('div', { class: 'field' }, h('label', {}, '종류'), kind),
    ],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn btn--primary', onclick: save }, '추가')],
  });
  setTimeout(() => url.focus(), 0);
}

// 👏 칭찬 ----------------------------------------------------------------------
export function openPraiseModal(toUser = null) {
  const { members, user, project } = getState();
  const others = [...members.values()].filter((m) => m.user_id !== user.id);
  if (!others.length) return toast('아직 팀원이 없어요. 설정에서 초대 링크를 공유해 주세요!');

  const who = h('select', { class: 'select' }, others.map((m) => h('option', { value: m.user_id }, m.profile?.display_name ?? '팀원')));
  if (toUser && members.has(toUser) && toUser !== user.id) who.value = toUser;
  let tag = '';
  const tagBtns = PRAISE_TAGS.map((t) => {
    const b = h('button', { class: 'chip', type: 'button', onclick: () => {
      tag = tag === t ? '' : t;
      tagBtns.forEach((x) => x.classList.toggle('btn--active', x.textContent === tag));
    } }, t);
    return b;
  });
  const msg = h('textarea', { class: 'textarea', maxlength: '200', rows: '3', placeholder: '(선택) 예) 회의록 정리해줘서 고마워!' });
  const send = async () => {
    const message = msg.value.trim();
    try {
      await sendPraise({ projectId: project.id, toUser: who.value, message, tag });
      m.close();
      toast('좋아요를 보냈어요! 칭찬 온도가 올라가요.');
      refreshTemperatures(project.id);
    } catch { /* 토스트 처리됨 */ }
  };
  const m = openModal({
    title: [icon('heart'), '팀원에게 좋아요 보내기'],
    body: [
      h('div', { class: 'field' }, h('label', {}, '누구를?'), who),
      h('div', { class: 'field' }, h('label', {}, '태그 (선택)'), h('div', { class: 'row row--wrap' }, tagBtns)),
      h('div', { class: 'field' }, h('label', {}, '메시지 (선택)'), msg),
      h('p', { class: 'small faint' }, '같은 팀원에게는 하루 한 번 보낼 수 있어요. 좋아요 1번에 +0.3℃!'),
    ],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn btn--primary', onclick: send }, icon('heart'), '보내기')],
  });
}

// 🔴 막힘 도움 (A7) ----------------------------------------------------------------
export async function openHelpModal(message) {
  if (!message?.trim()) return toast('어디서 막혔는지 신호등 메시지에 먼저 적어 주세요.', { type: 'error' });
  const progress = progressModal('AI가 도울 방법을 찾는 중', ['담당 작업을 살펴보는 중...', '해결 힌트를 정리하는 중...']);
  let res;
  try {
    res = await runAI('help_blocked', { message });
  } catch {
    progress.close();
    return;
  }
  progress.close();
  const { members } = getState();
  const helpers = (res.helpers ?? []).filter((id) => members.has(id));
  const m = openModal({
    title: [icon('warning'), '막힘 도움'],
    body: [
      h('div', { class: 'card__title' }, icon('bulb'), '이렇게 해 보세요'),
      h('ol', { style: { paddingLeft: '20px', margin: '0 0 12px' } }, (res.tips ?? []).map((t) => h('li', { style: { marginBottom: '6px' } }, t))),
      helpers.length > 0 && [
        h('div', { class: 'card__title' }, icon('users'), '도와줄 수 있는 팀원'),
        res.helper_reason && h('p', { class: 'small muted', style: { marginBottom: '8px' } }, res.helper_reason),
        helpers.map((uid) => h('div', { class: 'row', style: { marginBottom: '6px' } },
          avatar(members.get(uid)), h('span', { class: 'grow' }, members.get(uid).profile?.display_name ?? '팀원'),
          h('button', { class: 'btn btn--sm', onclick: (e) => {
            sendHelpRequest(uid, message);
            e.target.disabled = true;
            e.target.textContent = '요청 보냄';
            toast('도움 요청을 보냈어요.');
          } }, '도움 요청'))),
      ],
    ],
    footer: [h('button', { class: 'btn btn--primary', onclick: () => m.close() }, '확인')],
  });
}

// 🙋 경험 카드 (F16) ----------------------------------------------------------------
/** onboarding=true: 프로젝트에 처음 들어왔을 때 (건너뛰기 가능) */
export function openExperienceModal({ onboarding = false } = {}) {
  const { user } = getState();
  const editor = experienceEditor({ userId: user.id });
  const m = openModal({
    title: onboarding ? '우리 팀 AI가 실행 가능한 범위를 정하려면 경험이 필요해요' : '내 경험 카드',
    wide: true,
    body: [
      h('p', { class: 'small muted', style: { marginBottom: '8px' } },
        '해 본 것, 잘하는 것을 카드로 남겨 주세요. AI가 아이디어의 조사 방법과 구현 범위(MVP / 범위 밖), 역할 추천을 정할 때 근거로 써요. ',
        '한 번 입력하면 다른 팀플에서도 그대로 쓰이고, 같은 프로젝트 팀원에게만 보여요.'),
      editor.el,
    ],
    footer: [
      onboarding && h('button', { class: 'btn', onclick: () => { skipOnboarding(user.id); m.close(); } }, '나중에 할게요'),
      h('button', { class: 'btn btn--primary', onclick: () => m.close() }, '완료'),
    ].filter(Boolean),
  });
}

export { onboardingSkipped };

// ✏️ 실행 계획 직접 수정 (F15) ----------------------------------------------------------
/**
 * 반복 행 편집기. fields: [{ key, placeholder, wide }]
 * 기존 객체의 다른 필드(experience_ids, owner_ids 등)는 그대로 보존한다.
 */
function rowsEditor(items, fields, addText) {
  const wrap = h('div', { class: 'rows-editor' });
  const rows = [];
  const addRow = (item = {}) => {
    const inputs = fields.map((f) => h('input', {
      class: ['input', f.wide && 'grow'], placeholder: f.placeholder, value: item[f.key] ?? '', maxlength: '300',
    }));
    const row = h('div', { class: 'row rows-editor__row' }, inputs,
      h('button', { class: 'icon-btn', type: 'button', title: '삭제', onclick: () => { row.remove(); rows.splice(rows.indexOf(entry), 1); } }, '✕'));
    const entry = { item, inputs };
    rows.push(entry);
    list.append(row);
  };
  const list = h('div', {});
  items.forEach(addRow);
  wrap.append(list, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => addRow() }, addText));
  return {
    el: wrap,
    value: () => rows
      .map(({ item, inputs }) => ({ ...item, ...Object.fromEntries(fields.map((f, i) => [f.key, inputs[i].value.trim()])) }))
      .filter((x) => x[fields[0].key]),
  };
}

export function openPlanEditModal(nodeId) {
  const { nodes, plans } = getState();
  const node = nodes.get(nodeId);
  if (!node) return;
  const plan = plans.get(nodeId);
  const base = plan && !plan._empty ? plan : {};
  const scope = base.scope ?? {};

  const feas = h('select', { class: 'select' },
    h('option', { value: '' }, '미정'),
    [5, 4, 3, 2, 1].map((n) => h('option', { value: String(n) }, `${'●'.repeat(n)}${'○'.repeat(5 - n)} ${n}점`)));
  feas.value = base.feasibility ? String(base.feasibility) : '';
  const note = h('input', { class: 'input', maxlength: '300', value: base.feasibility_note ?? '', placeholder: '점수 근거 한 줄 (예: Figma 숙련자 2명, 설문 경험 1명)' });
  const methods = rowsEditor(base.research_methods ?? [],
    [{ key: 'method', placeholder: '조사 방법 (예: 대학생 30명 구글폼 설문)', wide: true }, { key: 'why', placeholder: '이유', wide: true }], '＋ 조사 방법');
  const scopeFields = [{ key: 'item', placeholder: '항목', wide: true }, { key: 'why', placeholder: '이유', wide: true }];
  const mvp = rowsEditor(scope.mvp ?? [], scopeFields, '＋ MVP 항목');
  const stretch = rowsEditor(scope.stretch ?? [], scopeFields, '＋ 여유 있으면');
  const out = rowsEditor(scope.out_of_scope ?? [], scopeFields, '＋ 범위 밖');
  const risks = rowsEditor(base.risks ?? [],
    [{ key: 'risk', placeholder: '리스크 (예: 데이터 분석 경험 없음)', wide: true }, { key: 'mitigation', placeholder: '대응책', wide: true }], '＋ 리스크');

  const save = h('button', { class: 'btn btn--primary' }, '저장');
  const m = openModal({
    title: [icon('edit'), `실행 계획 — ${node.title}`],
    wide: true,
    body: [
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, '실행 가능성'), feas), h('div', { class: 'field grow' }, h('label', {}, '근거'), note)),
      h('div', { class: 'field' }, h('label', {}, '조사 방법'), methods.el),
      h('div', { class: 'field' }, h('label', {}, 'MVP (반드시)'), mvp.el),
      h('div', { class: 'field' }, h('label', {}, '여유 있으면'), stretch.el),
      h('div', { class: 'field' }, h('label', {}, '범위 밖 (이번엔 안 함)'), out.el),
      h('div', { class: 'field' }, h('label', {}, icon('warning'), '리스크'), risks.el),
      h('p', { class: 'small faint' }, '직접 수정한 계획은 AI가 다시 구체화하기 전에 덮어쓸지 확인해요.'),
    ],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), save],
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await savePlan(nodeId, {
        feasibility: feas.value ? Number(feas.value) : null,
        feasibility_note: note.value.trim(),
        research_methods: methods.value(),
        scope: { mvp: mvp.value(), stretch: stretch.value(), out_of_scope: out.value() },
        risks: risks.value(),
      });
      m.close();
      toast('실행 계획을 저장했어요.');
    } catch {
      save.disabled = false;
    }
  });
}

// ✏️ 요구사항 추가 ---------------------------------------------------------------
export function openRequirementModal(onSave) {
  const cat = h('select', { class: 'select' }, Object.entries(REQ_CATEGORIES).map(([k, v]) => h('option', { value: k }, v)));
  const imp = h('select', { class: 'select' }, [[3, '필수'], [2, '중요'], [1, '보통']].map(([v, l]) => h('option', { value: String(v) }, l)));
  imp.value = '2';
  const content = h('textarea', { class: 'textarea', maxlength: '500', rows: '3', placeholder: '예) 발표는 10분 이내' });
  const save = async () => {
    if (!content.value.trim()) return;
    try {
      await onSave({ category: cat.value, importance: Number(imp.value), content: content.value.trim() });
      m.close();
    } catch { /* 토스트 처리됨 */ }
  };
  const m = openModal({
    title: '요구사항 추가',
    body: [
      h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('label', {}, '분류'), cat), h('div', { class: 'field grow' }, h('label', {}, '중요도'), imp)),
      h('div', { class: 'field' }, h('label', {}, '내용'), content),
    ],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn btn--primary', onclick: save }, '추가')],
  });
  setTimeout(() => content.focus(), 0);
}
