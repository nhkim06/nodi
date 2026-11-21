// 팀원 경험 카드 (member_experiences) CRUD — 사용자 단위, 같은 프로젝트 팀원에게만 공개(RLS)
import { supabase } from '../supabase.js';
import { getState, mutate } from '../store.js';
import { q } from './client.js';

/** store 반영 (워크스페이스가 아니면 무시해도 무해) */
export function upsertExperienceLocal(row) {
  mutate('experiences', (m) => {
    for (const [uid, list] of m) {
      if (uid !== row.user_id && list.some((x) => x.id === row.id)) m.set(uid, list.filter((x) => x.id !== row.id));
    }
    const list = (m.get(row.user_id) ?? []).filter((x) => x.id !== row.id);
    list.push(row);
    m.set(row.user_id, list);
  });
}

export function removeExperienceLocal(id) {
  mutate('experiences', (m) => {
    for (const [uid, list] of m) {
      const next = list.filter((x) => x.id !== id);
      if (next.length !== list.length) m.set(uid, next);
    }
  });
}

export const listExperiences = (userIds) => (userIds.length
  ? q(supabase.from('member_experiences').select('*').in('user_id', userIds).order('created_at'),
    '경험 카드를 불러오지 못했어요.')
  : Promise.resolve([]));

export const listMyExperiences = (uid) => q(
  supabase.from('member_experiences').select('*').eq('user_id', uid).order('created_at'),
  '내 경험 카드를 불러오지 못했어요.',
);

export async function countMyExperiences(uid) {
  const { count, error } = await supabase.from('member_experiences')
    .select('id', { count: 'exact', head: true }).eq('user_id', uid);
  if (error) { console.error(error); return null; }
  return count ?? 0;
}

const clean = ({ kind, title, detail, level, tags }) => ({
  kind,
  title: String(title ?? '').trim().slice(0, 60),
  detail: String(detail ?? '').trim().slice(0, 500) || null,
  level: Math.min(3, Math.max(1, Number(level) || 1)),
  tags: (tags ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 10),
});

export async function addExperience(card) {
  const row = await q(
    supabase.from('member_experiences').insert(clean(card)).select().single(),
    '경험 카드를 추가하지 못했어요.',
  );
  if (getState().project) upsertExperienceLocal(row);
  return row;
}

export async function updateExperience(id, card) {
  const row = await q(
    supabase.from('member_experiences').update(clean(card)).eq('id', id).select().single(),
    '경험 카드를 수정하지 못했어요.',
  );
  if (getState().project) upsertExperienceLocal(row);
  return row;
}

export async function deleteExperience(id) {
  await q(supabase.from('member_experiences').delete().eq('id', id), '경험 카드를 삭제하지 못했어요.');
  if (getState().project) removeExperienceLocal(id);
}
