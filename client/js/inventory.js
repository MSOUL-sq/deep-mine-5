// Инвентарь игрока на клиенте: зеркало состояния, которое присылает сервер.
// Клиент ничего не списывает и не начисляет сам — покупки, продажа, добыча и стройка проверяются сервером.
import { createPlayerState } from '/shared/economy.js';

export class Inventory {
  constructor() {
    this.state = createPlayerState();
    this.itemListeners = [];
    this.updateListeners = [];
  }

  get money() { return this.state.money; }
  get equipped() { return this.state.equipped; }

  /** Подписка на изменение предметов: callback(id, count, delta). */
  onChange(fn) { this.itemListeners.push(fn); }

  /** Подписка на любое изменение состояния (деньги, кирки, предметы). */
  onUpdate(fn) { this.updateListeners.push(fn); }

  count(id) { return this.state.items[id] || 0; }
  has(id, amount = 1) { return this.count(id) >= amount; }

  /** Принимает полное состояние от сервера и уведомляет интерфейс о разнице. */
  setState(next) {
    const prev = this.state;
    this.state = next;
    for (const id of Object.keys(next.items)) {
      const delta = next.items[id] - (prev.items[id] || 0);
      if (delta !== 0) this.itemListeners.forEach((fn) => fn(id, next.items[id], delta));
    }
    this.updateListeners.forEach((fn) => fn(next));
  }
}
