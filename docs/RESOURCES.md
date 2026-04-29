# Local Resources

Voxmire does not commit large runtime resources to git. Local transcription needs binaries and GGML model files placed under `resources/`.

## Required For First CPU Run

```txt
resources/
  ffmpeg/
    ffmpeg.exe
    ffprobe.exe
  engines/
    win32/
      cpu/
        whispercpp-v1.8.4/
          whisper-cli.exe
          whisper.dll
          ggml.dll
          ggml-base.dll
          ggml-cpu.dll
  models/
    ggml-large-v3-turbo.bin
```

The app can open without these files, but transcription will fail with a clear missing-resource message until at least the plain CPU runtime and required model exist.

## Optional Engine Runtimes

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
```

Runtime preference is:

```txt
CUDA 12.4 -> Vulkan -> BLAS CPU -> plain CPU
```

Plain CPU remains the final fallback. CUDA and Vulkan are optional acceleration paths; BLAS CPU is the preferred CPU path when present.

## Optional Models

```txt
resources/models/ggml-large-v3.bin
resources/models/ggml-distil-large-v3.5.bin
resources/models/ggml-medium.bin
```

## Source Locations

Use upstream project pages and verify downloaded artifacts before packaging:

- whisper.cpp project and releases: https://github.com/ggml-org/whisper.cpp/releases
- whisper.cpp GGML model files: https://huggingface.co/ggerganov/whisper.cpp/tree/main
- Windows FFmpeg builds: https://www.gyan.dev/ffmpeg/builds/

For V1 development, place files manually in the expected paths. Do not commit binaries or model files unless packaging rules are explicitly changed.

## Status Check

Run:

```bash
npm run resources:check
```

The command prints required and optional resources with their expected local paths.
