// Добыча: луч из камеры выбирает блок, удар отправляется на сервер, а тот проверяет дальность и считает урон.
// Здесь — мгновенная обратная связь (звук, частицы, отдача) и визуализация: трещины рисуются по урону от сервера.
import * as THREE from 'three';
import { BLOCK } from '/shared/worldgen.js';
import { BLOCK_INFO, PICKAXES, PICKAXE_ORDER } from '/shared/blocks.js';
import { REACH, DAMAGE_FORGET_TIME } from '/shared/constants.js';
import { effectivePick } from '/shared/enchants.js';
import { sound } from './audio.js';

const MAX_PARTICLES = 120;
const CRACK_STAGES = 5;

/** Рисует текстуры трещин: чем выше стадия, тем больше линий. */
function makeCrackTextures() {
  const textures = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lines = [];
  for (let i = 0; i < 14; i++) {
    const pts = [[32, 32]];
    let a = rnd() * Math.PI * 2;
    for (let j = 0; j < 4; j++) {
      const last = pts[pts.length - 1];
      a += (rnd() - 0.5) * 1.2;
      pts.push([last[0] + Math.cos(a) * (6 + rnd() * 8), last[1] + Math.sin(a) * (6 + rnd() * 8)]);
    }
    lines.push(pts);
  }
  for (let stage = 0; stage < CRACK_STAGES; stage++) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 2;
    g.lineCap = 'round';
    const count = Math.ceil(((stage + 1) / CRACK_STAGES) * lines.length);
    for (let i = 0; i < count; i++) {
      g.beginPath();
      lines[i].forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    textures.push(tex);
  }
  return textures;
}

export class Mining {
  constructor(scene, camera, world, player, net) {
    this.camera = camera;
    this.world = world;
    this.player = player;
    this.net = net;
    this.pickaxe = PICKAXES.stone; // текущая кирка (меняется при покупке/выборе в мастерской)
    this.onSwing = null;           // колбэк анимации удара
    this.onWeak = null;            // колбэк: кирка слишком слабая для блока (текст подсказки)
    this.lastWeakAt = -10;

    this.holding = false;     // зажата ЛКМ / кнопка копания
    this.cooldown = 0;        // время до следующего удара
    this.target = null;       // блок под прицелом
    this.damage = new Map();  // "x,y,z" -> { ratio, time } — урон, присланный сервером
    this.time = 0;
    this._dir = new THREE.Vector3();

    // Рамка вокруг выбранного блока
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
      new THREE.LineBasicMaterial({ color: 0x29d3c8 }),
    );
    this.outline.visible = false;
    scene.add(this.outline);

    // Трещины
    this.crackTextures = makeCrackTextures();
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.004, 1.004, 1.004),
      new THREE.MeshBasicMaterial({
        map: this.crackTextures[0], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
    );
    this.crack.visible = false;
    scene.add(this.crack);

    // Частицы: один InstancedMesh на все
    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.09),
      new THREE.MeshBasicMaterial(),
      MAX_PARTICLES,
    );
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    scene.add(this.particleMesh);
    this.particles = Array.from({ length: MAX_PARTICLES }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() }));
    this.nextParticle = 0;
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    for (let i = 0; i < MAX_PARTICLES; i++) this.writeParticle(i, null);

    // Подсказка о блоке под прицелом
    this.targetEl = document.getElementById('target');
    this.targetName = document.getElementById('target-name');
    this.targetBar = document.getElementById('target-bar');
  }

  /** Кирка с учётом чар (скорость): передаётся состояние игрока. */
  setPickaxe(state) { this.pickaxe = effectivePick(state); }

  /** Блок не поддаётся этой кирке (сервер проверяет то же самое). */
  isTooWeak(info) { return (info.minTier || 0) > this.pickaxe.tier; }

  /** Подсказка: какая кирка нужна. */
  requirement(info) { return `нужна ${PICKAXES[PICKAXE_ORDER[info.minTier]].name} или лучше`; }

  /** Блок под прицелом (или null). Вызывается каждый кадр. */
  updateTarget() {
    const p = this.camera.position;
    this.camera.getWorldDirection(this._dir);
    this.target = this.world.raycast(p.x, p.y, p.z, this._dir.x, this._dir.y, this._dir.z, REACH);
    return this.target;
  }

  update(dt) {
    this.time += dt;
    const active = this.player.enabled;
    const hit = active ? this.updateTarget() : null;

    // Забываем старый урон
    for (const [key, d] of this.damage) if (this.time - d.time > DAMAGE_FORGET_TIME) this.damage.delete(key);

    this.cooldown = Math.max(0, this.cooldown - dt);
    if (active && this.holding && this.cooldown === 0) {
      this.cooldown = 1 / this.pickaxe.speed;
      this.onSwing?.(this.cooldown); // анимация кирки в руке (даже при промахе)
      if (hit) this.swing(hit);
    }

    this.updateVisuals(hit);
    this.updateParticles(dt);
  }

  /** Один удар киркой: локальный отклик + запрос серверу (он решает, сколько урона нанесено). */
  swing(hit) {
    const type = this.world.getBlock(hit.x, hit.y, hit.z);
    const info = BLOCK_INFO[type];
    this.player.kick = 0.045; // небольшая отдача камеры

    if (!info || info.hardness === Infinity) {
      sound.hard();
      this.spawnParticles(hit, [0.5, 0.5, 0.55], 4, 1.5);
      return;
    }
    if (this.isTooWeak(info)) {
      sound.hard();
      this.spawnParticles(hit, [0.5, 0.5, 0.55], 4, 1.5);
      if (this.time - this.lastWeakAt > 1) { this.lastWeakAt = this.time; this.onWeak?.(`${info.name}: ${this.requirement(info)}`); }
      return;
    }
    sound.hit();
    this.spawnParticles(hit, info.color, 6, 2);
    this.net.hit(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz); // нормаль нужна чарам (бур 3×3)
  }

  /** Урон блоку от сервера (свой или чужой удар): обновляет трещины. */
  setDamage(x, y, z, dmg, max) {
    this.damage.set(`${x},${y},${z}`, { ratio: dmg / max, time: this.time });
  }

  /** Эффекты чужого удара (громкость зависит от расстояния). */
  showRemoteHit(x, y, z, volume) {
    const info = BLOCK_INFO[this.world.getBlock(x, y, z)];
    if (!info || volume < 0.05) return;
    sound.hit(volume);
    this.spawnParticles({ x, y, z, nx: 0, ny: 1, nz: 0 }, info.color, 5, 2);
  }

  /** Эффекты разрушенного блока. Вызывать ДО того, как блок убран из мира. */
  showBreak(x, y, z, type, volume) {
    this.damage.delete(`${x},${y},${z}`);
    const info = BLOCK_INFO[type];
    if (!info || volume < 0.05) return;
    this.spawnParticles({ x, y, z, nx: 0, ny: 1, nz: 0 }, info.color, 22, 3.5);
    sound.breakBlock(volume);
  }

  updateVisuals(hit) {
    const type = hit ? this.world.getBlock(hit.x, hit.y, hit.z) : BLOCK.AIR;
    const info = BLOCK_INFO[type];
    if (!hit || !info) {
      this.outline.visible = false;
      this.crack.visible = false;
      this.targetEl?.classList.add('hidden');
      return;
    }
    this.outline.visible = true;
    this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    const entry = this.damage.get(`${hit.x},${hit.y},${hit.z}`);
    const ratio = entry ? entry.ratio : 0;
    if (ratio > 0) {
      this.crack.visible = true;
      this.crack.position.copy(this.outline.position);
      const stage = Math.min(CRACK_STAGES - 1, Math.floor(ratio * CRACK_STAGES));
      this.crack.material.map = this.crackTextures[stage];
    } else {
      this.crack.visible = false;
    }

    if (this.targetEl) {
      this.targetEl.classList.remove('hidden');
      this.targetName.textContent = this.isTooWeak(info) ? `🔒 ${info.name}: ${this.requirement(info)}` : info.name;
      this.targetEl.classList.toggle('locked', this.isTooWeak(info));
      this.targetBar.style.width = `${ratio * 100}%`;
    }
  }

  // --- Частицы -------------------------------------------------------------
  spawnParticles(hit, color, count, speed) {
    // Появляются на грани, в которую попал луч
    const cx = hit.x + 0.5 + hit.nx * 0.5, cy = hit.y + 0.5 + hit.ny * 0.5, cz = hit.z + 0.5 + hit.nz * 0.5;
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.nextParticle];
      this.writeParticleColor(this.nextParticle, color);
      this.nextParticle = (this.nextParticle + 1) % MAX_PARTICLES;
      p.life = 0.5 + Math.random() * 0.5;
      p.pos.set(cx + (Math.random() - 0.5) * 0.8, cy + (Math.random() - 0.5) * 0.8, cz + (Math.random() - 0.5) * 0.8);
      p.vel.set(
        hit.nx * speed * 0.6 + (Math.random() - 0.5) * speed,
        hit.ny * speed * 0.6 + Math.random() * speed * 0.6,
        hit.nz * speed * 0.6 + (Math.random() - 0.5) * speed,
      );
    }
  }

  writeParticleColor(i, color) {
    const k = 0.8 + Math.random() * 0.4;
    this._color.setRGB(Math.min(1, color[0] * k), Math.min(1, color[1] * k), Math.min(1, color[2] * k));
    this.particleMesh.setColorAt(i, this._color);
    this.particleMesh.instanceColor.needsUpdate = true;
  }

  writeParticle(i, p) {
    const d = this._dummy;
    if (p) { d.position.copy(p.pos); d.scale.setScalar(Math.max(0.2, p.life * 1.6)); }
    else { d.position.set(0, -1000, 0); d.scale.setScalar(0.0001); }
    d.updateMatrix();
    this.particleMesh.setMatrixAt(i, d.matrix);
  }

  updateParticles(dt) {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vel.y -= 14 * dt;
      p.pos.addScaledVector(p.vel, dt);
      // Простое отскакивание от блоков не нужно: частицы живут меньше секунды
      this.writeParticle(i, p.life > 0 ? p : null);
    }
    if (any) this.particleMesh.instanceMatrix.needsUpdate = true;
  }
}
