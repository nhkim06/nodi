// 팀원 경험 카드 표시 유틸 + E 번호 매기기
// E 번호 규칙은 서버(supabase/functions/ai/context.ts)와 반드시 같아야 AI 텍스트 속 'E3'이 같은 카드를 가리킨다.
//   팀원: 가입순(joined_at) → user_id / 팀원 안에서: 숙련도 높은 순 → 만든 순 → id, 팀원당 최대 6개
import { h } from './dom.js';

export const EXP_KINDS = {
  project: { label: '프로젝트', icon: '📁' },
  research: { label: '조사·리서치', icon: '🔍' },
  tool: { label: '도구·기술', icon: '🛠️' },
  domain: { label: '도메인 지식', icon: '📚' },
  role: { label: '역할', icon: '🎤' },
};

export const EXP_LEVELS = { 1: '해봤음', 2: '혼자 할 수 있음', 3: '가르칠 수 있음' };

/** 온보딩 / 빠른 입력용 예시 칩 */
export const EXP_EXAMPLES = [
  { kind: 'research', title: '설문조사 설계·분석', tags: ['설문'] },
  { kind: 'research', title: '사용자 인터뷰', tags: ['인터뷰'] },
  { kind: 'tool', title: 'Figma 프로토타이핑', tags: ['figma'] },
  { kind: 'tool', title: '웹 개발 (HTML/JS)', tags: ['웹개발'] },
  { kind: 'tool', title: '영상 편집', tags: ['영상'] },
  { kind: 'tool', title: '엑셀 데이터 분석', tags: ['엑셀'] },
  { kind: 'role', title: '발표', tags: ['발표'] },
  { kind: 'role', title: '보고서·문서 작성', tags: ['문서'] },
];

const MAX_EXP_PER_MEMBER = 6;

export function sortExperiences(list) {
  return [...list]
    .sort((a, b) => b.level - a.level || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(0, MAX_EXP_PER_MEMBER);
}

export function sortedMembers(members) {
  return [...members.values()].sort((a, b) =>
    a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id));
}

/** expId -> { label:'E3', exp, member } — 서버와 같은 순서로 번호를 매긴다 */
export function expLabelMap(s) {
  const out = new Map();
  let k = 0;
  for (const m of sortedMembers(s.members)) {
    for (const ex of sortExperiences(s.experiences.get(m.user_id) ?? [])) {
      out.set(ex.id, { label: `E${++k}`, exp: ex, member: m });
    }
  }
  return out;
}

/** 'E3' -> expLabelMap 항목 */
export function expByLabel(map) {
  const out = new Map();
  for (const v of map.values()) out.set(v.label, v);
  return out;
}

export const levelDots = (level, max = 3) => '●'.repeat(level) + '○'.repeat(Math.max(0, max - level));

export function expTooltip(ex, member) {
  return [
    member ? `${member.profile?.display_name ?? '팀원'} · ` : '',
    `[${EXP_KINDS[ex.kind]?.label ?? ex.kind}] ${ex.title} (${EXP_LEVELS[ex.level] ?? ex.level})`,
    ex.detail ? `\n${ex.detail}` : '',
  ].join('');
}

/** 근거 경험 칩 'E3' (hover: 카드 내용) */
export function expChip(entry) {
  if (!entry) return null;
  return h('span', { class: 'ref-chip ref-chip--exp', title: expTooltip(entry.exp, entry.member) }, entry.label);
}

/** 근거 요구사항 칩 'R2' (hover: 요구사항 원문) */
export function reqChip(r) {
  if (!r) return null;
  return h('span', { class: 'ref-chip', title: r.content }, r.label);
}

/** 팀 경험 중 가장 최근 수정 시각 (실행 계획 stale 판단용) */
export function latestExperienceUpdate(s) {
  let latest = '';
  for (const m of s.members.keys()) {
    for (const ex of s.experiences.get(m) ?? []) if (ex.updated_at > latest) latest = ex.updated_at;
  }
  return latest || null;
}

export const totalExperiences = (s) => [...s.members.keys()].reduce((n, id) => n + (s.experiences.get(id)?.length ?? 0), 0);
