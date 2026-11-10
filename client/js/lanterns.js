// Свет от фонарей. Реальных источников света мало (число ограничено производительностью),
// поэтому небольшой пул PointLight каждые 0.25 с перекидывается на ближайшие к игроку фонари.
// Число источников постоянно (лишние гаснут через intensity = 0) — так Three.js не перекомпилирует шейдеры.
import * as THREE from 'three';

const POOL_SIZE = 6;
const INTENSITY = 12;

export class LanternLights {
  constructor(scene, world) {
    this.world = world;
    this.limit = POOL_SIZE; // сколько источников реально включено (зависит от графики)
    this.timer = 0;
    this.lights = Array.from({ length: POOL_SIZE }, () => {
      const l = new THREE.PointLight(0xffc766, 0, 14, 2);
      l.position.set(0, -1000, 0);
      scene.add(l);
      return l;
    });
  }

  /** Ограничивает число одновременно горящих источников (дешевле для слабых устройств). */
  setLimit(n) { this.limit = Math.max(0, Math.min(POOL_SIZE, n)); this.timer = 0; }

  update(dt, cameraPos) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;

    const near = [...this.world.lanterns.values()]
      .map((p) => ({ p, d: (p.x - cameraPos.x) ** 2 + (p.y - cameraPos.y) ** 2 + (p.z - cameraPos.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.limit);

    this.lights.forEach((light, i) => {
      if (near[i]) { light.position.set(near[i].p.x, near[i].p.y, near[i].p.z); light.intensity = INTENSITY; }
      else { light.intensity = 0; }
    });
  }
}
