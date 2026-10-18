-- 127 - check:directory for the s113 batch (2026-10-18): 77 new live entries, Europe (46), North America (29), Serbia (2).
-- Report: directory-check-2026-10-18.json (--only 317-396 run: 1 812 facts, 1 713 with evidence, 502 addresses;
-- pages ok 448, blocked 49, script-only 2, dead 3).
-- 1) 1404 facts found on their source page are confirmed now (ids as ranges; every id belongs to an entry >= 317).
--    Not found: 309 (159 on pages closed to scripts, 134 on pages that loaded, 15 on dead pages, 1 script-only).
-- 2) directory_facts_id_seq was at 3380 while max(id) is 8731 (the import writes explicit ids): realigned so that
--    a later manual insert cannot collide with an existing row.
-- 3) Snapshot into the directory history (s103). Must stay the last statement.
update directory_facts set confirmed = true, confirmed_on = '2026-10-18'
 where confirmed is distinct from true and entry_id >= 317 and id in (
  select generate_series(split_part(r, '-', 1)::int, coalesce(nullif(split_part(r, '-', 2), ''), split_part(r, '-', 1))::int)
  from unnest(string_to_array(
    '6864-6865,6887-6888,6890-6905,6909,6911-6925,6928-6935,6937-6957,6959,6962-6974,6976-6977,6979-6996,6998-7030,' ||
    '7032-7048,7050-7075,7080-7099,7103-7136,7139-7140,7142-7144,7146,7148-7152,7154-7161,7167-7173,7175-7187,' ||
    '7190-7209,7215-7217,7224-7227,7229,7233-7282,7286-7288,7290-7291,7294,7296-7297,7307-7330,7335-7350,7353-7358,' ||
    '7383-7402,7406-7430,7434-7446,7450-7460,7462-7467,7469,7471-7484,7488-7501,7511-7522,7534-7535,7540-7542,7544,' ||
    '7552-7554,7556-7558,7560,7577-7620,7622-7639,7643-7652,7654-7665,7667-7668,7670-7674,7677-7679,7685,7694-7727,' ||
    '7729-7748,7750-7751,7753,7757-7760,7762-7763,7765-7784,7786-7840,7844,7846,7858-7871,7874,7890-7901,7903-7965,' ||
    '7967-7970,8005-8011,8014-8030,8033-8035,8038-8062,8066-8076,8078-8106,8109-8111,8113-8134,8138-8151,8153-8166,' ||
    '8172-8179,8181-8182,8184-8194,8200-8232,8234-8237,8258-8261,8264-8265,8267-8268,8270-8281,8283-8284,8297-8321,' ||
    '8375-8380,8382-8399,8425-8442,8444-8455,8457-8517,8519-8527,8531-8558,8560-8571,8573-8577,8579-8616,8619-8641,' ||
    '8643-8653,8657-8684,8700-8716,8719-8728', ',')) as r
);

select setval('public.directory_facts_id_seq', (select max(id) from public.directory_facts));

select * from directory_snapshot('2026-10-18');
