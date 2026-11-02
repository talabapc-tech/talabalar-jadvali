-- ==============================================================================
-- SHAHRISABZ TIBBIYOT TEXNIKUMI — SUPABASE BAZA JADVALLARI
-- Bu fayldagi barcha SQL buyruqlarni Supabase Dashboard → SQL Editor ga
-- qo'yib, "Run" tugmasini bosing (bir marta ishga tushirish kifoya).
-- Qayta ishga tushirilsa ham mavjud ma'lumotlarga zarar yetmaydi (IF NOT EXISTS).
-- ==============================================================================

-- 1. O'QUV REJALARI JADVALI (har bir o'quv yili, yo'nalish, fanlar va biriktirilgan guruhlar)
create table if not exists public.oquv_rejalari (
  id          text primary key,
  oquv_yili   text not null,
  yonalish    text not null,
  muddati     text not null default '3 yillik',
  kod         text,
  daraja      text default 'O''rta maxsus professional',
  tavsif      text,
  groups      jsonb not null default '[]'::jsonb,
  semestrlar  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. FANLAR JADVALI (har bir guruh va semestr bo'yicha fanlar ro'yxati)
create table if not exists public.fanlar (
  id         bigint generated always as identity primary key,
  guruh      text     not null,
  semestr    smallint not null check (semestr between 1 and 8),
  nom        text     not null,
  tartib     integer  not null default 0,
  created_at timestamptz not null default now(),
  unique (guruh, semestr, nom)
);

-- 3. BAHOLAR JADVALI (talaba × fan × semestr baholari va 100 ballik avtomatik reyting)
create table if not exists public.baholar (
  id          bigint generated always as identity primary key,
  pinfl       text     not null,
  guruh       text     not null,
  semestr     smallint not null check (semestr between 1 and 8),
  fan         text     not null,
  yakuniy     smallint check (yakuniy   between 2 and 5),
  joriy       smallint check (joriy     between 2 and 5),
  oraliq      smallint check (oraliq    between 2 and 5),
  r_semestr   smallint check (r_semestr between 2 and 5),
  yakuniy100  numeric(5,2) check (yakuniy100 between 0 and 100),
  joriy100    numeric(5,2) check (joriy100   between 0 and 100),
  oraliq100   numeric(5,2) check (oraliq100  between 0 and 100),
  r100        numeric(5,2) check (r100       between 0 and 100),
  updated_at  timestamptz not null default now(),
  unique (pinfl, semestr, fan)
);
create index if not exists baholar_guruh_semestr_idx on public.baholar (guruh, semestr);

-- 4. MALAKAVIY AMALIYOT JADVALI
create table if not exists public.malakaviy_amaliyot (
  id         bigint generated always as identity primary key,
  pinfl      text     not null,
  guruh      text     not null,
  semestr    smallint not null check (semestr between 1 and 8),
  nom        text     not null,
  joy        text,
  boshlanish date,
  tugash     date,
  ball       smallint check (ball between 2 and 5),
  ball100    numeric(5,2) check (ball100 between 0 and 100),
  izoh       text,
  updated_at timestamptz not null default now(),
  unique (pinfl, semestr, nom)
);
create index if not exists amaliyot_guruh_semestr_idx on public.malakaviy_amaliyot (guruh, semestr);

-- 5. XAVFSIZLIK: RLS YOQISH (faqat server service_role kaliti orqali boshqariladi)
alter table public.oquv_rejalari      enable row level security;
alter table public.fanlar             enable row level security;
alter table public.baholar            enable row level security;
alter table public.malakaviy_amaliyot enable row level security;
