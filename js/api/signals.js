import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase.js';
import { q } from './client.js';
import { todayKST } from '../utils/time.js';

export const setSignal = (pid, uid, signal, signal_message = null) => q(
  supabase.from('project_members')
    .update({ signal, signal_message: signal_message || null })
    .eq('project_id', pid).eq('user_id', uid)
    .select('*, profile:profiles(*)').single(),
  '신호등을 바꾸지 못했어요.',
);

/** 상태별 누적 초 { green, yellow, red } (from~to 날짜, KST) */
export async function signalTime(pid, uid, fromDay = todayKST(), toDay = todayKST()) {
  const rows = await q(
    supabase.from('member_signal_time').select('signal, day, total_seconds')
      .eq('project_id', pid).eq('user_id', uid).gte('day', fromDay).lte('day', toDay),
    '신호등 기록을 불러오지 못했어요.',
    { silent: true },
  );
  const out = { green: 0, yellow: 0, red: 0 };
  for (const r of rows ?? []) out[r.signal] = (out[r.signal] ?? 0) + r.total_seconds;
  return out;
}

/** 탭을 닫을 때 off 로 바꾸기 시도 (keepalive fetch — 실패할 수 있음) */
export function signalOffBeacon(pid, uid, accessToken) {
  if (!accessToken) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/project_members?project_id=eq.${pid}&user_id=eq.${uid}`, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ signal: 'off' }),
    });
  } catch { /* 무시 */ }
}
