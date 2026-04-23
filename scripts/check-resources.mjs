import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDirectory);
const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const exe = process.platform === 'win32' ? '.exe' : '';

const resources = [
  ['required', 'ffmpeg', join(root, 'resources', 'ffmpeg', `ffmpeg${exe}`)],
  ['required', 'ffprobe', join(root, 'resources', 'ffmpeg', `ffprobe${exe}`)],
  ['required', 'whisper CPU', join(root, 'resources', 'engines', platform, `whisper-cpu${exe}`)],
  ['required', 'large-v3-turbo model', join(root, 'resources', 'models', 'ggml-large-v3-turbo.bin')],
  ['optional', 'whisper CUDA', join(root, 'resources', 'engines', platform, `whisper-cuda${exe}`)],
  ['optional', 'whisper Vulkan', join(root, 'resources', 'engines', platform, `whisper-vulkan${exe}`)],
  ['optional', 'large-v3 model', join(root, 'resources', 'models', 'ggml-large-v3.bin')],
  ['optional', 'distil-large-v3.5 model', join(root, 'resources', 'models', 'ggml-distil-large-v3.5.bin')],
  ['optional', 'medium model', join(root, 'resources', 'models', 'ggml-medium.bin')]
];

let missingRequired = 0;
console.log('Voxmire resource status\n');

for (const [level, label, path] of resources) {
  const available = existsSync(path);
  if (!available && level === 'required') {
    missingRequired += 1;
  }

  console.log(`${available ? 'OK  ' : 'MISS'} ${level.padEnd(8)} ${label.padEnd(22)} ${path}`);
}

if (missingRequired > 0) {
  console.log(`\nMissing ${missingRequired} required resource(s). See docs/RESOURCES.md.`);
  process.exitCode = 1;
} else {
  console.log('\nAll required resources are present.');
}
