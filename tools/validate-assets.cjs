'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../viewer/catalog.js');
const root = path.join(__dirname, '..');

function validateImage(relativePath) {
  const filename = path.join(root, relativePath);
  assert.ok(fs.statSync(filename).isFile(), 'Missing image file: ' + relativePath);
  const descriptor = fs.openSync(filename, 'r');
  const header = Buffer.alloc(12);
  let bytes;
  try { bytes = fs.readSync(descriptor, header, 0, header.length, 0); }
  finally { fs.closeSync(descriptor); }
  assert.equal(bytes, 12, 'Empty or truncated image: ' + relativePath);
  const extension = path.extname(filename);
  if (extension === '.webp') {
    assert.equal(header.toString('ascii', 0, 4), 'RIFF', 'Invalid WebP image: ' + relativePath);
    assert.equal(header.toString('ascii', 8, 12), 'WEBP', 'Invalid WebP image: ' + relativePath);
  } else if (extension === '.png') {
    assert.ok(header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid PNG image: ' + relativePath);
  } else if (extension === '.jpg') {
    assert.ok(header[0] === 255 && header[1] === 216 && header[2] === 255, 'Invalid JPEG image: ' + relativePath);
  }
}

function validateInventory(directory, expected, directories = false) {
  const actual = fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter(entry => directories ? entry.isDirectory() : entry.isFile())
    .map(entry => entry.name).sort();
  assert.deepEqual(actual, [...expected].sort(), 'Catalog/inventory mismatch in ' + directory);
}

function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1].split(/[?#]/)[0]);
}

function validateEntry(filename, allowRedirect) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8');
  assert.ok(!/\b(?:const|let|var)\s+heroes\s*=\s*\[/.test(html) && !/["']key["']\s*:\s*["']\d+_/.test(html),
    filename + ' contains a duplicate inline hero catalog');
  const sources = scriptSources(html);
  const redirect = allowRedirect && /index\.html/.test(html) && /location\.(?:replace|assign|href)/.test(html);
  if (redirect) {
    assert.ok(/location\.search/.test(html) && /location\.hash/.test(html), filename + ' must preserve query and hash');
    return;
  }
  for (const source of ['viewer/catalog.js', 'viewer/renderer.js', 'viewer/app.js']) {
    assert.ok(sources.includes(source), filename + ' must load ' + source);
    assert.ok(fs.statSync(path.join(root, source)).isFile(), 'Missing script: ' + source);
  }
}

try {
  const heroes = catalog.normalizeHeroes(JSON.parse(fs.readFileSync(path.join(root, 'heroes.json'), 'utf8')));
  assert.equal(heroes.length, 125, 'Expected the 125 available cards');
  const excludedNumbers = new Set([120, 121, 126, 129, 130]);
  const numbers = new Set(heroes.map(hero => hero.no));
  for (let no = 1; no <= 130; no++) {
    assert.equal(numbers.has(no), !excludedNumbers.has(no), 'Unexpected original series number: ' + no);
  }
  assert.ok(!heroes.some(hero => hero.name.includes('元流之子') || hero.key.includes('元流之子')),
    'Unavailable variants must not be exposed in the runtime catalog');
  const paths = new Set(['shared/background.webp', 'shared/back.webp']);
  for (const hero of heroes) {
    assert.equal(hero.edition, 'No. ' + String(hero.no).padStart(3, '0') + ' / 130', 'Changed edition: ' + hero.key);
    for (const file of Object.values(catalog.assetsFor(hero))) paths.add(file);
    paths.add(catalog.thumbnailFor(hero));
    paths.add('assets/splash/' + hero.key + '.jpg');
    paths.add('assets/cutout/' + hero.key + '.png');
    validateInventory('layers/' + hero.key, ['character.webp', 'ui.webp', 'structure.webp']);
  }
  validateInventory('layers', heroes.map(hero => hero.key), true);
  validateInventory('viewer/thumb', heroes.map(hero => hero.key + '.webp'));
  validateInventory('assets/splash', heroes.map(hero => hero.key + '.jpg'));
  validateInventory('assets/cutout', heroes.map(hero => hero.key + '.png'));
  validateInventory('shared', ['background.webp', 'back.webp']);
  paths.forEach(validateImage);
  validateEntry('index.html', false);
  validateEntry('all.html', true);
  console.log('Validated ' + heroes.length + ' cards, ' + paths.size + ' images and both static entry points.');
} catch (error) {
  console.error('Asset validation failed: ' + error.message);
  process.exitCode = 1;
}
