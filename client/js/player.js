// Игрок от первого лица: мышь (Pointer Lock), WASD, прыжок, гравитация и коллизии с блоками.
import * as THREE from 'three';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, EYE_HEIGHT } from '/shared/constants.js';

const HALF_WIDTH = PLAYER_HALF_WIDTH;
const HEIGHT = PLAYER_HEIGHT;
const WALK_SPEED = 5;
const JUMP_SPEED = 8;
const GRAVITY = 24;
const MOUSE_SENSITIVITY = 0.0022;
const EPS = 1e-4;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.camera.rotation.order = 'YXZ';

    this.pos = new THREE.Vector3();   // позиция ног
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.keys = new Set();
    this.analog = { x: 0, y: 0 };     // аналоговое движение с сенсорного джойстика: x — вправо, y — вперёд (-1..1)
    this.jumpHeld = false;            // кнопка прыжка на сенсорном экране
    this.enabled = false;             // управление включено (только при захвате курсора)
    this.kick = 0;                    // отдача камеры от удара киркой (затухает сама)

    // Клавиши игнорируем, пока печатаем в поле ввода (чат, ник)
    const typing = (e) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => this.look(e.movementX, e.movementY));

    this.spawnPoint = world.spawn;    // сервер присылает свою точку появления
    this.onFall = null;               // вызывается, если игрок провалился за мир
    this.respawn();
  }

  respawn() { this.spawnAt(this.spawnPoint); }

  /** Поворот камеры (мышь: пиксели движения, касание: пиксели сдвига пальца). */
  look(dx, dy, sensitivity = MOUSE_SENSITIVITY) {
    if (!this.enabled) return;
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * sensitivity));
  }

  /** Сбрасывает всё управление (при паузе, открытии магазина или чата). */
  releaseInput() {
    this.keys.clear();
    this.analog.x = 0; this.analog.y = 0;
    this.jumpHeld = false;
  }

  /** Ставит игрока в точку (при входе, респавне и телепорте от сервера). */
  spawnAt(p) {
    this.pos.set(p.x, p.y + 0.01, p.z);
    this.vel.set(0, 0, 0);
  }

  /** Есть ли пересечение хитбокса игрока с твёрдыми блоками в точке (px, py, pz). */
  collides(px, py, pz) {
    const minX = Math.floor(px - HALF_WIDTH + EPS), maxX = Math.floor(px + HALF_WIDTH - EPS);
    const minY = Math.floor(py + EPS), maxY = Math.floor(py + HEIGHT - EPS);
    const minZ = Math.floor(pz - HALF_WIDTH + EPS), maxZ = Math.floor(pz + HALF_WIDTH - EPS);
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++)
          if (this.world.isSolid(x, y, z)) return true;
    return false;
  }

  /** Пересекается ли хитбокс игрока с единичным блоком (нужно для проверки строительства). */
  overlapsBlock(bx, by, bz) {
    return this.pos.x + HALF_WIDTH > bx && this.pos.x - HALF_WIDTH < bx + 1 &&
           this.pos.y + HEIGHT > by && this.pos.y < by + 1 &&
           this.pos.z + HALF_WIDTH > bz && this.pos.z - HALF_WIDTH < bz + 1;
  }

  update(dt) {
    dt = Math.min(dt, 0.05); // защита от больших скачков при лагах

    // Желаемое горизонтальное направление относительно взгляда
    let forward = 0, strafe = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW')) forward += 1;
      if (this.keys.has('KeyS')) forward -= 1;
      if (this.keys.has('KeyD')) strafe += 1;
      if (this.keys.has('KeyA')) strafe -= 1;
      forward += this.analog.y;
      strafe += this.analog.x;
    }
    // Не больше единицы: диагональ клавиатурой не быстрее, а джойстик работает пропорционально отклонению
    const len = Math.max(1, Math.hypot(forward, strafe));
    forward /= len; strafe /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.vel.x = (-sin * forward + cos * strafe) * WALK_SPEED;
    this.vel.z = (-cos * forward - sin * strafe) * WALK_SPEED;

    if (this.enabled && (this.keys.has('Space') || this.jumpHeld) && this.onGround) {
      this.vel.y = JUMP_SPEED;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    // Движение по осям по отдельности — так игрок скользит вдоль стен
    const nx = this.pos.x + this.vel.x * dt;
    if (!this.collides(nx, this.pos.y, this.pos.z)) this.pos.x = nx;

    const nz = this.pos.z + this.vel.z * dt;
    if (!this.collides(this.pos.x, this.pos.y, nz)) this.pos.z = nz;

    const ny = this.pos.y + this.vel.y * dt;
    if (!this.collides(this.pos.x, ny, this.pos.z)) {
      this.pos.y = ny;
      this.onGround = false;
    } else if (this.vel.y < 0) {
      this.pos.y = Math.floor(ny) + 1; // встаём на верхнюю грань блока
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.pos.y = Math.floor(ny + HEIGHT) - HEIGHT - EPS * 2; // упёрлись головой
      this.vel.y = 0;
    }

    if (this.pos.y < -10) { if (this.onFall) this.onFall(); else this.respawn(); this.vel.set(0, 0, 0); }

    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.kick *= Math.max(0, 1 - dt * 14);
    this.camera.rotation.set(this.pitch - this.kick, this.yaw, 0);
  }
}
