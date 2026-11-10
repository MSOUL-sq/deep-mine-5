// Описание блоков, предметов и кирок. Общий модуль: клиент использует его для эффектов и интерфейса,
// сервер — для проверки добычи, наград и покупок.
import { BLOCK } from './worldgen.js';

// Блок: имя, прочность (сколько "силы" нужно вложить), предмет и количество выпадающих ресурсов, цвет.
// minTier — минимальный уровень кирки (индекс в PICKAXE_ORDER), которой этот блок можно добыть.
export const BLOCK_INFO = {
  [BLOCK.STONE]:   { name: 'Камень',        hardness: 3,  minTier: 0,  item: 'stone',   drop: 1, color: [0.42, 0.44, 0.48] },
  [BLOCK.COAL]:    { name: 'Угольная руда', hardness: 4,  minTier: 0,  item: 'coal',    drop: 2, color: [0.17, 0.17, 0.19] },
  [BLOCK.COPPER]:  { name: 'Медная руда',   hardness: 5,  minTier: 0,  item: 'copper',  drop: 2, color: [0.78, 0.45, 0.27] },
  [BLOCK.IRON]:    { name: 'Железная руда', hardness: 6,  minTier: 1,  item: 'iron',    drop: 1, color: [0.66, 0.5, 0.42] },
  [BLOCK.CRYSTAL]: { name: 'Кристалл',      hardness: 8,  minTier: 3,  item: 'crystal', drop: 1, color: [0.25, 0.95, 0.95] },
  [BLOCK.GOLD]:    { name: 'Золотая руда',  hardness: 10, minTier: 5,  item: 'gold',    drop: 1, color: [0.98, 0.8, 0.25] },
  [BLOCK.RUBY]:    { name: 'Рубиновая руда', hardness: 14, minTier: 9, item: 'ruby',    drop: 1, color: [0.85, 0.12, 0.25] },
  [BLOCK.DIAMOND]: { name: 'Алмазная руда', hardness: 20, minTier: 12, item: 'diamond', drop: 1, color: [0.55, 0.95, 1.0] },
  // Постройки игроков: ресурсов не дают (стоимость см. shared/building.js)
  [BLOCK.BUILT_STONE]: { name: 'Каменный блок',    hardness: 2, minTier: 0, item: null, drop: 0, color: [0.6, 0.62, 0.68] },
  [BLOCK.LANTERN]:     { name: 'Каменный фонарь',  hardness: 1, minTier: 0, item: null, drop: 0, color: [1.0, 0.82, 0.4] },
  [BLOCK.SUPPORT]:     { name: 'Деревянная опора', hardness: 2, minTier: 0, item: null, drop: 0, color: [0.55, 0.37, 0.2] },
  [BLOCK.BEDROCK]: { name: 'Неразрушимая порода', hardness: Infinity, minTier: 0, item: null, drop: 0, color: [0.12, 0.12, 0.14] },
};

// Предметы инвентаря. value — цена продажи в мастерской.
export const ITEMS = {
  stone:   { name: 'Камень',   color: '#8b909a', value: 1 },
  coal:    { name: 'Уголь',    color: '#33343b', value: 3 },
  copper:  { name: 'Медь',     color: '#e07a45', value: 6 },
  iron:    { name: 'Железо',   color: '#c58d78', value: 8 },
  crystal: { name: 'Кристалл', color: '#3df0f0', value: 25 },
  gold:    { name: 'Золото',   color: '#f5c542', value: 45 },
  ruby:    { name: 'Рубин',    color: '#e0264d', value: 110 },
  diamond: { name: 'Алмаз',    color: '#8ff0ff', value: 260 },
};

// 22 кирки. power — урон блоку за удар, speed — ударов в секунду, cost — цена,
// head/edge — цвета модели и иконки, glow — светящаяся (магическая) кирка.
const PICK_TABLE = [
  // id          название               сила  скор.  цена     голова     остриё     свет
  ['stone',    'Каменная кирка',        1,    1.6,        0, '#8b909a', '#5f646d', false],
  ['copper',   'Медная кирка',          1.3,  1.8,       60, '#d9743f', '#f0a070', false],
  ['bronze',   'Бронзовая кирка',       1.6,  1.9,      120, '#b8814a', '#e0b078', false],
  ['iron',     'Железная кирка',        2,    2.2,      220, '#cdd5dc', '#f0f4f7', false],
  ['steel',    'Стальная кирка',        2.4,  2.3,      380, '#9fb0c0', '#dbe6f0', false],
  ['silver',   'Серебряная кирка',      2.8,  2.4,      600, '#e4e8ee', '#ffffff', false],
  ['gold',     'Золотая кирка',         3.2,  2.6,      900, '#f2c230', '#fff1a0', false],
  ['cobalt',   'Кобальтовая кирка',     3.7,  2.7,     1300, '#2f63d6', '#7fa6ff', false],
  ['titanium', 'Титановая кирка',       4.3,  2.8,     1900, '#8e98a8', '#d3dbe8', false],
  ['crystal',  'Кристальная кирка',     5,    3.0,     2700, '#3df0f0', '#b6ffff', true],
  ['emerald',  'Изумрудная кирка',      5.8,  3.1,     3800, '#2fd16f', '#9dffc4', true],
  ['ruby',     'Рубиновая кирка',       6.7,  3.2,     5200, '#e0264d', '#ff9aac', true],
  ['sapphire', 'Сапфировая кирка',      7.7,  3.3,     7000, '#2a6bff', '#9cc0ff', true],
  ['amethyst', 'Аметистовая кирка',     8.8,  3.4,     9500, '#a45cf0', '#dcb8ff', true],
  ['obsidian', 'Обсидиановая кирка',    10,   3.5,    13000, '#3a2556', '#a070ff', true],
  ['diamond',  'Алмазная кирка',        12,   3.6,    18000, '#7fe9ff', '#ffffff', true],
  ['mythril',  'Мифриловая кирка',      14,   3.8,    25000, '#9ad6c8', '#e8fffa', true],
  ['adamant',  'Адамантовая кирка',     16.5, 4.0,    35000, '#c0392b', '#ffb199', true],
  ['plasma',   'Плазменная кирка',      19,   4.2,    50000, '#ff4fd8', '#ffd0f6', true],
  ['void',     'Пустотная кирка',       22,   4.4,    75000, '#5b2bd6', '#c9a8ff', true],
  ['solar',    'Солнечная кирка',       26,   4.6,   110000, '#ffb020', '#fff2a0', true],
  ['cosmic',   'Космическая кирка',     30,   5.0,   160000, '#18e0ff', '#ffffff', true],
];

export const PICKAXE_ORDER = PICK_TABLE.map((r) => r[0]);

export const PICKAXES = Object.fromEntries(PICK_TABLE.map(([id, name, power, speed, cost, head, edge, glow], tier) => [
  id, { id, name, power, speed, cost, tier, head, edge, glow },
]));
