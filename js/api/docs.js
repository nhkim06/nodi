// 과제 문서 업로드 + 요구사항 CRUD
import { supabase } from '../supabase.js';
import { getState, setState } from '../store.js';
import { q } from './client.js';
import { mimeOf } from '../utils/pdf.js';

const pid = () => getState().project.id;

/** 파일(선택) + 추출 텍스트 저장 → assignment_docs 행 반환 */
export async function saveDoc({ file = null, text, fileName }) {
  let storage_path = null;
  if (file) {
    const ext = file.name.split('.').pop().toLowerCase();
    storage_path = `${pid()}/${crypto.randomUUID()}.${ext}`;
    await q(
      supabase.storage.from('assignment-docs').upload(storage_path, file, { contentType: mimeOf(file) }),
      '파일을 업로드하지 못했어요.',
    );
  }
  const row = await q(
    supabase.from('assignment_docs').insert({
      project_id: pid(),
      file_name: fileName || file?.name || '붙여넣은 텍스트',
      storage_path,
      mime_type: file ? mimeOf(file) : 'text/plain',
      extracted_text: text,
    }).select('id, file_name, storage_path, analyzed_at, created_at').single(),
    '문서를 저장하지 못했어요.',
  );
  setState({ docs: [row, ...getState().docs] });
  return row;
}

export async function deleteDoc(doc) {
  if (doc.storage_path) {
    await supabase.storage.from('assignment-docs').remove([doc.storage_path]);
  }
  await q(supabase.from('assignment_docs').delete().eq('id', doc.id), '문서를 삭제하지 못했어요.');
  setState({ docs: getState().docs.filter((d) => d.id !== doc.id) });
}

export async function openDocFile(doc) {
  const data = await q(
    supabase.storage.from('assignment-docs').createSignedUrl(doc.storage_path, 60),
    '파일을 열지 못했어요.',
  );
  window.open(data.signedUrl, '_blank', 'noopener');
}

export async function reloadRequirements() {
  const rows = await q(
    supabase.from('requirements').select('*').eq('project_id', pid()).order('sort_order'),
    '요구사항을 불러오지 못했어요.',
  );
  setState({ requirements: rows });
}

export function upsertReqLocal(row) {
  const list = getState().requirements.filter((r) => r.id !== row.id);
  list.push(row);
  list.sort((a, b) => a.sort_order - b.sort_order);
  setState({ requirements: list });
}

export async function addRequirement({ category = 'etc', content, importance = 2 }) {
  const max = Math.max(0, ...getState().requirements.map((r) => r.sort_order));
  const row = await q(
    supabase.from('requirements')
      .insert({ project_id: pid(), category, content, importance, is_ai: false, sort_order: max + 1 })
      .select().single(),
    '요구사항을 추가하지 못했어요.',
  );
  upsertReqLocal(row);
  return row;
}

export async function updateRequirement(id, patch) {
  const row = await q(
    supabase.from('requirements').update(patch).eq('id', id).select().single(),
    '요구사항을 수정하지 못했어요.',
  );
  upsertReqLocal(row);
  return row;
}

export async function deleteRequirement(id) {
  await q(supabase.from('requirements').delete().eq('id', id), '요구사항을 삭제하지 못했어요.');
  setState({ requirements: getState().requirements.filter((r) => r.id !== id) });
}
