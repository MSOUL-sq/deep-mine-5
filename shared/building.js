// Правила строительства. Используются и клиентом (прозрачный предпросмотр), и сервером (настоящая проверка).
import { BLOCK, SIZE_X, SIZE_Y, SIZE_Z } from './worldgen.js';
import { REACH, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, NET_REACH_TOLERANCE } from './constants.js';

// Что можно построить и сколько ресурсов это стоит.
// Дерева в пещере нет, поэтому опора "обугливается": её цена — камень и уголь.
export const BUILD_KINDS = {
  stone_block: { id: 'stone_block', name: 'Каменный блок',    block: BLOCK.BUILT_STONE, cost: { stone: 2 } },
  lantern:     { id: 'lantern',     name: 'Каменный фонарь',  block: BLOCK.LANTERN,     cost: { stone: 2, coal: 1, copper: 1 } },
  support:     { id: 'support',     name: 'Деревянная опора', block: BLOCK.SUPPORT,     cost: { stone: 1, coal: 2 } },
};
export const BUILD_ORDER = ['stone_block', 'lantern', 'support'];

export function canAfford(items, kindId) {
  const kind = BUILD_KINDS[kindId];
  return Object.entries(kind.cost).every(([id, n]) => (items[id] || 0) >= n);
}

export function payCost(items, kindId) {
  for (const [id, n] of Object.entries(BUILD_KINDS[kindId].cost)) items[id] -= n;
}

/**
 * Можно ли поставить блок в клетку (x, y, z).
 *  world   — объект с getBlock(x, y, z) (за границами мира должен возвращать твёрдый блок);
 *  eye     — позиция глаз строителя {x, y, z};
 *  players — позиции ног всех игроков {x, y, z}: внутри них строить нельзя;
 *  tolerance — запас по дальности (на сервере компенсирует задержку сети).
 * Возвращает { ok: true } или { ok: false, error }.
 */
export function validatePlacement(world, x, y, z, eye, players, tolerance = 0) {
  if (![x, y, z].every(Number.isInteger)) return { ok: false, error: 'Неверные координаты' };
  // Внешняя оболочка мира — неприкосновенна
  if (x < 1 || y < 1 || z < 1 || x > SIZE_X - 2 || y > SIZE_Y - 2 || z > SIZE_Z - 2) {
    return { ok: false, error: 'Здесь строить нельзя' };
  }
  const dx = x + 0.5 - eye.x, dy = y + 0.5 - eye.y, dz = z + 0.5 - eye.z;
  if (Math.hypot(dx, dy, dz) > REACH + 0.9 + tolerance) return { ok: false, error: 'Слишком далеко' };
  if (world.getBlock(x, y, z) !== BLOCK.AIR) return { ok: false, error: 'Место занято' };

  // Ставим только на поверхность: хотя бы один сосед — твёрдый блок
  const supported =
    world.getBlock(x + 1, y, z) !== BLOCK.AIR || world.getBlock(x - 1, y, z) !== BLOCK.AIR ||
    world.getBlock(x, y + 1, z) !== BLOCK.AIR || world.getBlock(x, y - 1, z) !== BLOCK.AIR ||
    world.getBlock(x, y, z + 1) !== BLOCK.AIR || world.getBlock(x, y, z - 1) !== BLOCK.AIR;
  if (!supported) return { ok: false, error: 'Нужна опорная поверхность' };

  // Нельзя запирать игроков внутри блока
  for (const p of players) {
    if (p.x + PLAYER_HALF_WIDTH > x && p.x - PLAYER_HALF_WIDTH < x + 1 &&
        p.y + PLAYER_HEIGHT > y && p.y < y + 1 &&
        p.z + PLAYER_HALF_WIDTH > z && p.z - PLAYER_HALF_WIDTH < z + 1) {
      return { ok: false, error: 'Игрок мешает' };
    }
  }
  return { ok: true };
}

export { NET_REACH_TOLERANCE };
