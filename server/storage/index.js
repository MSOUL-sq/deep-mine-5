// Выбор хранилища по переменным окружения: Supabase, если заданы SUPABASE_URL и SUPABASE_SERVICE_KEY, иначе JSON-файлы.
import { createFileStore } from './file-store.js';
import { createSupabaseStore } from './supabase-store.js';

export function createStore({ dataDir, env = process.env }) {
  const url = (env.SUPABASE_URL || '').trim(), key = (env.SUPABASE_SERVICE_KEY || '').trim();
  if (url || key) {
    if (!url || !key) throw new Error('Для Supabase нужны обе переменные: SUPABASE_URL и SUPABASE_SERVICE_KEY');
    return createSupabaseStore({ url, key });
  }
  return createFileStore(dataDir);
}
