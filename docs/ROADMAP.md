# Roadmap

## Completed Foundation

- Monorepo with Electron desktop app and shared packages.
- React + TypeScript + Vite renderer.
- Typed preload bridge and Electron main IPC.
- SQLite storage for jobs, chunks, transcripts, and settings.
- Local ffmpeg probing/preparation.
- whisper.cpp sidecar transcription.
- Durable chunked long-audio jobs with pause, resume, cancel, and recovery.
- Transcript virtualization for large jobs.
- TXT, JSON, SRT, and VTT exports.
- CLI and local MCP development surfaces.

## Completed Hardware And Resource Work

- Runtime fallback chain: CUDA 12.4, Vulkan, BLAS CPU, plain CPU.
- Versioned whisper.cpp runtime folders.
- Bundled Vulkan, BLAS CPU, and plain CPU runtimes.
- Downloadable CUDA runtime through the runtime manifest.
- Bundled `small-q8_0` starter model.
- Downloadable `large-v3-turbo` and `large-v3` models through the model manifest.
- Runtime/model package checks and developer tooling.

## Active Polish

- Job processing stats: processing duration, chunk count, average chunk time, per-chunk runtime.
- Progress bar behavior for single-chunk and multi-chunk jobs.
- Wider timestamp editing fields for hour-scale transcripts.
- Clean-machine validation for CUDA runtime download and fallback behavior.
- Refactor pressure points: `packages/runtime/src/runtime.ts`, `apps/desktop/src/renderer/src/App.tsx`, and `scripts/whisper-runtime-tool.mjs`.

## Transcript Editing

Completed first passes:

- Direct transcript text editing.
- Autosave and explicit save/cancel behavior.
- Split and merge segments.
- Timestamp correction with storage validation.
- Find/replace.
- Edited text flows into all export formats.

Remaining:

- Undo/redo edit history.
- Speaker labels.
- Edit conflict handling if a job is still transcribing.

## Playback

Completed first passes:

- Safe local media protocol.
- Native audio playback in the renderer.
- Segment highlight and seek sync.
- Byte-range streaming.
- Volume/mute controls.
- Backend-generated waveform peaks.

Remaining:

- Manual-scroll follow behavior.
- Waveform persistence.
- Broader media-container edge-case testing.
- Optional playback-rate control.

## Release Readiness

- App icon and installer polish.
- Update flow.
- Clean public docs.
- Clean-machine smoke tests for bundled runtimes, CUDA download, model download, and long-audio transcription.

## Future

- Optional faster-whisper backend for advanced users.
- Optional web app.
- Optional mobile app.
- Speaker diarization if local quality is strong enough.
- Summary and cleanup features using local models.
