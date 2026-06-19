-- Alternative portal logins: teammates the client invites can request their own code.
alter table magic_links add column if not exists alt_emails text[] not null default '{}';
