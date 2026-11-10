// Модель другого игрока: простая low-poly фигурка, ник над головой и плавная интерполяция позиции.
import * as THREE from 'three';

function makeNameSprite(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI, system-ui, sans-serif';
  const w = Math.min(244, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(8, 16, 22, 0.7)';
  g.beginPath();
  g.roundRect(128 - w / 2, 8, w, 48, 14);
  g.fill();
  g.fillStyle = '#7ff5ec';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 232);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

export class RemotePlayer {
  constructor(scene, info) {
    this.id = info.id;
    this.nickname = info.nickname;
    this.scene = scene;
    this.group = new THREE.Group();

    // Цвет одежды зависит от id, чтобы игроков можно было различать
    let h = 0;
    for (const ch of info.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const suit = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h / 360, 0.55, 0.45) });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe0b894 });
    const visor = new THREE.MeshBasicMaterial({ color: 0x29d3c8 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a3038 });

    const box = (w, hh, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); b.position.set(x, y, z); return b; };
    this.body = box(0.5, 0.7, 0.28, suit, 0, 1.05, 0);
    this.head = new THREE.Group();
    this.head.position.set(0, 1.62, 0);
    this.head.add(box(0.38, 0.38, 0.38, skin, 0, 0, 0), box(0.4, 0.14, 0.4, dark, 0, 0.2, 0), box(0.3, 0.08, 0.04, visor, 0, 0.02, -0.2));
    // Ноги и руки качаются при ходьбе: вращаем от верхней точки
    const limb = (w, hh, d, m, x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(box(w, hh, d, m, 0, -hh / 2, 0));
      return pivot;
    };
    this.legL = limb(0.2, 0.7, 0.22, dark, -0.13, 0.7);
    this.legR = limb(0.2, 0.7, 0.22, dark, 0.13, 0.7);
    this.armL = limb(0.14, 0.6, 0.14, suit, -0.34, 1.38);
    this.armR = limb(0.14, 0.6, 0.14, suit, 0.34, 1.38);
    this.group.add(this.body, this.head, this.legL, this.legR, this.armL, this.armR);

    this.nameSprite = makeNameSprite(info.nickname);
    this.nameSprite.position.y = 2.2;
    this.group.add(this.nameSprite);

    this.pos = new THREE.Vector3(info.x, info.y, info.z);
    this.target = this.pos.clone();
    this.yaw = info.yaw; this.targetYaw = info.yaw;
    this.pitch = info.pitch; this.targetPitch = info.pitch;
    this.walkPhase = 0;
    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  setTarget(x, y, z, yaw, pitch) {
    this.target.set(x, y, z);
    this.targetYaw = yaw;
    this.targetPitch = pitch;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 14);
    const before = this.pos.clone();
    this.pos.lerp(this.target, k);
    // Угол поворота интерполируем по кратчайшему пути
    let dyaw = this.targetYaw - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    const speed = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 1e-4);
    const moving = Math.min(1, speed / 3);
    this.walkPhase += speed * dt * 2.2;
    const swing = Math.sin(this.walkPhase) * 0.8 * moving;
    this.legL.rotation.x = swing; this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing; this.armR.rotation.x = swing;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.head.rotation.x = this.pitch;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
