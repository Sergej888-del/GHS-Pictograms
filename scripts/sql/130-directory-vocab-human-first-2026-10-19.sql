-- 130 - vocabulary v2.1 addendum (2026-10-19): ai_stance code human_first_positioning.
-- The vendor sells itself on NOT using AI / machine translation / software generators ("100% human",
-- "not another AI tool", "each SDS written manually, not by a generator"). Mirrors src/lib/directoryVocab.ts.
-- Run BEFORE npm run import:directory: the v2.1 collection pass (s114) adds 21 facts with this code (20 vendors + 1 tagged not_chemical_safety).

INSERT INTO public.directory_vocab (vocab, code, label, sort, legacy, vocab_version) VALUES
  ('ai_stance', 'human_first_positioning', 'Sells itself on not using AI', 5, '{}', '2026-10-19');

SELECT vocab, code, label FROM public.directory_vocab WHERE vocab = 'ai_stance' ORDER BY sort;
