// Хранилище в Supabase (PostgreSQL) через REST API. Без внешних библиотек: только встроенный fetch (Node 18+).
// Таблицы создаёт server/storage/supabase.sql. Ключ — service_role (секретный, только на сервере!).
const PAGE = 1000;
const CHUNK = 100;

const toRow = (key, a) => ({ nick_key: key, nickname: a.nickname, salt: a.salt, hash: a.hash, state: a.state, last_seen: new Date(a.lastSeen || Date.now()).toISOString() });
const fromRow = (r) => ({ nickname: r.nickname, salt: r.salt, hash: r.hash, state: r.state, lastSeen: Date.parse(r.last_seen) || Date.now() });

export function createSupabaseStore({ url, key, fetchImpl = fetch }) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function call(method, pathQuery, body, extra = {}) {
    const res = await fetchImpl(base + pathQuery, {
      method, headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 404 ? ' (таблицы не созданы? выполните server/storage/supabase.sql)' : res.status === 401 || res.status === 403 ? ' (проверьте SUPABASE_SERVICE_KEY)' : '';
      throw new Error(`Supabase ${method} ${pathQuery.split('?')[0]}: ${res.status} ${text.slice(0, 150)}${hint}`);
    }
    return text ? JSON.parse(text) : null;
  }

  // Записи идут строго по очереди, чтобы более старое состояние не перезаписало новое
  let chain = Promise.resolve();
  const enqueue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const upsert = (table, conflict, rows) =>
    call('POST', `/${table}?on_conflict=${conflict}`, rows, { Prefer: 'resolution=merge-duplicates,return=minimal' });

  return {
    name: `Supabase (${new URL(url).host})`,

    async loadAccounts() {
      const out = {};
      for (let offset = 0; ; offset += PAGE) {
        const rows = await call('GET', `/accounts?select=*&order=nick_key&limit=${PAGE}&offset=${offset}`);
        for (const r of rows) out[r.nick_key] = fromRow(r);
        if (rows.length < PAGE) break;
      }
      return out;
    },

    saveAccounts(all, dirtyKeys) {
      const rows = dirtyKeys.filter((k) => all[k]).map((k) => toRow(k, all[k]));
      return enqueue(async () => {
        for (let i = 0; i < rows.length; i += CHUNK) await upsert('accounts', 'nick_key', rows.slice(i, i + CHUNK));
      });
    },

    async loadWorld() {
      const rows = await call('GET', '/world?id=eq.1&select=seed,size,changes');
      return rows[0] || null;
    },

    saveWorld(world) {
      return enqueue(() => upsert('world', 'id', [{ id: 1, seed: world.seed, size: world.size, changes: world.changes, updated_at: new Date().toISOString() }]));
    },
  };
}
