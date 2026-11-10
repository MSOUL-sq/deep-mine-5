// Интерфейс HUD: счётчик ресурсов (подписан на инвентарь).
import { ITEMS, PICKAXES, PICKAXE_ORDER, BLOCK_INFO } from '/shared/blocks.js';
import { BLOCK } from '/shared/worldgen.js';
import { BUILD_KINDS, BUILD_ORDER } from '/shared/building.js';
import { ENCHANTS, ENCHANT_ORDER } from '/shared/enchants.js';

export class ResourceBar {
  constructor(container, inventory) {
    this.container = container;
    this.slots = {};
    for (const [id, item] of Object.entries(ITEMS)) {
      const slot = document.createElement('div');
      slot.className = 'res-slot';
      slot.title = item.name;
      slot.innerHTML = `<span class="res-icon" style="background:${item.color}"></span>` +
        `<span class="res-name">${item.name}</span><span class="res-count">0</span>`;
      container.appendChild(slot);
      this.slots[id] = slot;
    }
    inventory.onChange((id, count, delta) => this.update(id, count, delta));
  }

  update(id, count, delta) {
    const slot = this.slots[id];
    slot.querySelector('.res-count').textContent = count;
    slot.classList.toggle('has', count > 0);
    if (delta > 0) {
      // Перезапуск CSS-анимации "всплеска" при получении ресурса
      slot.classList.remove('pop');
      void slot.offsetWidth;
      slot.classList.add('pop');
    }
  }
}

// --- Деньги в HUD -------------------------------------------------------------
export class MoneyBadge {
  constructor(el, inventory) {
    this.el = el;
    this.last = inventory.money;
    inventory.onUpdate((state) => {
      el.querySelector('.money-count').textContent = state.money;
      if (state.money !== this.last) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
        this.last = state.money;
      }
    });
    el.querySelector('.money-count').textContent = inventory.money;
  }
}

// --- Магазин (мастерская) -----------------------------------------------------
function pickIcon(p) {
  const glowStyle = p.glow ? `style="filter:drop-shadow(0 0 4px ${p.edge})"` : '';
  return `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" ${glowStyle}>
    <rect x="22" y="14" width="4" height="30" rx="2" fill="${p.tier < 9 ? '#8a5a33' : '#2a3a46'}"/>
    <path d="M5 23 Q24 3 43 23 Q24 12 5 23Z" fill="${p.head}" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>
    <path d="M7 22.5 Q24 8 41 22.5" fill="none" stroke="${p.edge}" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
  </svg>`;
}

// Руды, которые открывает кирка этого уровня (minTier совпадает с её уровнем)
function unlocksOf(p) {
  if (p.tier === 0) return '';
  const names = Object.values(BLOCK_INFO).filter((b) => b.minTier === p.tier).map((b) => b.name);
  return names.length ? `<span class="unlock">🔓 ${names.join(', ')}</span>` : '';
}

export class ShopUI {
  constructor(inventory, net) {
    this.inventory = inventory;
    this.net = net; // все покупки и продажи идут через сервер
    this.el = document.getElementById('shop');
    this.picksEl = document.getElementById('shop-picks');
    this.sellEl = document.getElementById('shop-sell');
    this.enchEl = document.getElementById('shop-enchants');
    this.moneyEl = document.getElementById('shop-money');
    this.msgEl = document.getElementById('shop-msg');
    this.closeBtn = document.getElementById('shop-close');
    this.isOpen = false;

    // Все кнопки магазина обрабатываем одним делегированным обработчиком
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;
      this.handle(btn.dataset.action, btn.dataset.id);
    });
    inventory.onUpdate(() => { if (this.isOpen) this.render(); });
  }

  open() { this.isOpen = true; this.msgEl.textContent = ''; this.render(); this.el.classList.remove('hidden'); }
  close() { this.isOpen = false; this.el.classList.add('hidden'); }

  /** Отправляет действие серверу и показывает его ответ. */
  async handle(action, id) {
    let result;
    if (action === 'buy') result = await this.net.shop('buy', id);
    else if (action === 'equip') result = await this.net.shop('equip', id);
    else if (action === 'sell-all') result = await this.net.shop('sell', id, this.inventory.count(id));
    else if (action === 'sell-one') result = await this.net.shop('sell', id, 1);
    else if (action === 'sell-everything') result = await this.net.shop('sellAll');
    else if (action === 'enchant') result = await this.net.request('enchant', { id });
    if (!result) return;
    this.msgEl.className = result.ok ? 'ok' : 'err';
    this.msgEl.textContent = result.ok
      ? (result.gain ? `Продано: +${result.gain} монет` : action === 'buy' ? 'Кирка куплена и взята в руки!' : action === 'enchant' ? `Чара улучшена до уровня ${result.level}` : 'Кирка выбрана')
      : result.error;
  }

  render() {
    const st = this.inventory.state;
    this.moneyEl.innerHTML = `<span class="coin"></span>${st.money.toLocaleString('ru-RU')}`;

    // Кирки
    this.picksEl.innerHTML = PICKAXE_ORDER.map((id) => PICKAXES[id]).map((p) => {
      const owned = st.pickaxes.includes(p.id);
      const equipped = st.equipped === p.id;
      const stoneTime = (Math.ceil(BLOCK_INFO[BLOCK.STONE].hardness / p.power) / p.speed).toFixed(1);
      let button;
      if (equipped) button = '<button class="btn-s" disabled>В руках</button>';
      else if (owned) button = `<button class="btn-s" data-action="equip" data-id="${p.id}">Взять</button>`;
      else button = `<button class="btn-s buy" data-action="buy" data-id="${p.id}" ${st.money < p.cost ? 'data-poor="1"' : ''}>Купить · ${p.cost.toLocaleString('ru-RU')}</button>`;
      return `<div class="pick-card ${equipped ? 'equipped' : ''}">
        ${pickIcon(p)}
        <div class="pick-name">${p.name}</div>
        <div class="pick-stats">
          <span>Сила <b>${p.power}</b> · <b>${p.speed}</b>/с</span>
          <span>Камень за <b>${stoneTime}</b> с</span>
          ${unlocksOf(p)}
        </div>
        ${button}
      </div>`;
    }).join('');

    // Чары
    const levels = st.enchants || {};
    this.enchEl.innerHTML = ENCHANT_ORDER.map((id) => {
      const e = ENCHANTS[id], lvl = levels[id] || 0, max = e.costs.length, cost = e.costs[lvl];
      const btn = lvl >= max ? '<button class="btn-s" disabled>Максимум</button>'
        : `<button class="btn-s buy" data-action="enchant" data-id="${id}" ${st.money < cost ? 'data-poor="1"' : ''}>${lvl ? 'Улучшить' : 'Купить'} · ${cost.toLocaleString('ru-RU')}</button>`;
      return `<div class="pick-card ${lvl ? 'equipped' : ''}">
        <div style="font-size:28px">${e.icon}</div>
        <div class="pick-name">${e.name}${max > 1 ? ` · ${lvl}/${max}` : ''}</div>
        <div class="pick-stats"><span>${e.desc}</span></div>
        ${btn}
      </div>`;
    }).join('');

    // Продажа
    const rows = Object.entries(ITEMS).map(([id, it]) => {
      const n = st.items[id];
      return `<div class="sell-row">
        <span class="res-icon" style="background:${it.color}"></span>
        <span class="sell-name">${it.name}</span>
        <span class="sell-count">×${n}</span>
        <span class="sell-price">${it.value} <i class="coin"></i></span>
        <button class="btn-s" data-action="sell-one" data-id="${id}" ${n < 1 ? 'disabled' : ''}>1</button>
        <button class="btn-s" data-action="sell-all" data-id="${id}" ${n < 1 ? 'disabled' : ''}>Всё</button>
      </div>`;
    }).join('');
    this.sellEl.innerHTML = rows +
      `<button class="btn-s wide" data-action="sell-everything">Продать всё</button>`;
  }
}

// --- Уведомления --------------------------------------------------------------
let toastTimer = 0;
export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 1800);
}

// --- Меню строительства -------------------------------------------------------
export class BuildMenu {
  constructor(el, building, inventory) {
    this.el = el;
    this.building = building;
    this.inventory = inventory;
    building.onChange(() => this.render());
    inventory.onUpdate(() => this.render());
    // Клик по карточке выбирает объект (пригодится на сенсорных экранах)
    el.addEventListener('click', (e) => {
      const card = e.target.closest('[data-kind]');
      if (card) building.select(card.dataset.kind);
    });
    this.render();
  }

  render() {
    const b = this.building;
    this.el.classList.toggle('hidden', !b.active);
    if (!b.active) return;
    const items = this.inventory.state.items;
    this.el.innerHTML = BUILD_ORDER.map((id, i) => {
      const k = BUILD_KINDS[id];
      const col = BLOCK_INFO[k.block].color.map((v) => Math.round(v * 255)).join(',');
      const cost = Object.entries(k.cost).map(([item, n]) => {
        const enough = (items[item] || 0) >= n;
        return `<span class="${enough ? '' : 'lack'}"><i class="res-icon" style="background:${ITEMS[item].color}"></i>${n}</span>`;
      }).join('');
      return `<div class="build-card ${b.selected === id ? 'sel' : ''}" data-kind="${id}">
        <div class="build-key">${i + 1}</div>
        <div class="build-swatch" style="background:rgb(${col});${id === 'lantern' ? `box-shadow:0 0 14px rgb(${col})` : ''}"></div>
        <div class="build-name">${k.name}</div>
        <div class="build-cost">${cost}</div>
      </div>`;
    }).join('');
  }
}
