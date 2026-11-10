// Игровая логика сервера, не зависящая от транспорта: работает с любым объектом io в стиле Socket.IO.
// Сервер проверяет всё: добычу, строительство, наличие ресурсов, покупки и перемещение.
import {
  REACH, SHOP_RANGE, NET_REACH_TOLERANCE,
} from '../shared/constants.js';
import { SIZE_X, SIZE_Y, SIZE_Z } from '../shared/worldgen.js';
import { effectivePick, extraTargets, dropBonus } from '../shared/enchants.js';
import { BUILD_KINDS, validatePlacement, canAfford, payCost } from '../shared/building.js';
import { sellItem, sellEverything, buyPickaxe, equipPickaxe } from '../shared/economy.js';
import { sanitizeNickname, sanitizeChat } from './players.js';
import { features } from './features/index.js';

const MOVE_TICK_MS = 50;       // как часто рассылаются позиции
const PLACE_COOLDOWN = 0.12;   // секунд между постройками одного игрока
const MAX_MOVE_BASE = 8;       // максимальный скачок позиции + MAX_MOVE_SPEED * dt
const MAX_MOVE_SPEED = 45;
const CHAT_COOLDOWN = 0.6;     // секунд между сообщениями одного игрока
const CHAT_HISTORY = 50;       // сколько сообщений помнит сервер (их получает новый игрок)
const STUCK_COOLDOWN = 10;     // /stuck — возврат на спавн, не чаще раза в 10 секунд
const RESPAWN_COOLDOWN = 3;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v) => Math.round(v * 1000) / 1000;

export function attachGame(io, { world, players, now = () => Date.now(), log = console.log, dataDir = null, store = null }) {
  const nowSec = () => now() / 1000;

  // --- Чат: история и системные сообщения ----------------------------------
  const chatLog = [];
  const remember = (msg) => { chatLog.push(msg); if (chatLog.length > CHAT_HISTORY) chatLog.shift(); return msg; };
  const systemMsg = (text) => ({ system: true, text, t: now() });

  // --- API для плагинов (server/features/*.js) -------------------------------------------------
  // Новая функция = новый файл в server/features/ + одна строка в features/index.js. game.js трогать не нужно.
  const sockets = new Map();     // id игрока -> его сокет
  const eventHandlers = [];      // [событие, fn(ctx, data, reply)], ctx = { me, socket }
  const commands = new Map();    // имя чат-команды -> { help, fn(ctx, args, say) }
  const joinHooks = [], joinedHooks = [], leaveHooks = [], stopHooks = [], readyList = [];
  const api = {
    io, players, world, log, now: nowSec,
    dataDir, store,                                                     // папка и хранилище сохранений (оба null — сохранения выключены)
    waitFor: (promise) => readyList.push(promise),                      // сервер начнёт принимать игроков, когда promise завершится
    beforeJoin: (fn) => joinHooks.push(fn),                             // fn(ctx{nickname,data}) -> строка с ошибкой отклонит вход
    afterJoin: (fn) => joinedHooks.push(fn),                            // fn(player, ctx) — игрок создан, можно загрузить состояние
    onLeave: (fn) => leaveHooks.push(fn),                               // fn(player) — игрок выходит
    onStop: (fn) => stopHooks.push(fn),                                 // fn() — сервер останавливается (сохранить всё)
    onEvent: (event, fn) => eventHandlers.push([event, fn]),            // обработчик события клиента
    command: (name, help, fn) => commands.set(name, { help, fn }),      // чат-команда /name
    sendState: (p) => sockets.get(p.id)?.emit('state', p.state),        // отправить игроку его инвентарь
    say: (p, text) => sockets.get(p.id)?.emit('chat', systemMsg(text)), // системное сообщение одному игроку
    findPlayer: (nick) => players.all().find((p) => p.nickname.toLowerCase() === String(nick).toLowerCase()),
  };
  for (const register of features) register(api);

  io.on('connection', (socket) => {
    let me = null; // игрок появляется после события 'join'

    const sendState = () => socket.emit('state', me.state);

    socket.on('join', (data, cb) => {
      if (me) return;
      const nickname = sanitizeNickname(data && data.nickname);
      const ctx = { nickname, data: data || {} };
      for (const hook of joinHooks) {
        const error = hook(ctx);
        if (error) { if (typeof cb === 'function') cb({ ok: false, error }); return; }
      }
      me = players.create(nickname, world.pickSpawn());
      for (const hook of joinedHooks) hook(me, ctx);
      me.lastMoveAt = nowSec();
      me.lastHitCheck = nowSec();
      sockets.set(me.id, socket);
      log(`[game] ${me.nickname} (${me.id}) вошёл, игроков: ${players.all().length}`);

      if (typeof cb === 'function') {
        cb({
          ok: true,
          id: me.id,
          spawn: { x: me.x, y: me.y, z: me.z },
          state: me.state,
          changes: world.listChanges(),
          players: players.all().filter((p) => p !== me).map((p) => p.publicInfo()),
          chat: chatLog.slice(-30),
        });
      }
      socket.broadcast.emit('playerJoined', me.publicInfo());
      const hello = remember(systemMsg(`${me.nickname} вошёл в игру`));
      socket.broadcast.emit('chat', hello);
    });

    // --- Перемещение ---------------------------------------------------------
    socket.on('move', (d) => {
      if (!me || !d || ![d.x, d.y, d.z, d.yaw, d.pitch].every(isNum)) return;
      const t = nowSec();
      const dt = Math.min(2, Math.max(0, t - me.lastMoveAt));
      const dist = Math.hypot(d.x - me.x, d.y - me.y, d.z - me.z);
      const inWorld = d.x > 0 && d.z > 0 && d.y > 0 && d.x < SIZE_X && d.y < SIZE_Y && d.z < SIZE_Z;
      if (!inWorld || dist > MAX_MOVE_BASE + MAX_MOVE_SPEED * dt) {
        // Подозрительный скачок: возвращаем игрока на последнюю допустимую позицию
        socket.emit('teleport', { x: me.x, y: me.y, z: me.z });
        return;
      }
      me.x = d.x; me.y = d.y; me.z = d.z; me.yaw = d.yaw; me.pitch = d.pitch;
      me.lastMoveAt = t;
      me.moved = true;
    });

    socket.on('respawn', (_d, cb) => {
      if (!me) return;
      const t = nowSec();
      if (t - me.lastRespawnAt < RESPAWN_COOLDOWN) { if (typeof cb === 'function') cb({ x: me.x, y: me.y, z: me.z }); return; }
      me.lastRespawnAt = t;
      const s = world.pickSpawn();
      me.x = s.x; me.y = s.y; me.z = s.z; me.moved = true;
      me.lastMoveAt = nowSec();
      if (typeof cb === 'function') cb(s);
    });

    // --- Добыча --------------------------------------------------------------
    // Результат удара по одному блоку: рассылка, награда (с учётом чар). Возвращает true, если изменились предметы.
    const applyHit = (pos, r) => {
      if (r.broken) {
        io.emit('block', { x: pos.x, y: pos.y, z: pos.z, type: 0, by: me.id });
        if (r.item) { me.state.items[r.item] += r.drop + dropBonus(me.state); return true; }
      } else {
        io.emit('damage', { x: pos.x, y: pos.y, z: pos.z, dmg: r.dmg, max: r.max, by: me.id });
      }
      return false;
    };
    // Нормаль грани от клиента: ровно одна ось ±1 (нужна чарам вроде бура)
    const unitNormal = (d) => {
      const n = [d.nx, d.ny, d.nz];
      if (!n.every((v) => v === 0 || v === 1 || v === -1) || n.reduce((a, v) => a + Math.abs(v), 0) !== 1) return null;
      return { nx: d.nx, ny: d.ny, nz: d.nz };
    };

    socket.on('hit', (d) => {
      if (!me || !d) return;
      const t = nowSec();
      const pick = effectivePick(me.state); // кирка с учётом чар (скорость, сила)
      // Ограничитель частоты: не больше ударов в секунду, чем позволяет кирка (с небольшим запасом)
      me.hitTokens = Math.min(2, me.hitTokens + (t - me.lastHitCheck) * pick.speed * 1.2);
      me.lastHitCheck = t;
      if (me.hitTokens < 1) return;
      me.hitTokens -= 1;

      const r = world.hit(me, d.x, d.y, d.z, pick.power, t, pick.tier);
      if (!r.ok) return;
      let changed = applyHit(d, r);

      // Чары, затрагивающие соседние блоки (бур 3×3): тот же удар, те же проверки уровня и дальности
      const n = unitNormal(d);
      if (n) {
        for (const tg of extraTargets(me.state, { x: d.x, y: d.y, z: d.z, ...n })) {
          const rr = world.hit(me, tg.x, tg.y, tg.z, pick.power, t, pick.tier, { ignoreExposed: true });
          if (rr.ok && applyHit(tg, rr)) changed = true;
        }
      }
      if (changed) sendState();
    });

    // --- Строительство -------------------------------------------------------
    socket.on('place', (d, cb) => {
      const reply = (res) => { if (typeof cb === 'function') cb(res); };
      if (!me || !d) return reply({ ok: false, error: 'Вы не в игре' });
      if (typeof d.kind !== 'string' || !Object.hasOwn(BUILD_KINDS, d.kind)) return reply({ ok: false, error: 'Неизвестный объект' });
      const t = nowSec();
      if (t - me.lastPlaceAt < PLACE_COOLDOWN) return reply({ ok: false, error: 'Слишком быстро' });

      const check = validatePlacement(world, d.x, d.y, d.z, me.eye(), players.all(), NET_REACH_TOLERANCE);
      if (!check.ok) return reply(check);
      if (!canAfford(me.state.items, d.kind)) return reply({ ok: false, error: 'Не хватает ресурсов' });

      me.lastPlaceAt = t;
      payCost(me.state.items, d.kind);
      const block = BUILD_KINDS[d.kind].block;
      world.setBlock(d.x, d.y, d.z, block);
      io.emit('block', { x: d.x, y: d.y, z: d.z, type: block, by: me.id });
      sendState();
      reply({ ok: true });
    });

    // --- Чат -------------------------------------------------------------------
    socket.on('chat', (d, cb) => {
      const reply = (res) => { if (typeof cb === 'function') cb(res); };
      if (!me || !d || typeof d.text !== 'string') return reply({ ok: false, error: 'Пустое сообщение' });
      const text = sanitizeChat(d.text);
      if (!text) return reply({ ok: false, error: 'Пустое сообщение' });
      const t = nowSec();
      if (t - me.lastChatAt < CHAT_COOLDOWN) return reply({ ok: false, error: 'Не так быстро' });
      me.lastChatAt = t;

      // Команды видит только отправитель (кроме /me)
      if (text.startsWith('/')) {
        const [cmd, ...rest] = text.slice(1).split(' ');
        const say = (line) => socket.emit('chat', systemMsg(line));
        switch (cmd.toLowerCase()) {
          case 'help': say('Команды: /players — кто онлайн, /stuck — вернуться на спавн, /me <действие>' + [...commands].map(([n, c]) => `, /${n} — ${c.help}`).join('')); break;
          case 'players': {
            const all = players.all();
            say(`Онлайн (${all.length}): ${all.map((p) => p.nickname).join(', ')}`);
            break;
          }
          case 'stuck': {
            if (t - me.lastStuckAt < STUCK_COOLDOWN) { say('Подождите несколько секунд перед повторным /stuck'); break; }
            me.lastStuckAt = t;
            const s = world.pickSpawn();
            me.x = s.x; me.y = s.y; me.z = s.z; me.moved = true; me.lastMoveAt = t;
            socket.emit('teleport', s);
            say('Вы вернулись на спавн');
            break;
          }
          case 'me': {
            const action = rest.join(' ').trim();
            if (!action) { say('Использование: /me <действие>'); break; }
            io.emit('chat', remember({ id: me.id, nickname: me.nickname, text: action, action: true, t: now() }));
            break;
          }
          default: {
            const c = commands.get(cmd.toLowerCase());
            if (!c) { say('Неизвестная команда. Список: /help'); break; }
            try { c.fn({ me, socket }, rest.filter(Boolean), say); } catch (e) { log(`[command:${cmd}] ${e.message}`); say('Ошибка команды'); }
          }
        }
        return reply({ ok: true });
      }

      io.emit('chat', remember({ id: me.id, nickname: me.nickname, text, t: now() }));
      reply({ ok: true });
    });

    // --- Магазин -------------------------------------------------------------
    socket.on('shop', (d, cb) => {
      const reply = (res) => { if (typeof cb === 'function') cb(res); };
      if (!me || !d) return reply({ ok: false, error: 'Вы не в игре' });
      const w = world.workshop;
      if (Math.hypot(me.x - w.x, me.y - w.y, me.z - w.z) > SHOP_RANGE) {
        return reply({ ok: false, error: 'Подойдите к мастерской' });
      }
      let result;
      switch (d.action) {
        case 'buy': result = buyPickaxe(me.state, d.id); break;
        case 'equip': result = equipPickaxe(me.state, d.id); break;
        case 'sell': result = sellItem(me.state, d.id, d.amount); break;
        case 'sellAll': result = sellEverything(me.state); break;
        default: result = { ok: false, error: 'Неизвестное действие' };
      }
      if (result.ok) sendState();
      reply(result);
    });

    // События плагинов
    for (const [event, fn] of eventHandlers) {
      socket.on(event, (d, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        if (!me) return reply({ ok: false, error: 'Вы не в игре' });
        try { fn({ me, socket }, d, reply); } catch (e) { log(`[feature:${event}] ${e.message}`); reply({ ok: false, error: 'Ошибка сервера' }); }
      });
    }

    socket.on('disconnect', () => {
      if (!me) return;
      sockets.delete(me.id);
      for (const hook of leaveHooks) hook(me);
      players.remove(me.id);
      io.emit('playerLeft', me.id);
      io.emit('chat', remember(systemMsg(`${me.nickname} вышел из игры`)));
      log(`[game] ${me.nickname} (${me.id}) вышел, игроков: ${players.all().length}`);
      me = null;
    });
  });

  // Рассылка позиций пачкой: только тех, кто двигался с прошлого раза
  function tick() {
    const moves = {};
    let any = false;
    for (const p of players.all()) {
      if (!p.moved) continue;
      p.moved = false;
      moves[p.id] = [round(p.x), round(p.y), round(p.z), round(p.yaw), round(p.pitch)];
      any = true;
    }
    if (any) io.emit('moves', moves);
    world.sweepDamage(nowSec());
  }

  const timer = setInterval(tick, MOVE_TICK_MS);
  return {
    tick,
    ready: Promise.all(readyList),                                       // загрузка плагинов завершена (сохранения прочитаны)
    stop: () => { clearInterval(timer); return Promise.all(stopHooks.map((fn) => fn())); }, // ждёт, пока всё сохранится
  };
}
