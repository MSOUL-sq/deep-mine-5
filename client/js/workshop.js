// Мастерская — станок в стартовой каверне. Подойти и нажать E, чтобы открыть магазин.
import * as THREE from 'three';

const INTERACT_DISTANCE = 3.5;

export class Workshop {
  constructor(scene, spot) {
    this.pos = new THREE.Vector3(spot.x, spot.y, spot.z);
    const g = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0x3a4350 });
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4426 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x29d3c8 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), stone);
    base.position.y = 0.35;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.7), wood);
    top.position.y = 0.75;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.06), glow);
    screen.position.set(0, 1.1, -0.2);
    screen.rotation.x = -0.25;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.05), stone);
    frame.position.set(0, 1.1, -0.24);
    frame.rotation.x = -0.25;
    g.add(base, top, frame, screen);

    // Подпись над станком
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 34px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7ff5ec';
    ctx.fillText('МАСТЕРСКАЯ', 128, 44);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, fog: false }));
    label.scale.set(1.6, 0.4, 1);
    label.position.y = 1.75;
    g.add(label);

    const light = new THREE.PointLight(0x29d3c8, 8, 9, 2);
    light.position.y = 1.3;
    g.add(light);

    g.position.copy(this.pos);
    scene.add(g);
  }

  isNear(position) {
    return this.pos.distanceTo(position) <= INTERACT_DISTANCE;
  }
}
