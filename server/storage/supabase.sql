-- Выполните один раз: Supabase → SQL Editor → New query → вставить → Run.

create table if not exists accounts (
  nick_key  text primary key,            -- ник в нижнем регистре
  nickname  text not null,               -- ник как при регистрации
  salt      text not null,
  hash      text not null,               -- хеш пароля (scrypt), сам пароль не хранится
  state     jsonb not null,              -- деньги, ресурсы, кирки, чары
  last_seen timestamptz not null default now()
);

create table if not exists world (
  id         int primary key,            -- всегда 1
  seed       int not null,
  size       text not null,
  changes    jsonb not null,             -- изменения карты: [индекс, тип, индекс, тип, ...]
  updated_at timestamptz not null default now()
);

-- Закрываем таблицы от публичного доступа: без политик ключ anon к ним доступа не имеет.
-- Сервер использует service_role-ключ, который обходит эти ограничения.
alter table accounts enable row level security;
alter table world    enable row level security;
