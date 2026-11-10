// Правила экономики: продажа ресурсов, покупка и выбор кирки.
// Чистые функции над состоянием игрока { money, items, pickaxes, equipped }.
// Клиент вызывает их для мгновенного отклика, сервер (этап мультиплеера) — для настоящей проверки.
import { ITEMS, PICKAXES } from './blocks.js';

export function createPlayerState() {
  const items = {};
  for (const id of Object.keys(ITEMS)) items[id] = 0;
  return { money: 0, items, pickaxes: ['stone'], equipped: 'stone', enchants: {} };
}

const fail = (error) => ({ ok: false, error });

/** Продаёт amount единиц предмета по его цене. */
export function sellItem(state, id, amount) {
  if (!Object.hasOwn(ITEMS, id)) return fail('Неизвестный предмет');
  if (!Number.isInteger(amount) || amount <= 0) return fail('Неверное количество');
  if ((state.items[id] || 0) < amount) return fail('Недостаточно ресурсов');
  state.items[id] -= amount;
  const gain = ITEMS[id].value * amount;
  state.money += gain;
  return { ok: true, gain };
}

/** Покупает кирку и сразу берёт её в руки. */
export function buyPickaxe(state, id) {
  const pick = Object.hasOwn(PICKAXES, id) ? PICKAXES[id] : null;
  if (!pick) return fail('Неизвестная кирка');
  if (state.pickaxes.includes(id)) return fail('Кирка уже куплена');
  if (state.money < pick.cost) return fail(`Не хватает монет: нужно ${pick.cost}`);
  state.money -= pick.cost;
  state.pickaxes.push(id);
  state.equipped = id;
  return { ok: true };
}

/** Берёт купленную кирку в руки. */
export function equipPickaxe(state, id) {
  if (!state.pickaxes.includes(id)) return fail('Кирка не куплена');
  state.equipped = id;
  return { ok: true };
}

/** Продаёт все ресурсы разом. */
export function sellEverything(state) {
  let gain = 0;
  for (const id of Object.keys(ITEMS)) {
    const n = state.items[id] || 0;
    if (n > 0) { const r = sellItem(state, id, n); if (r.ok) gain += r.gain; }
  }
  return gain > 0 ? { ok: true, gain } : fail('Нечего продавать');
}
