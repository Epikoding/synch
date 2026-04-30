create table if not exists waitlist_entries (
	id integer primary key autoincrement,
	email text not null unique,
	locale text not null default '',
	source text not null default 'www',
	user_agent text not null default '',
	ip_hash text not null default '',
	created_at text not null default (datetime('now'))
);

create index if not exists waitlist_entries_created_at_idx
	on waitlist_entries (created_at);
