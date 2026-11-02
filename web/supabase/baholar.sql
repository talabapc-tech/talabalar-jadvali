-- Baholar bo'limi jadvallari. Supabase → SQL Editor da BIR MARTA ishga tushiring (qayta ishga tushirsa ham zarar yo'q).
-- Portalning o'z bazasida (NEXT_PUBLIC_SUPABASE_URL dagi loyiha) bajarilishi kerak.
--
-- Baho 5 ballik (2..5) kiritiladi. Bazaning adminiga kerak bo'ladigan 100 ballik reyting (*100 ustunlari)
-- server tomonidan AVTOMATIK hosil qilinadi va shu yerda saqlanadi (qoida: web/lib/baholar.ts).
-- Kalit: talabaning JSHSHIR (pinfl) raqami — talaba guruhini o'zgartirsa ham baho yo'qolmaydi.
-- RLS yoqilgan va siyosat yo'q: jadvallarga faqat server (service_role) kira oladi, brauzer (anon kalit) — yo'q.

-- Fanlar: har bir guruh va semestr uchun ustunlar ro'yxati
create table if not exists public.fanlar (
  id         bigint generated always as identity primary key,
  guruh      text     not null,
  semestr    smallint not null check (semestr between 1 and 8),
  nom        text     not null,
  tartib     integer  not null default 0,
  created_at timestamptz not null default now(),
  unique (guruh, semestr, nom)
);

-- Baholar: talaba × fan × semestr = bitta qator
create table if not exists public.baholar (
  id          bigint generated always as identity primary key,
  pinfl       text     not null,
  guruh       text     not null,
  semestr     smallint not null check (semestr between 1 and 8),
  fan         text     not null,
  -- 5 ballik baholar (r_semestr — uchala bahoning yaxlitlangan o'rtachasi, serverda hisoblanadi)
  yakuniy     smallint check (yakuniy   between 2 and 5),
  joriy       smallint check (joriy     between 2 and 5),
  oraliq      smallint check (oraliq    between 2 and 5),
  r_semestr   smallint check (r_semestr between 2 and 5),
  -- 100 ballik reyting (adminga yuboriladigan)
  yakuniy100  numeric(5,2) check (yakuniy100 between 0 and 100),
  joriy100    numeric(5,2) check (joriy100   between 0 and 100),
  oraliq100   numeric(5,2) check (oraliq100  between 0 and 100),
  r100        numeric(5,2) check (r100       between 0 and 100),
  updated_at  timestamptz not null default now(),
  unique (pinfl, semestr, fan)
);
create index if not exists baholar_guruh_semestr_idx on public.baholar (guruh, semestr);

-- Malakaviy amaliyot baholari
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

alter table public.fanlar              enable row level security;
alter table public.baholar             enable row level security;
alter table public.malakaviy_amaliyot  enable row level security;
