# Local Resources

Voxmire keeps heavyweight runtime and model binaries out of git. The repo tracks manifests and tooling, while local development and packaged builds use files under `resources/`.

## App Bundle Policy

The Windows desktop app bundles these resources:

```txt
resources/
  ffmpeg/
    ffmpeg.exe
    ffprobe.exe
  engines/
    win32/
      vulkan/whispercpp-v1.8.4/
      cpu-blas/whispercpp-v1.8.4/
      cpu/whispercpp-v1.8.4/
  models/
    ggml-small-q8_0.bin
```

CUDA is not bundled because the CUDA package is much larger. The app downloads CUDA on demand from `resources/whisper-runtimes.manifest.json`.

Large models are not bundled. The app downloads `large-v3-turbo` and `large-v3` on demand from `resources/whisper-models.manifest.json`.

## Runtime Layout

Keep each whisper.cpp build in its own versioned folder because the builds contain overlapping DLL names that must stay paired with their matching executable. Replace the whole `whispercpp-v...` folder when upgrading; do not mix files between whisper.cpp releases.

```txt
resources/engines/win32/cuda-12.4/whispercpp-v1.8.4/
  whisper-cli.exe
  whisper.dll
  ggml.dll
  ggml-base.dll
  ggml-cpu.dll
  ggml-cuda.dll
  cublas64_12.dll
  cublasLt64_12.dll
  cudart64_12.dll

resources/engines/win32/vulkan/whispercpp-v1.8.4/
  whisper-cli.exe
  whisper.dll
  ggml.dll
  ggml-base.dll
  ggml-cpu.dll
  ggml-vulkan.dll

resources/engines/win32/cpu-blas/whispercpp-v1.8.4/
  whisper-cli.exe
  whisper.dll
  ggml.dll
  ggml-base.dll
  ggml-cpu.dll
  ggml-blas.dll
  libopenblas.dll

resources/engines/win32/cpu/whispercpp-v1.8.4/
  whisper-cli.exe
  whisper.dll
  ggml.dll
  ggml-base.dll
  ggml-cpu.dll
```

Runtime fallback order is:

```txt
CUDA 12.4 -> Vulkan -> BLAS CPU -> plain CPU
```

Plain CPU remains the final fallback. BLAS CPU is the preferred CPU path when available.

## Model Layout

Bundled starter model:

```txt
resources/models/ggml-small-q8_0.bin
```

Downloadable models:

```txt
ggml-large-v3-turbo.bin
ggml-large-v3.bin
```

Installed runtime and model downloads go under Electron user data, not the app install directory. Downloads are written to a temporary folder, verified with SHA256, then moved into the final resource directory.

## Developer Commands

Download or verify the bundled starter model:

```bash
npm run models:download
```

Download all configured models for local testing:

```bash
npm run models:download:all
```

Prepare, promote, and upload whisper.cpp runtime packages:

```bash
npm run runtimes
```

Check local bundle policy:

```bash
npm run app:runtimes:check
npm run app:models:check
npm run resources:check
```

`npm run desktop:package` downloads/verifies the bundled starter model before building the app.

## Source Locations

Use upstream project pages and verify downloaded artifacts before packaging:

- whisper.cpp project and releases: https://github.com/ggml-org/whisper.cpp/releases
- whisper.cpp GGML model files: https://huggingface.co/ggerganov/whisper.cpp/tree/main
- Windows FFmpeg builds: https://www.gyan.dev/ffmpeg/builds/

Do not commit runtime binaries, model binaries, generated zip packages, or local staging folders unless packaging rules are explicitly changed.
