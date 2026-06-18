-- Document review loop: the team can reject an uploaded doc with a note; the
-- client sees it and re-uploads.
alter type doc_status add value if not exists 'rejected';
alter table documents add column if not exists review_note text;
