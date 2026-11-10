import * as THREE from 'three';
import {
  SIZE_X, SIZE_Y, SIZE_Z, BLOCK, blockIndex, inBounds, generateWorld, findSpawn,
} from '/shared/worldgen.js';
import { buildAtlasData, ATLAS, COLS, TILE_BY_NAME } from './atlas.js';

const CHUNK = 16;
const CHUNKS_X = Math.ceil(SIZE_X / CHUNK);
const CHUNKS_Y = Math.ceil(SIZE_Y / CHUNK);
const CHUNKS_Z = Math.ceil(SIZE_Z / CHUNK);

// Плитка атласа для каждого типа блока и признак "светится" (рисуется без освещения)
const TILE_OF = new Uint8Array(32);
for (const [name, tile] of Object.entries(TILE_BY_NAME)) TILE_OF[BLOCK[name]] = tile;
const GLOW = new Uint8Array(32);
GLOW[BLOCK.CRYSTAL] = GLOW[BLOCK.LANTERN] = GLOW[BLOCK.DIAMOND] = 1;

// Грани: нормаль n и касательные u, v (u × v = n, значит обход против часовой снаружи).
// vi — какая из осей угла (0: su, 1: sv) направлена вверх: по ней текстура получает правильный "верх".
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.82, vi: 0 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.82, vi: 1 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1.0, vi: 1 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.55, vi: 1 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.7, vi: 1 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], shade: 0.7, vi: 0 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];
const UV_INSET = 0.002; // чтобы соседняя плитка не просвечивала на краях

// Небольшая вариация цвета, чтобы стены не выглядели плоскими
function variation(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return 0.9 + ((h >>> 0) % 1000) / 1000 * 0.2;
}

// Общие рабочие буферы: чанк собирается в них без выделения памяти, затем копируется в точный размер.
// Больше 16384 граней в чанке 16×16×16 получиться не может (шахматный узор), поэтому индексы помещаются в Uint16.
const MAX_FACES = 16384;
class MeshBuf {
  constructor() {
    this.pos = new Float32Array(MAX_FACES * 12);
    this.nor = new Int8Array(MAX_FACES * 12);
    this.col = new Uint8Array(MAX_FACES * 12);
    this.uv = new Float32Array(MAX_FACES * 8);
    this.idx = new Uint16Array(MAX_FACES * 6);
    this.faces = 0;
  }
}
const SOLID_BUF = new MeshBuf();
const GLOW_BUF = new MeshBuf();

function makeAtlasTexture() {
  const tex = new THREE.DataTexture(buildAtlasData(), ATLAS, ATLAS, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;   // чёткие пиксельные текстуры
  tex.minFilter = THREE.NearestFilter;   // без мипмапов: они "протекают" между плитками атласа
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.data = generateWorld();
    this.spawn = findSpawn(this.data);
    this.chunks = new Map(); // ключ чанка -> { solid, glow }
    this.lanterns = new Map(); // ключ "x,y,z" -> позиция фонаря (для источников света)
    this.dirty = new Set();

    this.atlas = makeAtlasTexture();
    this.solidMaterial = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true });

    for (let cy = 0; cy < CHUNKS_Y; cy++)
      for (let cz = 0; cz < CHUNKS_Z; cz++)
        for (let cx = 0; cx < CHUNKS_X; cx++) this.dirty.add(this.chunkKey(cx, cy, cz));
    this.rebuildDirty(Infinity); // первый раз строим весь мир сразу (пока виден экран меню)
  }

  /** Сколько чанков ждут перестройки. */
  get pendingChunks() { return this.dirty.size; }

  chunkKey(cx, cy, cz) { return (cy * CHUNKS_Z + cz) * CHUNKS_X + cx; }

  getBlock(x, y, z) {
    if (!inBounds(x, y, z)) return BLOCK.BEDROCK; // за границами мира — стена
    return this.data[blockIndex(x, y, z)];
  }

  isSolid(x, y, z) { return this.getBlock(x, y, z) !== BLOCK.AIR; }

  /**
   * Луч через воксели (алгоритм Амановидеса-Ву). Возвращает первый твёрдый блок на пути:
   * { x, y, z, nx, ny, nz, dist }, где (nx,ny,nz) — нормаль грани, в которую попал луч.
   * Нормаль нужна строительству: блок ставится в клетку (x+nx, y+ny, z+nz).
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const dX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const dY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const dZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tX = dx > 0 ? (x + 1 - ox) * dX : dx < 0 ? (ox - x) * dX : Infinity;
    let tY = dy > 0 ? (y + 1 - oy) * dY : dy < 0 ? (oy - y) * dY : Infinity;
    let tZ = dz > 0 ? (z + 1 - oz) * dZ : dz < 0 ? (oz - z) * dZ : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    while (t <= maxDist) {
      if (this.isSolid(x, y, z)) return { x, y, z, nx, ny, nz, dist: t };
      if (tX < tY && tX < tZ) { x += stepX; t = tX; tX += dX; nx = -stepX; ny = 0; nz = 0; }
      else if (tY < tZ) { y += stepY; t = tY; tY += dY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tZ; tZ += dZ; nx = 0; ny = 0; nz = -stepZ; }
    }
    return null;
  }

  /** Меняет блок и помечает затронутые чанки для перестройки. */
  setBlock(x, y, z, type) {
    if (!inBounds(x, y, z)) return false;
    const old = this.data[blockIndex(x, y, z)];
    this.data[blockIndex(x, y, z)] = type;
    if (type === BLOCK.LANTERN) this.lanterns.set(`${x},${y},${z}`, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    else if (old === BLOCK.LANTERN) this.lanterns.delete(`${x},${y},${z}`);
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), cz = Math.floor(z / CHUNK);
    this.dirty.add(this.chunkKey(cx, cy, cz));
    // Блок на границе чанка влияет и на соседний чанк
    const lx = x - cx * CHUNK, ly = y - cy * CHUNK, lz = z - cz * CHUNK;
    if (lx === 0 && cx > 0) this.dirty.add(this.chunkKey(cx - 1, cy, cz));
    if (lx === CHUNK - 1 && cx < CHUNKS_X - 1) this.dirty.add(this.chunkKey(cx + 1, cy, cz));
    if (ly === 0 && cy > 0) this.dirty.add(this.chunkKey(cx, cy - 1, cz));
    if (ly === CHUNK - 1 && cy < CHUNKS_Y - 1) this.dirty.add(this.chunkKey(cx, cy + 1, cz));
    if (lz === 0 && cz > 0) this.dirty.add(this.chunkKey(cx, cy, cz - 1));
    if (lz === CHUNK - 1 && cz < CHUNKS_Z - 1) this.dirty.add(this.chunkKey(cx, cy, cz + 1));
    return true;
  }

  /** Сбрасывает мир к исходному (при повторном подключении к серверу). */
  regenerate() {
    this.data = generateWorld();
    this.lanterns.clear();
    for (let cy = 0; cy < CHUNKS_Y; cy++)
      for (let cz = 0; cz < CHUNKS_Z; cz++)
        for (let cx = 0; cx < CHUNKS_X; cx++) this.dirty.add(this.chunkKey(cx, cy, cz));
  }

  /** Применяет список изменений от сервера: [[x, y, z, type], ...]. */
  applyChanges(changes) {
    for (const [x, y, z, type] of changes) this.setBlock(x, y, z, type);
  }

  /**
   * Перестраивает изменённые чанки, но не дольше budgetMs за кадр (хотя бы один всегда),
   * чтобы разрушение/постройка не вызывали подвисаний. Ближние к focus чанки идут первыми.
   */
  rebuildDirty(budgetMs = 5, focus = null) {
    if (this.dirty.size === 0) return;
    const keys = [...this.dirty];
    if (focus && keys.length > 1) {
      const dist = (key) => {
        const cx = key % CHUNKS_X, cz = Math.floor(key / CHUNKS_X) % CHUNKS_Z, cy = Math.floor(key / (CHUNKS_X * CHUNKS_Z));
        return (cx * CHUNK + 8 - focus.x) ** 2 + (cy * CHUNK + 8 - focus.y) ** 2 + (cz * CHUNK + 8 - focus.z) ** 2;
      };
      keys.sort((a, b) => dist(a) - dist(b));
    }
    const start = performance.now();
    let built = 0;
    for (const key of keys) {
      if (built > 0 && performance.now() - start > budgetMs) break;
      this.dirty.delete(key);
      const cx = key % CHUNKS_X;
      const cz = Math.floor(key / CHUNKS_X) % CHUNKS_Z;
      const cy = Math.floor(key / (CHUNKS_X * CHUNKS_Z));
      this.buildChunk(key, cx, cy, cz);
      built++;
    }
  }

  buildChunk(key, cx, cy, cz) {
    SOLID_BUF.faces = 0;
    GLOW_BUF.faces = 0;
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    const data = this.data;
    const tileSize = 1 / COLS;

    for (let y = y0; y < Math.min(y0 + CHUNK, SIZE_Y); y++) {
      for (let z = z0; z < Math.min(z0 + CHUNK, SIZE_Z); z++) {
        for (let x = x0; x < Math.min(x0 + CHUNK, SIZE_X); x++) {
          const type = data[blockIndex(x, y, z)];
          if (type === BLOCK.AIR) continue;
          const isGlow = GLOW[type] === 1;
          const buf = isGlow ? GLOW_BUF : SOLID_BUF;
          const tile = TILE_OF[type];
          const tu0 = (tile % COLS) * tileSize, tv0 = Math.floor(tile / COLS) * tileSize;
          const vary = variation(x, y, z);

          for (const f of FACES) {
            const [nx, ny, nz] = f.n;
            // Грань видна, только если с этой стороны воздух
            if (this.getBlock(x + nx, y + ny, z + nz) !== BLOCK.AIR) continue;
            if (buf.faces >= MAX_FACES) continue;

            const [ux, uy, uz] = f.u, [vx, vy, vz] = f.v;
            const cxm = x + 0.5 + nx * 0.5, cym = y + 0.5 + ny * 0.5, czm = z + 0.5 + nz * 0.5;
            const ao0 = this.cornerAO(x, y, z, f, 0), ao1 = this.cornerAO(x, y, z, f, 1);
            const ao2 = this.cornerAO(x, y, z, f, 2), ao3 = this.cornerAO(x, y, z, f, 3);
            const aoLevels = [ao0, ao1, ao2, ao3];
            const vBase = buf.faces * 4;

            for (let c = 0; c < 4; c++) {
              const su = CORNERS[c][0], sv = CORNERS[c][1];
              const o3 = (vBase + c) * 3, o2 = (vBase + c) * 2;
              buf.pos[o3] = cxm + su * 0.5 * ux + sv * 0.5 * vx;
              buf.pos[o3 + 1] = cym + su * 0.5 * uy + sv * 0.5 * vy;
              buf.pos[o3 + 2] = czm + su * 0.5 * uz + sv * 0.5 * vz;
              buf.nor[o3] = nx; buf.nor[o3 + 1] = ny; buf.nor[o3 + 2] = nz;

              const k = isGlow ? 1 : Math.min(1.2, f.shade * AO_LEVELS[aoLevels[c]] * vary);
              const byte = Math.min(255, Math.round(k * 255));
              buf.col[o3] = byte; buf.col[o3 + 1] = byte; buf.col[o3 + 2] = byte;

              // UV: ось "вверх" текстуры совпадает с вертикальной осью грани
              const cv = f.vi === 0 ? su : sv, cu = f.vi === 0 ? sv : su;
              buf.uv[o2] = tu0 + (UV_INSET + (1 - 2 * UV_INSET) * (cu + 1) / 2) * tileSize;
              buf.uv[o2 + 1] = tv0 + (UV_INSET + (1 - 2 * UV_INSET) * (cv + 1) / 2) * tileSize;
            }

            // Выбираем диагональ так, чтобы не было артефактов градиента AO
            const io = buf.faces * 6;
            if (ao0 + ao2 >= ao1 + ao3) {
              buf.idx[io] = vBase; buf.idx[io + 1] = vBase + 1; buf.idx[io + 2] = vBase + 2;
              buf.idx[io + 3] = vBase; buf.idx[io + 4] = vBase + 2; buf.idx[io + 5] = vBase + 3;
            } else {
              buf.idx[io] = vBase + 1; buf.idx[io + 1] = vBase + 2; buf.idx[io + 2] = vBase + 3;
              buf.idx[io + 3] = vBase + 1; buf.idx[io + 4] = vBase + 3; buf.idx[io + 5] = vBase;
            }
            buf.faces++;
          }
        }
      }
    }

    // Убираем старые меши чанка
    const old = this.chunks.get(key);
    if (old) {
      for (const mesh of [old.solid, old.glow]) {
        if (!mesh) continue;
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    this.chunks.set(key, {
      solid: this.makeMesh(SOLID_BUF, this.solidMaterial),
      glow: this.makeMesh(GLOW_BUF, this.glowMaterial),
    });
  }

  /** Уровень ambient occlusion (0..3) для угла грани по трём соседним блокам. */
  cornerAO(x, y, z, f, corner) {
    const [su, sv] = CORNERS[corner];
    const [ux, uy, uz] = f.u, [vx, vy, vz] = f.v;
    const ax = x + f.n[0], ay = y + f.n[1], az = z + f.n[2];
    const s1 = this.isSolid(ax + su * ux, ay + su * uy, az + su * uz) ? 1 : 0;
    const s2 = this.isSolid(ax + sv * vx, ay + sv * vy, az + sv * vz) ? 1 : 0;
    const c = this.isSolid(ax + su * ux + sv * vx, ay + su * uy + sv * vy, az + su * uz + sv * vz) ? 1 : 0;
    return (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
  }

  makeMesh(buf, material) {
    const f = buf.faces;
    if (f === 0) return null;
    const v = f * 4;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buf.pos.slice(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(buf.nor.slice(0, v * 3), 3, true));
    geo.setAttribute('color', new THREE.BufferAttribute(buf.col.slice(0, v * 3), 3, true));
    geo.setAttribute('uv', new THREE.BufferAttribute(buf.uv.slice(0, v * 2), 2));
    geo.setIndex(new THREE.BufferAttribute(buf.idx.slice(0, f * 6), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    this.scene.add(mesh);
    return mesh;
  }
}
