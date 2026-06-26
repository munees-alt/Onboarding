-- Backup for portal access codes: store the current code encrypted + when it was sent, so the
-- team can read it out to the client from the Client Portal tab when the email doesn't arrive.
-- (otp_hash is still what verification checks; this is a team-only fallback, auto-expires in 10 min.)
alter table magic_links add column if not exists otp_code_enc text;
alter table magic_links add column if not exists otp_sent_at timestamptz;
