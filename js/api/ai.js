// Edge Function 'ai' 호출 래퍼 + AI 코멘트 로컬 반영
import { supabase } from '../supabase.js';
import { getState, mutate, PROJECT_KEY } from '../store.js';
import { toast } from '../utils/dom.js';

const inflight = new Map();

/**
 * 같은 action + 대상의 중복 요청은 같은 Promise 를 돌려준다.
 * opts.quietStatuses: 토스트 없이 throw 만 할 HTTP 상태 (예: 409 덮어쓰기 확인)
 * 실패 시 throw 하는 에러에는 { status, handled } 가 붙는다.
 */
export function runAI(action, payload = {}, opts = {}) {
  const key = `${action}:${JSON.stringify(payload)}`;
  if (inflight.has(key)) return inflight.get(key);

  const p = supabase.functions
    .invoke('ai', { body: { action, projectId: getState().project.id, ...payload } })
    .then(async ({ data, error }) => {
      if (error) {
        const status = error.context?.status ?? 0;
        let message = 'AI 요청 처리 중 오류가 발생했어요.';
        try {
          const body = await error.context?.json?.();
          if (body?.error) message = body.error;
        } catch { /* 본문 없음 */ }
        if (!status && /Failed to send|fetch/i.test(error.message ?? '')) {
          message = 'AI 서버에 연결하지 못했어요. Edge Function 배포 상태를 확인해 주세요.';
        }
        const quiet = (opts.quietStatuses ?? []).includes(status);
        if (!quiet) {
          console.error(action, error);
          toast(message, { type: 'error', duration: 4000 });
        }
        throw Object.assign(new Error(message), { handled: !quiet, status });
      }
      return data;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

export const isRunning = (action, payload = {}) => inflight.has(`${action}:${JSON.stringify(payload)}`);

/** AI 처리 중 표시 (노드 스피너) */
export async function withBusy(nodeIds, fn) {
  mutate('aiBusy', (s) => nodeIds.forEach((id) => s.add(id)));
  try {
    return await fn();
  } finally {
    mutate('aiBusy', (s) => nodeIds.forEach((id) => s.delete(id)));
  }
}

// ai_comments 로컬 반영 ---------------------------------------------------------
export function addCommentLocal(c) {
  if (c.dismissed) return removeCommentLocal(c.id);
  const key = c.node_id ?? PROJECT_KEY;
  mutate('aiComments', (m) => {
    const list = (m.get(key) ?? []).filter((x) => x.id !== c.id);
    list.push(c);
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    m.set(key, list);
  });
}

export function removeCommentLocal(id) {
  mutate('aiComments', (m) => {
    for (const [k, list] of m) {
      const next = list.filter((c) => c.id !== id);
      if (next.length !== list.length) {
        if (next.length) m.set(k, next); else m.delete(k);
      }
    }
  });
}

/** AI 응답으로 새 코멘트가 오면, 같은 대상의 이전 코멘트는 서버에서 dismissed 됐으므로 로컬도 정리 */
export function replaceCommentsLocal(nodeIds, comments) {
  mutate('aiComments', (m) => nodeIds.forEach((id) => m.delete(id ?? PROJECT_KEY)));
  comments.forEach(addCommentLocal);
}

export async function dismissComment(id) {
  removeCommentLocal(id);
  const { error } = await supabase.from('ai_comments').update({ dismissed: true }).eq('id', id);
  if (error) {
    console.error(error);
    toast('말풍선을 숨기지 못했어요.', { type: 'error' });
  }
}

/** 코멘트 첫 줄 = 제목 (gap / suggestion 에서 [노드로 추가]에 사용) */
export function commentTitle(c) {
  return c.content.split('\n')[0].trim().slice(0, 100);
}
export function commentBody(c) {
  return c.content.split('\n').slice(1).join('\n').trim();
}
