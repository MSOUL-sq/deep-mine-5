// Тест Supabase-хранилища на локальной имитации REST API (PostgREST). Настоящей базы не нужно. Запуск: npm test
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { ServerWorld } from '../server/world.js';
import { PlayerManager } from '../server/players.js';
import { attachGame } from '../server/game.js';
import { BLOCK } from '../shared/worldgen.js';
import { createSupabaseStore } from '../server/storage/supabase-store.js';
import { createStore } from '../server/storage/index.js';

let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

// --- Имитация Supabase REST ---
const KEY = 'service-secret';
const db = { accounts: new Map(), world: new Map() };
const fake = { failNext: 0, posts: 0, log: [] };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
    if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: 'Invalid API key' });
    const m = url.pathname.match(/^\/rest\/v1\/(accounts|world)$/);
    if (!m) return send(404, { message: 'no table' });
    const table = db[m[1]], pk = m[1] === 'accounts' ? 'nick_key' : 'id';
    if (req.method === 'POST') {
      fake.posts++;
      if (fake.failNext > 0) { fake.failNext--; return send(500, { message: 'boom' }); }
      if (!/merge-duplicates/.test(req.headers.prefer || '') || url.searchParams.get('on_conflict') !== pk) return send(400, { message: 'bad upsert' });
      for (const row of JSON.parse(body)) table.set(String(row[pk]), row);
      return send(201);
    }
    if (req.method === 'GET') {
      let rows = [...table.values()];
      const eq = url.searchParams.get('id');
      if (eq) rows = rows.filter((r) => `eq.${r.id}` === eq);
      const limit = Number(url.searchParams.get('limit') || 1000), offset = Number(url.searchParams.get('offset') || 0);
      return send(200, rows.slice(offset, offset + limit));
    }
    send(405, {});
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_BASE = `http://127.0.0.1:${server.address().port}`;
const newStore = () => createSupabaseStore({ url: URL_BASE, key: KEY });

async function startServer(store) {
  const io = new EventEmitter(); const sockets = [];
  io.emit = (ev, data) => sockets.forEach((s) => s.inbox.push([ev, data]));
  const world = new ServerWorld(); const players = new PlayerManager();
  const logs = [];
  const game = attachGame(io, { world, players, now: () => Date.now(), log: (m) => logs.push(m), store });
  await game.ready;
  const join = (nickname, password) => {
    const s = new EventEmitter(); s.inbox = []; s.emit = () => {}; s.broadcast = { emit: () => {} };
    s.client = (ev, data, cb) => EventEmitter.prototype.emit.call(s, ev, data, cb);
    s.leave = () => EventEmitter.prototype.emit.call(s, 'disconnect');
    sockets.push(s); EventEmitter.prototype.emit.call(io, 'connection', s);
    let r; s.client('join', { nickname, password }, (x) => r = x); return { s, r };
  };
  return { world, players, game, join, logs };
}

// --- Первый запуск: регистрация, прогресс, карта ---
let srv = await startServer(newStore());
const a = srv.join('Alice', 'secret1'); ok(a.r.ok, 'регистрация через Supabase');
await new Promise((r) => setTimeout(r, 50));
ok(db.accounts.has('alice'), 'аккаунт записан в таблицу accounts сразу при регистрации');
const pl = srv.players.get(a.r.id);
pl.state.money = 4242; pl.state.items.diamond = 3; pl.state.enchants = { drill: 1 };
srv.world.setBlock(50, 14, 50, BLOCK.BUILT_STONE);
fake.failNext = 2;                                        // временный сбой сети/базы при выходе
a.s.leave();
await new Promise((r) => setTimeout(r, 50));
ok(srv.logs.some((l) => /не сохранен/.test(l)), 'сбой записи залогирован, сервер не упал');
await srv.game.stop();                                    // остановка повторяет неудавшиеся записи
const row = db.accounts.get('alice');
ok(row && row.state.money === 4242 && row.state.items.diamond === 3, 'после сбоя данные дозаписаны при остановке');
ok(row.hash && !JSON.stringify(row).includes('secret1') && row.salt && row.nickname === 'Alice', 'в базе хеш и соль, пароля нет');
ok(db.world.get('1')?.changes.length >= 2, 'карта записана в таблицу world');

// --- Перезапуск: всё из базы ---
srv = await startServer(newStore());
ok(srv.world.getBlock(50, 14, 50) === BLOCK.BUILT_STONE, 'карта загружена из Supabase');
const b = srv.join('ALICE', 'secret1');
ok(b.r.ok && b.r.state.money === 4242 && b.r.state.items.diamond === 3 && b.r.state.enchants.drill === 1, 'вход: деньги, ресурсы и чары из базы');
ok(srv.join('Alice', 'nope').r.error === 'Неверный пароль', 'пароль проверяется по хешу из базы');
await srv.game.stop();

// --- Пагинация: больше 1000 аккаунтов ---
for (let i = 0; i < 1500; i++) db.accounts.set(`u${i}`, { nick_key: `u${i}`, nickname: `U${i}`, salt: 's', hash: 'h', state: {}, last_seen: new Date().toISOString() });
const loaded = await newStore().loadAccounts();
ok(Object.keys(loaded).length === 1501, 'загрузка постранично: ' + Object.keys(loaded).length);

// --- Ошибки конфигурации ---
const bad = createSupabaseStore({ url: URL_BASE, key: 'wrong' });
let err = null; try { await bad.loadAccounts(); } catch (e) { err = e; }
ok(err && /401/.test(err.message) && /SUPABASE_SERVICE_KEY/.test(err.message), 'неверный ключ: понятная ошибка');
let failedStart = false;
try { await startServer(bad); } catch { failedStart = true; }
ok(failedStart, 'сервер не стартует, если сохранения не загрузились');
ok(createStore({ dataDir: '/tmp/x-deepmine', env: {} }).name.startsWith('файлы'), 'без переменных окружения — файлы');
ok(createStore({ dataDir: '/tmp/x', env: { SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_KEY: KEY } }).name.startsWith('Supabase'), 'с переменными — Supabase');
let cfg = null; try { createStore({ dataDir: '/tmp/x', env: { SUPABASE_URL: URL_BASE } }); } catch (e) { cfg = e; }
ok(cfg && /SUPABASE_SERVICE_KEY/.test(cfg.message), 'одна переменная без другой — ошибка');

import('node:fs').then((fs) => fs.rmSync('/tmp/x-deepmine', { recursive: true, force: true }));
server.close();
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены'); process.exit(fails ? 1 : 0);
