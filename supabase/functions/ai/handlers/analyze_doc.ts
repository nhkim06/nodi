// A1. 과제 문서 → 요구사항 추출
import { callJSON, type Usage } from '../openai.ts';
import { SYSTEM, prompts } from '../prompts.ts';
import { schemas } from '../schemas.ts';
import { clamp } from '../context.ts';
import { type Handler, badRequest, isUuid, notFound, pickHeavyModel, sumUsage } from './_shared.ts';

const CHUNK_SIZE = 24_000;
const MAX_CHUNKS = 4;

interface Extracted {
  summary: string;
  requirements: { category: string; content: string; importance: number; source_quote: string }[];
}

/** 문단 경계 기준으로 자르기 */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > CHUNK_SIZE && chunks.length < MAX_CHUNKS - 1) {
    let cut = rest.lastIndexOf('\n', CHUNK_SIZE);
    if (cut < CHUNK_SIZE * 0.5) cut = CHUNK_SIZE;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest.slice(0, CHUNK_SIZE));
  return chunks;
}

const normalize = (s: string) => s.replace(/[\s.,·'"“”‘’()[\]-]/g, '').toLowerCase();

export const analyzeDoc: Handler = async ({ admin, projectId, input }) => {
  if (!isUuid(input.docId)) throw badRequest('docId가 필요해요.');

  const { data: doc, error } = await admin.from('assignment_docs')
    .select('id, extracted_text').eq('id', input.docId).eq('project_id', projectId).maybeSingle();
  if (error) throw error;
  if (!doc) throw notFound('문서를 찾을 수 없어요.');

  const text = (doc.extracted_text ?? '').trim();
  if (text.length < 20) throw badRequest('문서 내용이 너무 짧아요. 과제 공지 전체를 넣어 주세요.');

  const chunks = chunkText(text);
  const { model, fallbackModel } = await pickHeavyModel(admin);

  const results = await Promise.all(chunks.map((chunk, i) => callJSON<Extracted>({
    model, fallbackModel,
    system: SYSTEM,
    user: prompts.analyze_doc(chunk, chunks.length > 1 ? { index: i + 1, total: chunks.length } : undefined),
    schemaName: 'analyze_doc',
    schema: schemas.analyze_doc,
    temperature: 0.2, effort: 'medium', maxTokens: 8000,
  })));

  // 청크 간 중복 제거
  const seen = new Set<string>();
  const merged: Extracted['requirements'] = [];
  for (const { data } of results) {
    for (const r of data.requirements ?? []) {
      const key = normalize(r.content ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
  }
  const summary = clamp(results[0].data.summary, 500);

  // 같은 문서의 기존 AI 요구사항을 지우고 다시 넣는다
  const del = await admin.from('requirements').delete().eq('doc_id', doc.id).eq('is_ai', true);
  if (del.error) throw del.error;

  const { data: last } = await admin.from('requirements').select('sort_order')
    .eq('project_id', projectId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const base = (last?.sort_order ?? 0) + 1;

  const categories = ['topic', 'deliverable', 'constraint', 'criteria', 'deadline', 'etc'];
  const rows = merged.slice(0, 60).map((r, i) => ({
    project_id: projectId,
    doc_id: doc.id,
    category: categories.includes(r.category) ? r.category : 'etc',
    content: clamp(r.content, 500),
    importance: [1, 2, 3].includes(r.importance) ? r.importance : 2,
    source_quote: clamp(r.source_quote, 500) || null,
    is_ai: true,
    sort_order: base + i,
  })).filter((r) => r.content);

  let inserted: unknown[] = [];
  if (rows.length) {
    const ins = await admin.from('requirements').insert(rows).select('*');
    if (ins.error) throw ins.error;
    inserted = ins.data ?? [];
  }

  await admin.from('assignment_docs').update({ analyzed_at: new Date().toISOString() }).eq('id', doc.id);

  // 프로젝트 설명이 비어 있으면 요약으로 채움
  const { data: project } = await admin.from('projects').select('description').eq('id', projectId).single();
  if (!project?.description && summary) {
    await admin.from('projects').update({ description: summary }).eq('id', projectId);
  }

  return {
    data: { summary, requirements: inserted, truncated: text.length > CHUNK_SIZE * MAX_CHUNKS },
    usage: sumUsage(results.map((r) => r.usage as Usage)),
  };
};
