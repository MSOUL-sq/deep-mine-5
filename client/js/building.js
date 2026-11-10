// Режим строительства: B включает, 1-3 / колесо мыши выбирают объект, ПКМ ставит.
// Прозрачный предпросмотр показывает, куда встанет блок: зелёный — можно, красный — нельзя.
// Те же правила (shared/building.js) повторно проверяет сервер.
import * as THREE from 'three';
import { REACH } from '/shared/constants.js';
import { BLOCK_INFO } from '/shared/blocks.js';
import { BUILD_KINDS, BUILD_ORDER, canAfford, validatePlacement } from '/shared/building.js';
import { sound } from './audio.js';

export class Building {
  /** getOthers() — позиции других игроков (ног), чтобы не строить внутри них. */
  constructor(scene, camera, world, player, inventory, net, getOthers) {
    this.camera = camera;
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.net = net;
    this.getOthers = getOthers;

    this.active = false;
    this.selected = BUILD_ORDER[0];
    this.cell = null;        // клетка, куда встанет блок
    this.valid = false;
    this.reason = '';
    this.cooldown = 0;
    this.listeners = [];
    this._dir = new THREE.Vector3();

    // Призрак: полупрозрачный куб + рамка
    this.ghostMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.ghostMaterial);
    this.ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x44ff88 }),
    );
    this.ghost.add(this.ghostEdges);
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.applyGhostColor();
  }

  /** Подписка на изменения режима/выбора (для меню строительства). */
  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach((fn) => fn(this)); }

  toggle() { this.setActive(!this.active); }
  setActive(on) {
    this.active = on;
    if (!on) this.ghost.visible = false;
    this.emit();
  }

  select(kindId) {
    if (!BUILD_KINDS[kindId]) return;
    this.selected = kindId;
    this.applyGhostColor();
    this.emit();
  }
  selectIndex(i) { if (BUILD_ORDER[i]) this.select(BUILD_ORDER[i]); }
  cycle(dir) {
    const i = BUILD_ORDER.indexOf(this.selected);
    this.select(BUILD_ORDER[(i + dir + BUILD_ORDER.length) % BUILD_ORDER.length]);
  }

  applyGhostColor() {
    const c = BLOCK_INFO[BUILD_KINDS[this.selected].block].color;
    this.baseColor = new THREE.Color(c[0], c[1], c[2]);
  }

  /** Каждый кадр: ищет клетку под прицелом и проверяет, можно ли там строить. */
  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.active || !this.player.enabled) { this.ghost.visible = false; this.cell = null; return; }

    const p = this.camera.position;
    this.camera.getWorldDirection(this._dir);
    const hit = this.world.raycast(p.x, p.y, p.z, this._dir.x, this._dir.y, this._dir.z, REACH);
    if (!hit) { this.ghost.visible = false; this.cell = null; this.valid = false; return; }

    const cell = { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
    this.cell = cell;

    const eye = { x: p.x, y: p.y, z: p.z };
    const players = [{ x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }, ...this.getOthers()];
    const check = validatePlacement(this.world, cell.x, cell.y, cell.z, eye, players, 0);
    let valid = check.ok;
    this.reason = check.ok ? '' : check.error;
    if (valid && !canAfford(this.inventory.state.items, this.selected)) { valid = false; this.reason = 'Не хватает ресурсов'; }
    this.valid = valid;

    this.ghost.visible = true;
    this.ghost.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    if (valid) this.ghostMaterial.color.copy(this.baseColor);
    else this.ghostMaterial.color.setRGB(1, 0.2, 0.2);
    this.ghostEdges.material.color.setHex(valid ? 0x44ff88 : 0xff4444);
  }

  /** ПКМ: просит сервер поставить блок. Результат приходит как событие 'block' (или ошибка в ответе). */
  place(toast) {
    if (!this.active || !this.player.enabled || this.cooldown > 0) return;
    if (!this.cell) return;
    if (!this.valid) { sound.error(); toast?.(this.reason || 'Сюда нельзя', 'err'); return; }
    this.cooldown = 0.15;
    const { x, y, z } = this.cell;
    this.net.place(x, y, z, this.selected).then((res) => {
      if (!res.ok) { sound.error(); toast?.(res.error, 'err'); }
    });
  }
}
