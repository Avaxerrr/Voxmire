# Voxmire Runtime Resources

This folder is for local runtime binaries, manifests, and model files. Large runtime and model binaries are intentionally ignored by git.

Current packaged Windows resource policy:

```txt
ffmpeg/ffmpeg.exe
ffmpeg/ffprobe.exe
engines/win32/vulkan/whispercpp-v1.8.4/
engines/win32/cpu-blas/whispercpp-v1.8.4/
engines/win32/cpu/whispercpp-v1.8.4/
models/ggml-small-q8_0.bin
whisper-runtimes.manifest.json
whisper-models.manifest.json
```

CUDA and larger models are installed on demand from the manifests instead of being committed or bundled by default.

See `docs/RESOURCES.md` and `docs/RUNTIME_PIPELINE.md` for setup and packaging details.
