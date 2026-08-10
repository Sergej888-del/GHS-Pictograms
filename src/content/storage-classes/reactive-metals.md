---
slug: reactive-metals
title: "Reactive metals: alkali metals and pyrophoric powders"
description: "Why lithium, sodium and potassium cannot be stored anywhere water can reach them, why aluminium and magnesium powder ignite in air, what a Class D fire is, and what these metals must never share a room with."
intro: "Two different hazards share this class. Alkali metals tear hydrogen out of water fast enough to ignite it. Finely divided metal powders ignite in plain air. What they have in common is that the usual firefighting instincts — water, foam, carbon dioxide — make both of them worse."
updatedDate: 2026-08-10
keywords:
  - reactive metals storage
  - alkali metals water reaction
  - pyrophoric metal powder
  - class d fire
  - sodium potassium lithium storage
  - combustible metal dust
  - h250 h260 h261
faq:
  - q: "Why do alkali metals react so violently with water?"
    a: "CAMEO Chemicals, the NOAA/EPA reactivity database, puts it in one sentence: materials in this group 'react, usually vigorously, with any substance having active hydrogen atoms to liberate gaseous hydrogen. This includes alcohols and acids, and most importantly, water.' The escalation is what matters. The reaction 'is violently rapid and quite exothermic. It produces gaseous hydrogen and other products. The heat that is generated is sufficient to melt the unreacted metal, ignite the liberated hydrogen and ignite the metal itself.' So a small amount of water does not produce a small reaction — it produces heat, then fuel, then a metal fire, in that order."
  - q: "What is a Class D fire?"
    a: "OSHA defines it at 29 CFR 1910.155(c)(11): 'Class D fire means a fire involving combustible metals such as magnesium, titanium, zirconium, sodium, lithium and potassium.' It is a separate class because the extinguishing agents for the other classes are wrong here. Where combustible metal powders, flakes or shavings are generated at least once every two weeks, OSHA requires Class D extinguishing agent to be distributed 'so that the travel distance from the combustible metal working area to any extinguishing agent is 75 feet (22.9 m) or less' — 29 CFR 1910.157(d)(6)."
  - q: "Can you use a CO2 extinguisher on a burning metal?"
    a: "No, and the reason is more fundamental than 'it does not work'. CAMEO's reactive-group documentation states that alkali metals 'are nonflammable, but they are combustible' and that 'they may also burn in carbon dioxide and in nitrogen'. Carbon dioxide is not inert towards them, so it is not smothering anything — it is another oxidant. The emergency-response guidance for sodium and potassium is explicit about the other two instincts as well: 'DO NOT USE WATER OR FOAM.' Recommended agents are dry chemical, soda ash, lime, dry sand, sodium chloride powder, graphite powder or a Class D extinguisher."
  - q: "Why is aluminium powder dangerous when aluminium foil is not?"
    a: "Surface area. The harmonised entries in this class are specifically for the pyrophoric powder forms — the EU list names them that way, 'aluminium powder (pyrophoric)', 'magnesium powder (pyrophoric)', 'zinc powder — zinc dust (pyrophoric)', 'zirconium powder (pyrophoric)'. A pyrophoric solid is one which 'even in small quantities, is liable to ignite within five minutes after coming into contact with air'. The bulk metal has an oxide skin and almost no surface relative to its mass; the powder is nearly all surface. OSHA's combustible dust guidance places aluminium and magnesium dusts in the strongest dust-explosion class."
  - q: "What must reactive metals never be stored with?"
    a: "Four classes: mineral acids, oxidizing acids, oxidizers and organic peroxides. Acids are prohibited because the metal-plus-acid reaction generates hydrogen directly and fast, and with an oxidizing acid it also generates heat and nitrogen oxides. The oxidizer classes are prohibited because a burning metal is already difficult to extinguish with the oxygen available in air; adding a chemical oxygen source removes the last limit. The one class marked generally compatible is water-reactives — not because the pairing is benign, but because it is the same hazard and the same control: an absolutely dry, sealed store."
draft: false
---

## Two hazards, one class

This class holds thirteen substances, and they do not all belong to it for the same reason.

The first group is the **alkali metals** — lithium, sodium, potassium — plus **calcium**. Their hazard is water. [CAMEO Chemicals](https://cameochemicals.noaa.gov/react/21), the NOAA/EPA reactivity database, documents the mechanism for the group:

> "Their reaction with water is violently rapid and quite exothermic. It produces gaseous hydrogen and other products. The heat that is generated is sufficient to melt the unreacted metal, ignite the liberated hydrogen and ignite the metal itself."

The harmonised EU classification says the same thing in code: lithium, sodium and potassium all carry **H260** — in contact with water releases flammable gases which may ignite spontaneously — together with **H314** for the corrosive hydroxide the reaction leaves behind. Calcium carries **H261**, the slower version of the same statement.

The second group is **metal powders**: aluminium, magnesium, zinc and zirconium. The EU list names them explicitly for the form — "aluminium powder (pyrophoric)", "magnesium powder (pyrophoric)", "zinc powder — zinc dust (pyrophoric)", "zirconium powder (pyrophoric)" — and gives them **H250**, catches fire spontaneously if exposed to air, usually alongside H260 or H261 as well. [OSHA's criteria](https://www.osha.gov/hazcom/appendix-b) define a pyrophoric solid as one which, "even in small quantities, is liable to ignite within five minutes after coming into contact with air" (B.10.1).

That is the whole difference between a roll of aluminium foil and a drum of aluminium powder. Not the chemistry — the surface area.

### The water-reactivity criteria are numeric

The three water-reactive categories are set by how much flammable gas comes off, and how fast (B.12, Table B.12.1):

| Category | Criterion | Statement |
|---|---|---|
| **1** | Reacts vigorously with water at ambient temperature, the gas generally tends to ignite spontaneously, **or** ≥ 10 litres of gas per kg of chemical **in any one minute** | H260 — in contact with water releases flammable gases, which may ignite spontaneously |
| **2** | ≥ 20 litres per kg **per hour**, and not Category 1 | H261 — in contact with water releases flammable gas |
| **3** | Reacts slowly; ≥ 1 litre per kg **per hour**, and not Category 1 or 2 | H261 |

The jump from Category 1 to Category 2 is a factor of thirty in time — a minute against an hour. That is the practical difference between a spill that catches fire while you are still looking at it and one that fills a closed cabinet with hydrogen over a shift.

### How we classify this page's substances

Unlike most classes on this site, membership here comes **entirely from documented reactivity data** — the CAMEO reactive groups *Metals, Alkali, Very Active* (3 substances) and *Metals, Elemental and Powder, Active* (10) — and **not from a hazard code**. There is no GHS hazard class called "reactive metal", so there is no code to anchor on.

That has an honest consequence which this page states rather than hides. **Four of the thirteen carry no physical hazard code at all.**

| Substance | Harmonised hazard statements | Why it is here |
|---|---|---|
| beryllium | H350i, H330, H301, H335, H372, H315, H319, H317 | carcinogen and acute toxicant — **no fire or water-reactivity code** |
| cobalt | H350, H341, H360F, H334, H317, H413 | carcinogen, mutagen, respiratory sensitiser — **no fire code** |
| nickel | H351, H372, H317 | suspected carcinogen, sensitiser — **no fire code** |
| selenium | H331, H301, H373, H413 | acute toxicant — **no fire code**, and it is not a metal but a metalloid |

These four are in the class because CAMEO groups the finely divided element as an active metal powder, which is defensible as combustible-dust chemistry. But their **harmonised classification is entirely health-based**, and for a storekeeper that is the hazard that should drive the decision. Beryllium and cobalt are not stored the way sodium is stored; they are stored the way a carcinogen is stored, with exposure control as the governing constraint.

Cadmium is the one that sits in both camps: the EU entry is "cadmium (pyrophoric)" and it carries H250 **and** H350, H341, H361fd, H330, H372, H400 and H410.

All thirteen carry the signal word **Danger**. Nine carry the GHS02 flame; five carry GHS08.

## Why water, foam and CO₂ are all the wrong answer

Most fire instincts are trained on carbon fires, and every one of them fails here.

**Water** is fuel. The emergency-response guidance for [sodium](https://cameochemicals.noaa.gov/chemical/7794) and [potassium](https://cameochemicals.noaa.gov/chemical/4289) states it in capitals — "DO NOT USE WATER OR FOAM" — and describes the reaction: sodium "reacts violently with water to give sodium hydroxide and hydrogen, which ignites spontaneously"; potassium "IGNITES WHEN EXPOSED TO WATER OR MOISTURE".

**Foam** is mostly water, and fails for the same reason.

**Carbon dioxide** is the one that surprises people, because it is the universal "safe" agent for electrical and liquid fires. CAMEO's group documentation is unambiguous: alkali metals "are nonflammable, but they are combustible", and "they may also burn in carbon dioxide and in nitrogen". A CO₂ extinguisher on a burning alkali metal is not an inert blanket — it is an oxidant.

What is left is the Class D set: dry chemical, soda ash, lime, dry sand, sodium chloride powder, graphite powder. OSHA's requirement is about availability rather than technique — where combustible metal powders, flakes, shavings or similarly sized products are generated at least once every two weeks, [29 CFR 1910.157(d)(6)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.157) requires that "the travel distance from the combustible metal working area to any extinguishing agent is 75 feet (22.9 m) or less".

A store holding these metals should be planned backwards from that sentence: where is the Class D agent, and how far is it from the drum?

## Powder is a different problem from bulk

Everything above concerns the material sitting in a container. The moment it is airborne, it is a different hazard with a different regulatory home.

OSHA's [Combustible Dust National Emphasis Program](https://www.osha.gov/sites/default/files/enforcement/directives/CPL_03-00-008.pdf) (CPL 03-00-008) defines combustible dust as "a finely divided combustible particulate solid that presents a flash-fire hazard or explosion hazard when suspended in air or the process-specific oxidizing medium over a range of concentrations", and lists "metal dust such as aluminum, magnesium, and some forms of iron dusts" first among the materials in scope. OSHA's [combustible dust guidance for hazard communication](https://www.osha.gov/sites/default/files/publications/3371COMBUSTIBLE-DUST.pdf) places aluminium and magnesium dusts in **St 3**, the most severe dust-explosion class.

Practically: a sealed drum of magnesium powder in a dry store is a storage problem. The same powder in a dust extraction duct, on a beam, or in a layer on top of a light fitting is a deflagration waiting for an ignition source, and no storage cabinet addresses it.

## Segregation

Four classes are marked **never store with**, and they split into two arguments.

**Acids — mineral acids and [oxidizing acids](/storage-compatibility/oxidizing-acids/).** The metal-plus-acid reaction produces hydrogen directly, without needing water to arrive first, and it does so at a rate set by surface area — which for a powder is very high. With an oxidizing acid the reaction also produces heat and nitrogen oxides.

**Oxidizer classes — [oxidizers](/storage-compatibility/oxidizers/) and [organic peroxides](/storage-compatibility/organic-peroxides/).** A metal fire is already hard to extinguish using only atmospheric oxygen. A chemical oxygen source removes the last constraint, and intimately mixed metal powder and oxidizer is the composition of a pyrotechnic rather than of a fire.

Seven classes sit at **keep separate**. One — [water-reactives and pyrophorics](/storage-compatibility/water-reactives/) — is marked generally compatible, and it is worth being precise about what that means: it is not that the pairing is harmless, but that it is the same hazard needing the same control. A dry, sealed, sprinkler-free store with a Class D agent at the door serves both.

⚠ One consequence of the two-population problem above: for beryllium, cobalt, nickel and selenium the class-level segregation is about the wrong hazard. Their controlling risk is inhalation, and the substance's own SDS sections 7 and 8 govern.

The flame pictogram is [GHS02](/ghs/ghs02/) and the health-hazard pictogram carried by five of these substances is [GHS08](/ghs/ghs08/). Class-level segregation is a starting point rather than a verdict on any individual substance: check SDS sections 7 and 10, or look the substance up in the [storage compatibility matrix](/tools/chemical-storage-compatibility/). The prohibited classes have their own pages — [oxidizers](/storage-compatibility/oxidizers/), [oxidizing acids](/storage-compatibility/oxidizing-acids/), [organic peroxides and self-reactives](/storage-compatibility/organic-peroxides/) — and the closest relative of this class is [water-reactives and pyrophorics](/storage-compatibility/water-reactives/).
