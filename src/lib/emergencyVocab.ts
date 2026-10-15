/**
 * src/lib/emergencyVocab.ts - value vocabularies for the emergency-lines reference
 * (tables public.emergency_countries and public.emergency_services, scripts/sql/113-emergency-reference.sql).
 *
 * The database holds the format only: a regex for kind / sds_rule_kind / sds_use and short check lists for hours_kind,
 * audience, verification and state. The lists below are the source of truth for which values exist and for the words the
 * page prints, so a new value is added here without a migration (same arrangement as directoryNumbers.ts).
 *
 * The words describe what an official source says. They never promise that a number works, is staffed, or is accepted by a
 * regulator. `meaning` is the sentence a reader sees next to the label; keep it short and neutral.
 *
 * Added with the second seed (scripts/sql/116-emergency-seed-wave2.sql): sds_rule_kind poison_centre_number_allowed and
 * no_rule_found, sds_use professionals_line.
 *
 * Every Record below is keyed by its value list, so adding a value to a list without a label fails `npm run check:types`.
 */

export type VocabEntry = { label: string; meaning: string }

/** emergency_services.kind - what the service is. */
export const EMERGENCY_KIND_VALUES = ['poison_centre', 'national_helpdesk', 'spill_reporting'] as const
export type EmergencyKind = (typeof EMERGENCY_KIND_VALUES)[number]
export const EMERGENCY_KINDS: Record<EmergencyKind, VocabEntry> = {
  poison_centre: {
    label: 'Poison centre',
    meaning: 'Gives advice on poisoning and chemical exposure.',
  },
  national_helpdesk: {
    label: 'National helpdesk',
    meaning: 'A national service that routes calls to the poison centres.',
  },
  spill_reporting: {
    label: 'Spill reporting centre',
    meaning: 'Takes reports of releases into the environment; it gives no medical advice.',
  },
}

/** emergency_countries.sds_rule_kind - what the country's official sources say about the number in SDS section 1.4. */
export const EMERGENCY_SDS_RULE_VALUES = [
  'transport_papers_rule',
  'own_number_required',
  'national_number_listed',
  'poison_centre_number_allowed',
  'no_rule_found',
] as const
export type EmergencySdsRule = (typeof EMERGENCY_SDS_RULE_VALUES)[number]
export const EMERGENCY_SDS_RULES: Record<EmergencySdsRule, VocabEntry> = {
  transport_papers_rule: {
    label: 'Rule for transport papers',
    meaning: 'The rule found applies to dangerous-goods transport papers, not to section 1.4 of a safety data sheet.',
  },
  own_number_required: {
    label: 'Own number required',
    meaning: 'The supplier must state its own emergency number; a national poison-centre number alone does not meet the rule.',
  },
  national_number_listed: {
    label: 'National number named',
    meaning: 'An official source names a national body or number for section 1.4. Whether using it is mandatory differs by country; see the note.',
  },
  poison_centre_number_allowed: {
    label: 'Poison-centre number allowed',
    meaning: 'The poison centre’s number can be used in section 1.4, usually under conditions such as notification or an agreement; see the note.',
  },
  no_rule_found: {
    label: 'No rule found',
    meaning: 'No official page was found that sets a rule for the emergency number in section 1.4. This reports what we could read, not that no rule exists.',
  },
}

/** emergency_services.sds_use - how the service relates to safety data sheets, as its own source puts it. */
export const EMERGENCY_SDS_USE_VALUES = [
  'public_line',
  'national_body_for_sds',
  'by_contract_only',
  'listed_in_register',
  'reporting_not_advice',
  'professionals_line',
] as const
export type EmergencySdsUse = (typeof EMERGENCY_SDS_USE_VALUES)[number]
export const EMERGENCY_SDS_USES: Record<EmergencySdsUse, VocabEntry> = {
  public_line: {
    label: 'Public line',
    meaning: 'A line open to the public. The source does not say the number may be used in a safety data sheet.',
  },
  national_body_for_sds: {
    label: 'Named for section 1.4',
    meaning: 'The source names this service or number for use in section 1.4 of safety data sheets.',
  },
  by_contract_only: {
    label: 'Agreement needed',
    meaning: 'The service offers its number for safety data sheets only under an agreement or after notification; ask the service.',
  },
  listed_in_register: {
    label: 'Listed in an official register',
    meaning: 'The number is listed in an official register of poison centres. The source does not say whether it may be named in a safety data sheet.',
  },
  reporting_not_advice: {
    label: 'Reporting line',
    meaning: 'Takes reports of releases; it gives no product or medical advice.',
  },
  professionals_line: {
    label: 'Line for health professionals',
    meaning: 'A line the service prints for health professionals.',
  },
}

/** emergency_services.hours_kind. 'stated_other' needs hours_note (the database checks it). */
export const EMERGENCY_HOURS_VALUES = ['24_7', 'stated_other', 'not_stated'] as const
export type EmergencyHours = (typeof EMERGENCY_HOURS_VALUES)[number]
export const EMERGENCY_HOURS: Record<EmergencyHours, VocabEntry> = {
  '24_7': { label: '24 hours, 7 days a week', meaning: 'The service states that it answers round the clock.' },
  stated_other: { label: 'Limited hours', meaning: 'The service states other hours; see the note.' },
  not_stated: { label: 'Hours not stated', meaning: 'The source does not state when the line is staffed.' },
}

/** emergency_services.audience - who the service says may call. */
export const EMERGENCY_AUDIENCE_VALUES = ['public', 'professionals_only', 'public_and_professionals', 'not_stated'] as const
export type EmergencyAudience = (typeof EMERGENCY_AUDIENCE_VALUES)[number]
export const EMERGENCY_AUDIENCES: Record<EmergencyAudience, VocabEntry> = {
  public: { label: 'Public', meaning: 'Open to anyone.' },
  professionals_only: { label: 'Health professionals only', meaning: 'The service says the line is for health professionals.' },
  public_and_professionals: { label: 'Public and health professionals', meaning: 'Open to the public and to health professionals.' },
  not_stated: { label: 'Callers not stated', meaning: 'The source does not say who may call.' },
}

/**
 * emergency_services.verification - how the number was checked. Only confirmed and dated_source can go live: the database
 * refuses a live row that is unconfirmed. `unconfirmed` stays a working label for drafts.
 */
export const EMERGENCY_VERIFICATION_VALUES = ['confirmed', 'dated_source', 'unconfirmed'] as const
export type EmergencyVerification = (typeof EMERGENCY_VERIFICATION_VALUES)[number]
export const EMERGENCY_VERIFICATIONS: Record<EmergencyVerification, VocabEntry> = {
  confirmed: { label: 'Confirmed', meaning: 'The number was read on an official page of the service or its authority.' },
  dated_source: { label: 'Official source, may be out of date', meaning: 'The number comes from an official page that is old or carries no date.' },
  unconfirmed: { label: 'Not confirmed', meaning: 'The number comes from a secondary or doubtful source. Never printed.' },
}

/** state on both tables. Only live rows are readable by the public (row-level security). */
export const EMERGENCY_STATE_VALUES = ['draft', 'live'] as const
export type EmergencyState = (typeof EMERGENCY_STATE_VALUES)[number]

const has = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v)

/**
 * Names every value of a row that is outside the vocabularies above. For the future check script and the page build:
 * a value added in SQL without a label here would otherwise print as an empty cell. Empty array = row is fine.
 */
export function emergencyVocabProblems(table: 'country' | 'service', row: Record<string, unknown>): string[] {
  const p: string[] = []
  const need = (col: string, list: readonly string[]) => {
    if (!has(list, row[col])) p.push(`${col} "${String(row[col])}" is outside the vocabulary (src/lib/emergencyVocab.ts)`)
  }
  need('state', EMERGENCY_STATE_VALUES)
  if (table === 'country') {
    need('sds_rule_kind', EMERGENCY_SDS_RULE_VALUES)
    return p
  }
  need('kind', EMERGENCY_KIND_VALUES)
  need('sds_use', EMERGENCY_SDS_USE_VALUES)
  need('hours_kind', EMERGENCY_HOURS_VALUES)
  need('audience', EMERGENCY_AUDIENCE_VALUES)
  need('verification', EMERGENCY_VERIFICATION_VALUES)
  if (row.state === 'live' && row.verification === 'unconfirmed') p.push('a live row cannot be unconfirmed')
  if (row.hours_kind === 'stated_other' && !row.hours_note) p.push('hours_kind stated_other needs hours_note')
  return p
}
