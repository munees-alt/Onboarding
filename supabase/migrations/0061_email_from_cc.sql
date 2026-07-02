-- Assignment-notification emails need (a) a per-email "from" so they can be sent
-- from a specific mailbox (munees@finanshels.com) while other mail keeps the
-- default sender, and (b) a CC list (e.g. AML: head + configured team members).
alter table email_batch add column if not exists from_email text;
alter table email_batch add column if not exists from_name  text;
alter table email_batch add column if not exists cc_emails  text[];
