import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDirectory);
const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const exe = process.platform === 'win32' ? '.exe' : '';
const engineRoot = join(root, 'resources', 'engines', platform);
const whisperCppRuntimeVersion = 'v1.8.4';
const whisperCppRuntimeDirectoryPrefix = 'whispercpp-';

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
  const runtimeRoot = join(engineRoot, runtimeId);
  const flatExe = join(runtimeRoot, `whisper-cli${exe}`);
  const legacyExe = join(engineRoot, definition.legacyExe);
  const directory = resolveRuntimeDirectory(runtimeRoot, flatExe, legacyExe);
  return definition.files.map((fileName, index) => {
    const path = index === 0 && directory === engineRoot ? legacyExe : join(directory, fileName);
    return [level, `${runtimeId} ${fileName}`, path];
  });
}

function resolveRuntimeDirectory(runtimeRoot, flatExe, legacyExe) {
  const versionedDirectory = installedRuntimeDirectories(runtimeRoot)
    .find((directory) => existsSync(join(directory, `whisper-cli${exe}`)));
  if (versionedDirectory) {
    return versionedDirectory;
  }

  if (existsSync(flatExe)) {
    return runtimeRoot;
  }

  if (existsSync(legacyExe)) {
    return engineRoot;
  }

  return join(runtimeRoot, `${whisperCppRuntimeDirectoryPrefix}${whisperCppRuntimeVersion}`);
}

function installedRuntimeDirectories(runtimeRoot) {
  try {
    return readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(whisperCppRuntimeDirectoryPrefix))
      .map((entry) => entry.name)
      .sort(compareRuntimeDirectoryNamesDescending)
      .map((name) => join(runtimeRoot, name));
  } catch {
    return [];
  }
}

function compareRuntimeDirectoryNamesDescending(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return right.localeCompare(left);
}

function versionParts(directoryName) {
  return directoryName
    .replace(whisperCppRuntimeDirectoryPrefix, '')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}
