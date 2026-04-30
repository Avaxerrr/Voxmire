#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = dirname(scriptDirectory);
const bundledRuntimeIds = ['vulkan', 'cpu-blas', 'cpu'];
const downloadedRuntimeIds = ['cuda-12.4'];
const manifest = JSON.parse(readFileSync(join(rootDirectory, 'resources', 'whisper-runtimes.manifest.json'), 'utf8'));
const stable = manifest.channels?.stable?.win32 ?? {};
let failed = false;

console.log('Voxmire app runtime bundle policy');

for (const runtimeId of bundledRuntimeIds) {
  const version = stable[runtimeId];
  const directory = version ? join(rootDirectory, 'resources', 'engines', 'win32', runtimeId, `whispercpp-${version}`) : null;
  const available = Boolean(directory && existsSync(join(directory, 'whisper-cli.exe')));
  console.log(`${available ? 'OK  ' : 'MISS'} bundled   ${runtimeId.padEnd(10)} ${directory ?? 'no stable version'}`);
  if (!available) {
    failed = true;
  }
}

for (const runtimeId of downloadedRuntimeIds) {
  const version = stable[runtimeId];
  const runtimePackage = manifest.packages.find((item) => item.platform === 'win32' && item.runtimeId === runtimeId && item.whisperCppVersion === version);
  const downloadable = Boolean(runtimePackage?.url);
  console.log(`${downloadable ? 'OK  ' : 'MISS'} download  ${runtimeId.padEnd(10)} ${runtimePackage?.url ?? 'no package URL'}`);
  if (!downloadable) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('\nBundle policy passed: Vulkan, BLAS CPU, and CPU are local; CUDA is downloadable.');
}
