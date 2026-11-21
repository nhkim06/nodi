// Supabase 호출 공통 처리: 에러는 토스트로, 원본은 콘솔로
import { toast } from '../utils/dom.js';

const KNOWN = [
  [/invalid invite code/i, '초대코드가 올바르지 않아요.'],
  [/root node cannot be deleted/i, '프로젝트 주제(루트) 노드는 삭제할 수 없어요.'],
  [/root node cannot be moved/i, '루트 노드는 옮길 수 없어요.'],
  [/cycle detected/i, '노드를 자기 하위로 옮길 수 없어요.'],
  [/not authenticated|JWT/i, '로그인이 만료됐어요. 다시 로그인해 주세요.'],
  [/row-level security|permission denied/i, '권한이 없어요.'],
  [/Failed to fetch|NetworkError/i, '네트워크 연결을 확인해 주세요.'],
];

export function friendlyError(error, fallback = '요청에 실패했어요.') {
  const msg = error?.message ?? String(error ?? '');
  for (const [re, text] of KNOWN) if (re.test(msg)) return text;
  return fallback;
}

/**
 * const data = await q(supabase.from(...).select(), '불러오지 못했어요');
 * opts.silent: 토스트 없이 throw 만
 * opts.messages: { [postgresCode]: '문구' }  예) { 23505: '이미 있어요' }
 */
export async function q(promise, fallback, opts = {}) {
  const { data, error } = await promise;
  if (error) {
    console.error(error);
    if (!opts.silent) {
      const special = opts.messages?.[error.code];
      toast(special ?? friendlyError(error, fallback), { type: 'error' });
    }
    throw error;
  }
  return data;
}
