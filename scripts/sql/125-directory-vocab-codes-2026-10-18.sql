-- 125 - vocabulary v2 additions (2026-10-18): liability capped at the insurance payout, four certifications.
-- Mirrors CODES in src/lib/directoryVocab.ts (the database holds a copy of the vocabulary, migration 123).
-- The price unit 'hour' lives only in directoryNumbers.PRICE_UNITS (the database checks the unit format, not the list).
INSERT INTO public.directory_vocab (vocab, code, label, sort, legacy, vocab_version) VALUES
  ('liability_cap', 'insurance_cover', 'Capped at the insurance payout', 5, '{}', '2026-10-18'),
  ('certification', 'iso_27017', 'ISO/IEC 27017', 12, '{}', '2026-10-18'),
  ('certification', 'iso_27018', 'ISO/IEC 27018', 13, '{}', '2026-10-18'),
  ('certification', 'iso_22301', 'ISO 22301', 14, '{}', '2026-10-18'),
  ('certification', 'tx_ramp', 'TX-RAMP', 15, '{}', '2026-10-18');
