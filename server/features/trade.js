// Передача ресурсов и монет другому игроку: событие 'give' и команда /give <ник> <предмет> <кол-во>.
import { ITEMS } from '../../shared/blocks.js';

const TRADE_RANGE = 12;      // макс. расстояние между игроками, блоков
const COOLDOWN = 0.4;        // секунд между передачами
const MAX_AMOUNT = 1e9;

const MONEY = { id: 'money', name: 'Монеты' };
const label = (id) => (id === 'money' ? MONEY.name : ITEMS[id].name);

/** Переводит предмет ('money' — монеты) от одного игрока другому. Возвращает { ok } или { ok: false, error }. */
export function transfer(api, from, to, item, amount) {
  if (!to || to === from) return { ok: false, error: 'Выберите другого игрока' };
  if (item !== 'money' && !Object.hasOwn(ITEMS, item)) return { ok: false, error: 'Неизвестный предмет' };
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) return { ok: false, error: 'Неверное количество' };
  const t = api.now();
  if (t - (from.lastGiveAt ?? -10) < COOLDOWN) return { ok: false, error: 'Не так быстро' };
  if (Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z) > TRADE_RANGE) return { ok: false, error: 'Игрок слишком далеко' };

  const have = item === 'money' ? from.state.money : from.state.items[item];
  if (have < amount) return { ok: false, error: 'Недостаточно ресурсов' };

  from.lastGiveAt = t;
  if (item === 'money') { from.state.money -= amount; to.state.money += amount; }
  else { from.state.items[item] -= amount; to.state.items[item] += amount; }
  api.sendState(from); api.sendState(to);
  api.say(from, `Вы передали ${to.nickname}: ${label(item)} ×${amount}`);
  api.say(to, `${from.nickname} передал вам: ${label(item)} ×${amount}`);
  api.log(`[trade] ${from.nickname} -> ${to.nickname}: ${item} x${amount}`);
  return { ok: true };
}

/** "железо" или "iron" -> 'iron'; "монеты" -> 'money'; иначе null. */
function parseItem(word) {
  const w = String(word || '').toLowerCase();
  if (w === 'money' || w === 'монеты' || w === 'деньги') return 'money';
  return Object.keys(ITEMS).find((id) => id === w || ITEMS[id].name.toLowerCase() === w) || null;
}

export default function register(api) {
  // Клиент -> сервер: 'give' { to: id игрока, item, amount }
  api.onEvent('give', ({ me }, d, reply) => {
    if (!d || typeof d.to !== 'string' || typeof d.item !== 'string') return reply({ ok: false, error: 'Неверный запрос' });
    reply(transfer(api, me, api.players.get(d.to), d.item, d.amount));
  });

  // Чат: /give <ник> <предмет> <кол-во>
  api.command('give', '<ник> <предмет> <кол-во> — передать ресурсы или монеты', ({ me }, args, say) => {
    const [nick, itemWord, amountWord] = args;
    const item = parseItem(itemWord);
    if (!nick || !item || !amountWord) return say('Пример: /give Alex железо 5  (предметы: ' + Object.values(ITEMS).map((i) => i.name.toLowerCase()).join(', ') + ', монеты)');
    const res = transfer(api, me, api.findPlayer(nick), item, Number(amountWord));
    if (!res.ok) say(res.error === 'Выберите другого игрока' ? 'Игрок не найден или это вы' : res.error);
  });
}
