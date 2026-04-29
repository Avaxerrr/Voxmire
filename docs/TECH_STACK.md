# Tech Stack

## Desktop App

- Electron for the desktop shell.
- Vite for fast local development and renderer bundling.
- React for UI.
- TypeScript across the app.

## Local Backend

Electron main process acts as the desktop adapter for the local runtime.

Responsibilities:

- Native file dialogs
- App path resolution
- Runtime initialization
- IPC with renderer
- Progress broadcasting

## Transcription Engine

Primary engine:

- whisper.cpp

Packaged sidecar binaries:

- `resources/engines/win32/cuda-12.4/whisper-cli.exe`
- `resources/engines/win32/vulkan/whisper-cli.exe`
- `resources/engines/win32/cpu-blas/whisper-cli.exe`
- `resources/engines/win32/cpu/whisper-cli.exe`

Runtime preference:

1. CUDA 12.4, when NVIDIA support is available and the binary works.
2. Vulkan, when available and stable.
3. BLAS CPU, when present.
4. Plain CPU fallback.

Optional future engine:

- faster-whisper Python backend for advanced NVIDIA/CUDA users.

This should not be the default V1 engine because Python and CUDA packaging adds deployment complexity.

## Audio Processing

- ffmpeg for input normalization, probing, extraction, and chunk preparation.

Expected input support:

- MP3
- WAV
- M4A
- FLAC
- OGG
- MP4
- MOV
- WebM

## Storage

- SQLite for durable local state through built-in `node:sqlite`.

Expected data:

- Jobs
- Source files
- Transcript segments
- Model metadata
- Engine runs
- Export history
- Settings

## Shared Packages

- `@voxmire/core`: pure app logic and state machines.
- `@voxmire/contracts`: Zod schemas and shared TypeScript types.
- `@voxmire/runtime`: UI-independent job orchestration for desktop and future headless execution.
- `@voxmire/engine`: whisper.cpp and ffmpeg orchestration.
- `@voxmire/storage`: SQLite repositories.
- `@voxmire/exporters`: transcript export formatting.
