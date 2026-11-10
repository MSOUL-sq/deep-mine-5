// Тесты сохранений: аккаунты, пароли, перезапуск сервера, карта. Запуск: npm test
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServerWorld } from '../server/world.js';
import { PlayerManager } from '../server/players.js';
import { attachGame } from '../server/game.js';
import { BLOCK } from '../shared/worldgen.js';
import { sanitizeState } from '../server/features/persistence.js';
import { createFileStore } from '../server/storage/file-store.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepmine-'));
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

/** Запускает «сервер» с папкой сохранений dir. */
async function startServer(store = createFileStore(dir)) {
  const io = new EventEmitter(); const sockets = [];
  io.emit = (ev, data) => sockets.forEach((s) => s.inbox.push([ev, data]));
  const world = new ServerWorld(); const players = new PlayerManager();
  let clock = 1000;
  const game = attachGame(io, { world, players, now: () => clock, log: () => {}, dataDir: dir, store });
  await game.ready;
  const connect = () => {
    const s = new EventEmitter(); s.inbox = [];
    s.emit = (ev, data) => { s.inbox.push([ev, data]); };
    s.broadcast = { emit: () => {} };
    s.client = (ev, data, cb) => EventEmitter.prototype.emit.call(s, ev, data, cb);
    s.leave = () => EventEmitter.prototype.emit.call(s, 'disconnect');
    sockets.push(s); EventEmitter.prototype.emit.call(io, 'connection', s); return s;
  };
  const join = (nickname, password) => { const s = connect(); let r; s.client('join', { nickname, password }, (x) => r = x); return { s, r }; };
  return { world, players, game, join, tick: (ms) => { clock += ms; } };
}

// --- Первый запуск ---
let srv = await startServer();
let { s: a, r: ra } = srv.join('Alice', 'secret1');
ok(ra.ok, 'регистрация нового аккаунта');
const pa = srv.players.get(ra.id);
pa.state.money = 777; pa.state.items.iron = 12; pa.state.pickaxes.push('copper'); pa.state.equipped = 'copper'; pa.state.enchants = { drill: 1, haste: 2 };
// ломаем блок: меняем карту
const spawn = srv.world.spawn; let cell = null;
for (let dx = -3; dx <= 3 && !cell; dx++) for (let dz = -3; dz <= 3 && !cell; dz++) {
  const x = Math.floor(spawn.x) + dx, z = Math.floor(spawn.z) + dz;
  if (srv.world.getBlock(x, spawn.y + 1, z) === BLOCK.AIR) cell = { x, y: spawn.y + 1, z };
}
srv.world.setBlock(cell.x, cell.y, cell.z, BLOCK.BUILT_STONE);
// Гость на чужой ник и неверный пароль
ok(!srv.join('alice', '').r.ok, 'гость не может занять ник (без учёта регистра): ' + srv.join('ALICE', '').r.error);
ok(srv.join('Alice', 'wrongpw').r.error === 'Неверный пароль', 'неверный пароль отклонён');
ok(srv.join('Alice', 'secret1').r.error === 'Этот игрок уже в игре', 'второй вход под тем же аккаунтом запрещён');
ok(srv.join('Bob', 'ab').r.error?.startsWith('Пароль'), 'короткий пароль отклонён');
const guest = srv.join('Guest', ''); ok(guest.r.ok, 'гость без пароля входит');
a.leave(); // выход сохраняет
ok(fs.existsSync(path.join(dir, 'accounts.json')), 'accounts.json создан');
ok(!fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8').includes('secret1'), 'пароль не хранится открытым текстом');
await srv.game.stop(); // остановка сохраняет карту
ok(fs.existsSync(path.join(dir, 'world.json')), 'world.json создан');
ok(!JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')).guest, 'гость не сохранён');

// --- Перезапуск сервера ---
srv = await startServer();
ok(srv.world.getBlock(cell.x, cell.y, cell.z) === BLOCK.BUILT_STONE, 'карта восстановлена после перезапуска');
ok(srv.world.getBlock(0, 10, 0) === BLOCK.BEDROCK, 'оболочка мира цела');
const re = srv.join('alice', 'secret1');
ok(re.r.ok, 'вход в сохранённый аккаунт (ник без учёта регистра)');
const st = srv.players.get(re.r.id).state;
ok(st.money === 777 && st.items.iron === 12, 'деньги и ресурсы сохранены');
ok(st.equipped === 'copper' && st.pickaxes.includes('copper'), 'кирка сохранена');
ok(st.enchants.drill === 1 && st.enchants.haste === 2, 'чары сохранены');
ok(srv.players.get(re.r.id).nickname === 'Alice', 'ник с исходным регистром');
ok(re.r.state.money === 777, 'клиент получил сохранённое состояние при входе');
// блокировка перебора
for (let i = 0; i < 5; i++) srv.join('Alice', 'bad' + i);
srv.players.all().forEach(() => {});
re.s.leave();
ok(srv.join('Alice', 'secret1').r.error === 'Слишком много попыток. Подождите минуту', 'блокировка после 5 неверных паролей');
srv.tick(61000);
ok(srv.join('Alice', 'secret1').r.ok, 'после минуты вход снова возможен');
await srv.game.stop();

// --- Защита от мусора в файлах ---
const s = sanitizeState({ money: -5, items: { iron: 'x', gold: 3.5, coal: 4 }, pickaxes: ['cosmic', 'fake'], equipped: 'fake', enchants: { drill: 99, nope: 1 } });
ok(s.money === 0 && s.items.iron === 0 && s.items.gold === 0 && s.items.coal === 4, 'мусорные числа обнулены');
ok(s.pickaxes.includes('cosmic') && !s.pickaxes.includes('fake') && s.equipped === 'stone', 'неизвестная кирка отброшена');
ok(s.enchants.drill === 1 && !('nope' in s.enchants), 'уровень чары ограничен, неизвестная отброшена');
fs.writeFileSync(path.join(dir, 'world.json'), '{ битый json');
ok(!!(await startServer()), 'битый world.json не роняет сервер');
const w = new ServerWorld();
ok(w.restore([1e12, 1, 5, 99, 0, BLOCK.AIR, 'x']) === 0, 'restore пропускает мусор и оболочку');

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены'); process.exit(fails ? 1 : 0);
