#!/usr/bin/env bun
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_FILES = [
  'build/three.min.js',
  'examples/js/loaders/GLTFLoader.js',
  'examples/js/postprocessing/EffectComposer.js',
  'examples/js/postprocessing/RenderPass.js',
  'examples/js/postprocessing/ShaderPass.js',
  'examples/js/postprocessing/MaskPass.js',
  'examples/js/shaders/CopyShader.js',
  'examples/js/shaders/FXAAShader.js',
  'examples/js/shaders/LuminosityHighPassShader.js',
  'examples/js/shaders/BokehShader.js',
  'examples/js/postprocessing/BokehPass.js',
  'examples/js/postprocessing/UnrealBloomPass.js',
];

export const THREE_RUNTIME_DIR = 'vendor/three/r128';

export async function syncThreeRuntime(projectRoot = toolRoot) {
  const packageRoot = path.join(projectRoot, 'node_modules', 'three');
  const destinationRoot = path.join(projectRoot, THREE_RUNTIME_DIR);

  try {
    await stat(packageRoot);
  } catch {
    throw new Error('three@0.128.0 is required to prepare the local runtime. Run bun install first.');
  }

  for (const rel of RUNTIME_FILES) {
    const source = path.join(packageRoot, rel);
    const destination = path.join(destinationRoot, rel);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }

  return { destinationRoot, files: RUNTIME_FILES.map((rel) => `${THREE_RUNTIME_DIR}/${rel}`) };
}

if (import.meta.main) {
  const result = await syncThreeRuntime();
  console.log(`Prepared ${result.files.length} local Three.js runtime files in ${result.destinationRoot}`);
}
