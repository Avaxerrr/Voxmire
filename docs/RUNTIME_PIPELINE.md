# Whisper Runtime Packaging Pipeline

Voxmire does not commit large whisper.cpp runtime binaries. The repo keeps a small manifest and local developer tooling; packaged runtime zips are published as GitHub Release assets.

## Normal Interactive Command

Use the menu for day-to-day packaging so you do not have to remember the lower-level commands:

```bash
npm run runtimes
```

The menu defaults to the GitHub repository from `git remote origin`, currently `Avaxerrr/Voxmire`. Override it for one run with `--repo owner/repo` or set `VOXMIRE_GITHUB_REPO`.

## Recommended Manual Flow

1. Download upstream release assets.

   ```bash
   npm run runtimes:download -- --version v1.8.4
   ```

   This downloads the upstream CPU, BLAS CPU, and CUDA 12.4 Windows x64 release assets into `whisper-binaries/`. Vulkan is skipped because upstream does not publish a Windows Vulkan zip in the same release asset set.

2. Build or copy the Vulkan runtime.

   Put the Vulkan build output in `whisper-binaries/whisper-vulkan-built-x64/`, or pass it explicitly:

   ```bash
   npm run runtimes:prepare -- --version v1.8.4 --vulkan-source C:/path/to/vulkan/runtime
   ```

3. Prepare local packages and update the manifest.

   ```bash
   npm run runtimes:prepare -- --version v1.8.4 --promote --force
   ```

   The script copies only the required files into versioned runtime folders, creates zip packages under `.voxmire-runtimes/packages/`, calculates SHA256 checksums, and updates `resources/whisper-runtimes.manifest.json`.

4. Smoke-test locally before upload.

   At minimum, run:

   ```bash
   npm run resources:check
   npm run typecheck
   npm test
   ```

   For a new runtime release, also transcribe a short known audio file with each runtime you plan to promote.

5. Dry-run the GitHub Release upload.

   ```bash
   npm run runtimes:upload -- --version v1.8.4 --repo Avaxerrr/Voxmire
   ```

6. Upload to GitHub Releases after the dry run looks correct.

   ```bash
   npm run runtimes:upload -- --version v1.8.4 --repo Avaxerrr/Voxmire --execute
   ```

   This uses the GitHub CLI. Sign in once with `gh auth login` if needed. The upload command creates the release tag when missing, uploads the package zips as release assets, then writes concrete GitHub download URLs back into `resources/whisper-runtimes.manifest.json`.

## App Runtime Bundle Policy

The app release should bundle these Windows runtimes by default:

- `vulkan`
- `cpu-blas`
- `cpu`

CUDA stays out of the app installer because the CUDA package is much larger. The app downloads `cuda-12.4` on demand from the GitHub Release URL in the manifest.

Before packaging an app release, run:

```bash
npm run app:runtimes:check
```

This confirms the three bundled runtimes exist locally and the CUDA package has a download URL.

## App Installer Flow

The desktop app reads `resources/whisper-runtimes.manifest.json` through Electron main, never from the renderer. Runtime packages are installed into Electron user data under `resources/engines/<platform>/<runtime-id>/<runtime-folder>/`, so a packaged app does not need to write into its bundled resources.

The Settings runtime manager shows the stable version, local installed version, package size, split-part count when present, and install state for each runtime. After an install completes, machine profile and resource detection refresh, and the downloaded runtime participates in the normal fallback order.

Downloads are enabled only when the manifest has either explicit package URLs or a public base URL. GitHub Release upload writes explicit package URLs, which is the preferred path.

## Promotion And Rollback

Release asset names are immutable by convention. Do not overwrite an existing stable asset unless you are deliberately repairing a failed upload before shipping the manifest.

Promotion is a manifest change. If `v1.9.0` is uploaded but not trusted yet, leave `stable` pointing at `v1.8.4`. When ready:

```bash
npm run runtimes:promote -- --version v1.9.0
```

Rollback is the same operation in reverse:

```bash
npm run runtimes:promote -- --version v1.8.4
```

## Retention Rule

Keep three stable versions in GitHub Releases:

- current stable
- previous stable
- one older emergency fallback

Candidate or failed packages can be deleted after testing, but stable versioned packages should not be overwritten.

## R2 Legacy Path

R2 support remains available for later, but it is no longer the default. Use it only if you explicitly want object storage:

```bash
npm run runtimes:upload:r2 -- --version v1.8.4 --bucket voxmire-runtimes --execute
```

For R2, large packages may need `--split-large-packages` because Wrangler remote uploads reject files over 300 MiB. The GitHub Release path does not need this split for the current CUDA package.

## Generated Files

- `.voxmire-runtimes/` is generated and ignored by git.
- `resources/whisper-runtimes.manifest.json` is small metadata and should be committed.
- Runtime binaries, zips, and local staging folders remain ignored.
