// Процедурный атлас текстур блоков 16×16 (4×4 плитки). Никаких файлов: пиксели рисуются кодом.
// Модуль чистый (без DOM и Three.js), поэтому его можно запускать и проверять в Node.
// Цвета подобраны так, чтобы каждый блок узнавался с первого взгляда: у каждой руды свой цвет и форма вкраплений.

export const TILE = 16;
export const COLS = 4;
export const ATLAS = TILE * COLS;

// Имя блока (ключ BLOCK) -> номер плитки в атласе
export const TILE_BY_NAME = {
  STONE: 0, COAL: 1, IRON: 2, COPPER: 3, CRYSTAL: 4, BEDROCK: 5,
  BUILT_STONE: 6, LANTERN: 7, SUPPORT: 8, GOLD: 9, RUBY: 10, DIAMOND: 11,
};

function makeRng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Холст одной плитки: y = 0 — низ плитки (направление "вверх" совпадает с осью V текстуры). */
class Tile {
  constructor(data, index) {
    this.data = data;
    this.ox = (index % COLS) * TILE;
    this.oy = Math.floor(index / COLS) * TILE;
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = ((this.oy + y) * ATLAS + (this.ox + x)) * 4;
    this.data[i] = clamp(c[0]); this.data[i + 1] = clamp(c[1]); this.data[i + 2] = clamp(c[2]); this.data[i + 3] = 255;
  }
  get(x, y) {
    const i = ((this.oy + y) * ATLAS + (this.ox + x)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  fill(fn) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, fn(x, y));
  }
}

// --- Заготовки ----------------------------------------------------------------

/** Камень: зернистая поверхность, пятна светлее/темнее, тонкие трещины. */
function paintStone(t, seed, base = [107, 112, 122]) {
  const rnd = makeRng(seed);
  const cells = Array.from({ length: 16 }, () => 0.9 + rnd() * 0.2); // крупные пятна 4×4
  t.fill((x, y) => {
    const blotch = cells[Math.floor(y / 4) * 4 + Math.floor(x / 4)];
    return mul(base, blotch * (0.9 + rnd() * 0.2));
  });
  // Светлые крапинки
  for (let i = 0; i < 10; i++) t.set(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), mul(base, 1.22));
  // Трещины
  for (let n = 0; n < 2; n++) {
    let x = Math.floor(rnd() * TILE), y = Math.floor(rnd() * TILE);
    for (let i = 0; i < 6; i++) {
      t.set(x, y, mul(base, 0.62));
      x += Math.floor(rnd() * 3) - 1;
      y += rnd() < 0.7 ? 1 : 0;
    }
  }
}

/** Вкрапления руды: кучки пикселей с бликом и тенью. */
function paintBlobs(t, seed, color, hi, count, size = 1.6) {
  const rnd = makeRng(seed + 99);
  for (let b = 0; b < count; b++) {
    const cx = 2 + Math.floor(rnd() * 12), cy = 2 + Math.floor(rnd() * 12);
    const cells = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.hypot(dx, dy) <= size * (0.75 + rnd() * 0.45)) cells.push([cx + dx, cy + dy]);
    }
    for (const [x, y] of cells) {
      const k = 0.88 + rnd() * 0.24;
      t.set(x, y, mul(color, k));
    }
    // Тень снизу (нижний ряд кучки темнее), блик сверху-слева
    for (const [x, y] of cells) {
      if (!cells.some(([a, b2]) => a === x && b2 === y - 1)) t.set(x, y, mul(color, 0.7));
    }
    const top = cells.reduce((m, c) => (c[1] > m[1] || (c[1] === m[1] && c[0] < m[0]) ? c : m), cells[0]);
    if (top) t.set(top[0], top[1], hi);
  }
}

function paintOre(t, seed, color, hi, count, size) {
  paintStone(t, seed);
  paintBlobs(t, seed, color, hi, count, size);
}

// --- Отдельные блоки ----------------------------------------------------------

function paintCrystal(t, seed) {
  const rnd = makeRng(seed);
  t.fill((x, y) => mul([22, 75, 92], 0.85 + rnd() * 0.3)); // тёмно-бирюзовая порода
  const shards = [[4, 3, 3, 7], [11, 5, 3, 8], [8, 11, 3, 5], [2, 12, 2, 3], [13, 13, 2, 3]];
  for (const [cx, cy, w, h] of shards) {
    for (let y = cy - h; y <= cy + h; y++) {
      for (let x = cx - w; x <= cx + w; x++) {
        const d = Math.abs(x - cx) / w + Math.abs(y - cy) / h;
        if (d > 1) continue;
        const edge = d > 0.8;
        const shade = x < cx ? 1.05 : 0.72; // освещённая и теневая грани
        const base = edge ? [30, 150, 165] : [70, 235, 235];
        t.set(x, y, mul(base, shade * (1 - d * 0.18)));
      }
    }
    t.set(cx - 1, cy + 1, [235, 255, 255]); // блик
  }
}

function paintBedrock(t, seed) {
  const rnd = makeRng(seed);
  t.fill(() => mul([34, 34, 40], 0.55 + rnd() * 0.9));
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rnd() * 14), y = Math.floor(rnd() * 14);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) t.set(x + dx, y + dy, [10, 10, 13]);
  }
  for (let i = 0; i < 8; i++) t.set(Math.floor(rnd() * 16), Math.floor(rnd() * 16), [70, 70, 82]);
}

function paintBricks(t, seed) {
  const rnd = makeRng(seed);
  const mortar = [88, 92, 104];
  t.fill(() => mortar);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const offset = row % 2 ? 4 : 0;
    for (let bx = -1; bx < 3; bx++) {
      const x0 = bx * 8 + offset;
      const shade = 0.88 + rnd() * 0.24;
      for (let y = y0 + 1; y < y0 + 4; y++) {
        for (let x = x0 + 1; x < x0 + 8; x++) {
          const top = y === y0 + 3;
          t.set(x, y, mul([158, 162, 176], shade * (top ? 1.12 : 1) * (0.96 + rnd() * 0.08)));
        }
      }
    }
  }
}

function paintLantern(t) {
  const frame = [58, 50, 46];
  t.fill((x, y) => {
    const border = x < 2 || y < 2 || x > 13 || y > 13;
    if (border) return frame;
    const bar = x === 7 || x === 8 || y === 7 || y === 8;
    if (bar) return [92, 76, 60];
    // Светящееся стекло: ярче к центру ячейки
    const d = Math.hypot((x % 8) - 3.5 + (x > 8 ? 0 : 0), (y % 8) - 3.5);
    return mul([255, 205, 95], 1.1 - d * 0.1);
  });
  for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15], [1, 1], [14, 1], [1, 14], [14, 14]]) t.set(x, y, [150, 130, 100]); // заклёпки
}

function paintSupport(t, seed) {
  const rnd = makeRng(seed);
  const wood = [150, 100, 56];
  t.fill((x, y) => {
    const plank = Math.floor(x / 4);
    const k = 0.9 + ((plank * 37) % 5) * 0.04 + rnd() * 0.06;
    const seam = x % 4 === 0;
    return mul(wood, seam ? 0.7 : k);
  });
  // Годовые линии
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(rnd() * 16), y0 = Math.floor(rnd() * 10);
    for (let y = y0; y < y0 + 4 + Math.floor(rnd() * 3); y++) t.set(x, y, mul(wood, 0.78));
  }
  // Рама и диагональная распорка
  const dark = [96, 62, 32], light = [186, 132, 76];
  for (let i = 0; i < TILE; i++) {
    for (const [x, y] of [[i, 0], [i, 1], [i, 14], [i, 15], [0, i], [1, i], [14, i], [15, i]]) t.set(x, y, dark);
    t.set(i, i, light); t.set(i, i + 1, light);
    t.set(15 - i, i, light); t.set(14 - i, i, light);
  }
}

function paintGold(t, seed) {
  paintStone(t, seed);
  paintBlobs(t, seed, [245, 195, 40], [255, 245, 170], 5, 2.0);
}

function paintRuby(t, seed) {
  paintStone(t, seed);
  paintBlobs(t, seed, [205, 25, 60], [255, 150, 170], 4, 2.2);
}

function paintDiamond(t, seed) {
  paintStone(t, seed);
  paintBlobs(t, seed, [110, 235, 245], [255, 255, 255], 4, 2.2);
}

/** Собирает атлас: возвращает Uint8Array RGBA размером ATLAS×ATLAS (строка 0 — низ, как в DataTexture). */
export function buildAtlasData() {
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  const T = (name) => new Tile(data, TILE_BY_NAME[name]);

  paintStone(T('STONE'), 1);
  paintOre(T('COAL'), 2, [22, 22, 27], [95, 95, 112], 7, 2.1);
  paintOre(T('IRON'), 3, [222, 172, 142], [255, 228, 208], 6, 1.9);
  const copper = T('COPPER');
  paintOre(copper, 4, [215, 112, 58], [255, 190, 130], 6, 1.9);
  for (const [x, y] of [[3, 4], [10, 10], [12, 3], [5, 12]]) copper.set(x, y, [70, 175, 140]); // зелёная патина
  paintCrystal(T('CRYSTAL'), 5);
  paintBedrock(T('BEDROCK'), 6);
  paintBricks(T('BUILT_STONE'), 7);
  paintLantern(T('LANTERN'));
  paintSupport(T('SUPPORT'), 9);
  paintGold(T('GOLD'), 10);
  paintRuby(T('RUBY'), 11);
  paintDiamond(T('DIAMOND'), 12);
  return data;
}
