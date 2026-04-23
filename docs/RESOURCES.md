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
      whisper-cpu.exe
  models/
    ggml-large-v3-turbo.bin
```

The app can open without these files, but transcription will fail with a clear missing-resource message until the required files exist.

## Optional Resources

```txt
resources/engines/win32/whisper-cuda.exe
resources/engines/win32/whisper-vulkan.exe
resources/models/ggml-large-v3.bin
resources/models/ggml-distil-large-v3.5.bin
resources/models/ggml-medium.bin
```

CUDA and Vulkan are optional follow-up engines. CPU remains the mandatory fallback.

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
