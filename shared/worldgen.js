// Процедурная генерация пещеры Deep Mine.
// Модуль общий: его импортируют и клиент (/shared/worldgen.js), и сервер.
// Генерация детерминирована по seed, поэтому все игроки получают один и тот же мир,
// а по сети нужно передавать только изменения (разрушенные/поставленные блоки).

export const SIZE_X = 96;
export const SIZE_Y = 48;
export const SIZE_Z = 96;
export const WORLD_SEED = 1337;

// Типы блоков
export const BLOCK = {
  AIR: 0,
  STONE: 1,
  COAL: 2,
  IRON: 3,
  COPPER: 4,
  CRYSTAL: 5,
  BEDROCK: 6,
  // Блоки, которые игроки строят сами
  BUILT_STONE: 7,
  LANTERN: 8,
  SUPPORT: 9,
  // Редкие руды глубоких уровней
  GOLD: 10,
  RUBY: 11,
  DIAMOND: 12,
};

// Центр стартовой каверны
const CAVERN = { x: SIZE_X / 2, y: 14, z: SIZE_Z / 2 };

export function blockIndex(x, y, z) {
  return (y * SIZE_Z + z) * SIZE_X + x;
}

export function inBounds(x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < SIZE_X && y < SIZE_Y && z < SIZE_Z;
}

// Псевдослучайное число 0..1 для целочисленной точки
function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Трёхмерный value-noise 0..1
export function noise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  const h = (dx, dy, dz) => hash3(x0 + dx, y0 + dy, z0 + dz, seed);
  const c00 = lerp(h(0, 0, 0), h(1, 0, 0), fx);
  const c10 = lerp(h(0, 1, 0), h(1, 1, 0), fx);
  const c01 = lerp(h(0, 0, 1), h(1, 0, 1), fx);
  const c11 = lerp(h(0, 1, 1), h(1, 1, 1), fx);
  return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
}

// Фрактальный шум (несколько октав), результат 0..1
export function fbm3(x, y, z, seed, octaves = 3) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Создаёт массив блоков мира размером SIZE_X*SIZE_Y*SIZE_Z. */
export function generateWorld(seed = WORLD_SEED) {
  const data = new Uint8Array(SIZE_X * SIZE_Y * SIZE_Z);
  const get = (x, y, z) => data[blockIndex(x, y, z)];
  const set = (x, y, z, t) => { data[blockIndex(x, y, z)] = t; };

  // 1. Камень + вырезание пещер
  for (let y = 0; y < SIZE_Y; y++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let x = 0; x < SIZE_X; x++) {
        // Внешняя оболочка мира — неразрушаемая
        if (x === 0 || z === 0 || y === 0 || x === SIZE_X - 1 || z === SIZE_Z - 1 || y === SIZE_Y - 1) {
          set(x, y, z, BLOCK.BEDROCK);
          continue;
        }
        // Условия "здесь пустота" объединяются через ИЛИ, поэтому дорогие шумы считаем в самом конце
        // и только если клетка ещё твёрдая (результат тот же, а генерация заметно быстрее).
        const dx = x - CAVERN.x, dz = z - CAVERN.z, dy = (y - CAVERN.y) * 1.6;
        const cavernDist = Math.sqrt(dx * dx + dz * dz + dy * dy);
        let hollow = false;

        // Стартовая каверна (шум-искажение границы не больше 6 блоков, дальше его можно не считать)
        if (cavernDist < 18) {
          const wobble = noise3(x * 0.15, y * 0.15, z * 0.15, seed + 303) * 6;
          if (cavernDist < 12 + wobble) hollow = true;
        }

        // Извилистые тоннели: пересечение двух "нулевых" поверхностей шума
        if (!hollow && Math.abs(noise3(x * 0.035, y * 0.05, z * 0.035, seed + 101) - 0.5) < 0.045 &&
            Math.abs(noise3(x * 0.035, y * 0.05, z * 0.035, seed + 202) - 0.5) < 0.045) hollow = true;

        // Большие полости
        if (!hollow && fbm3(x * 0.06, y * 0.08, z * 0.06, seed, 3) > 0.56) hollow = true;

        let solid = !hollow;

        // Дно и потолок остаются массивными (кроме каверны)
        if ((y < 3 || y > SIZE_Y - 4) && Math.abs(dx) > 14) solid = true;

        set(x, y, z, solid ? BLOCK.STONE : BLOCK.AIR);
      }
    }
  }

  const exposed = (x, y, z) =>
    get(x + 1, y, z) === 0 || get(x - 1, y, z) === 0 ||
    get(x, y + 1, z) === 0 || get(x, y - 1, z) === 0 ||
    get(x, y, z + 1) === 0 || get(x, y, z - 1) === 0;

  // 2. Руды
  for (let y = 1; y < SIZE_Y - 1; y++) {
    for (let z = 1; z < SIZE_Z - 1; z++) {
      for (let x = 1; x < SIZE_X - 1; x++) {
        if (get(x, y, z) !== BLOCK.STONE) continue;
        if (noise3(x * 0.2, y * 0.2, z * 0.2, seed + 10) > 0.8) { set(x, y, z, BLOCK.COAL); continue; }
        if (y < 32 && noise3(x * 0.22, y * 0.22, z * 0.22, seed + 11) > 0.78) { set(x, y, z, BLOCK.IRON); continue; }
        if (y < 28 && noise3(x * 0.22, y * 0.22, z * 0.22, seed + 12) > 0.78) { set(x, y, z, BLOCK.COPPER); continue; }
        // Глубокие руды: чем ниже, тем богаче
        if (y < 22 && noise3(x * 0.24, y * 0.24, z * 0.24, seed + 15) > 0.82) { set(x, y, z, BLOCK.GOLD); continue; }
        if (y < 16 && noise3(x * 0.26, y * 0.26, z * 0.26, seed + 16) > 0.845) { set(x, y, z, BLOCK.RUBY); continue; }
        if (y < 11 && noise3(x * 0.28, y * 0.28, z * 0.28, seed + 17) > 0.855) { set(x, y, z, BLOCK.DIAMOND); continue; }
        // Кристаллы растут только на стенах пещер
        if (y < 26 && exposed(x, y, z) && noise3(x * 0.1, y * 0.1, z * 0.1, seed + 13) > 0.55 &&
            hash3(x, y, z, seed + 14) < 0.12) {
          set(x, y, z, BLOCK.CRYSTAL);
        }
      }
    }
  }

  // 3. Сталактиты (с потолка) и сталагмиты (с пола)
  for (let z = 2; z < SIZE_Z - 2; z++) {
    for (let x = 2; x < SIZE_X - 2; x++) {
      if (Math.abs(x - CAVERN.x) < 3 && Math.abs(z - CAVERN.z) < 3) continue; // не загораживаем спавн
      for (let y = 3; y < SIZE_Y - 4; y++) {
        const here = get(x, y, z);
        if (here !== BLOCK.STONE) continue;
        // потолок: камень сверху, воздух под ним
        if (get(x, y - 1, z) === BLOCK.AIR && hash3(x, y, z, seed + 21) < 0.07) {
          const len = 1 + Math.floor(hash3(x, y, z, seed + 22) * 3);
          for (let i = 1; i <= len && get(x, y - i, z) === BLOCK.AIR; i++) set(x, y - i, z, BLOCK.STONE);
        }
        // пол: камень снизу, воздух над ним
        if (get(x, y + 1, z) === BLOCK.AIR && hash3(x, y, z, seed + 23) < 0.07) {
          const len = 1 + Math.floor(hash3(x, y, z, seed + 24) * 3);
          for (let i = 1; i <= len && get(x, y + i, z) === BLOCK.AIR; i++) set(x, y + i, z, BLOCK.STONE);
        }
      }
    }
  }

  return data;
}

/** Точка появления игрока: пол стартовой каверны. Возвращает координаты ног. */
export function findSpawn(data) {
  const x = Math.floor(CAVERN.x), z = Math.floor(CAVERN.z);
  for (let y = 2; y < SIZE_Y - 3; y++) {
    if (data[blockIndex(x, y - 1, z)] !== BLOCK.AIR &&
        data[blockIndex(x, y, z)] === BLOCK.AIR &&
        data[blockIndex(x, y + 1, z)] === BLOCK.AIR) {
      return { x: x + 0.5, y, z: z + 0.5 };
    }
  }
  return { x: x + 0.5, y: CAVERN.y, z: z + 0.5 };
}

/**
 * Место для мастерской: свободная клетка пола рядом со спавном (но не на нём).
 * Возвращает центр клетки на уровне пола.
 */
export function findWorkshopSpot(data) {
  const spawn = findSpawn(data);
  const sx = Math.floor(spawn.x), sz = Math.floor(spawn.z);
  for (let r = 3; r <= 8; r++) {
    for (let a = 0; a < 16; a++) {
      const x = sx + Math.round(Math.cos(a / 16 * Math.PI * 2) * r);
      const z = sz + Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
      const y = spawn.y; // каверна ровная вокруг спавна, но проверим высоту явно
      // Только тот же уровень или ±1 блок — иначе станок не достать прыжком (прыжок ≈ 1.3 блока)
      for (const yy of [y, y - 1, y + 1]) {
        if (!inBounds(x, yy, z) || !inBounds(x, yy + 2, z)) continue;
        if (data[blockIndex(x, yy - 1, z)] !== BLOCK.AIR && data[blockIndex(x, yy, z)] === BLOCK.AIR &&
            data[blockIndex(x, yy + 1, z)] === BLOCK.AIR && data[blockIndex(x, yy + 2, z)] === BLOCK.AIR) {
          return { x: x + 0.5, y: yy, z: z + 0.5 };
        }
      }
    }
  }
  return { x: spawn.x + 2, y: spawn.y, z: spawn.z }; // запасной вариант
}
