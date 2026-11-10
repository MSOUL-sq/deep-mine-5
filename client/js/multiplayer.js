// Сетевой слой клиента (Socket.IO): подключение, синхронизация игроков, блоков, урона и состояния.
// Клиент только отправляет намерения (удар, постройка, покупка), а результат применяет после ответа сервера.
import { RemotePlayer } from './remote-player.js';

const MOVE_SEND_INTERVAL = 0.05; // секунд между отправками позиции
const MOVE_HEARTBEAT = 1;        // отправлять позицию хотя бы раз в секунду

export class Multiplayer {
  constructor(scene, world, inventory) {
    this.scene = scene;
    this.world = world;
    this.inventory = inventory;
    this.socket = null;
    this.connected = false;
    this.id = null;
    this.remotes = new Map();   // id -> RemotePlayer
    this.hadConnection = false; // для сброса мира при повторном входе

    this.sendTimer = 0;
    this.idleTimer = 0;
    this.lastSent = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

    // Колбэки (их задаёт main.js)
    this.onBlock = null;       // (x, y, z, type, by)
    this.onDamage = null;      // (x, y, z, dmg, max, by)
    this.onTeleport = null;    // ({x, y, z})
    this.onDisconnect = null;
    this.onPlayersChanged = null;
    this.onChat = null;        // (message)
  }

  get playerCount() { return this.remotes.size + (this.connected ? 1 : 0); }

  /** Подключается и входит в игру. Возвращает Promise с данными входа (spawn и т.д.). */
  connect(nickname, password = '') {
    return new Promise((resolve, reject) => {
      if (typeof window.io !== 'function') {
        reject(new Error('Не загрузился Socket.IO. Откройте игру через сервер: npm start'));
        return;
      }
      if (this.socket) { this.socket.disconnect(); this.socket = null; }
      const socket = window.io({ reconnection: false });
      this.socket = socket;
      let settled = false;

      socket.on('connect_error', () => {
        if (!settled) { settled = true; reject(new Error('Не удалось подключиться к серверу')); }
      });

      socket.on('connect', () => {
        socket.emit('join', { nickname, password }, (res) => {
          if (settled) return;
          settled = true;
          if (!res || !res.ok) { socket.disconnect(); reject(new Error((res && res.error) || 'Сервер отклонил вход')); return; }
          this.connected = true;
          this.id = res.id;
          // Мир: при повторном подключении сначала сбрасываем локальные изменения
          if (this.hadConnection) this.world.regenerate();
          this.hadConnection = true;
          this.world.applyChanges(res.changes);
          this.inventory.setState(res.state);
          this.clearRemotes();
          for (const info of res.players) this.addRemote(info);
          resolve(res);
        });
      });

      socket.on('disconnect', () => {
        const was = this.connected;
        this.connected = false;
        this.clearRemotes();
        if (was) this.onDisconnect?.();
      });

      socket.on('playerJoined', (info) => this.addRemote(info));
      socket.on('playerLeft', (id) => this.removeRemote(id));
      socket.on('moves', (moves) => {
        for (const [id, m] of Object.entries(moves)) this.remotes.get(id)?.setTarget(m[0], m[1], m[2], m[3], m[4]);
      });
      socket.on('block', (d) => this.onBlock?.(d.x, d.y, d.z, d.type, d.by));
      socket.on('damage', (d) => this.onDamage?.(d.x, d.y, d.z, d.dmg, d.max, d.by));
      socket.on('state', (state) => this.inventory.setState(state));
      socket.on('teleport', (p) => this.onTeleport?.(p));
      socket.on('chat', (m) => this.onChat?.(m));
    });
  }

  addRemote(info) {
    if (this.remotes.has(info.id)) return;
    this.remotes.set(info.id, new RemotePlayer(this.scene, info));
    this.onPlayersChanged?.();
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose();
    this.remotes.delete(id);
    this.onPlayersChanged?.();
  }

  clearRemotes() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }

  /** Позиции (ног) других игроков — для проверки строительства. */
  remotePositions() {
    return [...this.remotes.values()].map((r) => ({ x: r.target.x, y: r.target.y, z: r.target.z }));
  }

  /** Каждый кадр: сглаживание чужих игроков и отправка своей позиции. */
  update(dt, player) {
    for (const r of this.remotes.values()) r.update(dt);
    if (!this.connected) return;

    this.sendTimer += dt;
    this.idleTimer += dt;
    if (this.sendTimer < MOVE_SEND_INTERVAL) return;
    this.sendTimer = 0;

    const cur = { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch };
    const l = this.lastSent;
    const changed = Math.abs(cur.x - l.x) + Math.abs(cur.y - l.y) + Math.abs(cur.z - l.z) > 0.001 ||
      Math.abs(cur.yaw - l.yaw) > 0.001 || Math.abs(cur.pitch - l.pitch) > 0.001;
    if (changed || this.idleTimer >= MOVE_HEARTBEAT) {
      this.socket.emit('move', cur);
      this.lastSent = cur;
      this.idleTimer = 0;
    }
  }

  // --- Намерения игрока -------------------------------------------------------
  hit(x, y, z, nx = 0, ny = 0, nz = 0) { if (this.connected) this.socket.emit('hit', { x, y, z, nx, ny, nz }); }

  /** Универсальный запрос серверному плагину: request('give', {...}) -> Promise<{ok, error?}>. */
  request(event, data) {
    return new Promise((resolve) => {
      if (!this.connected) { resolve({ ok: false, error: 'Нет соединения' }); return; }
      this.socket.timeout(4000).emit(event, data, (err, res) => resolve(err ? { ok: false, error: 'Сервер не ответил' } : res));
    });
  }

  place(x, y, z, kind) {
    return new Promise((resolve) => {
      if (!this.connected) { resolve({ ok: false, error: 'Нет соединения' }); return; }
      this.socket.timeout(4000).emit('place', { x, y, z, kind }, (err, res) => resolve(err ? { ok: false, error: 'Сервер не ответил' } : res));
    });
  }

  shop(action, id, amount) {
    return new Promise((resolve) => {
      if (!this.connected) { resolve({ ok: false, error: 'Нет соединения' }); return; }
      this.socket.timeout(4000).emit('shop', { action, id, amount }, (err, res) => resolve(err ? { ok: false, error: 'Сервер не ответил' } : res));
    });
  }

  /** Отправляет сообщение в чат (сервер чистит текст и ограничивает частоту). */
  chat(text) {
    return new Promise((resolve) => {
      if (!this.connected) { resolve({ ok: false, error: 'Нет соединения' }); return; }
      this.socket.timeout(4000).emit('chat', { text }, (err, res) => resolve(err ? { ok: false, error: 'Сервер не ответил' } : res));
    });
  }

  respawn() {
    return new Promise((resolve) => {
      if (!this.connected) { resolve(null); return; }
      this.socket.timeout(4000).emit('respawn', {}, (err, spawn) => resolve(err ? null : spawn));
    });
  }
}
