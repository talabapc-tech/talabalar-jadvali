-- ==============================================================================
-- SHAHRISABZ TIBBIYOT TEXNIKUMI — SO'ROVNOMALAR TIZIMI JADVALLARI
-- Supabase Dashboard -> SQL Editor ga qo'yib, "Run" tugmasini bosing (bir marta).
-- Qayta ishga tushirilsa ham mavjud ma'lumotlarga zarar yetmaydi (IF NOT EXISTS).
-- ==============================================================================

-- 1. SO'ROVNOMALAR (Google Forms kabi konstruktor orqali yaratiladigan jadvallar)
create table if not exists public.sorovnomalar (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null,
  description    text not null default '',
  audience       text not null default 'talabalar' check (audience in ('talabalar', 'xodimlar', 'ochiq')),
  target_courses smallint[] not null default '{}',
  target_groups  text[] not null default '{}',
  questions      jsonb not null default '[]'::jsonb,
  active         boolean not null default true,
  allow_update   boolean not null default true,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sorovnomalar_created_at_idx on public.sorovnomalar (created_at desc);

-- 2. SO'ROVNOMA JAVOBLARI
create table if not exists public.sorovnoma_javoblar (
  id               bigint generated always as identity primary key,
  survey_id        uuid not null references public.sorovnomalar(id) on delete cascade,
  respondent_key   text not null,
  respondent_type  text not null default 'ochiq' check (respondent_type in ('talabalar', 'xodimlar', 'ochiq')),
  respondent_name  text not null default '',
  respondent_group text not null default '',
  respondent_pinfl text not null default '',
  answers          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (survey_id, respondent_key)
);
create index if not exists sorovnoma_javoblar_survey_created_idx on public.sorovnoma_javoblar (survey_id, created_at desc);
create index if not exists sorovnoma_javoblar_survey_group_idx   on public.sorovnoma_javoblar (survey_id, respondent_group);

-- 3. XAVFSIZLIK: RLS YOQISH (faqat server service_role kaliti orqali boshqariladi; anon brauzerdan yopiq)
alter table public.sorovnomalar       enable row level security;
alter table public.sorovnoma_javoblar enable row level security;
