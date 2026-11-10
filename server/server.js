// Сервер Deep Mine: раздаёт клиент и Three.js, принимает Socket.IO-подключения.
// Вся игровая логика — в game.js; мир — в world.js; игроки — в players.js.
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { ServerWorld } from './world.js';
import { PlayerManager } from './players.js';
import { attachGame } from './game.js';
import { createStore } from './storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { perMessageDeflate: false, pingInterval: 10000, pingTimeout: 15000 });

// Three.js отдаём из node_modules, чтобы игра работала без внешнего CDN.
app.use('/vendor/three', express.static(path.join(rootDir, 'node_modules', 'three'), { maxAge: '7d', immutable: true }));
// Общий код (генерация мира, правила) используется и клиентом, и сервером.
app.use('/shared', express.static(path.join(rootDir, 'shared')));
app.use(express.static(path.join(rootDir, 'client')));

console.log('Генерация мира...');
const world = new ServerWorld();
const players = new PlayerManager();
// Сохранения (аккаунты и карта) лежат в папке data/ (можно сменить: DATA_DIR=/путь node server/server.js)
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
const store = createStore({ dataDir });
console.log(`Сохранения: ${store.name}`);
const game = attachGame(io, { world, players, dataDir, store });

// При остановке (Ctrl+C) сохраняем всё
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('Сохранение и выход...'); game.stop().catch(() => {}).finally(() => process.exit(0)); });

// Начинаем принимать игроков только после загрузки сохранений. Если загрузка не удалась — выходим,
// чтобы пустое состояние не перезаписало данные в базе.
game.ready.then(() => {
  httpServer.listen(PORT, () => console.log(`Deep Mine: http://localhost:${PORT}`));
}).catch((err) => {
  console.error(`Не удалось загрузить сохранения: ${err.message}`);
  process.exit(1);
});
