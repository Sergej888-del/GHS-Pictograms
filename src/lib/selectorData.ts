// =====================================================================
// Pictogram Selector — reference data loader
// Loads the small, public-read reference tables once (client-side) into a
// single object. The returned shape is a structural SUPERSET of the engine's
// RefData (extra display fields are ignored by the engine), so you can pass
// the loaded object straight into resolveSelection().
//
// Place at: src/lib/selectorData.ts
// =====================================================================
import { supabase } from './supabase';
import type { RefData } from './pictogramSelector';

export type LoadedData = RefData & {
  // richer display fields carried on the same arrays (harmless for the engine)
  jurisdictions: { id: string; code: string; name_en: string }[];
  catalog: { id: string; class_code: string; group_type: string; name_en: string; display_order: number }[];
  hText: Record<string, string>; // H-code -> English statement text (display only)
};

export async function loadSelectorData(): Promise<LoadedData> {
  const [jur, cat, map, ov, prec, hprec] = await Promise.all([
    supabase
      .from('jurisdiction')
      .select('id, code, name_en')
      .eq('is_active', true),
    supabase
      .from('hazard_class_catalog')
      .select('id, class_code, group_type, name_en, display_order'),
    supabase
      .from('hazard_category_mapping')
      .select('hazard_class_id, category_code, pictogram_code, signal_word, h_statement_code, endpoint_key'),
    supabase
      .from('jurisdiction_override')
      .select('jurisdiction_id, hazard_class_id, category_code, override_action, pictogram_code, signal_word, h_statement_code, reason'),
    supabase
      .from('precedence_rule')
      .select('jurisdiction_id, rule_code, if_pictogram, if_endpoint, then_action, affected_pictogram, affected_endpoint, explanation_en, legal_reference, is_active')
      .eq('is_active', true),
    supabase
      .from('h_statement_precedence')
      .select('jurisdiction_id, if_h_code, then_omit_h_code')
      .eq('is_active', true),
  ]);

  const core = [jur, cat, map, ov, prec, hprec];
  const firstErr = core.find((r) => r.error)?.error;
  if (firstErr) {
    throw new Error(`Selector reference data failed to load: ${firstErr.message}`);
  }

  // H-statement text is display-only — never let it break the tool.
  const hText: Record<string, string> = {};
  try {
    const { data } = await supabase.from('h_statements').select('code, text_en');
    for (const row of (data ?? []) as { code: string; text_en: string | null }[]) {
      if (row.text_en) hText[row.code] = row.text_en;
    }
  } catch {
    /* ignore — fall back to showing H-codes without text */
  }

  return {
    jurisdictions: (jur.data ?? []) as LoadedData['jurisdictions'],
    catalog: (cat.data ?? []) as LoadedData['catalog'],
    mapping: (map.data ?? []) as RefData['mapping'],
    overrides: (ov.data ?? []) as RefData['overrides'],
    precedence: (prec.data ?? []) as RefData['precedence'],
    hPrecedence: (hprec.data ?? []) as RefData['hPrecedence'],
    hText,
  };
}
