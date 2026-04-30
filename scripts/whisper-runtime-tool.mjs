#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { copyFile, readdir, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = dirname(scriptDirectory);
const defaultManifestPath = join(rootDirectory, 'resources', 'whisper-runtimes.manifest.json');
const defaultWorkDirectory = join(rootDirectory, '.voxmire-runtimes');
const defaultSourceDirectory = join(rootDirectory, 'whisper-binaries');
const defaultPackageDirectory = join(defaultWorkDirectory, 'packages');
const defaultPartDirectory = join(defaultWorkDirectory, 'parts');
const defaultStagingDirectory = join(defaultWorkDirectory, 'staging');
const defaultExtractDirectory = join(defaultWorkDirectory, 'extracted');
const defaultGitHubAssetDirectory = join(defaultWorkDirectory, 'github-assets');
const whisperCppRuntimeDirectoryPrefix = 'whispercpp-';
const defaultPlatform = 'win32';
const defaultArch = 'x64';
const wranglerRemoteUploadLimitBytes = 300 * 1024 * 1024;
const packagePartSizeBytes = 250 * 1024 * 1024;
const defaultR2Bucket = process.env.VOXMIRE_R2_BUCKET ?? 'voxmire-runtimes';
const defaultGitHubRepository = process.env.VOXMIRE_GITHUB_REPO ?? gitHubRepositoryFromRemote() ?? 'Avaxerrr/Voxmire';

const runtimeDefinitions = {
  'cuda-12.4': {
    backend: 'cuda',
    label: 'whisper.cpp CUDA 12.4',
    upstreamAsset: 'whisper-cublas-12.4.0-bin-x64.zip',
    defaultSourceName: 'whisper-cublas-12.4.0-bin-x64',
    sourceOption: 'cuda-source',
    requiredFiles: [
      'whisper-cli.exe',
      'whisper.dll',
      'ggml.dll',
      'ggml-base.dll',
      'ggml-cpu.dll',
      'ggml-cuda.dll',
      'cublas64_12.dll',
      'cublasLt64_12.dll',
      'cudart64_12.dll'
    ]
  },
  vulkan: {
    backend: 'vulkan',
    label: 'whisper.cpp Vulkan',
    upstreamAsset: null,
    defaultSourceName: 'whisper-vulkan-built-x64',
    sourceOption: 'vulkan-source',
    requiredFiles: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-vulkan.dll']
  },
  'cpu-blas': {
    backend: 'cpu',
    label: 'whisper.cpp BLAS CPU',
    upstreamAsset: 'whisper-blas-bin-x64.zip',
    defaultSourceName: 'whisper-blas-bin-x64',
    sourceOption: 'cpu-blas-source',
    requiredFiles: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-blas.dll', 'libopenblas.dll']
  },
  cpu: {
    backend: 'cpu',
    label: 'whisper.cpp CPU',
    upstreamAsset: 'whisper-bin-x64.zip',
    defaultSourceName: 'whisper-bin-x64',
    sourceOption: 'cpu-source',
    requiredFiles: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll']
  }
};

const runtimeOrder = ['cuda-12.4', 'vulkan', 'cpu-blas', 'cpu'];
const commands = new Set(['menu', 'download', 'prepare', 'promote', 'upload', 'help']);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [command = 'menu', ...argv] = process.argv.slice(2);
  if (!commands.has(command)) {
    throw new Error(`Unknown command "${command}". Run npm run runtimes -- --help for usage.`);
  }

  if (command === 'help' || argv.includes('--help') || argv.includes('-h')) {
    printHelp(command === 'help' ? null : command);
    return;
  }

  const options = parseArgs(argv);
  if (command === 'menu') {
    await menuCommand(options);
    return;
  }

  if (command === 'download') {
    await downloadCommand(options);
    return;
  }

  if (command === 'prepare') {
    await prepareCommand(options);
    return;
  }

  if (command === 'promote') {
    promoteCommand(options);
    return;
  }

  if (command === 'upload') {
    uploadCommand(options);
  }
}

async function menuCommand(options) {
  const rl = createInterface({ input, output });
  try {
    const manifestPath = optionPath(options, 'manifest', defaultManifestPath);
    const manifest = readManifest(manifestPath);
    const defaultVersion = latestManifestVersion(manifest) ?? 'v1.8.4';
    const defaultRepo = options.repo && options.repo !== true
      ? options.repo
      : manifest.provider?.owner && manifest.provider?.repo
        ? `${manifest.provider.owner}/${manifest.provider.repo}`
        : defaultGitHubRepository;
    const repo = await askText(rl, 'GitHub repo', defaultRepo);

    console.log('\nVoxmire runtime manager');
    console.log(`Manifest: ${displayPath(manifestPath)}`);
    console.log(`Repo:     ${repo}`);

    const action = await askChoice(rl, '\nChoose an action', [
      ['1', 'Prepare packages and promote stable'],
      ['2', 'Upload packages to GitHub Release dry run'],
      ['3', 'Upload packages to GitHub Release now'],
      ['4', 'Download upstream CPU/BLAS/CUDA assets'],
      ['5', 'Promote an already prepared version'],
      ['6', 'Show manifest summary'],
      ['7', 'Advanced: upload packages to R2 dry run'],
      ['8', 'Advanced: upload packages to R2 now'],
      ['0', 'Exit']
    ], '1');

    if (action === '0') {
      console.log('No changes made.');
      return;
    }

    if (action === '6') {
      printManifestSummary(manifest);
      return;
    }

    const version = normalizeVersion(await askText(rl, 'whisper.cpp version', defaultVersion));
    const include = await askRuntimeSet(rl, action === '4' ? 'upstream' : 'all');

    if (action === '1') {
      const promote = await askYesNo(rl, 'Set this version as stable in the manifest?', true);
      const force = await askYesNo(rl, 'Rebuild existing local packages if they already exist?', true);
      await prepareCommand({
        ...options,
        version,
        include,
        promote,
        force
      });
      return;
    }

    if (action === '2' || action === '3') {
      const releaseTag = await askText(rl, 'GitHub release tag', githubReleaseTag(version));
      uploadCommand({
        ...options,
        target: 'github-release',
        version,
        include,
        repo,
        'release-tag': releaseTag,
        execute: action === '3'
      });
      return;
    }

    if (action === '4') {
      await downloadCommand({
        ...options,
        version,
        include
      });
      return;
    }

    if (action === '5') {
      promoteCommand({
        ...options,
        version,
        include
      });
      return;
    }

    if (action === '7' || action === '8') {
      const bucket = await askText(rl, 'R2 bucket', options.bucket && options.bucket !== true ? options.bucket : manifest.provider?.bucket ?? defaultR2Bucket);
      uploadCommand({
        ...options,
        target: 'r2',
        version,
        include,
        bucket,
        execute: action === '8'
      });
    }
  } finally {
    rl.close();
  }
}
async function downloadCommand(options) {
  const requestedVersion = requiredOption(options, 'version');
  const include = includedRuntimeIds(options, { skipVulkanByDefault: true });
  const sourceDirectory = optionPath(options, 'source-dir', defaultSourceDirectory);
  mkdirSync(sourceDirectory, { recursive: true });

  const release = await githubRelease(requestedVersion);
  const version = release.tag_name;
  console.log(`Downloading whisper.cpp ${version} release assets to ${displayPath(sourceDirectory)}`);

  for (const runtimeId of include) {
    const definition = runtimeDefinitions[runtimeId];
    if (!definition.upstreamAsset) {
      console.log(`SKIP ${runtimeId}: upstream does not publish this runtime asset. Build it and pass --${definition.sourceOption}.`);
      continue;
    }

    const asset = release.assets.find((item) => item.name === definition.upstreamAsset);
    if (!asset) {
      throw new Error(`Release ${version} does not include ${definition.upstreamAsset}. Check upstream asset names before continuing.`);
    }

    const zipPath = join(sourceDirectory, definition.upstreamAsset);
    await downloadFile(asset.browser_download_url, zipPath);
    const extractPath = join(sourceDirectory, definition.defaultSourceName);
    await extractArchive(zipPath, extractPath, { clean: true });
    console.log(`OK   ${runtimeId.padEnd(10)} ${displayPath(extractPath)}`);
  }
}

async function prepareCommand(options) {
  const version = normalizeVersion(requiredOption(options, 'version'));
  const platform = options.platform ?? defaultPlatform;
  const arch = options.arch ?? defaultArch;
  const include = includedRuntimeIds(options);
  const sourceDirectory = optionPath(options, 'source-dir', defaultSourceDirectory);
  const stagingDirectory = optionPath(options, 'staging-dir', defaultStagingDirectory);
  const packageDirectory = optionPath(options, 'package-dir', defaultPackageDirectory);
  const partDirectory = optionPath(options, 'part-dir', defaultPartDirectory);
  const manifestPath = optionPath(options, 'manifest', defaultManifestPath);
  const publicBaseUrl = trimTrailingSlash(options['base-url'] ?? '');
  const splitLargePackages = booleanOption(options, 'split-large-packages') || options.target === 'r2';
  const promote = booleanOption(options, 'promote');
  const force = booleanOption(options, 'force');
  const manifest = readManifest(manifestPath);
  const preparedPackages = [];

  for (const runtimeId of include) {
    const definition = runtimeDefinitions[runtimeId];
    const source = await resolveRuntimeSource(definition, options, sourceDirectory, runtimeId);
    const runtimeDirectoryName = `${whisperCppRuntimeDirectoryPrefix}${version}`;
    const stagedRuntimeDirectory = join(stagingDirectory, platform, runtimeId, runtimeDirectoryName);
    ensureSafeManagedPath(stagedRuntimeDirectory, stagingDirectory);
    if (existsSync(stagedRuntimeDirectory)) {
      if (!force) {
        throw new Error(`${displayPath(stagedRuntimeDirectory)} already exists. Re-run with --force to rebuild it.`);
      }
      rmSync(stagedRuntimeDirectory, { recursive: true, force: true });
    }

    mkdirSync(stagedRuntimeDirectory, { recursive: true });
    const missing = [];
    for (const fileName of definition.requiredFiles) {
      const sourceFile = join(source, fileName);
      if (!existsSync(sourceFile)) {
        missing.push(fileName);
        continue;
      }
      await copyFile(sourceFile, join(stagedRuntimeDirectory, fileName));
    }

    if (missing.length > 0) {
      throw new Error(`${runtimeId} source is missing required files: ${missing.join(', ')}. Source: ${displayPath(source)}`);
    }

    const objectKey = objectKeyFor({ version, platform, runtimeId, runtimeDirectoryName });
    const packagePath = join(packageDirectory, ...objectKey.split('/'));
    mkdirSync(dirname(packagePath), { recursive: true });
    if (existsSync(packagePath)) {
      if (!force) {
        throw new Error(`${displayPath(packagePath)} already exists. Re-run with --force to rebuild it.`);
      }
      rmSync(packagePath, { force: true });
    }

    await createZipFromDirectory(stagedRuntimeDirectory, packagePath);
    const sizeBytes = statSync(packagePath).size;
    const sha256 = hashFile(packagePath);
    const parts = splitLargePackages ? splitPackageIfNeeded(packagePath, objectKey, partDirectory) : [];
    const packageRecord = {
      runtimeId,
      backend: definition.backend,
      label: definition.label,
      platform,
      arch,
      whisperCppVersion: version,
      runtimeDirectoryName,
      objectKey,
      url: publicBaseUrl ? `${publicBaseUrl}/${objectKey}` : null,
      packagePath: toPosixPath(relative(rootDirectory, packagePath)),
      sizeBytes,
      sha256,
      parts,
      requiredFiles: definition.requiredFiles,
      preparedAt: new Date().toISOString()
    };

    upsertPackage(manifest, packageRecord);
    if (promote) {
      setActiveVersion(manifest, 'stable', platform, runtimeId, version);
    }

    preparedPackages.push(packageRecord);
    console.log(`OK   ${runtimeId.padEnd(10)} ${formatBytes(sizeBytes).padStart(9)} sha256:${sha256.slice(0, 12)} ${displayPath(packagePath)}`);
  }

  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifestPath, manifest);
  console.log(`\nUpdated ${displayPath(manifestPath)}`);
  printUploadHint(preparedPackages);
}

function promoteCommand(options) {
  const version = normalizeVersion(requiredOption(options, 'version'));
  const platform = options.platform ?? defaultPlatform;
  const include = includedRuntimeIds(options);
  const manifestPath = optionPath(options, 'manifest', defaultManifestPath);
  const manifest = readManifest(manifestPath);

  for (const runtimeId of include) {
    const record = findPackage(manifest, { platform, runtimeId, version });
    if (!record) {
      throw new Error(`Cannot promote ${runtimeId} ${version}; package is not in ${displayPath(manifestPath)}.`);
    }
    setActiveVersion(manifest, 'stable', platform, runtimeId, version);
    console.log(`OK   stable ${platform}/${runtimeId} -> ${version}`);
  }

  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifestPath, manifest);
  console.log(`Updated ${displayPath(manifestPath)}`);
}

function uploadCommand(options) {
  const target = options.target ?? options.provider ?? 'github-release';
  if (target === 'r2') {
    uploadToR2Command(options);
    return;
  }

  if (target !== 'github-release' && target !== 'github') {
    throw new Error(`Unknown upload target "${target}". Use github-release or r2.`);
  }

  uploadToGitHubReleaseCommand(options);
}

function uploadToGitHubReleaseCommand(options) {
  const version = normalizeVersion(requiredOption(options, 'version'));
  const platform = options.platform ?? defaultPlatform;
  const include = includedRuntimeIds(options);
  const manifestPath = optionPath(options, 'manifest', defaultManifestPath);
  const repo = options.repo && options.repo !== true ? options.repo : defaultGitHubRepository;
  const releaseTag = options['release-tag'] && options['release-tag'] !== true ? options['release-tag'] : githubReleaseTag(version);
  const execute = booleanOption(options, 'execute');
  const skipManifest = booleanOption(options, 'skip-manifest');
  const manifest = readManifest(manifestPath);
  const packages = uniquePackages(manifest.packages.filter((record) => {
    return record.platform === platform && include.includes(record.runtimeId) && record.whisperCppVersion === version;
  }));

  if (packages.length === 0) {
    throw new Error(`No matching packages found in ${displayPath(manifestPath)}.`);
  }

  const { owner, name } = parseGitHubRepository(repo);
  const releaseTitle = options['release-title'] && options['release-title'] !== true
    ? options['release-title']
    : `Voxmire whisper.cpp runtimes ${version}`;

  ensureGitHubRelease({ execute, releaseTag, releaseTitle, repo: `${owner}/${name}` });

  for (const record of packages) {
    const filePath = packageFilePath(record);
    if (!existsSync(filePath)) {
      throw new Error(`Missing package file for ${record.runtimeId}: ${displayPath(filePath)}`);
    }
    const assetName = githubAssetName(record);
    const uploadPath = prepareGitHubAssetFile({ assetName, execute, releaseTag, sourcePath: filePath });
    runOrPrintGh(['release', 'upload', releaseTag, uploadPath, '--repo', `${owner}/${name}`, '--clobber'], execute);
    record.assetName = assetName;
    record.url = githubReleaseAssetUrl(owner, name, releaseTag, assetName);
    delete record.parts;
  }

  manifest.provider = {
    type: 'github-release',
    owner,
    repo: name,
    publicBaseUrl: null
  };
  manifest.updatedAt = new Date().toISOString();

  if (!skipManifest) {
    if (execute || booleanOption(options, 'write-manifest')) {
      writeManifest(manifestPath, manifest);
      console.log(`Updated ${displayPath(manifestPath)} with GitHub Release URLs.`);
    } else {
      console.log('\nDry run only. Add --execute to upload and update the manifest, or --write-manifest to preview URL changes locally.');
    }
  }
}

function uploadToR2Command(options) {
  const version = options.version ? normalizeVersion(options.version) : null;
  const platform = options.platform ?? defaultPlatform;
  const include = includedRuntimeIds(options);
  const manifestPath = optionPath(options, 'manifest', defaultManifestPath);
  const bucket = options.bucket && options.bucket !== true ? options.bucket : defaultR2Bucket;
  const manifestKey = options['manifest-key'] ?? 'whisper.cpp/manifest/whisper-runtimes.json';
  const execute = booleanOption(options, 'execute');
  const skipManifest = booleanOption(options, 'skip-manifest');
  const manifest = readManifest(manifestPath);
  const packages = uniquePackages(manifest.packages.filter((record) => {
    return record.platform === platform && include.includes(record.runtimeId) && (!version || record.whisperCppVersion === version);
  }));

  if (packages.length === 0) {
    throw new Error(`No matching packages found in ${displayPath(manifestPath)}.`);
  }

  for (const record of packages) {
    if ((!record.parts || record.parts.length === 0) && record.sizeBytes > wranglerRemoteUploadLimitBytes) {
      throw new Error(`${record.runtimeId} is larger than Wrangler's remote upload limit. Rebuild with --target r2 --split-large-packages or use the GitHub Release upload target.`);
    }
    const uploadItems = packageUploadItems(record);
    for (const item of uploadItems) {
      if (!existsSync(item.filePath)) {
        throw new Error(`Missing package file for ${record.runtimeId}: ${displayPath(item.filePath)}`);
      }
      runOrPrintWranglerPut({ bucket, key: item.objectKey, filePath: item.filePath, execute });
    }
  }

  if (!skipManifest) {
    runOrPrintWranglerPut({ bucket, key: manifestKey, filePath: manifestPath, execute });
  }

  if (!execute) {
    console.log('\nDry run only. Add --execute to upload with Wrangler.');
  }
}

async function resolveRuntimeSource(definition, options, sourceDirectory, runtimeId) {
  const explicit = options[definition.sourceOption];
  const candidate = explicit
    ? resolve(rootDirectory, explicit)
    : join(sourceDirectory, definition.defaultSourceName);

  const archiveCandidate = explicit
    ? candidate
    : definition.upstreamAsset
      ? join(sourceDirectory, definition.upstreamAsset)
      : candidate;

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    return locateRuntimeRoot(candidate, definition.requiredFiles);
  }

  if (existsSync(archiveCandidate) && statSync(archiveCandidate).isFile()) {
    const extractDirectory = join(defaultExtractDirectory, runtimeId);
    await extractArchive(archiveCandidate, extractDirectory, { clean: true });
    return locateRuntimeRoot(extractDirectory, definition.requiredFiles);
  }

  throw new Error(`Missing source for ${runtimeId}. Expected ${displayPath(candidate)}${definition.upstreamAsset ? ` or ${displayPath(archiveCandidate)}` : ''}.`);
}

async function locateRuntimeRoot(directory, requiredFiles) {
  if (containsFiles(directory, requiredFiles)) {
    return directory;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const child = join(directory, entry.name);
    if (containsFiles(child, requiredFiles)) {
      return child;
    }
  }

  throw new Error(`No runtime root with required files found under ${displayPath(directory)}.`);
}

function containsFiles(directory, files) {
  return files.every((fileName) => existsSync(join(directory, fileName)));
}

async function githubRelease(version) {
  const endpoint = version === 'latest'
    ? 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'
    : `https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${encodeURIComponent(normalizeVersion(version))}`;
  const response = await fetch(endpoint, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} ${url}`);
  }

  const temporary = `${destination}.tmp`;
  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  await rename(temporary, destination);
}

async function extractArchive(archivePath, destination, { clean }) {
  if (clean && existsSync(destination)) {
    ensureSafeManagedPath(destination, dirname(destination));
    rmSync(destination, { recursive: true, force: true });
  }
  mkdirSync(destination, { recursive: true });

  if (process.platform === 'win32') {
    runPowerShell(`
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [System.IO.Directory]::CreateDirectory(${powerShellString(destination)}) | Out-Null
      [System.IO.Compression.ZipFile]::ExtractToDirectory(${powerShellString(archivePath)}, ${powerShellString(destination)})
    `);
    return;
  }

  runProcess('unzip', ['-q', archivePath, '-d', destination]);
}

async function createZipFromDirectory(sourceDirectory, zipPath) {
  mkdirSync(dirname(zipPath), { recursive: true });
  if (process.platform === 'win32') {
    runPowerShell(`
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      if (Test-Path -LiteralPath ${powerShellString(zipPath)}) { Remove-Item -LiteralPath ${powerShellString(zipPath)} -Force }
      [System.IO.Compression.ZipFile]::CreateFromDirectory(${powerShellString(sourceDirectory)}, ${powerShellString(zipPath)})
    `);
    return;
  }

  runProcess('zip', ['-qr', zipPath, '.'], { cwd: sourceDirectory });
}

function splitPackageIfNeeded(packagePath, objectKey, partDirectory) {
  const sizeBytes = statSync(packagePath).size;
  if (sizeBytes <= wranglerRemoteUploadLimitBytes) {
    return [];
  }

  const parts = [];
  const inputFile = openSync(packagePath, 'r');
  const buffer = Buffer.alloc(8 * 1024 * 1024);
  let offset = 0;
  let partIndex = 1;
  let partPath = null;
  let partFile = null;
  let partHash = null;
  let partBytes = 0;

  try {
    while (offset < sizeBytes) {
      const bytesRead = readSync(inputFile, buffer, 0, buffer.length, offset);
      if (bytesRead === 0) {
        break;
      }

      let consumed = 0;
      while (consumed < bytesRead) {
        if (!partFile) {
          const partObjectKey = `${objectKey}.part${String(partIndex).padStart(3, '0')}`;
          partPath = join(partDirectory, ...partObjectKey.split('/'));
          mkdirSync(dirname(partPath), { recursive: true });
          partFile = openSync(partPath, 'w');
          partHash = createHash('sha256');
          partBytes = 0;
        }

        const remainingPartBytes = packagePartSizeBytes - partBytes;
        const writeLength = Math.min(bytesRead - consumed, remainingPartBytes);
        const chunk = buffer.subarray(consumed, consumed + writeLength);
        writeSync(partFile, chunk);
        partHash.update(chunk);
        partBytes += writeLength;
        consumed += writeLength;

        if (partBytes === packagePartSizeBytes || offset + consumed === sizeBytes) {
          closeSync(partFile);
          const partObjectKey = `${objectKey}.part${String(partIndex).padStart(3, '0')}`;
          parts.push({
            index: partIndex,
            objectKey: partObjectKey,
            packagePath: toPosixPath(relative(rootDirectory, partPath)),
            sizeBytes: partBytes,
            sha256: partHash.digest('hex')
          });
          partIndex += 1;
          partPath = null;
          partFile = null;
          partHash = null;
          partBytes = 0;
        }
      }

      offset += bytesRead;
    }
  } finally {
    closeSync(inputFile);
    if (partFile) {
      closeSync(partFile);
    }
  }

  return parts;
}

function packageFilePath(record) {
  return join(rootDirectory, ...record.packagePath.split('/'));
}

function packageUploadItems(record) {
  if (record.parts && record.parts.length > 0) {
    return record.parts.map((part) => ({
      objectKey: part.objectKey,
      filePath: join(rootDirectory, ...part.packagePath.split('/'))
    }));
  }

  return [{
    objectKey: record.objectKey,
    filePath: join(rootDirectory, ...record.packagePath.split('/'))
  }];
}
function prepareGitHubAssetFile({ assetName, execute, releaseTag, sourcePath }) {
  const assetDirectory = join(defaultGitHubAssetDirectory, releaseTag);
  const assetPath = join(assetDirectory, assetName);
  if (execute) {
    mkdirSync(assetDirectory, { recursive: true });
    if (resolve(sourcePath) !== resolve(assetPath)) {
      copyFileSync(sourcePath, assetPath);
    }
  }
  return assetPath;
}

function ensureGitHubRelease({ execute, releaseTag, releaseTitle, repo }) {
  const viewArgs = ['release', 'view', releaseTag, '--repo', repo];
  const createArgs = ['release', 'create', releaseTag, '--repo', repo, '--title', releaseTitle, '--notes', 'Voxmire whisper.cpp runtime packages.'];
  if (!execute) {
    console.log(`gh ${viewArgs.map(shellQuote).join(' ')} || gh ${createArgs.map(shellQuote).join(' ')}`);
    return;
  }

  const view = spawnSync('gh', viewArgs, { cwd: rootDirectory, stdio: 'ignore', shell: false });
  if (view.status === 0) {
    console.log(`OK   GitHub release exists: ${repo} ${releaseTag}`);
    return;
  }
  runOrPrintGh(createArgs, true);
}

function runOrPrintGh(args, execute) {
  const displayCommand = `gh ${args.map(shellQuote).join(' ')}`;
  console.log(displayCommand);
  if (execute) {
    runProcess('gh', args);
  }
}

function runOrPrintWranglerPut({ bucket, key, filePath, execute }) {
  const objectPath = `${bucket}/${key}`;
  const args = ['--yes', 'wrangler', 'r2', 'object', 'put', objectPath, `--file=${filePath}`, '--remote'];
  const displayCommand = `npx ${args.map(shellQuote).join(' ')}`;
  console.log(displayCommand);
  if (execute) {
    runNpx(args);
  }
}

function runNpx(args) {
  if (process.platform === 'win32') {
    runProcess('cmd.exe', ['/d', '/s', '/c', 'npx.cmd', ...args]);
    return;
  }

  runProcess('npx', args);
}

function runPowerShell(script) {
  const wrappedScript = `$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
${script}`;
  const encoded = Buffer.from(wrappedScript, 'utf16le').toString('base64');
  runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDirectory,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function gitHubRepositoryFromRemote() {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: rootDirectory, encoding: 'utf8', shell: false });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  try {
    const parsed = parseGitHubRepository(result.stdout.trim());
    return `${parsed.owner}/${parsed.name}`;
  } catch {
    return null;
  }
}

function parseGitHubRepository(value) {
  const normalized = value.trim().replace(/\.git$/, '');
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], name: httpsMatch[2] };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], name: sshMatch[2] };
  }

  const shorthandMatch = normalized.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], name: shorthandMatch[2] };
  }

  throw new Error(`Invalid GitHub repository "${value}". Use owner/repo.`);
}

function githubReleaseTag(version) {
  return `whisper-runtimes-${normalizeVersion(version)}`;
}

function githubAssetName(record) {
  return `voxmire-${record.runtimeDirectoryName}-${record.platform}-${record.arch}-${record.runtimeId}.zip`;
}

function githubReleaseAssetUrl(owner, repo, releaseTag, assetName) {
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return {
      schemaVersion: 1,
      updatedAt: null,
      provider: {
        type: 'github-release',
        owner: parseGitHubRepository(defaultGitHubRepository).owner,
        repo: parseGitHubRepository(defaultGitHubRepository).name,
        publicBaseUrl: null
      },
      channels: {
        stable: {}
      },
      packages: []
    };
  }

  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function writeManifest(manifestPath, manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  manifest.packages = uniquePackages(manifest.packages);
  manifest.packages.sort((left, right) => {
    return left.platform.localeCompare(right.platform)
      || runtimeOrder.indexOf(left.runtimeId) - runtimeOrder.indexOf(right.runtimeId)
      || compareVersionStrings(right.whisperCppVersion, left.whisperCppVersion);
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function upsertPackage(manifest, packageRecord) {
  manifest.packages = manifest.packages.filter((record) => packageIdentity(record) !== packageIdentity(packageRecord));
  manifest.packages.push(packageRecord);
}

function uniquePackages(packages) {
  const byIdentity = new Map();
  for (const record of packages) {
    byIdentity.set(packageIdentity(record), record);
  }
  return [...byIdentity.values()];
}

function packageIdentity(record) {
  return `${record.platform}/${record.runtimeId}/${record.whisperCppVersion}`;
}

function findPackage(manifest, { platform, runtimeId, version }) {
  return manifest.packages.find((record) => {
    return record.platform === platform && record.runtimeId === runtimeId && record.whisperCppVersion === version;
  }) ?? null;
}

function setActiveVersion(manifest, channel, platform, runtimeId, version) {
  manifest.channels[channel] ??= {};
  manifest.channels[channel][platform] ??= {};
  manifest.channels[channel][platform][runtimeId] = version;
}

function objectKeyFor({ version, platform, runtimeId, runtimeDirectoryName }) {
  return `whisper.cpp/${version}/${platform}/${runtimeId}/${runtimeDirectoryName}.zip`;
}

function latestManifestVersion(manifest) {
  const stableVersions = Object.values(manifest.channels?.stable?.[defaultPlatform] ?? {});
  if (stableVersions.length > 0) {
    return stableVersions.sort(compareVersionStrings).at(-1) ?? null;
  }

  const packageVersions = manifest.packages?.map((record) => record.whisperCppVersion) ?? [];
  return packageVersions.sort(compareVersionStrings).at(-1) ?? null;
}

function printManifestSummary(manifest) {
  console.log('\nProvider');
  if (manifest.provider?.type === 'github-release') {
    console.log(`  GitHub Release: ${manifest.provider.owner ?? 'unknown'}/${manifest.provider.repo ?? 'unknown'}`);
  } else if (manifest.provider?.type === 'r2') {
    console.log(`  R2 bucket: ${manifest.provider.bucket ?? 'not set'}`);
  } else {
    console.log('  not set');
  }

  console.log('\nStable channel');
  const stable = manifest.channels?.stable?.[defaultPlatform] ?? {};
  for (const runtimeId of runtimeOrder) {
    console.log(`  ${runtimeId.padEnd(10)} ${stable[runtimeId] ?? 'not set'}`);
  }

  console.log('\nPrepared packages');
  const packages = manifest.packages ?? [];
  if (packages.length === 0) {
    console.log('  none');
    return;
  }

  for (const record of packages) {
    const urlStatus = record.url ? 'url' : 'no-url';
    console.log(`  ${record.platform}/${record.runtimeId.padEnd(10)} ${record.whisperCppVersion.padEnd(8)} ${formatBytes(record.sizeBytes).padStart(9)} ${urlStatus.padEnd(6)} ${record.assetName ?? record.objectKey}`);
  }
}

async function askText(rl, label, defaultValue) {
  const answer = (await rl.question(`${label} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

async function askYesNo(rl, label, defaultValue) {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  while (true) {
    const answer = (await rl.question(`${label} [${suffix}]: `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    if (['y', 'yes'].includes(answer)) {
      return true;
    }
    if (['n', 'no'].includes(answer)) {
      return false;
    }
    console.log('Please answer yes or no.');
  }
}

async function askChoice(rl, label, choices, defaultKey) {
  for (const [key, description] of choices) {
    console.log(`  ${key}) ${description}`);
  }

  const validKeys = new Set(choices.map(([key]) => key));
  while (true) {
    const answer = (await rl.question(`${label} [${defaultKey}]: `)).trim() || defaultKey;
    if (validKeys.has(answer)) {
      return answer;
    }
    console.log(`Choose one of: ${choices.map(([key]) => key).join(', ')}`);
  }
}

async function askRuntimeSet(rl, defaultSet) {
  const defaultChoice = defaultSet === 'upstream' ? '2' : '1';
  const choice = await askChoice(rl, 'Runtime set', [
    ['1', 'All runtimes: CUDA, Vulkan, BLAS CPU, CPU'],
    ['2', 'Upstream assets only: CUDA, BLAS CPU, CPU'],
    ['3', 'GPU runtimes: CUDA and Vulkan'],
    ['4', 'CPU runtimes: BLAS CPU and CPU'],
    ['5', 'CUDA only'],
    ['6', 'Vulkan only'],
    ['7', 'Custom comma-separated runtime ids']
  ], defaultChoice);

  if (choice === '1') {
    return runtimeOrder.join(',');
  }
  if (choice === '2') {
    return runtimeOrder.filter((runtimeId) => runtimeId !== 'vulkan').join(',');
  }
  if (choice === '3') {
    return 'cuda-12.4,vulkan';
  }
  if (choice === '4') {
    return 'cpu-blas,cpu';
  }
  if (choice === '5') {
    return 'cuda-12.4';
  }
  if (choice === '6') {
    return 'vulkan';
  }

  while (true) {
    const custom = (await rl.question(`Runtime ids [${runtimeOrder.join(',')}]: `)).trim();
    const include = custom || runtimeOrder.join(',');
    try {
      includedRuntimeIds({ include });
      return include;
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
}
function includedRuntimeIds(options, { skipVulkanByDefault = false } = {}) {
  const defaultIds = skipVulkanByDefault ? runtimeOrder.filter((runtimeId) => runtimeId !== 'vulkan') : runtimeOrder;
  const include = options.include ? options.include.split(',').map((item) => item.trim()).filter(Boolean) : defaultIds;
  for (const runtimeId of include) {
    if (!runtimeDefinitions[runtimeId]) {
      throw new Error(`Unknown runtime id "${runtimeId}". Valid ids: ${runtimeOrder.join(', ')}`);
    }
  }
  return include;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument "${token}".`);
    }

    const raw = token.slice(2);
    const equalsIndex = raw.indexOf('=');
    if (equalsIndex !== -1) {
      const key = raw.slice(0, equalsIndex);
      options[key] = raw.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[raw] = true;
      continue;
    }

    options[raw] = next;
    index += 1;
  }
  return options;
}

function requiredOption(options, key) {
  const value = options[key];
  if (!value || value === true) {
    throw new Error(`Missing required option --${key}.`);
  }
  return value;
}

function booleanOption(options, key) {
  return options[key] === true || options[key] === 'true';
}

function optionPath(options, key, defaultValue) {
  const value = options[key] ?? defaultValue;
  return isAbsolute(value) ? value : resolve(rootDirectory, value);
}

function normalizeVersion(version) {
  return version.startsWith('v') ? version : `v${version}`;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function ensureSafeManagedPath(targetPath, managedRoot) {
  const resolvedRoot = resolve(managedRoot);
  const resolvedTarget = resolve(targetPath);
  const pathRelative = relative(resolvedRoot, resolvedTarget);
  if (!pathRelative || pathRelative.startsWith('..') || isAbsolute(pathRelative)) {
    throw new Error(`Refusing to remove path outside managed directory: ${displayPath(targetPath)}`);
  }
}

function compareVersionStrings(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.localeCompare(right);
}

function versionParts(value) {
  return value.replace(/^v/i, '').split(/[^\d]+/).filter(Boolean).map((part) => Number(part));
}

function printUploadHint(packages) {
  if (packages.length === 0) {
    return;
  }
  const versions = [...new Set(packages.map((record) => record.whisperCppVersion))];
  const include = packages.map((record) => record.runtimeId).join(',');
  console.log('\nNext upload command:');
  console.log(`npm run runtimes:upload -- --version ${versions[0]} --include ${include} --repo ${defaultGitHubRepository}`);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function toPosixPath(value) {
  return value.split(sep).join('/');
}

function displayPath(value) {
  return relative(rootDirectory, value) || '.';
}

function powerShellString(value) {
  return `'${value.replace(/'/g, `''`)}'`;
}

function shellQuote(value) {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function printHelp(command) {
  const common = `
Common options:
  --version <vX.Y.Z>        whisper.cpp release tag
  --include <ids>           Comma list: ${runtimeOrder.join(',')}
  --manifest <path>         Default: resources/whisper-runtimes.manifest.json
`;

  if (command === 'menu') {
    console.log(`Open the guided runtime manager.

Usage:
  npm run runtimes

Defaults:
  GitHub repo: ${defaultGitHubRepository}

The menu can prepare packages, dry-run GitHub Release uploads, execute uploads, download upstream assets, promote prepared versions, and show the manifest summary.`);
    return;
  }

  if (command === 'download') {
    console.log(`Download upstream whisper.cpp release assets.

Usage:
  npm run runtimes:download -- --version v1.8.4
${common}
Options:
  --source-dir <path>       Default: whisper-binaries

Vulkan is skipped by default because upstream releases do not publish a Vulkan Windows asset.`);
    return;
  }

  if (command === 'prepare') {
    console.log(`Prepare versioned runtime zips and update the manifest.

Usage:
  npm run runtimes:prepare -- --version v1.8.4 --promote --force
${common}
Options:
  --source-dir <path>       Default: whisper-binaries
  --cpu-source <path>       Folder or zip for plain CPU
  --cpu-blas-source <path>  Folder or zip for BLAS CPU
  --cuda-source <path>      Folder or zip for CUDA 12.4
  --vulkan-source <path>    Folder or zip for Vulkan build
  --package-dir <path>      Default: .voxmire-runtimes/packages
  --staging-dir <path>      Default: .voxmire-runtimes/staging
  --base-url <url>          Optional public download base URL
  --split-large-packages    Split large zips for R2 legacy uploads
  --promote                 Set stable channel to this version
  --force                   Rebuild existing staging/package outputs`);
    return;
  }

  if (command === 'promote') {
    console.log(`Promote prepared packages in the local manifest.

Usage:
  npm run runtimes:promote -- --version v1.8.4
${common}`);
    return;
  }

  if (command === 'upload') {
    console.log(`Upload prepared packages to GitHub Releases by default.

Usage:
  npm run runtimes:upload -- --version v1.8.4 --repo Avaxerrr/Voxmire --execute
${common}
Options:
  --repo <owner/repo>       GitHub repository, defaults to git origin
  --release-tag <tag>       Default: whisper-runtimes-<version>
  --target r2               Use legacy Cloudflare R2 upload path
  --bucket <name>           R2 bucket name for --target r2
  --manifest-key <key>      R2 manifest key for --target r2
  --skip-manifest           Upload packages only
  --write-manifest          Write GitHub URLs during dry run
  --execute                 Actually run gh or Wrangler; omitted means dry run`);
    return;
  }

  console.log(`Voxmire whisper.cpp runtime tooling.

Commands:
  menu       Open the guided runtime manager
  download   Download upstream release assets into whisper-binaries
  prepare    Normalize runtime folders, zip packages, checksum, update manifest
  promote    Set stable manifest versions after local testing
  upload     Upload prepared zips to GitHub Releases and update manifest URLs

Examples:
  npm run runtimes
  npm run runtimes:download -- --version v1.8.4
  npm run runtimes:prepare -- --version v1.8.4 --promote --force
  npm run runtimes:upload -- --version v1.8.4 --repo Avaxerrr/Voxmire
`);
}
