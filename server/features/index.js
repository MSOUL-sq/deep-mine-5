// Список серверных плагинов. Новая функция: создайте файл рядом, экспортируйте функцию register(api), добавьте сюда.
import trade from './trade.js';
import enchantShop from './enchant-shop.js';
import persistence from './persistence.js';

export const features = [persistence, trade, enchantShop];
