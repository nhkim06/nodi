// 프로젝트 하나당 채널 하나. postgres_changes → store 반영.
// DELETE 이벤트는 filter 가 적용되지 않고, RLS 테이블에서는 old 에 PK 만 온다 → id 로 판별.
import { supabase } from './supabase.js';
import { getState, mutate, setState } from './store.js';
import { upsertNodeLocal, removeNodeLocal } from './api/nodes.js';
import { setAssigneeLocal, removeAssigneeLocal } from './api/assignees.js';
import { addCommentLocal, removeCommentLocal } from './api/ai.js';
import { upsertLinkLocal, removeLinkLocal } from './api/links.js';
import { upsertReqLocal } from './api/docs.js';
import { listTemperatures } from './api/projects.js';
import { upsertPlanLocal, removePlanLocal } from './api/plans.js';
import { upsertTaskLocal, removeTaskLocal } from './api/tasks.js';
import { listExperiences, upsertExperienceLocal, removeExperienceLocal } from './api/experiences.js';
import { toast } from './utils/dom.js';

let channel = null;

export function subscribeProject(pid) {
  if (channel) supabase.removeChannel(channel);
  const filter = `project_id=eq.${pid}`;
  const ch = supabase.channel(`project:${pid}`, { config: { broadcast: { self: false } } });

  const on = (table, handler) => {
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, (p) => handler('INSERT', p));
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, (p) => handler('UPDATE', p));
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (p) => handler('DELETE', p));
  };

  on('nodes', (ev, { new: row, old }) => {
    if (ev === 'DELETE') return removeNodeLocal(old.id);
    if (ev === 'UPDATE' && getState().dragging.has(row.id)) {
      // 드래그 중엔 위치를 덮어쓰지 않는다
      const cur = getState().nodes.get(row.id);
      return upsertNodeLocal({ ...row, x: cur?.x ?? row.x, y: cur?.y ?? row.y });
    }
    upsertNodeLocal(row);
  });

  on('node_assignees', (ev, { new: row, old }) => {
    if (ev === 'DELETE') return removeAssigneeLocal(old.node_id, old.user_id);
    setAssigneeLocal(row);
  });

  on('ai_comments', (ev, { new: row, old }) => {
    if (ev === 'DELETE') return removeCommentLocal(old.id);
    addCommentLocal(row);
  });

  on('links', (ev, { new: row, old }) => {
    if (ev === 'DELETE') return removeLinkLocal(old.id);
    upsertLinkLocal(row);
  });

  on('requirements', (ev, { new: row, old }) => {
    if (ev === 'DELETE') {
      return setState({ requirements: getState().requirements.filter((r) => r.id !== old.id) });
    }
    upsertReqLocal(row);
  });

  on('node_plans', (ev, { new: row, old }) => {
    if (ev === 'DELETE') return removePlanLocal(old.node_id);
    upsertPlanLocal(row, true);
  });

  on('node_tasks', (ev, { new: row, old }) => {
    if (ev === 'DELETE') return removeTaskLocal(old.id);
    upsertTaskLocal(row);
  });

  // 경험 카드는 project_id 가 없는 사용자 단위 테이블 → 필터 없이 받고 RLS(같은 팀원만) + 팀원 여부로 거른다
  for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
    ch.on('postgres_changes', { event, schema: 'public', table: 'member_experiences' }, ({ new: row, old }) => {
      if (event === 'DELETE') return removeExperienceLocal(old.id);
      if (getState().members.has(row.user_id)) upsertExperienceLocal(row);
    });
  }

  on('project_members', async (ev, { new: row, old }) => {
    if (ev === 'DELETE') {
      if (old.project_id && old.project_id !== pid) return;
      return mutate('members', (m) => m.delete(old.user_id));
    }
    const cur = getState().members.get(row.user_id);
    if (cur) {
      mutate('members', (m) => m.set(row.user_id, { ...cur, ...row }));
    } else {
      // 새 팀원 참여 → 프로필 포함해서 다시 읽기
      const { data } = await supabase.from('project_members').select('*, profile:profiles(*)')
        .eq('project_id', pid).eq('user_id', row.user_id).maybeSingle();
      if (data) {
        mutate('members', (m) => m.set(row.user_id, { ...data, temperature: 36.5, praise_count: 0 }));
        listExperiences([row.user_id]).then((rows) => mutate('experiences', (m) => m.set(row.user_id, rows))).catch(() => {});
        toast(`${data.profile?.display_name ?? '새 팀원'}님이 참여했어요`);
      }
    }
  });

  on('praises', async (ev, { new: row }) => {
    if (ev !== 'INSERT') return;
    await refreshTemperatures(pid);
    const { user, members } = getState();
    if (row.to_user === user?.id) {
      const from = members.get(row.from_user)?.profile?.display_name ?? '팀원';
      toast(row.message ? `${from}님의 좋아요: ${row.message}` : `${from}님이 좋아요를 보냈어요!`, { duration: 5000 });
    }
  });

  // 도움 요청 (A7) — DB 없이 broadcast
  ch.on('broadcast', { event: 'help' }, ({ payload }) => {
    const { user, members } = getState();
    if (payload?.to !== user?.id) return;
    mutate('helpRequests', (s) => s.add(payload.from));
    const from = members.get(payload.from)?.profile?.display_name ?? '팀원';
    toast(`${from}님이 도움을 요청했어요: ${payload.message ?? ''}`, { duration: 8000 });
  });

  ch.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('realtime', status);
    }
  });
  channel = ch;
  return ch;
}

export async function refreshTemperatures(pid) {
  try {
    const temps = await listTemperatures(pid);
    mutate('members', (m) => {
      for (const t of temps) {
        const cur = m.get(t.user_id);
        if (cur) m.set(t.user_id, { ...cur, temperature: Number(t.temperature), praise_count: t.praise_count });
      }
    });
  } catch { /* 토스트는 q 에서 */ }
}

export function sendHelpRequest(to, message) {
  if (!channel) return;
  channel.send({ type: 'broadcast', event: 'help', payload: { from: getState().user.id, to, message } });
}
