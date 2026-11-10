// Игроки на сервере: состояние (деньги, инвентарь, кирки), позиция и служебные счётчики.
import { createPlayerState } from '../shared/economy.js';
import { EYE_HEIGHT } from '../shared/constants.js';

/** Чистит никнейм: убирает управляющие символы и угловые скобки, обрезает до 16 символов. */
export function sanitizeNickname(raw) {
  const clean = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, 16);
  return clean || `Шахтёр${Math.floor(100 + Math.random() * 900)}`;
}

/** Чистит сообщение чата: убирает управляющие символы, схлопывает пробелы, обрезает до 120 символов. */
export const CHAT_MAX = 120;
export function sanitizeChat(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

export class Player {
  constructor(id, nickname, spawn) {
    this.id = id;
    this.nickname = nickname;
    this.state = createPlayerState();
    this.x = spawn.x; this.y = spawn.y; this.z = spawn.z;
    this.yaw = 0; this.pitch = 0;
    this.moved = false;       // позиция изменилась с прошлой рассылки
    this.lastMoveAt = 0;      // секунды
    this.hitTokens = 1;       // ограничитель частоты ударов
    this.lastHitCheck = 0;
    this.lastPlaceAt = 0;
    this.lastChatAt = -10;
    this.lastStuckAt = -100;
    this.lastRespawnAt = -10;
  }

  eye() { return { x: this.x, y: this.y + EYE_HEIGHT, z: this.z }; }

  /** Данные, которые видят другие игроки. */
  publicInfo() {
    return {
      id: this.id, nickname: this.nickname,
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
    };
  }
}

export class PlayerManager {
  constructor() {
    this.players = new Map();
    this.nextId = 1;
  }

  create(nickname, spawn) {
    const id = `p${this.nextId++}`;
    const player = new Player(id, nickname, spawn);
    this.players.set(id, player);
    return player;
  }

  remove(id) { this.players.delete(id); }
  get(id) { return this.players.get(id); }
  all() { return [...this.players.values()]; }
}
