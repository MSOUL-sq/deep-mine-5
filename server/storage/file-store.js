// Хранилище в JSON-файлах (по умолчанию, ничего настраивать не нужно).
import fs from 'node:fs';
import path from 'node:path';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = `${file}.tmp`;                       // сначала во временный файл, потом переименование:
  fs.writeFileSync(tmp, JSON.stringify(data));     // при сбое питания не останется битого файла
  fs.renameSync(tmp, file);
}

// Интерфейс хранилища (его реализует и supabase-store.js):
//   loadAccounts() -> { ключ: { nickname, salt, hash, state, lastSeen } }
//   saveAccounts(all, dirtyKeys)   — сохранить изменённые аккаунты
//   loadWorld() -> { seed, size, changes } | null
//   saveWorld(world)
export function createFileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const accountsFile = path.join(dir, 'accounts.json');
  const worldFile = path.join(dir, 'world.json');
  return {
    name: `файлы в ${dir}`,
    async loadAccounts() { return readJson(accountsFile, {}); },
    async saveAccounts(all) { writeJson(accountsFile, all); },
    async loadWorld() { return readJson(worldFile, null); },
    async saveWorld(world) { writeJson(worldFile, world); },
  };
}
