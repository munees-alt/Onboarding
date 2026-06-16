-- Email-locked client portal: a one-time code is sent to the configured email
-- and must be verified before the portal opens. Only that email can get in.
alter table magic_links add column if not exists otp_hash text;
alter table magic_links add column if not exists otp_expiry timestamptz;
alter table magic_links add column if not exists otp_attempts int not null default 0;
