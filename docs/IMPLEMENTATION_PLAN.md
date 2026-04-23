# Voxmire Implementation Plan

## Summary

Build Voxmire in a pipeline-first order, with the first milestone proving the real local CPU transcription path: file import -> ffmpeg probe/prepare -> whisper.cpp CPU sidecar -> SQLite transcript storage -> renderer progress/transcript display.

Also add `docs/IMPLEMENTATION_PLAN.md` as the repo source of truth before continuing implementation.

## Key Changes

- Add `docs/IMPLEMENTATION_PLAN.md` with this plan, then commit it before coding the next feature layer.
- Add shared contracts in `packages/contracts` using Zod:
  - `JobStatus`: `queued`, `preparing`, `transcribing`, `paused`, `completed`, `failed`, `canceled`
  - `ExportFormat`: `txt`, `json`, `srt`, `vtt`
  - `SourceFile`, `TranscriptionJob`, `TranscriptSegment`, `ModelProfile`, `EngineAvailability`, `TranscriptionProgressEvent`
- Add core logic in `packages/core`:
  - job state transition helpers
  - model shortlist defaults: `large-v3-turbo`, `large-v3`, `distil-large-v3.5`, `medium`
  - long-audio chunk policy defaults
- Add `packages/storage` using `better-sqlite3`:
  - migrations for jobs, source files, transcript segments, models, settings
  - repository APIs for creating jobs, listing jobs, updating progress/status, saving segments, loading transcripts
- Add `packages/engine`:
  - `TranscriptionEngine` interface
  - ffmpeg probe wrapper
  - whisper.cpp CPU engine wrapper first
  - resource path resolver for `resources/engines/win32/whisper-cpu.exe`
- Add `packages/exporters`:
  - TXT and JSON first
  - SRT/VTT after timestamped segments are stable
- Expand desktop IPC:
  - `jobs:create`
  - `jobs:list`
  - `jobs:get`
  - `jobs:cancel`
  - `transcripts:get`
  - `exports:create`
  - `system:get-engine-availability`
- Update desktop UI:
  - real import button/file picker
  - job list
  - progress states
  - transcript viewer placeholder, then segment rendering
  - export actions once data exists

## Build Order

1. **Plan document**
   Create `docs/IMPLEMENTATION_PLAN.md` and commit.

2. **Contracts**
   Implement shared Zod schemas and exported TypeScript types. No Electron-specific imports.

3. **Core**
   Implement job status transitions, model defaults, and chunking policy helpers.

4. **Storage**
   Add SQLite connection, migrations, and repositories. Store durable job and transcript state from the start.

5. **Desktop IPC**
   Wire typed IPC in main/preload/renderer. Renderer must not access filesystem, SQLite, ffmpeg, or Whisper directly.

6. **File import**
   Use Electron file picker to create a job from a selected audio/video file.

7. **ffmpeg**
   Add file probing first, then audio preparation/chunking.

8. **whisper.cpp CPU**
   Add real CPU sidecar execution. Stream progress and save segments incrementally.

9. **Long-audio reliability**
   Add checkpointing, resume after interruption, cancel, and paused state handling.

10. **Exports**
   Implement TXT and JSON, then SRT and VTT.

11. **Hardware profiles**
   Add CUDA/Vulkan detection after the CPU path works.

12. **Packaging**
   Add electron-builder and resource packaging once the transcription path is functional.

## Test Plan

- Run after each implementation slice:
  - `npm run typecheck`
  - `corepack pnpm --filter @voxmire/desktop build`
- Add Vitest for package-level tests before core/storage logic grows.
- Test contracts with valid and invalid job, segment, model, and export payloads.
- Test core state transitions, including invalid transitions.
- Test storage repositories against a temporary SQLite database.
- Test exporters with fixed transcript fixtures.
- Manual desktop checks:
  - app opens
  - file picker creates a job
  - progress updates render
  - transcript segments appear incrementally
  - cancel works
  - completed transcript exports to TXT/JSON

## Assumptions

- First milestone uses the **real whisper.cpp CPU path**, not a mock pipeline.
- `docs/IMPLEMENTATION_PLAN.md` should be created as the source of truth.
- Web and mobile remain placeholders.
- No cloud transcription.
- `faster-whisper` remains optional future work.
- CPU fallback is mandatory; CUDA/Vulkan come later.
- Large model files and binaries are not committed unless explicitly intended.
