import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDirectory);
const manifestPath = join(root, 'resources', 'whisper-models.manifest.json');
const modelRoot = join(root, 'resources', 'models');

if (!existsSync(manifestPath)) {
  console.error(`Missing model manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];

console.log('Voxmire app model bundle policy');
for (const model of manifest.models) {
  const localPath = join(modelRoot, model.fileName);
  if (model.bundled) {
    const available = existsSync(localPath);
    console.log(`${available ? 'OK  ' : 'MISS'} bundled   ${model.modelId.padEnd(16)} ${localPath}`);
    if (!available) {
      failures.push(`Bundled model missing: ${model.fileName}`);
    }
    continue;
  }

  const downloadable = Boolean(model.url);
  console.log(`${downloadable ? 'OK  ' : 'MISS'} download  ${model.modelId.padEnd(16)} ${model.url ?? 'missing URL'}`);
  if (!downloadable) {
    failures.push(`Download URL missing: ${model.modelId}`);
  }
}

if (failures.length > 0) {
  console.error(`\nModel bundle policy failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('\nBundle policy passed: starter model is local; larger models are downloadable.');