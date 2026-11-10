// Тесты плагинов: чары (бур, удача, спешка) и передача ресурсов. Запуск: npm test
import { EventEmitter } from 'node:events';
import { ServerWorld } from '../server/world.js';
import { PlayerManager } from '../server/players.js';
import { attachGame } from '../server/game.js';
import { BLOCK } from '../shared/worldgen.js';
import { ENCHANTS, buyEnchant, effectivePick, extraTargets, dropBonus } from '../shared/enchants.js';
import { createPlayerState } from '../shared/economy.js';

const io = new EventEmitter(); const sockets = [];
io.emit = (ev, data) => sockets.forEach((s) => s.inbox.push([ev, data]));
function connect() {
  const s = new EventEmitter(); s.inbox = [];
  s.emit = (ev, data) => { s.inbox.push([ev, data]); };
  s.broadcast = { emit: (ev, data) => sockets.filter((o) => o !== s).forEach((o) => o.inbox.push([ev, data])) };
  s.client = (ev, data, cb) => EventEmitter.prototype.emit.call(s, ev, data, cb);
  sockets.push(s); EventEmitter.prototype.emit.call(io, 'connection', s); return s;
}
const world = new ServerWorld(); const players = new PlayerManager();
let clock = 1000;
attachGame(io, { world, players, now: () => clock, log: () => {} }).stop();
const ev = (s, name) => s.inbox.filter(([e]) => e === name).map(([, d]) => d);
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

// --- Чистая логика чар ---
const st = createPlayerState();
ok(buyEnchant(st, 'drill').error?.startsWith('Не хватает'), 'чара без денег не покупается');
st.money = 100000;
ok(buyEnchant(st, 'drill').ok && st.enchants.drill === 1, 'бур куплен');
ok(buyEnchant(st, 'drill').error === 'Максимальный уровень', 'бур — только 1 уровень');
ok(!buyEnchant(st, '__proto__').ok && !buyEnchant(st, 'xyz').ok, 'левая чара отклонена');
ok(extraTargets(st, { x: 10, y: 10, z: 10, nx: 0, ny: 0, nz: 1 }).length === 8, 'бур: 8 доп. блоков (3×3)');
const tg = extraTargets(st, { x: 10, y: 10, z: 10, nx: 0, ny: 1, nz: 0 });
ok(tg.every((t) => t.y === 10) && tg.some((t) => t.x === 9 && t.z === 11), 'бур по верхней грани: плоскость XZ');
buyEnchant(st, 'haste'); buyEnchant(st, 'haste');
ok(Math.abs(effectivePick(st).speed - 1.6 * 1.3) < 1e-9, 'спешка 2 ур.: скорость ×1.3');
buyEnchant(st, 'fortune'); buyEnchant(st, 'fortune'); buyEnchant(st, 'fortune');
ok(dropBonus(st, () => 0.1) === 1 && dropBonus(st, () => 0.99) === 0, 'удача: бонус по броску');

// --- Сервер: бур ---
const a = connect(), b = connect(); let ra, rb;
a.client('join', { nickname: 'Alice' }, (r) => ra = r); b.client('join', { nickname: 'Bob' }, (r) => rb = r);
const pa = players.get(ra.id), pb = players.get(rb.id);
pa.state.enchants = { drill: 1 };
pa.state.pickaxes.push('cosmic'); pa.state.equipped = 'cosmic';   // сильная кирка: каждый удар ломает мягкие блоки
// Стена камня рядом: найдём блок камня, у которого весь квадрат 3×3 в плоскости z твёрдый
let found = null;
outer: for (let y = 2; y < 40; y++) for (let z = 40; z < 56; z++) for (let x = 40; x < 56; x++) {
  if (world.getBlock(x, y, z + 1) !== BLOCK.AIR) continue;      // грань смотрит в +z
  let all = true;
  for (let dx = -1; dx <= 1 && all; dx++) for (let dy = -1; dy <= 1 && all; dy++) if (world.getBlock(x + dx, y + dy, z) !== BLOCK.STONE) all = false;
  if (all) { found = { x, y, z }; break outer; }
}
ok(!!found, 'нашёл стену камня 3×3');
pa.x = found.x + 0.5; pa.y = found.y - 1; pa.z = found.z + 2.5;
clock += 1000;
a.client('hit', { ...found, nx: 0, ny: 0, nz: 1 });
let gone = 0;
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (world.getBlock(found.x + dx, found.y + dy, found.z) === BLOCK.AIR) gone++;
ok(gone === 9, 'бур сломал 9 блоков за удар: ' + gone);
ok(pa.state.items.stone === 9, 'за 9 блоков получено 9 камня');
ok(ev(b, 'block').filter((e) => e.type === 0).length >= 9, 'Bob получил 9 событий block');

// обычный удар без нормали — без бура
pa.state.enchants = { drill: 1 };
clock += 1000;
const before = world.changes.size;
a.client('hit', { x: found.x, y: found.y, z: found.z - 1 });
ok(world.changes.size - before <= 1, 'без нормали бур не срабатывает');
// мусорная нормаль
clock += 1000; const c0 = world.changes.size;
a.client('hit', { x: found.x, y: found.y, z: found.z - 1, nx: 5, ny: 0, nz: 0 });
ok(world.changes.size - c0 <= 1, 'неверная нормаль игнорируется');

// --- Покупка чар на сервере ---
pa.state.money = 0; let r;
pa.x = world.workshop.x + 5; pa.z = world.workshop.z; pa.y = world.workshop.y;
pa.x = 1.5; pa.y = 10; pa.z = 1.5;
a.client('enchant', { id: 'haste' }, (x) => r = x); ok(!r.ok && r.error === 'Подойдите к мастерской', 'чары: далеко от мастерской');
const w = world.workshop; pa.x = w.x; pa.y = w.y; pa.z = w.z;
a.client('enchant', { id: 'haste' }, (x) => r = x); ok(!r.ok && /Не хватает/.test(r.error), 'чары: нет денег');
pa.state.money = 700;
a.client('enchant', { id: 'haste' }, (x) => r = x); ok(r.ok && pa.state.enchants.haste === 1 && pa.state.money === 100, 'чары: куплена спешка');
ok(ev(a, 'state').length > 0, 'игрок получил state после покупки');

// --- Передача ---
pa.x = pb.x; pa.y = pb.y; pa.z = pb.z;
pa.state.items.iron = 10; pb.state.items.iron = 0; pa.state.money = 500; pb.state.money = 0;
clock += 1000; a.client('give', { to: rb.id, item: 'iron', amount: 4 }, (x) => r = x);
ok(r.ok && pa.state.items.iron === 6 && pb.state.items.iron === 4, 'передано 4 железа');
ok(ev(b, 'state').length > 0 && ev(b, 'chat').some((m) => m.system && /Alice передал вам/.test(m.text)), 'получатель уведомлён');
clock += 1000; a.client('give', { to: rb.id, item: 'money', amount: 200 }, (x) => r = x);
ok(r.ok && pa.state.money === 300 && pb.state.money === 200, 'переданы монеты');
clock += 1000; a.client('give', { to: rb.id, item: 'iron', amount: 99 }, (x) => r = x); ok(!r.ok, 'больше, чем есть — отказ: ' + r.error);
clock += 1000; a.client('give', { to: rb.id, item: 'iron', amount: -5 }, (x) => r = x); ok(!r.ok, 'отрицательное количество — отказ');
clock += 1000; a.client('give', { to: rb.id, item: 'iron', amount: 1.5 }, (x) => r = x); ok(!r.ok, 'дробное количество — отказ');
clock += 1000; a.client('give', { to: ra.id, item: 'iron', amount: 1 }, (x) => r = x); ok(!r.ok, 'самому себе — отказ');
clock += 1000; a.client('give', { to: 'p999', item: 'iron', amount: 1 }, (x) => r = x); ok(!r.ok, 'несуществующему игроку — отказ');
clock += 1000; a.client('give', { to: rb.id, item: '__proto__', amount: 1 }, (x) => r = x); ok(!r.ok, 'левый предмет — отказ');
clock += 1000; a.client('give', { to: rb.id, item: 'iron', amount: 1 }, (x) => r = x); a.client('give', { to: rb.id, item: 'iron', amount: 1 }, (x) => r = x);
ok(!r.ok && r.error === 'Не так быстро', 'антиспам передач');
clock += 1000; pa.x += 30; a.client('give', { to: rb.id, item: 'iron', amount: 1 }, (x) => r = x); ok(!r.ok && /далеко/.test(r.error), 'слишком далеко — отказ');
pa.x -= 30;
// команда /give
clock += 1000; const iron0 = pb.state.items.iron;
a.client('chat', { text: '/give bob железо 2' }, () => {});
ok(pb.state.items.iron === iron0 + 2, '/give bob железо 2 работает');
clock += 1000; a.client('chat', { text: '/give' }, () => {});
ok(ev(a, 'chat').some((m) => m.system && /Пример: \/give/.test(m.text)), '/give без аргументов — подсказка');
clock += 1000; a.client('chat', { text: '/help' }, () => {});
ok(ev(a, 'chat').some((m) => m.system && /\/give/.test(m.text)), '/help показывает /give');

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены'); process.exit(fails ? 1 : 0);
