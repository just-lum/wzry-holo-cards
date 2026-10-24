(function (root) {
  'use strict';

  // Asset keys are single local path segments, never URLs or encoded paths.
  function safeKey(hero) {
    const key = hero && hero.key;
    if (typeof key !== 'string' || key.trim() !== key ||
        !/^\d+_[\p{L}\p{M}\p{N}().· _-]+$/u.test(key)) {
      throw new TypeError('Invalid hero key');
    }
    return key;
  }

  function normalizeHeroes(raw) {
    if (!Array.isArray(raw)) throw new TypeError('Hero catalog must be an array');
    const keys = new Set();
    const numbers = new Set();
    return raw.map(function (hero, index) {
      if (!hero || typeof hero !== 'object' || Array.isArray(hero)) {
        throw new TypeError('Invalid hero at catalog index ' + index);
      }
      const key = safeKey(hero);
      if (!Number.isSafeInteger(hero.no) || hero.no < 1) {
        throw new TypeError('Invalid hero number at catalog index ' + index);
      }
      for (const field of ['name', 'title', 'edition']) {
        if (typeof hero[field] !== 'string' || !hero[field].trim()) {
          throw new TypeError('Invalid hero ' + field + ' at catalog index ' + index);
        }
      }
      if (keys.has(key)) throw new TypeError('Duplicate hero key: ' + key);
      if (numbers.has(hero.no)) throw new TypeError('Duplicate hero number: ' + hero.no);
      keys.add(key);
      numbers.add(hero.no);
      return { no: hero.no, key, name: hero.name, title: hero.title, edition: hero.edition };
    });
  }

  function filterHeroes(heroes, query, { favoritesOnly = false, favorites = [] } = {}) {
    const needle = String(query == null ? '' : query).trim().toLowerCase();
    const favoriteKeys = favorites instanceof Set ? favorites : new Set(Array.isArray(favorites) ? favorites : []);
    return heroes.filter(function (hero) {
      if (favoritesOnly && !favoriteKeys.has(hero.key)) return false;
      return !needle || [hero.name, hero.title, hero.key, String(hero.no), String(hero.no).padStart(3, '0')]
        .some(function (value) { return value.toLowerCase().includes(needle); });
    });
  }

  function heroFromHash(heroes, hash) {
    if (typeof hash !== 'string' || !hash.startsWith('#hero=')) return null;
    let key;
    try { key = decodeURIComponent(hash.slice(6)); } catch (_) { return null; }
    return heroes.find(function (hero) { return hero.key === key; }) || null;
  }

  function heroHash(hero) {
    return '#hero=' + encodeURIComponent(safeKey(hero));
  }

  function assetsFor(hero) {
    const directory = 'layers/' + safeKey(hero) + '/';
    return {
      character: directory + 'character.webp',
      background: 'shared/background.webp',
      ui: directory + 'ui.webp',
      structure: directory + 'structure.webp',
    };
  }

  function thumbnailFor(hero) {
    return 'viewer/thumb/' + safeKey(hero) + '.webp';
  }

  const api = Object.freeze({ normalizeHeroes, filterHeroes, heroFromHash, heroHash, assetsFor, thumbnailFor });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HOLO_CATALOG = api;
})(globalThis);
