// Сохранения: аккаунты (ник + пароль → деньги, ресурсы, кирки, чары) и изменения карты.
// Где хранить — решает api.store (server/storage/): JSON-файлы в data/ или Supabase. Здесь только логика игры.
//
// Без пароля игрок входит «гостем»: прогресс не сохраняется, но и чужой ник занять нельзя.
// С паролем: новый ник регистрируется, существующий — проверяется пароль.
import crypto from 'node:crypto';
import { SIZE_X, SIZE_Y, SIZE_Z, WORLD_SEED } from '../../shared/worldgen.js';
import { ITEMS, PICKAXES } from '../../shared/blocks.js';
import { ENCHANTS } from '../../shared/enchants.js';
import { createPlayerState } from '../../shared/economy.js';

const AUTOSAVE_MS = 30000;
const MAX_FAILS = 5;          // неверных паролей подряд до блокировки ника
const LOCK_SECONDS = 60;

// --- Проверка сохранённого состояния (файл могли поправить руками или обновить игру) -------------
const nonNegInt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
export function sanitizeState(saved) {
  const st = createPlayerState();
  if (!saved || typeof saved !== 'object') return st;
  st.money = nonNegInt(saved.money);
  for (const id of Object.keys(ITEMS)) st.items[id] = nonNegInt(saved.items && saved.items[id]);
  const picks = Array.isArray(saved.pickaxes) ? saved.pickaxes.filter((id) => Object.hasOwn(PICKAXES, id)) : [];
  st.pickaxes = [...new Set(['stone', ...picks])];
  st.equipped = st.pickaxes.includes(saved.equipped) ? saved.equipped : 'stone';
  for (const [id, e] of Object.entries(ENCHANTS)) {
    const lvl = nonNegInt(saved.enchants && saved.enchants[id]);
    if (lvl > 0) st.enchants[id] = Math.min(lvl, e.costs.length);
  }
  return st;
}

const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');
const snapshot = (state) => JSON.parse(JSON.stringify({
  money: state.money, items: state.items, pickaxes: state.pickaxes, equipped: state.equipped, enchants: state.enchants,
}));

export default function register(api) {
  if (!api.store) return;                          // сохранения выключены (например, в тестах)
  const store = api.store;
  let accounts = {};                               // ключ (ник в нижнем регистре) -> { nickname, salt, hash, state, lastSeen }
  const dirty = new Set();                         // аккаунты, ещё не записанные в хранилище
  const fails = new Map();                         // ключ -> { n, until }
  let savedVersion = -1;
  const online = (key) => api.players.all().some((p) => p.account === key);

  // --- Загрузка при запуске (сервер не примет игроков, пока она не завершится) ---
  api.waitFor((async () => {
    const savedWorld = await store.loadWorld();
    if (savedWorld && savedWorld.seed === WORLD_SEED && savedWorld.size === `${SIZE_X}x${SIZE_Y}x${SIZE_Z}`) {
      api.log(`[save] карта загружена: ${api.world.restore(savedWorld.changes)} изменений`);
    }
    savedVersion = api.world.version;
    accounts = await store.loadAccounts();
    api.log(`[save] аккаунтов: ${Object.keys(accounts).length}`);
  })());

  // --- Сохранение ---
  const saveWorld = () => {
    if (api.world.version === savedVersion) return Promise.resolve();
    savedVersion = api.world.version;
    return store.saveWorld({ seed: WORLD_SEED, size: `${SIZE_X}x${SIZE_Y}x${SIZE_Z}`, changes: api.world.exportChanges() })
      .catch((e) => { savedVersion = -1; api.log(`[save] карта не сохранена (повтор позже): ${e.message}`); });
  };
  const remember = (player) => {
    const acc = player.account && accounts[player.account];
    if (!acc) return;
    acc.state = snapshot(player.state);
    acc.lastSeen = Date.now();
    dirty.add(player.account);
  };
  const saveAccounts = () => {
    api.players.all().forEach(remember);
    if (!dirty.size) return Promise.resolve();
    const keys = [...dirty];
    dirty.clear();
    return store.saveAccounts(accounts, keys)
      .catch((e) => { keys.forEach((k) => dirty.add(k)); api.log(`[save] аккаунты не сохранены (повтор позже): ${e.message}`); });
  };
  const saveAll = () => Promise.all([saveWorld(), saveAccounts()]);

  api.beforeJoin((ctx) => {
    const password = typeof ctx.data.password === 'string' ? ctx.data.password : '';
    const key = ctx.nickname.toLowerCase();
    const acc = accounts[key];
    if (!password) return acc ? 'Этот ник занят. Введите пароль, если он ваш' : undefined; // гость
    if (password.length < 4 || password.length > 64) return 'Пароль: от 4 до 64 символов';

    const f = fails.get(key);
    if (f && f.n >= MAX_FAILS && api.now() < f.until) return 'Слишком много попыток. Подождите минуту';
    if (acc) {
      const given = Buffer.from(hashPassword(password, acc.salt), 'hex');
      const real = Buffer.from(acc.hash, 'hex');
      if (!crypto.timingSafeEqual(given, real)) {
        fails.set(key, { n: (f && api.now() < f.until ? f.n : 0) + 1, until: api.now() + LOCK_SECONDS });
        return 'Неверный пароль';
      }
      fails.delete(key);
    }
    if (online(key)) return 'Этот игрок уже в игре';
    if (!acc) {                                    // новый аккаунт
      const salt = crypto.randomBytes(16).toString('hex');
      accounts[key] = { nickname: ctx.nickname, salt, hash: hashPassword(password, salt), state: snapshot(createPlayerState()), lastSeen: Date.now() };
      dirty.add(key);
      saveAccounts();                              // регистрацию записываем сразу
    }
    ctx.account = key;
  });

  api.afterJoin((player, ctx) => {
    if (!ctx.account) return;
    const acc = accounts[ctx.account];
    player.account = ctx.account;
    player.nickname = acc.nickname;                // регистр букв как при регистрации
    player.state = sanitizeState(acc.state);
  });

  api.onLeave((player) => { remember(player); saveAll(); });
  const timer = setInterval(saveAll, AUTOSAVE_MS);
  timer.unref?.();
  api.onStop(() => { clearInterval(timer); api.players.all().forEach(remember); return saveAll(); });
}
