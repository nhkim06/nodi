-- =============================================================================
-- IA 개편 (ia.md "IA v2")
--
--   HOME ─ home(프로젝트 현황: 진행 중 / 지난 프로젝트)
--        ─ project(전체 목록 → 프로젝트 상세: 아이디어 맵 / 팀원 / 작업 링크 모음 / 나의 작업)
--        ─ account(나의 정보 → 나의 프로젝트 경험)
--        ─ setting(프로젝트 기본 정보 + 교수 요구사항 / 팀원 관리 → 초대 링크 공유)
--
-- 바뀌는 것
--   1. projects.completed_at   : '지난 프로젝트'로 보내기 (setting 에서 owner 가 종료 처리)
--   2. projects.professor_note : setting 의 '교수 요구사항' 원문 메모 (AI 분석 전/후 모두 보관)
--   3. node_tasks              : 아이디어 맵의 '할 일 목록' (AI 추천 + 직접 추가, 체크·담당자)
--   4. praises.message nullable: 팀원 칭찬 → '좋아요' 한 번 누르기 (메시지는 선택)
--
-- 이미 적용된 DB에 한 번 실행한다. (if not exists / drop if exists 로 재실행에도 안전)
-- =============================================================================


-- 1·2. projects ---------------------------------------------------------------
alter table public.projects
  add column if not exists completed_at   timestamptz,
  add column if not exists professor_note text;

alter table public.projects drop constraint if exists projects_professor_note_check;
alter table public.projects add constraint projects_professor_note_check
  check (professor_note is null or char_length(professor_note) <= 10000);

-- owner 만 수정 가능 (RLS projects_update 가 is_owner 검사)
grant update (completed_at, professor_note) on public.projects to authenticated;


-- 3. node_tasks (할 일 목록) --------------------------------------------------
create table if not exists public.node_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,
  node_id      uuid not null,
  content      text not null check (char_length(content) between 1 and 200),
  done         boolean not null default false,
  assignee_id  uuid,
  source       text not null default 'user' check (source in ('user', 'ai')),
  sort_order   int not null default 0,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (node_id, project_id) references public.nodes (id, project_id) on delete cascade,
  -- 팀원이 나가면 담당만 비운다 (project_id 는 유지)
  foreign key (project_id, assignee_id)
    references public.project_members (project_id, user_id) on delete set null (assignee_id)
);
create index if not exists node_tasks_node_idx     on public.node_tasks (node_id, sort_order);
create index if not exists node_tasks_assignee_idx on public.node_tasks (project_id, assignee_id);

drop trigger if exists trg_node_tasks_touch on public.node_tasks;
create trigger trg_node_tasks_touch before update on public.node_tasks
  for each row execute function public.touch_updated_at();

alter table public.node_tasks enable row level security;
drop policy if exists "node_tasks_all" on public.node_tasks;
create policy "node_tasks_all" on public.node_tasks for all to authenticated
  using (public.is_member(project_id)) with check (public.is_member(project_id));

grant select, insert, update, delete on public.node_tasks to authenticated;
grant all on public.node_tasks to service_role;

do $$ begin
  alter publication supabase_realtime add table public.node_tasks;
exception when duplicate_object then null;
end $$;
alter table public.node_tasks replica identity full;


-- 4. praises → 좋아요 (메시지 선택) --------------------------------------------
alter table public.praises alter column message drop not null;
alter table public.praises drop constraint if exists praises_message_check;
alter table public.praises add constraint praises_message_check
  check (message is null or char_length(message) between 1 and 200);
