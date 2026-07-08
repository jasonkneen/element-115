#!/usr/bin/env bun
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceName = 'flight-sim3.html';
const sourcePath = path.join(root, sourceName);

// Rebuild flight-sim3.html from src/game modules before packaging.
function assembleGameSource() {
  const assemblePath = path.join(root, 'tools', 'assemble-game.mjs');
  const result = spawnSync(process.execPath, [assemblePath], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `assemble-game failed (exit ${result.status}):\n${result.stdout || ''}${result.stderr || ''}`,
    );
  }
  if (result.stdout) process.stdout.write(result.stdout);
}
const distDir = path.join(root, 'dist');
const outGamePath = path.join(distDir, 'game.html');
const outIndexPath = path.join(distDir, 'index.html');
const outManifestPath = path.join(distDir, 'build-manifest.json');
const outReadmePath = path.join(distDir, 'README.txt');
const args = new Set(process.argv.slice(2));
const clean = !args.has('--no-clean');
const chunkSize = 24_000;
const deploySupportFiles = ['plane-tweaks.json', 'latest-features.json'];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function chunkString(value, size) {
  const chunks = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks;
}

function jsString(value) {
  return JSON.stringify(value);
}

async function fileInfo(absPath, relPath) {
  const buf = await readFile(absPath);
  return { path: relPath, bytes: buf.length, sha256: sha256(buf) };
}

function collectReferencedAssets(html) {
  const assets = new Set();
  const literalAssetRe = /["'`]((?:\.\/)?(?:(?:audio|models)\/[^"'`]+?|[\w .-]+?)\.(?:glb|gltf|bin|png|jpg|jpeg|webp|mp3|wav|ogg))(?:[?#][^"'`]*)?["'`]/gi;
  let match;
  while ((match = literalAssetRe.exec(html))) {
    const rel = match[1].replace(/^\.\//, '');
    if (!rel.includes('${') && !/^https?:\/\//i.test(rel) && !rel.startsWith('data:')) assets.add(rel);
  }

  // The stunt plane texture is template-built in flight-sim3.html:
  // `models/Polygon_Plane_Texture_0${safeVariant}.png`.
  if (html.includes('Polygon_Plane_Texture_0${safeVariant}.png')) {
    for (let i = 1; i <= 4; i++) assets.add(`models/Polygon_Plane_Texture_0${i}.png`);
  }

  return [...assets].sort((a, b) => a.localeCompare(b));
}

function buildEncodedDocument(html, sourceHash) {
  const payload = Buffer.from(html, 'utf8').toString('base64');
  const chunks = chunkString(payload, chunkSize);
  const chunkList = chunks.map(jsString).join(',\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<meta name="x-build-format" content="encoded-dom-bootstrap">
<meta name="x-source-sha256" content="${sourceHash}">
<title>Canyon Flight Sim</title>
</head>
<body>
<script>(()=>{"use strict";const p=[
${chunkList}
];function decode(){const b=atob(p.join(""));const n=b.length;const u=new Uint8Array(n);for(let i=0;i<n;i++)u[i]=b.charCodeAt(i);return new TextDecoder().decode(u)}function ensureBody(){if(document.body)return document.body;const b=document.createElement("body");document.documentElement.appendChild(b);return b}function copyAttrs(from,to){for(const attr of from.attributes)to.setAttribute(attr.name,attr.value)}function loadScript(spec){return new Promise((resolve,reject)=>{const s=document.createElement("script");for(const [k,v]of spec.attrs)s.setAttribute(k,v);s.async=false;if(spec.src){s.onload=resolve;s.onerror=()=>reject(new Error("Failed to load "+spec.src));s.src=spec.src;document.head.appendChild(s)}else{s.textContent=spec.text;ensureBody().appendChild(s);resolve()}})}(async()=>{ensureBody();const parsed=new DOMParser().parseFromString(decode(),"text/html");const scriptSpecs=[...parsed.scripts].map(s=>({src:s.src||s.getAttribute("src")||"",text:s.textContent||"",attrs:[...s.attributes].filter(a=>a.name!=="src").map(a=>[a.name,a.value])}));for(const s of [...parsed.scripts])s.remove();copyAttrs(parsed.documentElement,document.documentElement);document.head.replaceChildren(...parsed.head.childNodes);ensureBody().replaceChildren(...parsed.body.childNodes);for(const spec of scriptSpecs)await loadScript(spec)})().catch(err=>{console.error("[bootstrap]",err);ensureBody().innerHTML='<pre style="white-space:pre-wrap;color:#fca;background:#120b0b;padding:16px">Game failed to boot: '+String(err&&err.message||err).replace(/[<&]/g,c=>c==="<"?"&lt;":"&amp;")+"</pre>"})})();</script>
</body>
</html>
`;
}

async function main() {
  assembleGameSource();
  const source = await readFile(sourcePath, 'utf8');
  const sourceBuffer = Buffer.from(source, 'utf8');
  const sourceHash = sha256(sourceBuffer);
  const assets = collectReferencedAssets(source);

  if (clean) await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const copiedAssets = [];
  for (const rel of assets) {
    const src = path.join(root, rel);
    const dest = path.join(distDir, rel);
    try {
      await stat(src);
    } catch {
      throw new Error(`Build asset is referenced but missing: ${rel}`);
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { force: true, recursive: false });
    copiedAssets.push(await fileInfo(dest, rel));
  }

  for (const rel of deploySupportFiles) {
    const src = path.join(root, rel);
    const dest = path.join(distDir, rel);
    try {
      await stat(src);
    } catch {
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { force: true, recursive: false });
    copiedAssets.push(await fileInfo(dest, rel));
  }

  const outGame = buildEncodedDocument(source, sourceHash);
  await writeFile(outGamePath, outGame, 'utf8');

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Canyon Flight Sim</title>
<meta http-equiv="refresh" content="0; url=game.html">
<link rel="canonical" href="game.html">
<script>location.replace('game.html' + (location.search || '') + (location.hash || ''));</script>
</head>
<body><p>Loading <a href="game.html">game.html</a>...</p></body>
</html>
`;
  await writeFile(outIndexPath, indexHtml, 'utf8');

  const gameInfo = await fileInfo(outGamePath, 'game.html');
  const indexInfo = await fileInfo(outIndexPath, 'index.html');
  const totalAssetBytes = copiedAssets.reduce((sum, item) => sum + item.bytes, 0);
  const manifest = {
    name: 'ships-flight-sim',
    entry: 'game.html',
    source: sourceName,
    format: 'encoded-dom-bootstrap',
    generatedAt: new Date().toISOString(),
    sourceBytes: sourceBuffer.length,
    sourceSha256: sourceHash,
    outputs: [gameInfo, indexInfo],
    assets: copiedAssets,
    assetBytes: totalAssetBytes,
    note: 'This hides readable source from casual view by shipping an encoded DOM bootstrap. Browser-delivered JavaScript cannot be made secret; do not place credentials or private logic in client code.',
  };
  await writeFile(outManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const readme = `Canyon Flight Sim deploy package

Main file: game.html
Source input: ${sourceName}
Build command: bun run build

Deploy the contents of this dist/ directory to a static host. index.html redirects to game.html and preserves query/hash params.

This package intentionally ships game.html as an encoded DOM bootstrap so the readable source is not casually visible in View Source. It is obfuscation, not security: any browser-delivered app can still be decoded by a determined user. Keep secrets and private server logic out of client-side files.

Generated: ${manifest.generatedAt}
Source SHA-256: ${sourceHash}
Assets copied: ${copiedAssets.length}
Asset bytes: ${totalAssetBytes}
`;
  await writeFile(outReadmePath, readme, 'utf8');

  console.log(`Built ${path.relative(root, outGamePath)} from ${sourceName}`);
  console.log(`Copied ${copiedAssets.length} assets (${(totalAssetBytes / 1024 / 1024).toFixed(2)} MiB)`);
  console.log(`Source SHA-256 ${sourceHash}`);
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
