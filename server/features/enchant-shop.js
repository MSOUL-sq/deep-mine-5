// Покупка чар в мастерской. Сами чары описаны в shared/enchants.js.
import { SHOP_RANGE } from '../../shared/constants.js';
import { buyEnchant } from '../../shared/enchants.js';

export default function register(api) {
  // Клиент -> сервер: 'enchant' { id }
  api.onEvent('enchant', ({ me }, d, reply) => {
    const w = api.world.workshop;
    if (Math.hypot(me.x - w.x, me.y - w.y, me.z - w.z) > SHOP_RANGE) return reply({ ok: false, error: 'Подойдите к мастерской' });
    const res = buyEnchant(me.state, d && d.id);
    if (res.ok) api.sendState(me);
    reply(res);
  });
}
