-- =============================================================================
-- Nodi 초기 스키마 (database.md 기준)
--
-- 프로젝트 설정 전제:
--   - RLS 자동 활성화: ON
--   - Data API: ON
--   - 새 테이블/함수 자동 grant(API 노출): OFF
--     → anon / authenticated / service_role 에 권한이 자동으로 붙지 않으므로
--       이 파일 마지막의 "8. 권한(GRANT)" 섹션에서 필요한 것만 명시적으로 준다.
--
-- Supabase SQL Editor에 통째로 붙여넣고 한 번 실행하거나,
-- `supabase db push`로 적용한다. (한 번만 실행할 것 — create 문이 중복되면 실패)
-- =============================================================================


-- =============================================================================
-- 1. 확장 & enum
-- =============================================================================
create extension if not exists pgcrypto;

create type public.node_status          as enum ('considering', 'adopted', 'discarded');
create type public.signal_type          as enum ('green', 'yellow', 'red', 'off');
create type public.task_state           as enum ('todo', 'doing', 'done');
create type public.link_kind            as enum ('notion', 'meeting', 'figma', 'github', 'drive', 'other');
create type public.ai_comment_kind      as enum ('feedback', 'suggestion', 'warning', 'gap', 'praise');
create type public.requirement_category as enum ('topic', 'deliverable', 'constraint', 'criteria', 'deadline', 'etc');
create type public.experience_kind      as enum ('project', 'research', 'tool', 'domain', 'role');


-- =============================================================================
-- 2. 테이블
-- =============================================================================

-- 사용자 프로필 ----------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 30),
  avatar_url    text,
  major         text,
  skills        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 팀원 경험 카드 (사용자 단위, 프로젝트 간 재사용) -----------------------------
create table public.member_experiences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind        public.experience_kind not null,
  title       text not null check (char_length(title) between 1 and 60),
  detail      text check (char_length(detail) <= 500),
  level       smallint not null default 1 check (level between 1 and 3),
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.member_experiences (user_id);

-- 프로젝트 (팀 과제) ------------------------------------------------------------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 60),
  course_name  text,
  description  text,
  due_date     date,
  invite_code  text not null unique
               default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 프로젝트 멤버 + 현재 신호등 --------------------------------------------------
create table public.project_members (
  project_id         uuid not null references public.projects(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  role               text not null default 'member' check (role in ('owner', 'member')),
  role_label         text,
  color              text not null default '#6366F1' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  signal             public.signal_type not null default 'off',
  signal_message     text check (char_length(signal_message) <= 80),
  signal_changed_at  timestamptz not null default now(),
  joined_at          timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on public.project_members (user_id);

-- 아이디어 노드 (트리) ----------------------------------------------------------
create table public.nodes (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  parent_id              uuid,
  title                  text not null check (char_length(title) between 1 and 100),
  description            text check (char_length(description) <= 2000),
  status                 public.node_status not null default 'considering',
  status_before_discard  public.node_status,
  is_candidate           boolean not null default false,
  source                 text not null default 'user' check (source in ('user', 'ai')),
  x                      real not null default 0,
  y                      real not null default 0,
  created_by             uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, project_id),
  foreign key (parent_id, project_id)
    references public.nodes (id, project_id) on delete cascade
);
create index on public.nodes (project_id);
create index on public.nodes (parent_id);
create unique index nodes_one_root_per_project on public.nodes (project_id) where parent_id is null;

-- 노드 담당자 (N:M) ------------------------------------------------------------
create table public.node_assignees (
  node_id      uuid not null,
  project_id   uuid not null,
  user_id      uuid not null,
  task_state   public.task_state not null default 'todo',
  note         text check (char_length(note) <= 300),
  assigned_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (node_id, user_id),
  foreign key (node_id, project_id) references public.nodes (id, project_id) on delete cascade,
  foreign key (project_id, user_id) references public.project_members (project_id, user_id) on delete cascade
);
create index on public.node_assignees (project_id, user_id);

-- 노드 실행 계획 (노드 1:1) ----------------------------------------------------
create table public.node_plans (
  node_id           uuid primary key,
  project_id        uuid not null,
  feasibility       smallint check (feasibility between 1 and 5),
  feasibility_note  text,
  research_methods  jsonb not null default '[]',
  scope             jsonb not null default '{"mvp":[],"stretch":[],"out_of_scope":[]}',
  risks             jsonb not null default '[]',
  experience_ids    uuid[] not null default '{}',
  generated_by_ai   boolean not null default true,
  edited_by_user    boolean not null default false,
  generated_at      timestamptz,
  updated_at        timestamptz not null default now(),
  foreign key (node_id, project_id) references public.nodes (id, project_id) on delete cascade
);
create index on public.node_plans (project_id);

-- 과제 문서 ---------------------------------------------------------------------
create table public.assignment_docs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  file_name       text not null,
  storage_path    text,
  mime_type       text,
  extracted_text  text not null,
  analyzed_at     timestamptz,
  uploaded_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on public.assignment_docs (project_id);

-- 요구사항 ----------------------------------------------------------------------
create table public.requirements (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  doc_id        uuid references public.assignment_docs(id) on delete set null,
  category      public.requirement_category not null default 'etc',
  content       text not null check (char_length(content) <= 500),
  importance    smallint not null default 2 check (importance between 1 and 3),
  source_quote  text,
  is_ai         boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.requirements (project_id);

-- AI 코멘트 ---------------------------------------------------------------------
create table public.ai_comments (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  node_id          uuid references public.nodes(id) on delete cascade,
  kind             public.ai_comment_kind not null default 'feedback',
  content          text not null,
  requirement_ids  uuid[] not null default '{}',
  experience_ids   uuid[] not null default '{}',
  dismissed       boolean not null default false,
  requested_by     uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index on public.ai_comments (project_id, node_id) where not dismissed;

-- 작업 링크 ---------------------------------------------------------------------
create table public.links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  node_id     uuid references public.nodes(id) on delete set null,
  kind        public.link_kind not null default 'other',
  title       text not null check (char_length(title) between 1 and 80),
  url         text not null check (url ~* '^https?://'),
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.links (project_id);

-- 칭찬 --------------------------------------------------------------------------
create table public.praises (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  from_user   uuid not null default auth.uid(),
  to_user     uuid not null,
  message     text not null check (char_length(message) between 1 and 200),
  tag         text,
  created_on  date not null default (now() at time zone 'Asia/Seoul')::date,
  created_at  timestamptz not null default now(),
  check (from_user <> to_user),
  unique (project_id, from_user, to_user, created_on),
  foreign key (project_id, from_user) references public.project_members (project_id, user_id) on delete cascade,
  foreign key (project_id, to_user)   references public.project_members (project_id, user_id) on delete cascade
);
create index on public.praises (project_id, to_user);

-- 신호등 구간 기록 --------------------------------------------------------------
create table public.signal_logs (
  id          bigint generated always as identity primary key,
  project_id  uuid not null,
  user_id     uuid not null,
  signal      public.signal_type not null,
  message     text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  foreign key (project_id, user_id) references public.project_members (project_id, user_id) on delete cascade
);
create index on public.signal_logs (project_id, user_id, started_at desc);

-- 활동 내역 ---------------------------------------------------------------------
create table public.activity_logs (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  action      text not null,
  node_id     uuid references public.nodes(id) on delete set null,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index on public.activity_logs (project_id, user_id, created_at desc);

-- AI 호출 기록 ------------------------------------------------------------------
create table public.ai_requests (
  id                 bigint generated always as identity primary key,
  project_id         uuid not null references public.projects(id) on delete cascade,
  user_id            uuid references public.profiles(id) on delete set null,
  action             text not null,
  model              text,
  prompt_tokens      int,
  completion_tokens  int,
  ok                 boolean not null default true,
  error              text,
  created_at         timestamptz not null default now()
);
create index on public.ai_requests (project_id, created_at desc);
create index on public.ai_requests (user_id, created_at desc);


-- =============================================================================
-- 3. 헬퍼 함수 & 트리거
-- =============================================================================

-- 멤버 / owner 여부 (RLS 전역에서 사용) ----------------------------------------
create or replace function public.is_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members where project_id = p_project and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members
    where project_id = p_project and user_id = auth.uid() and role = 'owner'
  );
$$;

-- updated_at 자동 갱신 ---------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_profiles_touch     before update on public.profiles       for each row execute function public.touch_updated_at();
create trigger trg_projects_touch     before update on public.projects       for each row execute function public.touch_updated_at();
create trigger trg_nodes_touch        before update on public.nodes          for each row execute function public.touch_updated_at();
create trigger trg_assignees_touch    before update on public.node_assignees for each row execute function public.touch_updated_at();
create trigger trg_requirements_touch before update on public.requirements   for each row execute function public.touch_updated_at();
create trigger trg_experiences_touch  before update on public.member_experiences for each row execute function public.touch_updated_at();
create trigger trg_plans_touch        before update on public.node_plans     for each row execute function public.touch_updated_at();

-- 사용자가 실행 계획을 직접 고치면 edited_by_user 표시 (Edge Function = service_role은 제외)
create or replace function public.mark_plan_edited()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.edited_by_user := true;
  end if;
  return new;
end $$;

create trigger trg_plans_mark_edited
  before update on public.node_plans for each row execute function public.mark_plan_edited();

-- 회원가입 시 프로필 자동 생성 -------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1), 'user'), 30),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- 멤버 색상 팔레트 (가입 순서대로 배정) ----------------------------------------
create or replace function public.next_member_color(p_project uuid)
returns text language sql stable set search_path = public as $$
  select (array['#6366F1','#EC4899','#F59E0B','#10B981','#3B82F6','#8B5CF6','#EF4444','#14B8A6'])
         [ (select count(*) from project_members where project_id = p_project) % 8 + 1 ];
$$;

-- RPC: 프로젝트 생성 (멤버 + root 노드 원자적 생성) -----------------------------
create or replace function public.create_project(
  p_name text, p_course text default null, p_due date default null, p_description text default null
) returns public.projects
language plpgsql security definer set search_path = public as $$
declare v_project projects;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into projects (name, course_name, due_date, description, created_by)
  values (p_name, p_course, p_due, p_description, auth.uid())
  returning * into v_project;

  insert into project_members (project_id, user_id, role, color)
  values (v_project.id, auth.uid(), 'owner', next_member_color(v_project.id));

  insert into nodes (project_id, parent_id, title, description, created_by)
  values (v_project.id, null, p_name, p_description, auth.uid());

  return v_project;
end $$;

-- RPC: 초대코드로 참여 ---------------------------------------------------------
create or replace function public.join_project(p_code text)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare v_project projects;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_project from projects where invite_code = upper(trim(p_code));
  if not found then raise exception 'invalid invite code'; end if;

  insert into project_members (project_id, user_id, color)
  values (v_project.id, auth.uid(), next_member_color(v_project.id))
  on conflict do nothing;

  return v_project;
end $$;

-- 노드: 순환 참조 방지 + root 보호 + 버림/복구 처리 ----------------------------
create or replace function public.nodes_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    if old.parent_id is null then
      raise exception 'root node cannot be moved';
    end if;
    if new.parent_id is null then
      raise exception 'only one root per project';
    end if;
    if exists (
      with recursive sub as (
        select id from nodes where id = new.id
        union all
        select n.id from nodes n join sub on n.parent_id = sub.id
      ) select 1 from sub where id = new.parent_id
    ) then
      raise exception 'cycle detected';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'discarded' and old.status <> 'discarded' then
    new.status_before_discard := old.status;
  elsif tg_op = 'UPDATE' and old.status = 'discarded' and new.status <> 'discarded' then
    new.status_before_discard := null;
  end if;

  return new;
end $$;

create trigger trg_nodes_before_write
  before update on public.nodes for each row execute function public.nodes_before_write();

-- root 노드 삭제 금지 (프로젝트 삭제로 인한 cascade는 허용) --------------------
create or replace function public.nodes_protect_root()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.parent_id is null and exists (select 1 from projects where id = old.project_id) then
    raise exception 'root node cannot be deleted';
  end if;
  return old;
end $$;

create trigger trg_nodes_protect_root
  before delete on public.nodes for each row execute function public.nodes_protect_root();

-- 신호등: 상태 변경 시 구간 로그 닫고 새로 열기 --------------------------------
create or replace function public.log_signal_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.signal is distinct from old.signal or new.signal_message is distinct from old.signal_message then
    new.signal_changed_at := now();

    update signal_logs set ended_at = now()
    where project_id = new.project_id and user_id = new.user_id and ended_at is null;

    if new.signal <> 'off' then
      insert into signal_logs (project_id, user_id, signal, message)
      values (new.project_id, new.user_id, new.signal, new.signal_message);
    end if;
  end if;
  return new;
end $$;

create trigger trg_signal_change
  before update of signal, signal_message on public.project_members
  for each row execute function public.log_signal_change();

-- 활동 로그 자동 기록 ----------------------------------------------------------
create or replace function public.log_node_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.parent_id is not null then
    insert into activity_logs (project_id, user_id, action, node_id, meta)
    values (new.project_id, auth.uid(), 'node_created', new.id,
            jsonb_build_object('title', new.title, 'source', new.source));
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    insert into activity_logs (project_id, user_id, action, node_id, meta)
    values (new.project_id, auth.uid(), 'node_status_changed', new.id,
            jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
  end if;
  return null;
end $$;

create trigger trg_nodes_activity
  after insert or update of status on public.nodes
  for each row execute function public.log_node_activity();

create or replace function public.log_assignee_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  select title into v_title from nodes where id = new.node_id;
  if tg_op = 'INSERT' then
    insert into activity_logs (project_id, user_id, action, node_id, meta)
    values (new.project_id, new.user_id, 'node_assigned', new.node_id,
            jsonb_build_object('title', v_title, 'by', auth.uid()));
  elsif new.task_state <> old.task_state then
    insert into activity_logs (project_id, user_id, action, node_id, meta)
    values (new.project_id, new.user_id, 'task_state_changed', new.node_id,
            jsonb_build_object('title', v_title, 'from', old.task_state, 'to', new.task_state));
  end if;
  return null;
end $$;

create trigger trg_assignees_activity
  after insert or update of task_state on public.node_assignees
  for each row execute function public.log_assignee_activity();


-- =============================================================================
-- 4. 뷰 (security_invoker → 호출자 RLS 적용)
-- =============================================================================

-- 칭찬 온도: 36.5 + 0.3 × 받은 칭찬 수 (최대 99)
create view public.member_temperature with (security_invoker = true) as
select pm.project_id,
       pm.user_id,
       count(p.id)                                         as praise_count,
       least(99, 36.5 + 0.3 * count(p.id))::numeric(4,1)   as temperature
from public.project_members pm
left join public.praises p on p.project_id = pm.project_id and p.to_user = pm.user_id
group by pm.project_id, pm.user_id;

-- 신호등 상태별 누적 시간 (진행 중 구간은 now까지)
create view public.member_signal_time with (security_invoker = true) as
select project_id,
       user_id,
       signal,
       (started_at at time zone 'Asia/Seoul')::date                       as day,
       sum(extract(epoch from coalesce(ended_at, now()) - started_at))::int as total_seconds
from public.signal_logs
group by project_id, user_id, signal, day;

-- 팀원별 담당 현황
create view public.member_workload with (security_invoker = true) as
select pm.project_id,
       pm.user_id,
       count(na.node_id)                                         as assigned_count,
       count(na.node_id) filter (where na.task_state = 'done')   as done_count,
       count(na.node_id) filter (where na.task_state = 'doing')  as doing_count
from public.project_members pm
left join public.node_assignees na on na.project_id = pm.project_id and na.user_id = pm.user_id
group by pm.project_id, pm.user_id;

-- 계획이 팀 경험보다 오래됐는지 (경험 카드가 그 뒤에 추가/수정되면 stale)
create view public.node_plan_freshness with (security_invoker = true) as
select np.node_id,
       np.project_id,
       np.generated_at,
       max(me.updated_at)                                    as team_experience_updated_at,
       coalesce(max(me.updated_at) > np.generated_at, false) as is_stale
from public.node_plans np
join public.project_members pm on pm.project_id = np.project_id
left join public.member_experiences me on me.user_id = pm.user_id
group by np.node_id, np.project_id, np.generated_at;


-- =============================================================================
-- 5. RLS
--    (자동 RLS가 켜져 있어도 명시해 둔다 — 이미 켜져 있으면 아무 일도 안 일어남)
-- =============================================================================
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.nodes           enable row level security;
alter table public.node_assignees  enable row level security;
alter table public.assignment_docs enable row level security;
alter table public.requirements    enable row level security;
alter table public.ai_comments     enable row level security;
alter table public.links           enable row level security;
alter table public.praises         enable row level security;
alter table public.signal_logs     enable row level security;
alter table public.activity_logs   enable row level security;
alter table public.ai_requests     enable row level security;
alter table public.member_experiences enable row level security;
alter table public.node_plans      enable row level security;

-- member_experiences: 본인 CRUD, 같은 프로젝트 팀원은 조회만
create policy "exp_select" on public.member_experiences for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = (select auth.uid()) and b.user_id = member_experiences.user_id
  )
);
create policy "exp_insert" on public.member_experiences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "exp_update" on public.member_experiences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "exp_delete" on public.member_experiences for delete to authenticated
  using (user_id = (select auth.uid()));

-- node_plans: 멤버 조회/수정 (생성은 주로 Edge Function, 수동 작성도 허용)
create policy "plans_all" on public.node_plans for all to authenticated
  using (public.is_member(project_id)) with check (public.is_member(project_id));

-- profiles: 본인 + 같은 프로젝트 팀원 프로필 조회, 본인만 수정
create policy "profiles_select" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = (select auth.uid()) and b.user_id = profiles.id
  )
);
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- projects: 멤버만 조회, owner만 수정/삭제, 생성은 RPC(create_project)로만
create policy "projects_select" on public.projects for select to authenticated using (public.is_member(id));
create policy "projects_update" on public.projects for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));
create policy "projects_delete" on public.projects for delete to authenticated using (public.is_owner(id));

-- project_members: 멤버끼리 조회, 본인 행 수정, 본인 탈퇴 또는 owner가 내보내기
create policy "members_select" on public.project_members for select to authenticated
  using (public.is_member(project_id));
create policy "members_update" on public.project_members for update to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(project_id));
create policy "members_delete" on public.project_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(project_id));

-- 멤버 공통 CRUD 테이블
create policy "nodes_all"     on public.nodes           for all to authenticated using (public.is_member(project_id)) with check (public.is_member(project_id));
create policy "assignees_all" on public.node_assignees  for all to authenticated using (public.is_member(project_id)) with check (public.is_member(project_id));
create policy "links_all"     on public.links           for all to authenticated using (public.is_member(project_id)) with check (public.is_member(project_id));
create policy "docs_all"      on public.assignment_docs for all to authenticated using (public.is_member(project_id)) with check (public.is_member(project_id));
create policy "reqs_all"      on public.requirements    for all to authenticated using (public.is_member(project_id)) with check (public.is_member(project_id));

-- ai_comments: 조회 + dismissed 수정만 (생성은 Edge Function service role)
create policy "ai_comments_select" on public.ai_comments for select to authenticated using (public.is_member(project_id));
create policy "ai_comments_update" on public.ai_comments for update to authenticated using (public.is_member(project_id));

-- praises: 조회, 본인 명의로만 작성, 본인이 쓴 것만 삭제
create policy "praises_select" on public.praises for select to authenticated using (public.is_member(project_id));
create policy "praises_insert" on public.praises for insert to authenticated
  with check (public.is_member(project_id) and from_user = (select auth.uid()));
create policy "praises_delete" on public.praises for delete to authenticated
  using (from_user = (select auth.uid()));

-- 로그성 테이블: 조회만 (쓰기는 트리거 / Edge Function)
create policy "signal_logs_select"   on public.signal_logs   for select to authenticated using (public.is_member(project_id));
create policy "activity_logs_select" on public.activity_logs for select to authenticated using (public.is_member(project_id));
create policy "ai_requests_select"   on public.ai_requests   for select to authenticated using (public.is_member(project_id));


-- =============================================================================
-- 6. Storage
-- =============================================================================
INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
VALUES (
  'assignment-docs',
  'assignment-docs',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- 경로 규칙: '<project_id>/<uuid>.<ext>' → 첫 폴더명으로 멤버 검사
create policy "docs_read" on storage.objects for select to authenticated
  using (bucket_id = 'assignment-docs' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "docs_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'assignment-docs' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'assignment-docs' and public.is_member(((storage.foldername(name))[1])::uuid));


-- =============================================================================
-- 7. Realtime
-- =============================================================================
alter publication supabase_realtime add table
  public.nodes, public.node_assignees, public.ai_comments,
  public.project_members, public.links, public.praises, public.requirements,
  public.node_plans, public.member_experiences;

alter table public.nodes          replica identity full;
alter table public.node_assignees replica identity full;
alter table public.ai_comments    replica identity full;
alter table public.links          replica identity full;


-- =============================================================================
-- 8. 권한 (GRANT)
--    자동 grant가 꺼져 있으므로 여기서 준 권한 외에는 Data API로 접근할 수 없다.
--    - anon          : 아무 권한도 주지 않음 (로그인 필수 서비스)
--    - authenticated : RLS 정책과 짝이 맞는 최소 권한만
--    - service_role  : Edge Function용 전체 권한 (RLS 우회)
-- =============================================================================
grant usage on schema public to authenticated, service_role;

-- 8.1 authenticated — 테이블 ---------------------------------------------------
-- profiles: 조회 + 본인 프로필 일부 컬럼만 수정 (insert는 가입 트리거가 처리)
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, major, skills) on public.profiles to authenticated;

-- member_experiences: 본인 카드 CRUD, 팀원 카드는 조회만 (RLS가 구분)
grant select, insert, update, delete on public.member_experiences to authenticated;

-- node_plans: 멤버 CRUD (edited_by_user는 트리거가 강제로 true 처리)
grant select, insert, update, delete on public.node_plans to authenticated;

-- projects: 조회 / 기본 정보 수정 / 삭제 (생성은 RPC, invite_code·created_by는 수정 불가)
grant select, delete on public.projects to authenticated;
grant update (name, course_name, description, due_date) on public.projects to authenticated;

-- project_members: 조회 / 탈퇴 / 일부 컬럼 수정 (role 변경 불가, 참여는 RPC)
grant select, delete on public.project_members to authenticated;
grant update (role_label, color, signal, signal_message) on public.project_members to authenticated;

-- 멤버 공통 CRUD
grant select, insert, update, delete on public.nodes           to authenticated;
grant select, insert, update, delete on public.node_assignees  to authenticated;
grant select, insert, update, delete on public.links           to authenticated;
grant select, insert, update, delete on public.assignment_docs to authenticated;
grant select, insert, update, delete on public.requirements    to authenticated;

-- ai_comments: 조회 + dismissed만 수정
grant select on public.ai_comments to authenticated;
grant update (dismissed) on public.ai_comments to authenticated;

-- praises: 조회 / 작성 / 삭제
grant select, insert, delete on public.praises to authenticated;

-- 로그성 테이블: 조회만
grant select on public.signal_logs   to authenticated;
grant select on public.activity_logs to authenticated;
grant select on public.ai_requests   to authenticated;

-- 뷰
grant select on public.member_temperature to authenticated;
grant select on public.member_signal_time to authenticated;
grant select on public.member_workload    to authenticated;
grant select on public.node_plan_freshness to authenticated;

-- 8.2 함수 실행 권한 ----------------------------------------------------------
-- Postgres는 기본적으로 함수 EXECUTE를 PUBLIC에 주므로 먼저 전부 회수한 뒤 필요한 것만 연다.
revoke execute on all functions in schema public from public, anon, authenticated;

-- RLS 정책 / Storage 정책 안에서 호출되므로 authenticated에 필요
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid)  to authenticated;

-- RPC
grant execute on function public.create_project(text, text, date, text) to authenticated;
grant execute on function public.join_project(text)                     to authenticated;

-- 8.3 service_role (Edge Function) --------------------------------------------
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
