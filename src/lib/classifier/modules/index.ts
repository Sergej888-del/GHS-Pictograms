// src/lib/classifier/modules/index.ts
// Реестр модулей. ⭐⭐ Ненаписанные модули ОБЪЯВЛЕНЫ здесь наравне с готовыми:
// движок берёт из них имя владельца класса и печатает «module A3 (Aquatic
// environment) covers this class and is not built yet» вместо безымянного
// «not computed». Пустая строка без причины — запрещена (урок s76).
//
// ⚠ Классы модулей не должны пересекаться: движок оставит первую строку и
// поднимет `MODULE_OVERLAP`, а `check-engine.ts` не даст такому уехать в прод.
//
// ⛔ `title` уезжает в браузер — по-английски.

import type { ClassifierModule, ModuleOutput } from '../types.ts';
import { acuteToxModule } from './acuteTox.ts';

/** Заглушка: объявляет владение классами, ничего не считает. */
function stub(key: string, title: string, classes: string[]): ClassifierModule {
  return {
    key, title, classes, implemented: false,
    run(): ModuleOutput { return { decisions: [] }; },
  };
}

/**
 * A4 — классы «по отсечке» (design-doc §5.4). Следующий модуль в очереди:
 * ни одной формулы, но прогоняет весь контур — lookup, пары A0, приоритет SCL,
 * провенанс, предупреждения, выход в Label Maker.
 */
export const cutoffModule = stub('A4', 'Cut-off classes', [
  'MUTAGEN', 'CARCINOGEN', 'REPRO_TOX',
  'SKIN_SENS', 'RESP_SENS',
  'STOT_SE', 'STOT_RE',
  'ASPIRATION',
  'ED_HH', 'ED_ENV', 'PBT_VPVB', 'PMT_VPVM', 'OZONE',
]);

/** A3 — водная среда: суммирование Tables 4.1.1/4.1.2 и M-факторы. */
export const aquaticModule = stub('A3', 'Aquatic environment', ['AQUATIC_ACUTE', 'AQUATIC_CHRONIC']);

/** A2 — кожа и глаза: аддитивный и неаддитивный подходы, pH-правило. */
export const skinEyeModule = stub('A2', 'Skin and eye', ['SKIN_CORR_IRRIT', 'EYE_DAMAGE_IRRIT']);

/**
 * A6 — физические опасности. Из состава НЕ выводятся никогда (нужны испытания):
 * этот модуль останется `implemented: false` и после того, как будет написан
 * его подсказочный слой — считать он всё равно не будет.
 */
export const physicalModule = stub('A6', 'Physical hazards', [
  'EXPLOSIVES', 'FLAM_GAS', 'AEROSOL', 'OX_GAS', 'GAS_PRESSURE', 'FLAM_LIQ', 'FLAM_SOL',
  'SELF_REACTIVE', 'PYRO_LIQ', 'PYRO_SOL', 'SELF_HEATING', 'WATER_REACTIVE',
  'OX_LIQ', 'OX_SOL', 'ORG_PEROXIDE', 'CORR_METAL', 'DESENS_EXPLOSIVE',
]);

export const DEFAULT_MODULES: ClassifierModule[] = [
  acuteToxModule,
  cutoffModule,
  aquaticModule,
  skinEyeModule,
  physicalModule,
];

export { acuteToxModule };
