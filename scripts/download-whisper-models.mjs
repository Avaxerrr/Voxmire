import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDirectory);
const manifestPath = join(root, 'resources', 'whisper-models.manifest.json');
const modelRoot = join(root, 'resources', 'models');
const all = process.argv.includes('--all');
const force = process.argv.includes('--force');
const chunkBytes = 8 * 1024 * 1024;

if (!existsSync(manifestPath)) {
  console.error(`Missing model manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const selectedModels = manifest.models.filter((model) => all || model.bundled);

for (const model of selectedModels) {
  const targetPath = join(modelRoot, model.fileName);
  if (existsSync(targetPath) && !force) {
    verifyFileHash(targetPath, model.sha256, model.label);
    console.log(`OK   ${model.modelId} ${targetPath}`);
    continue;
  }

  const url = model.url ?? `${manifest.provider.publicBaseUrl.replace(/\/+$/, '')}/${model.fileName}`;
  const tempPath = `${targetPath}.download`;
  mkdirSync(modelRoot, { recursive: true });
  rmSync(tempPath, { force: true });

  console.log(`GET  ${model.modelId} ${url}`);
  await download(url, model.fileName, tempPath);
  verifyFileHash(tempPath, model.sha256, model.label);
  renameSync(tempPath, targetPath);
  console.log(`OK   ${model.modelId} ${targetPath}`);
}

async function download(url, label, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${label}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function verifyFileHash(filePath, expectedSha256, label) {
  const actualSha256 = hashFile(filePath);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`${label} checksum mismatch. Expected ${expectedSha256}, got ${actualSha256}.`);
  }
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(chunkBytes);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}