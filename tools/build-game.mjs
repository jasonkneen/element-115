#!/usr/bin/env bun
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceName = 'flight-sim3.html';
const sourcePath = path.join(root, sourceName);
const distDir = path.join(root, 'dist');
const outGamePath = path.join(distDir, 'game.html');
const outIndexPath = path.join(distDir, 'index.html');
const outManifestPath = path.join(distDir, 'build-manifest.json');
const outReadmePath = path.join(distDir, 'README.txt');
const args = new Set(process.argv.slice(2));
const clean = !args.has('--no-clean');
const chunkSize = 24_000;

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
  const literalAssetRe = /["'`]((?:\.\/)?(?:audio|models)\/[^"'`]+?\.(?:glb|gltf|bin|png|jpg|jpeg|webp|mp3|wav|ogg))(?:[?#][^"'`]*)?["'`]/gi;
  let match;
  while ((match = literalAssetRe.exec(html))) {
    const rel = match[1].replace(/^\.\//, '');
    if (!rel.includes('${')) assets.add(rel);
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
<meta name="x-build-format" content="encoded-document-bootstrap">
<meta name="x-source-sha256" content="${sourceHash}">
<title>Canyon Flight Sim</title>
<!-- Keep the decoded document script ahead of any visible body chrome. During
     parser-time document.write(), earlier body nodes can survive and look
     like a stuck loading screen after the real game boots. -->
<script>(()=>{"use strict";const p=[
${chunkList}
];const b=atob(p.join(""));const n=b.length;const u=new Uint8Array(n);for(let i=0;i<n;i++)u[i]=b.charCodeAt(i);const h=new TextDecoder().decode(u);document.open();document.write(h);document.close();})();</script>
</head>
<body></body>
</html>
`;
}

async function main() {
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
    format: 'encoded-document-bootstrap',
    generatedAt: new Date().toISOString(),
    sourceBytes: sourceBuffer.length,
    sourceSha256: sourceHash,
    outputs: [gameInfo, indexInfo],
    assets: copiedAssets,
    assetBytes: totalAssetBytes,
    note: 'This hides readable source from casual view by shipping an encoded document bootstrap. Browser-delivered JavaScript cannot be made secret; do not place credentials or private logic in client code.',
  };
  await writeFile(outManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const readme = `Canyon Flight Sim deploy package

Main file: game.html
Source input: ${sourceName}
Build command: bun run build

Deploy the contents of this dist/ directory to a static host. index.html redirects to game.html and preserves query/hash params.

This package intentionally ships game.html as an encoded document bootstrap so the readable source is not casually visible in View Source. It is obfuscation, not security: any browser-delivered app can still be decoded by a determined user. Keep secrets and private server logic out of client-side files.

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
