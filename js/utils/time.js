// 날짜/시간 유틸 (한국 시간 기준)

/** 오늘 날짜 'YYYY-MM-DD' (KST) */
export function todayKST(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

/** '지난 프로젝트'인지: 종료 처리했거나 마감일이 지났으면 true (HOME 프로젝트 현황) */
export const isPastProject = (p) => !!p.completed_at || (!!p.due_date && p.due_date < todayKST());

/** 마감일까지 D-day 라벨 */
export function dday(dateStr) {
  if (!dateStr) return null;
  const today = new Date(todayKST() + 'T00:00:00Z');
  const due = new Date(dateStr + 'T00:00:00Z');
  const diff = Math.round((due - today) / 86400_000);
  if (diff === 0) return { label: 'D-DAY', days: 0 };
  return { label: diff > 0 ? `D-${diff}` : `D+${-diff}`, days: diff };
}

/** 초 → '1시간 23분' */
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분`;
  return sec ? '1분 미만' : '0분';
}

/** '방금 전', '3분 전', '2일 전' */
export function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '');
