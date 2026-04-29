# Voxmire Handoff Context

This document captures the product and architecture decisions from the planning discussion so a new chat or clean project can continue without needing the full conversation history.

## Product Name

Final name: **Voxmire**

Pronunciation: `VOX-mire`

The name was chosen because it is readable, distinctive, voice-adjacent through `Vox`, and shippable without feeling too personal or gimmicky.

## Product Purpose

Voxmire is a local-first transcription app for very long audio files, including 3 hour plus recordings.

Primary goal:

- Transcribe long audio locally without subscription limits.

Secondary goals:

- Keep audio private by default.
- Support different machine capabilities.
- Make transcription resumable and reliable.
- Export useful transcript formats.
- Keep the architecture maintainable and extensible.

## Final Stack

- Desktop shell: Electron
- Frontend: React, TypeScript, Vite
- Package manager: pnpm workspace
- Local transcription engine: whisper.cpp
- Audio tooling: bundled ffmpeg
- Storage: SQLite
- Shared contracts: Zod
- Desktop packaging: electron-builder

Electron is final. The app should optimize memory by keeping transcription outside the renderer, not by switching away from Electron.

## Architecture Direction

Use a monorepo with platform apps at the edge and reusable product logic in packages.

Recommended layout:

```txt
Voxmire/
  apps/
    desktop/
    web/
    mobile/

  packages/
    core/
    contracts/
    engine/
    storage/
    exporters/

  resources/
    engines/
    ffmpeg/
    models/

  docs/
```

Important rule:

- `apps/*` contains platform-specific shells.
- `packages/*` contains reusable product logic.
- Electron-specific code should stay out of reusable packages.

## Desktop App Boundaries

Renderer:

- React UI only.
- No direct filesystem access.
- No direct SQLite access.
- No direct Whisper or ffmpeg calls.

Preload:

- Narrow typed bridge exposed to the renderer.

Electron main:

- Local backend for desktop.
- Owns file access, job queue, engine spawning, ffmpeg orchestration, SQLite, and exports.

## Shared Packages

`packages/core`

- Job state machine
- Chunking policy
- Model selection rules
- Retry/resume rules
- Transcript domain logic

`packages/contracts`

- Zod schemas
- IPC/API request and response types
- Shared transcript and job types

`packages/engine`

- Whisper and ffmpeg orchestration
- Engine detection
- Transcription engine interfaces

`packages/storage`

- SQLite connection
- Migrations
- Repositories for jobs, transcripts, models, settings

`packages/exporters`

- TXT
- JSON
- SRT
- VTT
- Future DOCX/PDF/Markdown

## Whisper Runtime Decision

Default engine: **whisper.cpp**

Reason:

- Works on CPU.
- Can support multiple acceleration backends.
- Easier to package than Python for a consumer Electron app.
- Better default path for broad hardware support.

Recommended Windows sidecar binaries:

```txt
resources/engines/win32/cuda-12.4/whispercpp-v1.8.4/whisper-cli.exe
resources/engines/win32/vulkan/whispercpp-v1.8.4/whisper-cli.exe
resources/engines/win32/cpu-blas/whispercpp-v1.8.4/whisper-cli.exe
resources/engines/win32/cpu/whispercpp-v1.8.4/whisper-cli.exe
```

Runtime preference:

1. CUDA 12.4 when NVIDIA support is available and working.
2. Vulkan when available and stable.
3. BLAS CPU when present.
4. Plain CPU fallback always.

## faster-whisper Decision

`faster-whisper` is not rejected, but it should be optional later.

Reason not to use it as default V1:

- Python runtime packaging complexity.
- CUDA/CTranslate2 compatibility issues.
- Larger app/support surface.
- Better suited for advanced NVIDIA users.

Potential future use:

- Optional advanced backend for NVIDIA/CUDA users.

## Model Shortlist

Expose useful quality models instead of every Whisper model.

Recommended initial models:

- `large-v3-turbo`: default for most users.
- `large-v3`: quality mode.
- `distil-large-v3.5`: fast English-focused mode.
- `medium` or `medium.en`: fallback for older machines.

Hide tiny/base/small by default unless adding a low-resource or preview mode.

## Long Audio Requirements

Voxmire must handle multi-hour audio safely.

Implementation expectations:

- Probe input with ffmpeg.
- Normalize/extract audio for transcription.
- Chunk long audio.
- Persist each segment/checkpoint.
- Stream progress events.
- Allow pause, resume, cancel.
- Recover interrupted jobs.
- Avoid loading huge transcripts fully into renderer memory.
- Use a virtualized transcript viewer.

## Initial Roadmap

Phase 1: Foundation

- Monorepo structure.
- Electron desktop scaffold.
- Shared packages.
- TypeScript config.
- Documentation.

Phase 2: MVP transcription

- File import.
- ffmpeg probe/normalize.
- SQLite database.
- Job queue.
- whisper.cpp CPU engine.
- Transcript segment storage.
- Progress UI.
- TXT and JSON export.

Phase 3: Long audio reliability

- Chunking.
- Checkpoints.
- Resume after interruption.
- Pause/resume/cancel.
- SRT and VTT export.
- Virtualized transcript viewer.

Phase 4: Hardware support

- CPU capability detection.
- CUDA detection.
- Vulkan detection.
- Model manager.
- Performance presets.

Phase 5: Polish

- Search.
- Basic transcript editing.
- Export presets.
- Recent files.
- Installer.
- Update flow.

## Current Workspace Note

During planning, the original folder was named `JOHANNA-TRANSCRIBER`, then renamed to `Voxmire`. A Windows junction was created from the old path to the new path to keep the previous Codex thread working.

For a clean project, use:

```txt
C:\Users\Work\Documents\Coding Projects\Coding\Voxmire
```

or create a fresh `Voxmire` folder and copy the docs/architecture decisions from this handoff.
