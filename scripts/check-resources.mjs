import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDirectory);
const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const exe = process.platform === 'win32' ? '.exe' : '';
const engineRoot = join(root, 'resources', 'engines', platform);

const runtimeDefinitions = {
  'cuda-12.4': {
    legacyExe: `whisper-cuda${exe}`,
    files: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-cuda.dll', 'cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll']
  },
  vulkan: {
    legacyExe: `whisper-vulkan${exe}`,
    files: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-vulkan.dll']
  },
  'cpu-blas': {
    legacyExe: `whisper-cpu-blas${exe}`,
    files: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-blas.dll', 'libopenblas.dll']
  },
  cpu: {
    legacyExe: `whisper-cpu${exe}`,
    files: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll']
  }
};

const resources = [
  ['required', 'ffmpeg', join(root, 'resources', 'ffmpeg', `ffmpeg${exe}`)],
  ['required', 'ffprobe', join(root, 'resources', 'ffmpeg', `ffprobe${exe}`)],
  ['required', 'large-v3-turbo model', join(root, 'resources', 'models', 'ggml-large-v3-turbo.bin')],
  ...runtimeResources('cpu', 'required'),
  ...runtimeResources('cpu-blas', 'optional'),
  ...runtimeResources('vulkan', 'optional'),
  ...runtimeResources('cuda-12.4', 'optional'),
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

  console.log(`${available ? 'OK  ' : 'MISS'} ${level.padEnd(8)} ${label.padEnd(30)} ${path}`);
}

if (missingRequired > 0) {
  console.log(`\nMissing ${missingRequired} required resource(s). See docs/RESOURCES.md.`);
  process.exitCode = 1;
} else {
  console.log('\nAll required resources are present.');
}

function runtimeResources(runtimeId, level) {
  const definition = runtimeDefinitions[runtimeId];
  const isolatedExe = join(engineRoot, runtimeId, `whisper-cli${exe}`);
  const legacyExe = join(engineRoot, definition.legacyExe);
  const directory = existsSync(isolatedExe) ? join(engineRoot, runtimeId) : existsSync(legacyExe) ? engineRoot : join(engineRoot, runtimeId);
  return definition.files.map((fileName, index) => {
    const path = index === 0 && directory === engineRoot ? legacyExe : join(directory, fileName);
    return [level, `${runtimeId} ${fileName}`, path];
  });
}