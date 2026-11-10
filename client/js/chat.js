// Чат: лента сообщений (исчезают через несколько секунд, пока чат закрыт) и поле ввода.
// Текст вставляется только через textContent — HTML из сообщений никогда не выполняется.

const FADE_AFTER_MS = 12000;   // через сколько сообщение пропадает с экрана, пока чат закрыт
const MAX_LINES = 60;

function colorOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 70%, 68%)`;
}

export class Chat {
  /** send(text) -> Promise<{ok, error?}>. onClose вызывается после закрытия поля ввода. */
  constructor({ send, onOpen, onClose, myId }) {
    this.send = send;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.myId = myId;                       // функция: () => id текущего игрока
    this.root = document.getElementById('chat');
    this.log = document.getElementById('chat-log');
    this.form = document.getElementById('chat-form');
    this.input = document.getElementById('chat-input');
    this.isOpen = false;
    this.sent = [];                         // история отправленного (стрелки вверх/вниз)
    this.sentIndex = 0;

    this.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      this.input.value = '';
      this.close();
      if (!text) return;
      this.sent.push(text);
      this.sentIndex = this.sent.length;
      const res = await this.send(text);
      if (res && !res.ok) this.addSystem(res.error || 'Не удалось отправить');
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { e.preventDefault(); this.input.value = ''; this.close(); }
      else if (e.code === 'ArrowUp' && this.sent.length) { this.sentIndex = Math.max(0, this.sentIndex - 1); this.input.value = this.sent[this.sentIndex]; e.preventDefault(); }
      else if (e.code === 'ArrowDown' && this.sent.length) { this.sentIndex = Math.min(this.sent.length, this.sentIndex + 1); this.input.value = this.sent[this.sentIndex] || ''; e.preventDefault(); }
    });
    document.getElementById('chat-close')?.addEventListener('click', () => this.close());
    setInterval(() => this.fade(), 1000);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.form.classList.remove('hidden');
    this.onOpen?.();
    this.log.scrollTop = this.log.scrollHeight;
    // Фокус после текущего события клавиши, иначе в поле попадёт открывающий символ
    setTimeout(() => this.input.focus(), 0);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.form.classList.add('hidden');
    this.input.blur();
    this.fade();
    this.onClose?.();
  }

  clear() { this.log.textContent = ''; }

  /** Добавляет сообщение сервера: { id, nickname, text, t, system?, action? }. */
  add(m, old = false) {
    const row = document.createElement('div');
    row.className = 'msg';
    row.dataset.t = old ? '0' : String(Date.now()); // история при входе сразу "старая": не загромождает экран
    if (m.system) {
      row.classList.add('system');
      row.textContent = m.text;
    } else {
      const name = document.createElement('span');
      name.className = 'msg-name';
      name.style.color = colorOf(m.id);
      const mine = this.myId && m.id === this.myId();
      if (m.action) {
        row.classList.add('action');
        name.textContent = `* ${m.nickname}`;
        row.append(name, document.createTextNode(` ${m.text}`));
      } else {
        name.textContent = `${m.nickname}${mine ? ' (вы)' : ''}:`;
        row.append(name, document.createTextNode(` ${m.text}`));
      }
    }
    this.log.appendChild(row);
    if (old) row.classList.add('old');
    while (this.log.children.length > MAX_LINES) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  addSystem(text) { this.add({ system: true, text }); }

  /** Загружает историю, присланную сервером при входе. */
  loadHistory(list) { this.clear(); for (const m of list || []) this.add(m, true); this.fade(); }

  /** Скрывает старые сообщения, пока чат закрыт. */
  fade() {
    const now = Date.now();
    for (const row of this.log.children) {
      row.classList.toggle('old', now - Number(row.dataset.t) > FADE_AFTER_MS);
    }
  }
}
