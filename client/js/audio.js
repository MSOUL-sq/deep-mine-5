// Процедурные звуки (Web Audio API): файлов не нужно. Если звук недоступен — тихо ничего не делаем.
let ctx = null;
let noiseBuffer = null;

/** Создаёт AudioContext. Вызывать из обработчика клика — браузеры требуют жест пользователя. */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) {
    ctx = null;
  }
}

// Короткий всплеск шума через полосовой фильтр + затухание
function burst(freq, duration, volume, q = 1) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq * (0.9 + Math.random() * 0.2);
  filter.Q.value = q;
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t, 0, duration + 0.05);
}

function tone(freq, duration, volume) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

// v — множитель громкости (для звуков других игроков, зависит от расстояния)
export const sound = {
  hit(v = 1) { burst(900, 0.12, 0.35 * v, 1.5); tone(140, 0.1, 0.25 * v); },
  hard(v = 1) { tone(520, 0.12, 0.2 * v); burst(2500, 0.05, 0.15 * v, 4); }, // удар по неразрушимому
  breakBlock(v = 1) { burst(500, 0.35, 0.5 * v, 0.8); tone(90, 0.25, 0.35 * v); },
  pickup() { tone(880, 0.12, 0.15); },
  place(v = 1) { burst(300, 0.15, 0.45 * v, 1); tone(180, 0.12, 0.3 * v); },
  error() { tone(200, 0.18, 0.2); },
};
