// Точка входа клиента: сцена, освещение, игровой цикл, меню, подключение к серверу и связка модулей.
// Работает на ПК (мышь + клавиатура, Pointer Lock) и на телефонах (сенсорные джойстик и кнопки).
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Inventory } from './inventory.js';
import { Mining } from './mining.js';
import { Building } from './building.js';
import { Multiplayer } from './multiplayer.js';
import { ResourceBar, MoneyBadge, ShopUI, BuildMenu, toast } from './ui.js';
import { PickaxeView } from './pickaxe.js';
import { Workshop } from './workshop.js';
import { LanternLights } from './lanterns.js';
import { Chat } from './chat.js';
import { TouchControls } from './touch.js';
import { TradePanel } from './features/trade-panel.js';
import { unlockAudio, sound } from './audio.js';
import { findWorkshopSpot, BLOCK } from '/shared/worldgen.js';

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const info = document.getElementById('info');
const nicknameInput = document.getElementById('nickname');
const passwordInput = document.getElementById('password');
const graphicsSelect = document.getElementById('graphics');
const playButton = document.getElementById('play');
const menuError = document.getElementById('menu-error');
const promptEl = document.getElementById('prompt');
const loadingEl = document.getElementById('loading');

// Телефон/планшет (основной указатель — палец) или принудительно: ?touch=1
const isTouch = window.matchMedia('(pointer: coarse)').matches ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('touch');
document.body.classList.toggle('touch', isTouch);

// Даём браузеру показать экран загрузки, прежде чем генерация мира займёт основной поток
await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));

// --- Сцена -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03080c);
scene.fog = new THREE.FogExp2(0x03080c, 0.04);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 110);
scene.add(camera);

// Мягкий общий свет + факел игрока (свет следует за камерой)
scene.add(new THREE.AmbientLight(0x6f9fb0, 0.9));
const torch = new THREE.PointLight(0xffd9a0, 45, 45, 2);
camera.add(torch);

// --- Игровые системы -------------------------------------------------------
const world = new World(scene);
const inventory = new Inventory();
const player = new Player(camera, world);
const net = new Multiplayer(scene, world, inventory);
const mining = new Mining(scene, camera, world, player, net);
const building = new Building(scene, camera, world, player, inventory, net, () => net.remotePositions());
const lanternLights = new LanternLights(scene, world);
const workshop = new Workshop(scene, findWorkshopSpot(world.data));
const pickaxeView = new PickaxeView(camera);

new ResourceBar(document.getElementById('resources'), inventory);
new MoneyBadge(document.getElementById('money'), inventory);
new BuildMenu(document.getElementById('build-menu'), building, inventory);
const shop = new ShopUI(inventory, net);

// Кирка в руке всегда соответствует выбранной (её присылает сервер)
function syncPickaxe() {
  mining.setPickaxe(inventory.state);
  pickaxeView.setModel(inventory.equipped);
}
inventory.onUpdate(syncPickaxe);
syncPickaxe();
mining.onSwing = (interval) => pickaxeView.swing(interval);
mining.onWeak = (text) => toast(text, 'err');
inventory.onChange((id, count, delta) => { if (delta > 0) sound.pickup(); });

// --- Управление: единая точка включения/выключения ----------------------------
let inGame = false;

/** Включает или выключает управление игроком (на ПК следует за Pointer Lock, на телефоне — за кнопками). */
function setControl(on) {
  player.enabled = on;
  if (!on) {
    mining.holding = false;
    player.releaseInput();
    touch.reset();
  }
}

function requestControl() {
  if (isTouch) setControl(true);
  else canvas.requestPointerLock?.();
}

const touch = new TouchControls({
  player, mining, building, toast,
  onShop: () => { if (player.enabled && workshop.isNear(player.pos)) openShop(); },
  onChat: () => { if (player.enabled) chat.open(); },
  onMenu: () => { setControl(false); showPauseMenu(); },
});

// --- Чат ---------------------------------------------------------------------
const chat = new Chat({
  send: (text) => net.chat(text),
  myId: () => net.id,
  onOpen: () => { setControl(false); if (!isTouch) document.exitPointerLock(); },
  onClose: () => { if (inGame && !menuVisible()) requestControl(); },
});
net.onChat = (m) => chat.add(m);

// --- Передача ресурсов (плагин: client/js/features/trade-panel.js) ---------------
const trade = new TradePanel({
  net, inventory,
  getPlayers: () => [...net.remotes.values()].map((r) => ({ id: r.id, nickname: r.nickname, dist: r.target.distanceTo(player.pos) })),
  onOpen: () => { setControl(false); if (!isTouch) document.exitPointerLock(); },
  onClose: () => { if (inGame && !menuVisible()) requestControl(); },
});

// --- Графика и адаптивное разрешение ---------------------------------------
const dpr = window.devicePixelRatio || 1;
const GRAPHICS = {
  low: { ratio: 0.6, fog: 0.055, lights: 2 },
  medium: { ratio: 1, fog: 0.04, lights: 4 },
  high: { ratio: Math.min(dpr, isTouch ? 1.5 : 2), fog: 0.03, lights: 6 },
};
let graphics = GRAPHICS.medium;
let renderScale = 1; // 0.5..1: авто-снижение разрешения при низком FPS

function applyRatio() {
  renderer.setPixelRatio(Math.max(0.3, graphics.ratio * renderScale));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

function applyGraphics(level) {
  graphics = GRAPHICS[level] || GRAPHICS.medium;
  renderScale = 1;
  scene.fog.density = graphics.fog;
  lanternLights.setLimit(graphics.lights);
  applyRatio();
  localStorage.setItem('deepmine.graphics', level);
}

graphicsSelect.value = localStorage.getItem('deepmine.graphics') || 'medium';
applyGraphics(graphicsSelect.value);
graphicsSelect.addEventListener('change', () => applyGraphics(graphicsSelect.value));

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyRatio();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

// --- Сеть: события от сервера ----------------------------------------------
// Громкость и эффекты чужих действий убывают с расстоянием
const _vec = new THREE.Vector3();
const volumeAt = (x, y, z) => Math.max(0, 1 - camera.position.distanceTo(_vec.set(x + 0.5, y + 0.5, z + 0.5)) / 25);

net.onBlock = (x, y, z, type) => {
  const prev = world.getBlock(x, y, z);
  const vol = volumeAt(x, y, z);
  if (type === BLOCK.AIR) mining.showBreak(x, y, z, prev, vol);
  else if (vol > 0.05) sound.place(vol);
  world.setBlock(x, y, z, type);
};
net.onDamage = (x, y, z, dmg, max, by) => {
  mining.setDamage(x, y, z, dmg, max);
  if (by !== net.id) mining.showRemoteHit(x, y, z, volumeAt(x, y, z));
};
net.onTeleport = (p) => player.spawnAt(p); // сервер вернул нас на допустимую позицию

let falling = false;
player.onFall = () => {
  if (falling) return;
  falling = true;
  net.respawn().then((s) => { player.spawnAt(s || player.spawnPoint); falling = false; });
};

net.onDisconnect = () => {
  inGame = false;
  document.body.classList.remove('ingame');
  chat.close();
  shop.close();
  building.setActive(false);
  setControl(false);
  touch.show(false);
  document.exitPointerLock();
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
  nicknameInput.disabled = false;
  passwordInput.disabled = false;
  playButton.textContent = 'Подключиться';
  showMenuError('Соединение с сервером потеряно');
};

// --- Меню, подключение и Pointer Lock --------------------------------------
nicknameInput.value = localStorage.getItem('deepmine.nickname') || '';
let nickname = '';

const menuVisible = () => !menu.classList.contains('hidden');

function showMenuError(text) {
  menuError.textContent = text;
  menuError.classList.toggle('hidden', !text);
}

function enterFullscreen() {
  try {
    Promise.resolve(document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })).catch(() => {});
    screen.orientation?.lock?.('landscape')?.catch?.(() => {});
  } catch { /* не критично: не все браузеры разрешают */ }
}

async function startGame() {
  unlockAudio();
  if (isTouch) enterFullscreen(); // сразу, пока действует жест пользователя
  showMenuError('');
  if (!net.connected) {
    nickname = nicknameInput.value.trim() || `Шахтёр${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem('deepmine.nickname', nickname);
    playButton.disabled = true;
    playButton.textContent = 'Подключение...';
    try {
      const res = await net.connect(nickname, passwordInput.value);
      player.spawnPoint = res.spawn;
      player.spawnAt(res.spawn);
      nicknameInput.disabled = true;
      passwordInput.disabled = true;
      chat.loadHistory(res.chat);
      chat.addSystem(isTouch ? 'Чат: кнопка 💬. Команды: /help' : 'Чат: Enter или T. Команды: /help');
    } catch (err) {
      showMenuError(err.message);
      playButton.textContent = 'Играть';
      return;
    } finally {
      playButton.disabled = false;
    }
  }
  inGame = true;
  document.body.classList.add('ingame');
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  if (isTouch) touch.show(true);
  requestControl();
}

playButton.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

function showPauseMenu() {
  menu.classList.remove('hidden');
  hud.classList.add('hidden');
  touch.show(false);
  document.body.classList.remove('ingame');
  playButton.textContent = 'Продолжить';
}

document.addEventListener('pointerlockchange', () => {
  if (isTouch) return;
  const locked = document.pointerLockElement === canvas;
  setControl(locked);
  if (!locked && inGame && !shop.isOpen && !chat.isOpen && !trade.isOpen) showPauseMenu(); // Esc или потеря фокуса
});

// Если браузер не вернул курсор (например, после закрытия магазина) — показываем меню с "Продолжить"
document.addEventListener('pointerlockerror', () => {
  if (!isTouch && inGame && !shop.isOpen && !chat.isOpen && !trade.isOpen && !player.enabled) showPauseMenu();
});

// Телефон свернули или переключили вкладку — ставим на паузу
document.addEventListener('visibilitychange', () => {
  if (document.hidden && inGame && isTouch && !menuVisible()) { setControl(false); showPauseMenu(); }
});

// --- Мастерская ---------------------------------------------------------------
function openShop() {
  shop.open();
  setControl(false);
  if (!isTouch) document.exitPointerLock();
}
function closeShop() {
  shop.close();
  requestControl();
}
document.getElementById('shop-close').addEventListener('click', closeShop);

// --- Клавиатура и мышь -------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (!inGame || e.repeat || chat.isOpen || trade.isOpen) return;
  if (shop.isOpen) {
    if (e.code === 'KeyE' || e.code === 'Escape') closeShop();
    return;
  }
  if (!player.enabled) return;
  if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); chat.open(); }
  else if (e.code === 'Slash') { e.preventDefault(); chat.open(); chat.input.value = '/'; }
  else if (e.code === 'KeyE' && workshop.isNear(player.pos)) openShop();
  else if (e.code === 'KeyG') trade.open();
  else if (e.code === 'KeyB') building.toggle();
  else if (building.active && e.code.startsWith('Digit')) building.selectIndex(Number(e.code.slice(5)) - 1);
});

if (!isTouch) {
  canvas.addEventListener('mousedown', (e) => {
    if (!player.enabled) return;
    if (e.button === 0) mining.holding = true;
    else if (e.button === 2) building.place(toast);
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mining.holding = false; });
  window.addEventListener('wheel', (e) => {
    if (player.enabled && building.active) building.cycle(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// --- Игровой цикл ----------------------------------------------------------
const clock = new THREE.Clock();
let fpsTimer = 0, fpsFrames = 0, fps = 0;
let slowSeconds = 0, fastSeconds = 0;

function adaptResolution(currentFps) {
  // Просадка FPS 1,5 секунды подряд — уменьшаем разрешение; стабильные 58+ в течение 4 секунд — возвращаем
  if (currentFps < 28 && renderScale > 0.5) {
    slowSeconds += 0.5; fastSeconds = 0;
    if (slowSeconds >= 1.5) { renderScale = Math.max(0.5, renderScale * 0.85); slowSeconds = 0; applyRatio(); }
  } else if (currentFps >= 58 && renderScale < 1) {
    fastSeconds += 0.5; slowSeconds = 0;
    if (fastSeconds >= 4) { renderScale = Math.min(1, renderScale * 1.1); fastSeconds = 0; applyRatio(); }
  } else { slowSeconds = 0; fastSeconds = 0; }
}

function frame() {
  requestAnimationFrame(frame);
  const dt = clock.getDelta();

  player.update(dt);
  net.update(dt, player);
  mining.update(dt);
  building.update(dt);
  pickaxeView.update(dt, player.enabled && (player.vel.x !== 0 || player.vel.z !== 0));
  lanternLights.update(dt, camera.position);
  const near = player.enabled && workshop.isNear(player.pos);
  promptEl.classList.toggle('hidden', !near);
  if (isTouch) touch.update(near);
  world.rebuildDirty(5, player.pos); // не больше ~5 мс за кадр: разрушение блоков не вызывает подвисаний
  renderer.render(scene, camera);

  fpsFrames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(fpsFrames / fpsTimer);
    fpsFrames = 0;
    fpsTimer = 0;
    if (inGame && !document.hidden) adaptResolution(fps);
    const res = renderScale < 1 ? `  |  ${Math.round(renderScale * 100)}%` : '';
    info.textContent =
      `${nickname}  |  ${fps} FPS${res}  |  Игроков: ${net.playerCount}  |  X ${player.pos.x.toFixed(0)}  Y ${player.pos.y.toFixed(0)}  Z ${player.pos.z.toFixed(0)}`;
  }
}
frame();

// Мир готов — убираем экран загрузки
loadingEl.classList.add('done');
setTimeout(() => loadingEl.remove(), 500);

window.addEventListener('error', (e) => console.error('[Deep Mine] ошибка:', e.message));
