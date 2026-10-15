-- Projects of each signed-in user (Clerk user id). Media files live in Vercel Blob; `data` is the full project.
create table if not exists public.projects (
  user_id      text        not null,
  id           text        not null,
  name         text        not null default '',
  format       text        not null default '9:16',
  duration_sec real        not null default 0,
  updated_at   timestamptz not null default now(),
  data         jsonb       not null,
  primary key (user_id, id)
);

create index if not exists projects_user_updated on public.projects (user_id, updated_at desc);

-- No policies on purpose: only the server, with the secret key, reads and writes, always scoped to the signed-in user.
alter table public.projects enable row level security;
