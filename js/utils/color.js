// 색상/표시 유틸
import { h } from './dom.js';

export const initials = (name = '?') => {
  const s = name.trim();
  if (!s) return '?';
  // 한글 이름이면 성을 뺀 앞 글자, 영문이면 첫 글자
  if (/^[가-힣]{2,4}$/.test(s)) return s.slice(1, 2);
  return s[0].toUpperCase();
};

export function avatar(member, { size } = {}) {
  const name = member?.profile?.display_name ?? '?';
  return h('span', {
    class: 'avatar',
    title: name,
    style: { background: member?.color ?? 'var(--text-faint)', ...(size ? { width: `${size}px`, height: `${size}px` } : {}) },
  }, initials(name));
}

export const SIGNALS = {
  green: { label: '진행 중', emoji: '🟢' },
  yellow: { label: '쉬는 중', emoji: '🟡' },
  red: { label: '막힘·도움 필요', emoji: '🔴' },
  off: { label: '오프라인', emoji: '⚪' },
};

export const STATUS = {
  considering: '고민중',
  adopted: '채택',
  discarded: '버림',
};

export const TASK_STATES = { todo: '할 일', doing: '진행 중', done: '완료' };

export const LINK_KINDS = {
  notion: { label: 'Notion', icon: '📝' },
  meeting: { label: '회의록', icon: '🗒️' },
  figma: { label: 'Figma', icon: '🎨' },
  github: { label: 'GitHub', icon: '🐙' },
  drive: { label: '드라이브', icon: '📁' },
  other: { label: '기타', icon: '🔗' },
};

export const REQ_CATEGORIES = {
  topic: '주제', deliverable: '제출물', constraint: '제약', criteria: '평가기준', deadline: '일정', etc: '기타',
};
export const IMPORTANCE = { 3: '필수', 2: '중요', 1: '보통' };

export const BUBBLE_KINDS = {
  praise: { icon: '👍', label: '잘한 점' },
  warning: { icon: '⚠️', label: '주의' },
  suggestion: { icon: '💡', label: '제안' },
  feedback: { icon: '💬', label: '피드백' },
  gap: { icon: '🧩', label: '빠진 부분' },
};

/** 담당자 신호등 표시가 오래된 green 이면 '자리 비움?' 으로 보정 */
export function effectiveSignal(member) {
  if (!member) return 'off';
  if (member.signal === 'green') {
    const age = Date.now() - new Date(member.signal_changed_at).getTime();
    if (age > 3 * 3600_000) return 'stale';
  }
  return member.signal;
}
