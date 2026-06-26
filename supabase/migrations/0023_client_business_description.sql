-- Brief business description (in the client's own words), filled from the discovery call.
alter table clients add column if not exists business_description text;
