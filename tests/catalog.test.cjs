'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../viewer/catalog.js');

const rawHeroes = [
  { no: 1, key: '159_朵莉亚', name: '朵莉亚', title: '人鱼之歌', edition: 'No. 001 / 130' },
  { no: 35, key: '140_关羽', name: '关羽', title: '一骑当千', edition: 'No. 035 / 130' },
  { no: 122, key: '577_SP少司缘', name: 'SP少司缘', title: '聆愿之祝', edition: 'No. 122 / 130' },
];

test('normalization preserves original series numbers without requiring a 125-item input', () => {
  const input = JSON.parse(JSON.stringify(rawHeroes));
  const heroes = catalog.normalizeHeroes(input);
  assert.deepEqual(heroes, rawHeroes);
  assert.notEqual(heroes, input);
  assert.notEqual(heroes[0], input[0]);
  assert.equal(heroes[2].no, 122);
  assert.equal(heroes[2].edition, 'No. 122 / 130');
  assert.deepEqual(input, rawHeroes);
});

test('normalization rejects malformed catalogs and incomplete records', () => {
  for (const raw of [null, {}, 'heroes', [null], [[]]]) {
    assert.throws(() => catalog.normalizeHeroes(raw), /catalog|hero/i);
  }
  for (const field of ['key', 'name', 'title', 'edition']) {
    for (const value of [undefined, '', '  ', 42]) {
      assert.throws(() => catalog.normalizeHeroes([{ ...rawHeroes[0], [field]: value }]), /key|name|title|edition/i);
    }
  }
  for (const no of [0, -1, 1.5, '1', NaN, Infinity]) {
    assert.throws(() => catalog.normalizeHeroes([{ ...rawHeroes[0], no }]), /number|no/i);
  }
});

test('normalization rejects duplicate keys and duplicate series numbers', () => {
  assert.throws(() => catalog.normalizeHeroes([rawHeroes[0], { ...rawHeroes[1], key: rawHeroes[0].key }]), /duplicate.*key/i);
  assert.throws(() => catalog.normalizeHeroes([rawHeroes[0], { ...rawHeroes[1], no: rawHeroes[0].no }]), /duplicate.*number|duplicate.*no/i);
});

test('all public path helpers reject traversal, encoded separators and URL syntax', () => {
  const unsafeKeys = ['../159_朵莉亚', '159_../朵莉亚', '159_\\朵莉亚', '159_%2f朵莉亚',
    '159_朵莉亚?x=1', '159_朵莉亚#x', 'https://example.test/card', '159_朵莉亚\n',
    '159_朵莉亚\u0000', '.', '..', '159_朵莉亚 '];
  for (const key of unsafeKeys) {
    const hero = { ...rawHeroes[0], key };
    assert.throws(() => catalog.normalizeHeroes([hero]), /key/i, key);
    assert.throws(() => catalog.assetsFor(hero), /key/i, key);
    assert.throws(() => catalog.thumbnailFor(hero), /key/i, key);
    assert.throws(() => catalog.heroHash(hero), /key/i, key);
  }
});

test('search finds names, titles, keys and original series numbers case-insensitively', () => {
  const heroes = catalog.normalizeHeroes(rawHeroes);
  assert.deepEqual(catalog.filterHeroes(heroes, ' 人鱼 '), [heroes[0]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '关羽'), [heroes[1]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '140_'), [heroes[1]]);
  assert.deepEqual(catalog.filterHeroes(heroes, 'sp少'), [heroes[2]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '122'), [heroes[2]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '001'), [heroes[0]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '130'), []);
  assert.deepEqual(catalog.filterHeroes(heroes, ''), heroes);
  assert.deepEqual(catalog.filterHeroes(heroes, '不存在'), []);
});

test('favorite filtering combines with search and accepts a Set or an array', () => {
  const heroes = catalog.normalizeHeroes(rawHeroes);
  const favorites = new Set([heroes[0].key, heroes[2].key, 'unknown']);
  assert.deepEqual(catalog.filterHeroes(heroes, '', { favoritesOnly: true, favorites }), [heroes[0], heroes[2]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '少', { favoritesOnly: true, favorites }), [heroes[2]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '关', { favoritesOnly: true, favorites }), []);
  assert.deepEqual(catalog.filterHeroes(heroes, '', { favoritesOnly: true, favorites: [heroes[1].key] }), [heroes[1]]);
  assert.deepEqual(catalog.filterHeroes(heroes, '', { favoritesOnly: true }), []);
  assert.deepEqual(catalog.filterHeroes(heroes, '', { favoritesOnly: false, favorites }), heroes);
  assert.deepEqual(heroes, rawHeroes);
});

test('hero hashes round-trip encoded names and retain the selected catalog object', () => {
  const heroes = catalog.normalizeHeroes(rawHeroes);
  const hash = '#hero=' + encodeURIComponent(heroes[0].key);
  assert.equal(catalog.heroHash(heroes[0]), hash);
  assert.equal(catalog.heroFromHash(heroes, hash), heroes[0]);
  assert.equal(catalog.heroFromHash(heroes, catalog.heroHash(heroes[2])), heroes[2]);
});

test('unknown and malformed hashes return null without throwing', () => {
  const heroes = catalog.normalizeHeroes(rawHeroes);
  for (const hash of ['', '#', '#hero=', '#other=159_朵莉亚', '#hero=missing',
    '#hero=%E0%A4%A', '#hero=%', '#hero=..%2F159_朵莉亚', '#hero=159_朵莉亚&hero=140_关羽', null, undefined]) {
    assert.equal(catalog.heroFromHash(heroes, hash), null, String(hash));
  }
});

test('asset helpers use shared backgrounds and preserve safe Unicode path segments', () => {
  const hero = rawHeroes[0];
  assert.deepEqual(catalog.assetsFor(hero), {
    character: 'layers/159_朵莉亚/character.webp',
    background: 'shared/background.webp',
    ui: 'layers/159_朵莉亚/ui.webp',
    structure: 'layers/159_朵莉亚/structure.webp',
  });
  assert.equal(catalog.thumbnailFor(hero), 'viewer/thumb/159_朵莉亚.webp');
  const variant = { ...hero, key: '582_元流之子(法师)' };
  assert.equal(catalog.thumbnailFor(variant), 'viewer/thumb/582_元流之子(法师).webp');
});

test('classic browser script exposes the same public API without CommonJS', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../viewer/catalog.js'), 'utf8'), context);
  const browserCatalog = context.HOLO_CATALOG;
  assert.deepEqual(Object.keys(browserCatalog).sort(), Object.keys(catalog).sort());
  assert.equal(browserCatalog.heroHash(rawHeroes[0]), catalog.heroHash(rawHeroes[0]));
});

test('the canonical JSON keeps available cards and original collection numbering', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../heroes.json'), 'utf8'));
  const heroes = catalog.normalizeHeroes(raw);
  assert.equal(heroes.length, 125);
  assert.equal(heroes.find(hero => hero.key === '151_孙权').no, 127);
  assert.equal(heroes.find(hero => hero.key === '172_蚩奼').edition, 'No. 128 / 130');
  assert.equal(heroes.some(hero => hero.name.includes('元流之子')), false);
});
