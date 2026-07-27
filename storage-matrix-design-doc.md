# Chemical Storage Compatibility Matrix — Design Doc
**Property:** ghspictograms.com · **Supabase:** `zhvrbrlqgntgzneggqst` · **Status:** design sign-off pending → then Cursor
**Rule:** design-first. No Cursor prompt / no component code until this doc is approved.

---

## 1. Goal & scope
A flagship, data-driven tool that answers "what can and can't be stored together" for any substance, backed by two verified data pillars, plus a set of category reference pages that double as an SEO/AI-citation asset.

- **In scope now:** the tool page + 13 storage-class category pages + homepage placement.
- **Deferred (wave 2):** 68 CAMEO reactive-group pages (pyrophoric / peroxide-forming / oxidizer lists — strong niche SEO).
- **Out of scope:** explosives storage (specialized magazine regime).

---

## 2. Data foundation (LIVE in prod, verified)
**Pillar 1 — reactivity (CAMEO/NOAA-EPA, public domain):**
- `chem_reactive_groups` (80: 68 groups + 12 special flags), `reactivity_hazard_codes` (12),
  `reactive_group_compat` (2346 pairs, `status` + `hazard_codes[]` + `gas_products[]` + `doc_ref`),
  `substance_reactive_group_link` (1959 links, **1073 of our CAS covered ≈ 28%**, high-traffic-skewed).

**Pillar 2 — storage segregation (synthesis: OSHA subpart H + consensus EHS; NFPA/IFC = reference only):**
- `storage_hazard_classes` (13), `storage_class_compat` (91, upper-triangle + `CHECK sc_a<=sc_b`),
  `storage_class_compat_sym` (view, symmetric read), `ghs_to_storage_class` (37 maps: 23 h_code + 14 reactive_group).

**Coverage model:** pillar-2 works from GHS codes → nearly ALL substances; pillar-1 adds substance-specific reactivity where CAMEO has it. CAMEO group disambiguates acid vs base where GHS H314 alone cannot.

---

## 3. Information architecture & routing
- Tool: `/tools/chemical-storage-compatibility/`
- Category pages: `/storage-compatibility/[class]/` (e.g. `/storage-compatibility/oxidizers/`)  — 13 pages
- Substance leaf (exists): `/pictograms/[cas]/` — enriched with a reactivity/segregation panel
- Deep-link into tool: `/tools/chemical-storage-compatibility/?substance=<CAS>`
- Canonical: one page per class; links to it come from the tool verdict, the hazard filter, and substance pages (no duplicates).

---

## 4. The tool page
### 4.1 UX (see skeleton v2)
Navy hero; two columns. **Left (selector):** hazard filter chips → live search (name/CAS) → results list → selected substance; multi-form (multi-UN) shown here as a choice, not autopicked. **Right (live result, no button), top→bottom:** substance header + derived class badge → segregation (never/separate/compatible, each pill → category page) → reactivity gases (CAMEO) → ADR transport strip → orange "Download segregation plan" → quiet SDS bridge.

### 4.2 Query schema (verified building blocks)
Derive storage class for a CAS (reactive-group first, h-code fallback):
```sql
SELECT DISTINCT m.sc_code FROM substance_reactive_group_link l
 JOIN chem_reactive_groups g ON g.rg_id=l.rg_id
 JOIN ghs_to_storage_class m ON m.source='reactive_group' AND m.key=g.name
 WHERE l.cas_number=$1
UNION
SELECT DISTINCT m.sc_code FROM substances s
 CROSS JOIN LATERAL unnest(s.h_statement_codes) h(code)
 JOIN ghs_to_storage_class m ON m.source='h_code' AND m.key=h.code
 WHERE s.cas_number=$1;
```
Segregation verdict for a class (symmetric view):
```sql
SELECT other.name, v.status, v.rationale
 FROM storage_class_compat_sym v
 JOIN storage_hazard_classes sc ON sc.sc_id=v.sc_a AND sc.code=$1
 JOIN storage_hazard_classes other ON other.sc_id=v.sc_b;
```
Substance-level reactivity + gases (CAMEO):
```sql
WITH me AS (SELECT rg_id FROM substance_reactive_group_link WHERE cas_number=$1)
SELECT g.name AS reacts_with, c.status, c.hazard_codes, c.gas_products
 FROM me JOIN reactive_group_compat c ON (c.rg_a=me.rg_id OR c.rg_b=me.rg_id)
 JOIN chem_reactive_groups g ON g.rg_id = CASE WHEN c.rg_a=me.rg_id THEN c.rg_b ELSE c.rg_a END
 WHERE c.status IN ('incompatible','caution');
```
ADR transport + multi-form choice:
```sql
SELECT d.un_number,d.transport_class,d.packing_group,d.proper_shipping_name
 FROM substance_un_link l JOIN dg_substances d ON d.un_number=l.un_number
 WHERE l.cas_number=$1;   -- >1 row => present as user choice
```

### 4.3 Deep-link, download, SDS bridge
- `?substance=CAS` preselects + runs the verdict (linked from every substance page).
- Download = client-side segregation plan (PDF), rasterize approach per stack notes.
- SDS bridge: contextual ("class is in SDS Section 2"), sub-id `stgsds`, coupons GHS5/GHS10 — **exact SDS-count thresholds PENDING Samiha**; dagger + `rel="sponsored nofollow noopener"` + inline FTC disclosure.

---

## 5. Category pages (13)  (see skeleton)
Blocks top→bottom: hero (class + pictogram/signal + count) · "how we classify" (methodology: GHS + CAMEO group) · storage & handling (pillar-2 rationale + OSHA) · compatibility-at-a-glance (matrix row, pills → other category pages) · **substances in this category** (list, each → `/pictograms/[cas]/`) · FAQ (FAQPage) · quiet SDS bridge · related links.

Substances-in-class query (reverse derivation):
```sql
SELECT DISTINCT s.cas_number, s.common_name, s.signal_word
 FROM substances s LEFT JOIN substance_reactive_group_link l ON l.cas_number=s.cas_number
 LEFT JOIN chem_reactive_groups g ON g.rg_id=l.rg_id
 LEFT JOIN ghs_to_storage_class mr ON mr.source='reactive_group' AND mr.key=g.name
 LEFT JOIN LATERAL unnest(s.h_statement_codes) h(code) ON true
 LEFT JOIN ghs_to_storage_class mh ON mh.source='h_code' AND mh.key=h.code
 WHERE $1 IN (mr.sc_code, mh.sc_code) ORDER BY s.common_name;
```

---

## 6. Homepage placement (see skeleton)
One homepage section: flagship tool card (orange CTA "Open the tool") + "Browse by hazard class" grid of 13 tiles. Five high-intent tiles (Oxidizers, Water-reactives, Flammable liquids, Compressed gases, Organic peroxides) accented (2px border + "Storage guide"). Remember: two footers (Layout.astro AND index.astro).

---

## 7. Pinned titles / H1 (keyword-validated, Semrush)
- **Tool:** `Chemical Storage Compatibility Chart & Segregation Matrix` (segregation chart 40/KD22; incompatible storage CPC $7.83)
- **Guide pillar (volume column):** `Chemical Storage: Requirements & Compatibility Guidelines` (chemical storage 880US/5.2K KD32; requirements 590; how should chemicals be stored 390)
- **Category angle = "examples / storage / hazards", NOT the chemistry head-term:**
  - Oxidizers → `Oxidizers: Examples, Hazards & Safe Storage` (examples of oxidizing agents 480/KD8)
  - Water-reactives → `Water-Reactive Chemicals: List, Hazards & Storage` (170/SD28)
  - Flammable liquids → `Flammable Liquids: Examples & Storage Requirements` (examples 260/KD34; how-to-store 30/SD32)
  - Compressed gases → `Compressed Gas Storage: Requirements & Compatibility` (cylinder storage 30/CPC$5.57)
  - Organic peroxides → `Organic Peroxides: Storage & Peroxide-Forming Hazards`
  - Other 8 (build for completeness + interlinking): oxidizing/organic/mineral acids, bases, reactive metals, acute toxics, cyanides & sulfides, flammable solids.

**Intent traps — do NOT target:** `oxidizing agents` (19K/KD47 = redox chemistry) · `reactive metals`/`list of reactive metals` (reactivity series, Class 10) · `list of (strong) acids` (chemistry + amino acids + acid reflux) · `chemical compatibility chart` (material-resistance) · `hazmat segregation table` (transport).

---

## 8. SEO & schema
- Tool page: `SoftwareApplication` or `WebApplication` + breadcrumb.
- Category page: `CollectionPage` + `ItemList` (substances) + `FAQPage` (from frontmatter `faq`).
- Substance page: existing schema + reactivity enrichment.
- Titles ≤60 chars; never hardcode "| GHS Pictograms" (Layout appends). Sentence/Title per convention.

---

## 9. Copyright & safety
- CAMEO reactivity = US-gov public domain; facts/codes + `source_ref` + link, prose not reproduced.
- Storage matrix = our-words synthesis; NFPA 400 / NFPA 30 / IFC 5003.9.8 named as framework, not reproduced; disclaimer in `source_ref` + on-page ("general guidance; verify SDS 7/10 + local fire code").
- Substance-data safety: values from authoritative data only; class derivation is deterministic from existing codes (safe).
- SDS coupons: tier-accurate copy mandatory → thresholds confirmed with Samiha BEFORE publish.

---

## 10. Build phasing (after sign-off → Cursor, one step at a time)
1. Tool page shell (`output:'server'`, `prerender=false`) + selector + live verdict (segregation + reactivity + ADR).
2. `?substance=CAS` deep-link + substance-page enrichment panel + deep-link back.
3. Category page template (`prerender=true`) + 13 pages (getStaticPaths over 13 classes) + schema.
4. Homepage section (both footers) + tool/category interlinking.
5. Download (PDF) + SDS bridge (after Samiha).

## 11. Open items
- Samiha: coupon → tier/SDS-count mapping (auto-apply vs flat).
- FirstPromoter link `stgsds` (verbatim URL).
- Wave 2: 68 CAMEO reactive-group pages; explosives out of scope.
