-- =============================================================================
-- 팀원 경험 카드(member_experiences) + 노드 실행 계획(node_plans)  (database.md 기준)
--
-- 20261121000000_init.sql 의 최신 버전에는 이 내용이 이미 들어 있다.
-- 이 파일은 "예전 init.sql(경험/실행 계획 없음, profiles.experience 컬럼 있음)"을 이미 적용한 DB를
-- 최신 상태로 올리기 위한 것이며, 어느 쪽 DB에 실행해도 안전하도록 멱등(idempotent)하게 작성했다.
-- =============================================================================

-- 1. enum ---------------------------------------------------------------------
do $$ begin
  create type public.experience_kind as enum ('project', 'research', 'tool', 'domain', 'role');
exception when duplicate_object then null;
end $$;


-- 2. 테이블 ---------------------------------------------------------------------

-- 팀원 경험 카드 (사용자 단위, 프로젝트 간 재사용)
create table if not exists public.member_experiences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind        public.experience_kind not null,
  title       text not null check (char_length(title) between 1 and 60),
  detail      text check (char_length(detail) <= 500),
  level       smallint not null default 1 check (level between 1 and 3),   -- 1 해봤음 / 2 혼자 가능 / 3 가르칠 수 있음
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists member_experiences_user_id_idx on public.member_experiences (user_id);

-- 노드 실행 계획 (노드 1:1)
create table if not exists public.node_plans (
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
create index if not exists node_plans_project_id_idx on public.node_plans (project_id);

-- AI 코멘트 근거 경험
alter table public.ai_comments add column if not exists experience_ids uuid[] not null default '{}';

-- profiles.experience(자유 서술)가 남아 있으면 → 경험 카드로 옮기고 컬럼 제거
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'experience'
  ) then
    execute $q$
      insert into public.member_experiences (user_id, kind, title, detail, level)
      select id, 'project', '이전 경험', left(experience, 500), 1
      from public.profiles
      where coalesce(trim(experience), '') <> ''
    $q$;
    alter table public.profiles drop column experience;
  end if;
end $$;


-- 3. 트리거 ---------------------------------------------------------------------
drop trigger if exists trg_experiences_touch on public.member_experiences;
create trigger trg_experiences_touch before update on public.member_experiences
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_plans_touch on public.node_plans;
create trigger trg_plans_touch before update on public.node_plans
  for each row execute function public.touch_updated_at();

-- 사용자가 실행 계획을 직접 고치면 edited_by_user 표시 (Edge Function은 service_role이라 제외)
create or replace function public.mark_plan_edited()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.edited_by_user := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_plans_mark_edited on public.node_plans;
create trigger trg_plans_mark_edited
  before update on public.node_plans for each row execute function public.mark_plan_edited();


-- 4. 뷰 -------------------------------------------------------------------------
-- 계획이 팀 경험보다 오래됐는지 (경험 카드가 그 뒤에 추가/수정되면 stale)
create or replace view public.node_plan_freshness with (security_invoker = true) as
select np.node_id,
       np.project_id,
       np.generated_at,
       max(me.updated_at)                                    as team_experience_updated_at,
       coalesce(max(me.updated_at) > np.generated_at, false) as is_stale
from public.node_plans np
join public.project_members pm on pm.project_id = np.project_id
left join public.member_experiences me on me.user_id = pm.user_id
group by np.node_id, np.project_id, np.generated_at;


-- 5. RLS ------------------------------------------------------------------------
alter table public.member_experiences enable row level security;
alter table public.node_plans         enable row level security;

-- member_experiences: 본인 CRUD, 같은 프로젝트 팀원은 조회만
drop policy if exists "exp_select" on public.member_experiences;
create policy "exp_select" on public.member_experiences for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = (select auth.uid()) and b.user_id = member_experiences.user_id
  )
);
drop policy if exists "exp_insert" on public.member_experiences;
create policy "exp_insert" on public.member_experiences for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "exp_update" on public.member_experiences;
create policy "exp_update" on public.member_experiences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "exp_delete" on public.member_experiences;
create policy "exp_delete" on public.member_experiences for delete to authenticated
  using (user_id = (select auth.uid()));

-- node_plans: 멤버 조회/수정 (생성은 주로 Edge Function, 수동 작성도 허용)
drop policy if exists "plans_all" on public.node_plans;
create policy "plans_all" on public.node_plans for all to authenticated
  using (public.is_member(project_id)) with check (public.is_member(project_id));


-- 6. Realtime -------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'node_plans') then
    alter publication supabase_realtime add table public.node_plans;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_experiences') then
    alter publication supabase_realtime add table public.member_experiences;
  end if;
end $$;


-- 7. 권한 (init.sql 과 같은 방식: 필요한 것만 명시적으로) -------------------------
grant select, insert, update, delete on public.member_experiences to authenticated;
grant select, insert, update, delete on public.node_plans         to authenticated;
grant select on public.node_plan_freshness to authenticated;
-- ai_comments.experience_ids 는 사용자 수정 불가 (dismissed 만 수정 가능한 기존 권한 유지)

grant all on public.member_experiences, public.node_plans, public.node_plan_freshness to service_role;
