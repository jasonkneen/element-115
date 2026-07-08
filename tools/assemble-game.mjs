#!/usr/bin/env bun
/**
 * Assemble flight-sim3.html from modular sources.
 *
 * Source of truth for game logic: src/game/*.js (order in MODULES.txt)
 * Page chrome (HTML/CSS/CDN):     src/shell/head.html + tail.html
 *
 * Modules are concatenated into a single IIFE so they share one scope
 * (matches the original monolith; no bundler, no ES-module rewrite).
 *
 * Usage:
 *   bun tools/assemble-game.mjs
 *   bun tools/assemble-game.mjs --check   # exit 1 if flight-sim3.html is stale
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameDir = path.join(root, 'src', 'game');
const shellDir = path.join(root, 'src', 'shell');
const outPath = path.join(root, 'flight-sim3.html');
const checkOnly = process.argv.includes('--check');

async function loadModuleOrder() {
  const listPath = path.join(gameDir, 'MODULES.txt');
  const text = await readFile(listPath, 'utf8');
  const names = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!names.length) throw new Error('src/game/MODULES.txt is empty');
  for (const name of names) {
    if (!name.endsWith('.js')) throw new Error(`Invalid module entry: ${name}`);
  }
  // Fail if a .js file exists but is missing from the manifest
  const onDisk = (await readdir(gameDir)).filter((f) => f.endsWith('.js')).sort();
  const missing = onDisk.filter((f) => !names.includes(f));
  if (missing.length) {
    throw new Error(
      `src/game has JS files not listed in MODULES.txt: ${missing.join(', ')}\n` +
      `Add them to MODULES.txt in the correct load order.`,
    );
  }
  const extra = names.filter((n) => !onDisk.includes(n));
  if (extra.length) {
    throw new Error(`MODULES.txt lists missing files: ${extra.join(', ')}`);
  }
  return names;
}

async function assemble() {
  const [head, tail, order] = await Promise.all([
    readFile(path.join(shellDir, 'head.html'), 'utf8'),
    readFile(path.join(shellDir, 'tail.html'), 'utf8'),
    loadModuleOrder(),
  ]);

  const parts = [head];
  for (const name of order) {
    const body = await readFile(path.join(gameDir, name), 'utf8');
    if (!body.endsWith('\n')) {
      parts.push(body, '\n');
    } else {
      parts.push(body);
    }
  }
  parts.push(tail);
  return parts.join('');
}

async function main() {
  const html = await assemble();
  if (checkOnly) {
    let existing = '';
    try {
      existing = await readFile(outPath, 'utf8');
    } catch {
      console.error(`Missing ${path.relative(root, outPath)} — run: bun tools/assemble-game.mjs`);
      process.exit(1);
    }
    if (existing === html) {
      console.log('flight-sim3.html is up to date with src/');
      return;
    }
    console.error('flight-sim3.html is STALE vs src/. Run: bun tools/assemble-game.mjs');
    process.exit(1);
  }

  await writeFile(outPath, html, 'utf8');
  const order = await loadModuleOrder();
  console.log(`Assembled ${path.relative(root, outPath)}`);
  console.log(`  modules: ${order.length} (${order.join(', ')})`);
  console.log(`  bytes:   ${html.length}`);
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
