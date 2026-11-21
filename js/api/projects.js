import { supabase } from '../supabase.js';
import { q } from './client.js';
import { listExperiences } from './experiences.js';
import { PLAN_LIGHT_COLS } from './plans.js';

export async function listMyProjects(userId) {
  const rows = await q(
    supabase.from('project_members')
      .select('role, joined_at, project:projects(*)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false }),
    '프로젝트 목록을 불러오지 못했어요.',
  );
  return rows.filter((r) => r.project).map((r) => ({ ...r.project, my_role: r.role }));
}

export const createProject = ({ name, course, due, description }) => q(
  supabase.rpc('create_project', {
    p_name: name, p_course: course || null, p_due: due || null, p_description: description || null,
  }),
  '프로젝트를 만들지 못했어요.',
);

export const joinProject = (code) => q(
  supabase.rpc('join_project', { p_code: code }),
  '프로젝트에 참여하지 못했어요.',
);

export const getProject = (id) => q(
  supabase.from('projects').select('*').eq('id', id).maybeSingle(),
  '프로젝트를 불러오지 못했어요.',
);

export const updateProject = (id, patch) => q(
  supabase.from('projects').update(patch).eq('id', id).select().single(),
  '프로젝트를 수정하지 못했어요.',
);

export const leaveProject = (projectId, userId) => q(
  supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId),
  '프로젝트에서 나가지 못했어요.',
);

export const listMembers = (pid) => q(
  supabase.from('project_members').select('*, profile:profiles(*)').eq('project_id', pid).order('joined_at'),
  '팀원 목록을 불러오지 못했어요.',
);

export const listTemperatures = (pid) => q(
  supabase.from('member_temperature').select('*').eq('project_id', pid),
  '칭찬 온도를 불러오지 못했어요.',
);

export const updateMember = (pid, uid, patch) => q(
  supabase.from('project_members').update(patch).eq('project_id', pid).eq('user_id', uid).select('*, profile:profiles(*)').single(),
  '팀원 정보를 수정하지 못했어요.',
);

/** 워크스페이스 초기 로드 (병렬). 경험 카드는 팀원 목록이 있어야 읽을 수 있어서 한 번 더 기다린다. */
export async function loadWorkspace(pid) {
  const [nodes, members, assignees, comments, reqs, links, temps, docs, plans, tasks] = await Promise.all([
    q(supabase.from('nodes').select('*').eq('project_id', pid), '노드를 불러오지 못했어요.'),
    listMembers(pid),
    q(supabase.from('node_assignees').select('*').eq('project_id', pid), '담당자를 불러오지 못했어요.'),
    q(supabase.from('ai_comments').select('*').eq('project_id', pid).eq('dismissed', false).order('created_at'), 'AI 코멘트를 불러오지 못했어요.'),
    q(supabase.from('requirements').select('*').eq('project_id', pid).order('sort_order'), '요구사항을 불러오지 못했어요.'),
    q(supabase.from('links').select('*').eq('project_id', pid).order('created_at', { ascending: false }), '링크를 불러오지 못했어요.'),
    listTemperatures(pid),
    q(supabase.from('assignment_docs').select('id, file_name, storage_path, analyzed_at, created_at').eq('project_id', pid).order('created_at', { ascending: false }), '문서를 불러오지 못했어요.'),
    // 노드 카드 배지용 요약만 (상세는 Inspector 에서)
    q(supabase.from('node_plans').select(PLAN_LIGHT_COLS).eq('project_id', pid), '실행 계획을 불러오지 못했어요.'),
    q(supabase.from('node_tasks').select('*').eq('project_id', pid).order('sort_order'), '할 일 목록을 불러오지 못했어요.'),
  ]);
  const experiences = await listExperiences(members.map((m) => m.user_id));
  return { nodes, members, assignees, comments, reqs, links, temps, docs, plans, tasks, experiences };
}

// setting: 팀원 관리 ---------------------------------------------------------------
/** owner 가 팀원을 내보내거나, 본인이 나간다 (RLS members_delete) */
export const removeMember = (pid, uid) => q(
  supabase.from('project_members').delete().eq('project_id', pid).eq('user_id', uid),
  '팀원을 내보내지 못했어요.',
);

/** 초대 링크: index.html?join=CODE (HOME 이 받아서 참여 처리) */
export function inviteUrl(code) {
  return new URL(`index.html?join=${encodeURIComponent(code)}`, location.href).href;
}

/** HOME 프로젝트 현황: 프로젝트별 내 담당 진행률 { [projectId]: { total, done } } */
export async function myProgressByProject(uid) {
  const rows = await q(
    supabase.from('node_assignees').select('project_id, task_state').eq('user_id', uid),
    '진행 현황을 불러오지 못했어요.',
  );
  const out = {};
  for (const r of rows) {
    out[r.project_id] ??= { total: 0, done: 0 };
    out[r.project_id].total += 1;
    if (r.task_state === 'done') out[r.project_id].done += 1;
  }
  return out;
}

export const getMyProfile = (uid) => q(
  supabase.from('profiles').select('*').eq('id', uid).single(),
  '프로필을 불러오지 못했어요.',
);

export const updateProfile = (uid, patch) => q(
  supabase.from('profiles').update(patch).eq('id', uid).select().single(),
  '프로필을 저장하지 못했어요.',
);
