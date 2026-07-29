-- Rename the site credit off Clerk's legal full name onto the brand handle.
update profiles
set display_name = 'Punaab',
    updated_at = now()
where lower(trim(display_name)) = 'sean layton';
