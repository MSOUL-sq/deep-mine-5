// Сенсорное управление для телефонов и планшетов (Pointer Events, мультитач):
//   левая часть экрана — плавающий джойстик движения;
//   правая часть — поворот камеры перетаскиванием;
//   кнопки: копать (удержание), прыжок (удержание), строительство, поставить, мастерская, чат, меню.
// Всё остальное (добыча, стройка, магазин) работает через те же модули, что и на ПК.

const STICK_RADIUS = 56;        // пикселей отклонения до полной скорости
const DEAD_ZONE = 0.12;
const LOOK_SENSITIVITY = 0.0058; // радиан на пиксель сдвига пальца

export class TouchControls {
  constructor({ player, mining, building, onShop, onChat, onMenu, toast }) {
    this.player = player;
    this.mining = mining;
    this.building = building;
    this.toast = toast;
    this.root = document.getElementById('touch');
    this.stickBase = document.getElementById('stick-base');
    this.stickKnob = document.getElementById('stick-knob');
    this.moveZone = document.getElementById('touch-move');
    this.lookZone = document.getElementById('touch-look');
    this.btn = {
      dig: document.getElementById('tb-dig'),
      jump: document.getElementById('tb-jump'),
      build: document.getElementById('tb-build'),
      place: document.getElementById('tb-place'),
      shop: document.getElementById('tb-shop'),
      chat: document.getElementById('tb-chat'),
      menu: document.getElementById('tb-menu'),
    };
    this.movePointer = null;
    this.lookPointer = null;
    this.moveOrigin = { x: 0, y: 0 };
    this.lookLast = { x: 0, y: 0 };

    this.bindMove();
    this.bindLook();
    this.hold(this.btn.dig, () => { this.mining.holding = true; }, () => { this.mining.holding = false; });
    this.hold(this.btn.jump, () => { this.player.jumpHeld = true; }, () => { this.player.jumpHeld = false; });
    this.tap(this.btn.build, () => this.building.toggle());
    this.tap(this.btn.place, () => this.building.place(this.toast));
    this.tap(this.btn.shop, onShop);
    this.tap(this.btn.chat, onChat);
    this.tap(this.btn.menu, onMenu);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  /** Отпускает все удерживаемые элементы (пауза, магазин, чат). */
  reset() {
    this.movePointer = null;
    this.lookPointer = null;
    this.stickBase.classList.remove('active');
    this.stickBase.style.left = this.stickBase.style.top = '';
    this.stickKnob.style.transform = '';
    this.player.analog.x = this.player.analog.y = 0;
    this.player.jumpHeld = false;
    this.mining.holding = false;
    for (const b of [this.btn.dig, this.btn.jump]) b.classList.remove('down');
  }

  /** Каждый кадр: показывает кнопки по ситуации. */
  update(nearWorkshop) {
    this.btn.shop.classList.toggle('hidden', !nearWorkshop);
    this.btn.place.classList.toggle('hidden', !this.building.active);
    this.btn.build.classList.toggle('on', this.building.active);
  }

  // --- Джойстик -------------------------------------------------------------
  bindMove() {
    const z = this.moveZone;
    z.addEventListener('pointerdown', (e) => {
      if (this.movePointer !== null) return;
      e.preventDefault();
      this.movePointer = e.pointerId;
      z.setPointerCapture(e.pointerId);
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      const half = this.stickBase.offsetWidth / 2;
      this.stickBase.style.left = `${e.clientX - half}px`;
      this.stickBase.style.top = `${e.clientY - half}px`;
      this.stickBase.classList.add('active');
      this.setStick(0, 0);
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.movePointer) return;
      let dx = e.clientX - this.moveOrigin.x, dy = e.clientY - this.moveOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) { dx = dx / len * STICK_RADIUS; dy = dy / len * STICK_RADIUS; }
      this.setStick(dx, dy);
    });
    const end = (e) => {
      if (e.pointerId !== this.movePointer) return;
      this.movePointer = null;
      this.stickBase.classList.remove('active');
      this.stickBase.style.left = this.stickBase.style.top = '';
      this.stickKnob.style.transform = '';
      this.player.analog.x = this.player.analog.y = 0;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  setStick(dx, dy) {
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    let x = dx / STICK_RADIUS, y = -dy / STICK_RADIUS;
    const len = Math.hypot(x, y);
    if (len < DEAD_ZONE) { x = 0; y = 0; }
    else { const k = (len - DEAD_ZONE) / (1 - DEAD_ZONE) / len; x *= k; y *= k; }
    this.player.analog.x = x;
    this.player.analog.y = y;
  }

  // --- Камера ---------------------------------------------------------------
  bindLook() {
    const z = this.lookZone;
    z.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      z.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.player.look(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y, LOOK_SENSITIVITY);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const end = (e) => { if (e.pointerId === this.lookPointer) this.lookPointer = null; };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  // --- Кнопки ---------------------------------------------------------------
  hold(el, down, up) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      down();
    });
    const end = () => { el.classList.remove('down'); up(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  tap(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('down');
      navigator.vibrate?.(8);
      fn();
    });
    const end = () => el.classList.remove('down');
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
  }
}
