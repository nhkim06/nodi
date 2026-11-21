import { supabase } from '../supabase.js';
import { getState, setState } from '../store.js';
import { q } from './client.js';

export function upsertLinkLocal(row) {
  const links = getState().links.filter((l) => l.id !== row.id);
  setState({ links: [row, ...links] });
}
export function removeLinkLocal(id) {
  setState({ links: getState().links.filter((l) => l.id !== id) });
}

export async function addLink({ kind, title, url, node_id = null }) {
  const row = await q(
    supabase.from('links').insert({ project_id: getState().project.id, kind, title, url, node_id }).select().single(),
    '링크를 추가하지 못했어요.',
  );
  upsertLinkLocal(row);
  return row;
}

export async function deleteLink(id) {
  await q(supabase.from('links').delete().eq('id', id), '링크를 삭제하지 못했어요.');
  removeLinkLocal(id);
}
