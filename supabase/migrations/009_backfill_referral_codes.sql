-- Backfill guild invite seals for travelers who never got one.

update profiles
set
  referral_code = upper(
    substr(
      translate(
        replace(id::text, '-', ''),
        'abcdef',
        'GHJKLM'
      ),
      1,
      8
    )
  ),
  updated_at = now()
where referral_code is null
  and not exists (
    select 1
    from profiles other
    where other.referral_code = upper(
      substr(
        translate(
          replace(profiles.id::text, '-', ''),
          'abcdef',
          'GHJKLM'
        ),
        1,
        8
      )
    )
  );

-- Any leftover collisions get a salted seal from clerk id + uuid.
update profiles
set
  referral_code = upper(
    substr(
      md5(clerk_user_id || id::text),
      1,
      8
    )
  ),
  updated_at = now()
where referral_code is null;
