// Окно «Передать»: выбрать игрока, предмет и количество. Самодостаточный модуль: сам создаёт свой HTML и стили.
// Открывается клавишей G или кнопкой 🎁 (на телефоне). Сервер проверяет всё повторно (дальность, наличие предметов).
import { ITEMS } from '/shared/blocks.js';

const CSS = `
#trade-btn { position: fixed; top: 64px; right: 12px; z-index: 4; display: none; width: 44px; height: 44px; font-size: 22px;
  background: var(--panel); border: 1px solid rgba(41,211,200,.4); border-radius: 12px; cursor: pointer; pointer-events: auto; }
body.ingame #trade-btn { display: block; }
#trade { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(380px, calc(100vw - 24px));
  padding: 20px 22px; z-index: 6; display: flex; flex-direction: column; gap: 8px; }
#trade h2 { margin: 0 0 4px; color: var(--accent); letter-spacing: 2px; }
#trade select, #trade input { width: 100%; padding: 10px 12px; font-size: 15px; color: var(--text);
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.15); border-radius: 10px; }
#trade .row { display: flex; gap: 8px; }
#trade-msg { min-height: 18px; font-size: 13px; }
#trade-msg.ok { color: #7fe08f; } #trade-msg.err { color: #ff8a8a; }
`;

export class TradePanel {
  /** getPlayers() -> [{id, nickname, dist}], inventory — клиентский Inventory, net — Multiplayer. */
  constructor({ net, inventory, getPlayers, onOpen, onClose }) {
    Object.assign(this, { net, inventory, getPlayers, onOpen, onClose, isOpen: false });
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.btn = document.createElement('button');
    this.btn.id = 'trade-btn';
    this.btn.title = 'Передать ресурсы (G)';
    this.btn.textContent = '🎁';
    this.btn.addEventListener('click', () => this.open());
    document.body.appendChild(this.btn);

    this.el = document.createElement('div');
    this.el.id = 'trade';
    this.el.className = 'panel hidden';
    this.el.innerHTML = `
      <div class="shop-head"><h2>Передать</h2><button class="icon-btn" data-close title="Закрыть (G / Esc)">✕</button></div>
      <label>Кому</label><select data-to></select>
      <label>Что</label><select data-item></select>
      <label>Сколько</label>
      <div class="row"><input data-amount type="number" min="1" value="1" inputmode="numeric"><button class="btn-s" data-all type="button">Всё</button></div>
      <div id="trade-msg"></div>
      <button class="btn" data-send type="button">Отправить</button>`;
    document.body.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.toSel = q('[data-to]'); this.itemSel = q('[data-item]'); this.amount = q('[data-amount]'); this.msg = q('#trade-msg');

    q('[data-close]').addEventListener('click', () => this.close());
    q('[data-all]').addEventListener('click', () => { this.amount.value = this.have(this.itemSel.value); });
    q('[data-send]').addEventListener('click', () => this.send());
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && (e.code === 'Escape' || (e.code === 'KeyG' && e.target.tagName !== 'INPUT'))) { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    });
    inventory.onUpdate(() => { if (this.isOpen) this.renderItems(); });
  }

  have(item) { return item === 'money' ? this.inventory.money : this.inventory.count(item); }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.msg.textContent = '';
    const players = this.getPlayers();
    this.toSel.innerHTML = players.length
      ? players.map((p) => `<option value="${p.id}">${p.nickname.replace(/[<>&"]/g, '')} · ${p.dist.toFixed(0)} м</option>`).join('')
      : '<option value="">Рядом никого нет</option>';
    this.renderItems();
    this.el.classList.remove('hidden');
    this.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  renderItems() {
    const keep = this.itemSel.value;
    const opts = [['money', 'Монеты']].concat(Object.entries(ITEMS).map(([id, it]) => [id, it.name]));
    this.itemSel.innerHTML = opts.filter(([id]) => this.have(id) > 0 || id === keep)
      .map(([id, name]) => `<option value="${id}">${name} (${this.have(id)})</option>`).join('') || '<option value="">Нечего передавать</option>';
    if (keep) this.itemSel.value = keep;
  }

  async send() {
    const to = this.toSel.value, item = this.itemSel.value, amount = Math.floor(Number(this.amount.value));
    if (!to || !item) { this.show('Выберите игрока и предмет', false); return; }
    const res = await this.net.request('give', { to, item, amount });
    this.show(res.ok ? 'Передано!' : res.error, res.ok);
  }

  show(text, ok) { this.msg.textContent = text; this.msg.className = ok ? 'ok' : 'err'; }
}
