// Чары (зачарования). ОДИН реестр: чтобы добавить чару — допиши объект в ENCHANTS, больше нигде менять не нужно.
// Игрок покупает чары в мастерской; они действуют на любую кирку в руках и складываются.
//
// Хуки (все необязательные, чистые функции — работают и на клиенте, и на сервере):
//   stats(level, s)            — меняет характеристики кирки: s.power, s.speed (изменяйте объект s)
//   extraTargets(level, hit)   — какие ещё блоки разрушает тот же удар. hit = { x, y, z, nx, ny, nz } (нормаль грани)
//                                возвращает массив [{x, y, z}, ...]
//   dropBonus(level, rng)      — сколько дополнительных предметов выпадает из сломанной руды (rng() даёт 0..1)
import { PICKAXES } from './blocks.js';

export const ENCHANTS = {
  drill: {
    id: 'drill', name: 'Бур 3×3', icon: '🌀',
    desc: 'Каждый удар разрушает квадрат 3×3 блока перед вами.',
    costs: [1500],                       // цена каждого уровня по порядку; длина массива = макс. уровень
    extraTargets(level, h) {
      const out = [];
      // Плоскость 3×3, перпендикулярная грани, в которую попал удар
      const axes = h.nx !== 0 ? ['y', 'z'] : h.ny !== 0 ? ['x', 'z'] : ['x', 'y'];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (a === 0 && b === 0) continue;
        const t = { x: h.x, y: h.y, z: h.z };
        t[axes[0]] += a; t[axes[1]] += b;
        out.push(t);
      }
      return out;
    },
  },
  fortune: {
    id: 'fortune', name: 'Удача', icon: '🍀',
    desc: 'Шанс +1 к добыче с каждого блока: 25% за уровень.',
    costs: [800, 2000, 5000],
    dropBonus: (level, rng) => (rng() < level * 0.25 ? 1 : 0),
  },
  haste: {
    id: 'haste', name: 'Спешка', icon: '⚡',
    desc: 'Скорость ударов +15% за уровень.',
    costs: [600, 1500, 4000],
    stats: (level, s) => { s.speed *= 1 + 0.15 * level; },
  },
};

export const ENCHANT_ORDER = Object.keys(ENCHANTS);

const levelsOf = (state) => (state && state.enchants) || {};
const active = (state) => ENCHANT_ORDER.filter((id) => levelsOf(state)[id] > 0);

/** Кирка в руках с учётом чар: { ...PICKAXES[id], power, speed }. */
export function effectivePick(state) {
  const base = PICKAXES[state.equipped];
  const s = { ...base };
  for (const id of active(state)) ENCHANTS[id].stats?.(levelsOf(state)[id], s);
  return s;
}

/** Дополнительные блоки, которые разрушает удар (бур и т.п.). */
export function extraTargets(state, hit) {
  return active(state).flatMap((id) => ENCHANTS[id].extraTargets?.(levelsOf(state)[id], hit) || []);
}

/** Сколько лишних предметов выпадет из одного сломанного блока. */
export function dropBonus(state, rng = Math.random) {
  return active(state).reduce((sum, id) => sum + (ENCHANTS[id].dropBonus?.(levelsOf(state)[id], rng) || 0), 0);
}

/** Покупка следующего уровня чары. Возвращает { ok } или { ok: false, error }. */
export function buyEnchant(state, id) {
  if (!Object.hasOwn(ENCHANTS, id)) return { ok: false, error: 'Неизвестная чара' };
  const e = ENCHANTS[id];
  const level = levelsOf(state)[id] || 0;
  if (level >= e.costs.length) return { ok: false, error: 'Максимальный уровень' };
  const cost = e.costs[level];
  if (state.money < cost) return { ok: false, error: `Не хватает монет: нужно ${cost}` };
  state.money -= cost;
  state.enchants = { ...levelsOf(state), [id]: level + 1 };
  return { ok: true, level: level + 1 };
}
