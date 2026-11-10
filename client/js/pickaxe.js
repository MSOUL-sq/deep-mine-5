// Модели кирок в руке (22 вида из простых форм, параметрически) и анимация удара.
import * as THREE from 'three';
import { PICKAXES } from '/shared/blocks.js';

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, fog: false, ...extra });
const glow = (color) => new THREE.MeshBasicMaterial({ color, fog: false });

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

// Острый наконечник: четырёхгранный конус, направленный вдоль оси z (sign = +1 вперёд, -1 назад)
function tip(radius, length, material, z, sign) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 4), material);
  m.rotation.x = sign * Math.PI / 2;
  m.position.set(0, 0, z + sign * length / 2);
  return m;
}

// Одна сторона головы кирки: изогнутое "плечо" с острием. sign = ±1 — направление по оси z.
function arm(sign, length, thick, headMat, tipMat, droop) {
  const g = new THREE.Group();
  const inner = box(thick, thick, length * 0.55, headMat, 0, 0, sign * length * 0.275);
  const outer = new THREE.Group();
  outer.position.set(0, 0, sign * length * 0.55);
  outer.rotation.x = -sign * droop; // концы плеч слегка загибаются вниз
  outer.add(box(thick * 0.8, thick * 0.8, length * 0.45, headMat, 0, 0, sign * length * 0.225));
  outer.add(tip(thick * 0.55, thick * 1.6, tipMat, sign * length * 0.45, sign));
  g.add(inner, outer);
  return g;
}

function handle(material, length = 0.55) {
  return box(0.04, length, 0.04, material, 0, length / 2, 0);
}

/**
 * Параметрическая модель кирки: размер, цвета и украшения зависят от уровня (tier) и данных PICKAXES.
 * Один код даёт 22 разные модели: от каменной с верёвкой до космической с кольцом и кристаллами.
 */
function buildPickaxe(p) {
  const t = p.tier;
  const g = new THREE.Group();
  const armLen = 0.3 + t * 0.012;
  const thick = 0.06 + t * 0.0018;
  const handleLen = 0.55 + t * 0.006;
  const topY = handleLen + 0.02;

  const headMat = p.glow ? glow(p.head) : mat(p.head);
  const edgeMat = p.glow ? glow(p.edge) : mat(p.edge);
  const darkMat = mat(0x24343e);
  const bandMat = mat(t < 9 ? 0x4a5560 : 0x151d24);

  // Рукоять: дерево у простых кирок, тёмный сплав с жилой света у магических
  g.add(handle(t < 9 ? mat(new THREE.Color(0x7a5233).offsetHSL(0, 0, -0.012 * t)) : darkMat, handleLen));
  if (t >= 9) g.add(box(0.012, handleLen * 0.7, 0.045, glow(p.edge), 0, handleLen * 0.5, 0));

  // Навершие и бугель
  g.add(box(thick * 1.25, thick * 1.25, thick * 1.25, t < 9 ? bandMat : darkMat, 0, topY - 0.01, 0));
  g.add(arm(1, armLen, thick, headMat, edgeMat, 0.3 + t * 0.006).translateY(topY - 0.01));
  g.add(arm(-1, armLen, thick, headMat, edgeMat, 0.3 + t * 0.006).translateY(topY - 0.01));

  // Обмотка/кольца на рукояти: чем выше уровень, тем их больше
  const bands = Math.min(4, 1 + Math.floor(t / 5));
  for (let i = 0; i < bands; i++) g.add(box(0.06, 0.03, 0.06, t < 3 ? mat(0xb89968) : bandMat, 0, 0.08 + i * 0.1, 0));

  // Украшения по уровню
  if (t >= 6) g.add(box(0.07, 0.05, 0.07, p.glow ? glow(p.edge) : edgeMat, 0, -0.01, 0)); // навершие внизу рукояти
  if (t >= 9) { // осколок-шип сверху
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.05 + t * 0.001, 0.16 + t * 0.004, 4), glow(p.edge));
    shard.position.set(0, topY + 0.1 + t * 0.002, 0);
    g.add(shard);
  }
  if (t >= 12) { // боковые зубцы головы
    for (const sign of [1, -1]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), glow(p.edge));
      spike.position.set(0, topY + 0.07, sign * 0.05);
      spike.rotation.x = sign * 0.5;
      g.add(spike);
    }
  }
  if (t >= 15) { // парящие самоцветы у концов головы
    for (const sign of [1, -1]) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035 + (t - 15) * 0.004), glow(p.edge));
      gem.position.set(0, topY + 0.14, sign * (armLen * 0.7));
      g.add(gem);
    }
  }
  if (t >= 19) { // светящееся кольцо вокруг головы
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11 + (t - 19) * 0.012, 0.009, 6, 20), glow(p.edge));
    ring.position.set(0, topY, 0);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
  }
  return g;
}

export class PickaxeView {
  constructor(camera) {
    this.root = new THREE.Group();
    this.models = {}; // модели создаются по требованию и кэшируются
    this.root.position.set(0.34, -0.42, -0.6);
    camera.add(this.root);

    this.swingTime = 1;      // 0..1 — прогресс текущего удара (1 = покой)
    this.swingDuration = 0.2;
    this.bobTime = 0;
    this.current = null;
  }

  /** Показывает модель нужной кирки. */
  setModel(id) {
    this.current = id;
    if (!this.models[id] && PICKAXES[id]) {
      const m = buildPickaxe(PICKAXES[id]);
      this.models[id] = m;
      this.root.add(m);
    }
    for (const [key, m] of Object.entries(this.models)) m.visible = key === id;
  }

  /** Запускает анимацию удара; duration — не дольше интервала между ударами. */
  swing(duration) {
    this.swingDuration = Math.min(0.24, duration * 0.9);
    this.swingTime = 0;
  }

  update(dt, moving) {
    this.bobTime += dt * (moving ? 9 : 2);
    const bob = Math.sin(this.bobTime) * (moving ? 0.012 : 0.004);

    let swing = 0;
    if (this.swingTime < 1) {
      this.swingTime = Math.min(1, this.swingTime + dt / this.swingDuration);
      swing = Math.sin(Math.PI * this.swingTime); // вниз и обратно
    }
    this.root.position.y = -0.42 + bob;
    // Базовый наклон вперёд и в сторону центра, при ударе голова уходит вперёд-вниз
    this.root.rotation.set(-0.3 - swing * 1.0, 0.1, 0.28 - swing * 0.15);
    this.root.position.z = -0.6 - swing * 0.1;
  }
}
