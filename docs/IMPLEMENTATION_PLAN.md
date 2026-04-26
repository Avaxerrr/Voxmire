# Voxmire Implementation Plan

## Summary

Build Voxmire in a pipeline-first order, with the first milestone proving the real local CPU transcription path: file import -> ffmpeg probe/prepare -> whisper.cpp CPU sidecar -> SQLite transcript storage -> renderer progress/transcript display.

`docs/IMPLEMENTATION_PLAN.md` is the repo source of truth for implementation status.

Current focus: harden the direct transcript editor UX, then move into transcript structure editing such as split/merge and timestamp correction.

Synchronized audio playback first pass is implemented for the transcript editor, and playback polish is in progress. See `docs/AUDIO_SYNC_PLAN.md` for remaining polish.

## Current Status

- Done: monorepo foundation, docs, Electron desktop scaffold, React UI, shared packages, typed IPC, file import, SQLite job/transcript storage, resource checks, model presets, exports, and package tests.
- Done: local runtime is pseudo-headless. Electron wraps `packages/runtime`, and the runtime can be exercised without the renderer.
- Done: bundled ffmpeg/ffprobe and whisper.cpp CPU resources are present locally and intentionally ignored by git.
- Done: ffmpeg preparation and chunk metadata foundation. Imported media is prepared into app-managed WAV chunks, chunks are stored durably, and whisper.cpp runs chunk-by-chunk.
- Done: long-audio reliability first pass. Checkpoint/resume, pause/resume, progress streaming, and transcript virtualization are implemented.
- Done: agent-friendly development surfaces. CLI, structured runtime JSONL logs, and a local stdio MCP server exist for debugging and automation.
- Done: machine profile first pass. Voxmire detects CPU/memory, backend binary/runtime availability, recommends a backend/model, and can resolve practical performance presets through desktop, CLI, and MCP.
- Done: model inventory first pass. Settings shows installed/missing local models and disables missing models for new imports.
- Done: synchronized audio playback first pass. The transcript editor now resolves a safe Electron media URL, plays through a native audio element, highlights active transcript rows, and seeks when a segment is clicked.
- Done: playback polish first pass. Media streaming now handles byte ranges directly, the audio deck has volume/mute controls, sits lower in the transcript view, and renders backend-generated waveform peaks.
- Done: transcript editing foundation. Existing transcript segment text can be edited and persisted through storage/runtime/main/preload without moving filesystem or SQLite access into the renderer.
- Done: real transcript editor UX first pass. Transcript text is directly editable, timestamps/gutters handle seeking, Enter commits and advances, Shift+Enter is the deliberate multiline path, autosave is debounced, and playback follow does not steal focus while editing.
- Started: packaging and real GPU sidecar support. CUDA/Vulkan remain blocked until the sidecar binaries and runtime DLL packaging are intentionally added.

## Key Changes

- [x] Add `docs/IMPLEMENTATION_PLAN.md` with this plan.
- [x] Add shared contracts in `packages/contracts` using Zod:
  - `JobStatus`: `queued`, `preparing`, `transcribing`, `paused`, `completed`, `failed`, `canceled`
  - `ExportFormat`: `txt`, `json`, `srt`, `vtt`
  - `SourceFile`, `TranscriptionJob`, `TranscriptionChunk`, `TranscriptSegment`, `ModelProfile`, `EngineAvailability`, `TranscriptionProgressEvent`
- [x] Add core logic in `packages/core`:
  - job state transition helpers
  - model shortlist defaults: `large-v3-turbo`, `large-v3`, `distil-large-v3.5`, `medium`
  - long-audio chunk policy defaults
- [x] Add `packages/storage` using built-in `node:sqlite`:
  - migrations for jobs, source files, transcription chunks, transcript segments, and settings
  - repository APIs for creating jobs, listing jobs, updating progress/status, saving chunks, saving segments, loading transcripts
- [x] Add `packages/engine`:
  - `TranscriptionEngine` interface
  - ffmpeg probe wrapper
  - ffmpeg audio preparation/chunking wrapper
  - whisper.cpp CPU engine wrapper first
  - resource path resolver for `resources/engines/win32/whisper-cpu.exe`
- [x] Add `packages/runtime`:
  - reusable local job orchestration outside Electron/React
  - create jobs, prepare chunks, run CPU transcription, save segments, export transcripts
- [x] Add `packages/exporters`:
  - TXT, JSON, SRT, and VTT
- [x] Expand desktop IPC:
  - `jobs:create`
  - `jobs:list`
  - `jobs:get`
  - `jobs:cancel`
  - `transcripts:get`
  - `exports:create`
  - `system:get-engine-availability`
- [x] Update desktop UI:
  - real import button/file picker
  - job list
  - progress states
  - transcript segment rendering
  - export actions once data exists
- [x] Finish long-audio reliability:
  - [x] resume after interruption
  - [x] checkpoint recovery from completed chunks
  - [x] pause/resume state handling
  - [x] stream whisper.cpp progress while a chunk is running
  - [x] virtualized transcript viewer
- [x] Add agent-friendly surfaces after runtime reliability:
  - [x] first CLI pass for automation and testability
  - [x] structured JSONL runtime logs for desktop and CLI runs
  - [x] CLI defaults to the Electron dev data directory when running from the workspace
  - [x] MCP server second for agent workflows
  - optional local HTTP API later, opt-in and localhost-only
- [ ] Add machine profiles and hardware support:
  - [x] first machine profile detection for CPU cores, RAM, CUDA runtime, Vulkan runtime, and backend binaries
  - [x] recommended backend/model exposed through desktop Settings, CLI, and MCP
  - [x] user-facing performance presets exposed through desktop, CLI, and MCP
  - [x] model manager inventory/status UI for installed and missing local models
  - [ ] model download/install flow
  - [ ] real CUDA/Vulkan transcription engine selection after sidecar binaries are available
- [x] Add transcript editing persistence foundation:
  - [x] define edit contract schemas for transcript segment updates
  - [x] add storage repository APIs for updating segment text and edit metadata
  - [x] expose runtime methods for editing transcript text
  - [x] add typed desktop IPC/preload methods for transcript edits
  - [x] make transcript rows editable in the renderer
  - [x] keep playback seeking, active row highlighting, and virtualization working while editing
  - [x] make exports use edited transcript text automatically
  - [x] add tests for segment editing and export-after-edit behavior
- [x] Build real transcript editor UX first pass:
  - [x] direct text editing without an explicit edit button
  - [x] move seek behavior to timestamp/gutter controls so clicking transcript text edits instead of seeking
  - [x] define keyboard behavior: Enter commits/moves to next segment, Shift+Enter inserts a deliberate line break, Escape cancels, Ctrl/Command+S saves
  - [x] add autosave/debounce and visible saving/error state
  - [x] prevent playback follow/highlight from stealing focus while editing
  - [x] preserve virtualized rendering performance on large transcripts while editing
  - [x] keep TXT/JSON/SRT/VTT export behavior correct after edits
- [ ] Add transcript structure editing:
  - [ ] split one segment into two
  - [ ] merge adjacent segments
  - [ ] timestamp correction controls
  - [ ] validation for subtitle-safe timestamps and segment order
- [ ] Add advanced editor tools:
  - [ ] speaker labels
  - [ ] undo/redo edit history
  - [ ] find/replace inside transcript text
  - [ ] edit conflict handling if a job is still transcribing

## Build Order

1. **Plan document** - Done
   Created `docs/IMPLEMENTATION_PLAN.md`.

2. **Contracts** - Done
   Implement shared Zod schemas and exported TypeScript types. No Electron-specific imports.

3. **Core** - Done
   Implement job status transitions, model defaults, and chunking policy helpers.

4. **Storage** - Mostly done
   Add SQLite connection, migrations, and repositories. Store durable job, chunk, and transcript state from the start.

5. **Desktop IPC** - Done
   Wire typed IPC in main/preload/renderer. Renderer must not access filesystem, SQLite, ffmpeg, or Whisper directly.

6. **File import** - Done
   Use Electron file picker to create a job from a selected audio/video file.

7. **ffmpeg** - Done for probe and first preparation/chunking pass
   Add file probing first, then audio preparation/chunking.

8. **whisper.cpp CPU** - Done for first CPU path
   Add real CPU sidecar execution. Current implementation runs CPU transcription chunk-by-chunk, streams whisper.cpp progress output, and saves segments after each chunk.

9. **Long-audio reliability** - Done for first pass
   Add checkpointing, resume after interruption, cancel, and paused state handling.

   Current recovery scope:
   - Desktop startup recovers jobs left in `queued`, `preparing`, or `transcribing`.
   - Completed chunks stay completed.
   - Interrupted chunks are reset to `queued`.
   - CLI can trigger the same path with `npm run cli -- jobs recover`.

   Current pause/resume scope:
   - Runtime can pause active or queued jobs.
   - Active chunk is reset to `queued` on pause.
   - Runtime can resume paused jobs and continue from unfinished chunks.
   - Desktop UI exposes Pause/Resume actions.
   - CLI exposes `npm run cli -- jobs pause <jobId>` and `npm run cli -- jobs resume <jobId>`.

   Current transcript rendering scope:
   - Desktop transcript rows are virtualized so long transcripts do not mount every segment in the DOM.
   - SQLite still stores the full transcript; pagination can be added later if transcript payloads become very large.

10. **Exports** - Done
   Implement TXT and JSON, then SRT and VTT.

11. **Agent interface** - Done for CLI and MCP
   Add CLI first, then MCP server, both wrapping the runtime instead of renderer UI. Keep any local HTTP API optional and disabled by default.

   First CLI scope:
   - `npm run cli -- paths`
   - `npm run cli -- resources`
   - `npm run cli -- jobs list`
   - `npm run cli -- jobs status <jobId>`
  - `npm run cli -- jobs create <sourcePath>`
  - `npm run cli -- jobs run <jobId>`
  - `npm run cli -- jobs recover`
  - `npm run cli -- jobs pause <jobId>`
  - `npm run cli -- jobs resume <jobId>`
   - `npm run cli -- transcribe <sourcePath>`
   - `npm run cli -- transcript get <jobId>`
   - `npm run cli -- export <jobId> --format txt`
   - `npm run cli -- logs tail`
   - `npm run cli -- dev seed-transcript --segments 20000`

   MCP scope:
   - `npm run mcp`
   - `voxmire_paths`
   - `voxmire_resources`
   - `voxmire_machine_profile`
   - `voxmire_jobs_list`
   - `voxmire_jobs_status`
   - `voxmire_jobs_create`
   - `voxmire_jobs_run`
   - `voxmire_jobs_pause`
   - `voxmire_jobs_resume`
   - `voxmire_jobs_recover`
   - `voxmire_transcript_get`
   - `voxmire_export_transcript`
   - `voxmire_logs_tail`
   - `voxmire_dev_seed_transcript`

12. **Hardware profiles** - Started
   Machine detection, model inventory, backend selection, and performance presets are in place. Remaining hardware work is real CUDA/Vulkan sidecar execution after binaries and runtime DLLs are available.

13. **Synchronized audio playback** - Done for first pass
   The transcript editor now uses a safe `voxmire-media://` URL from main/preload, native audio playback, current-time/duration display, skip/seek controls, active segment highlighting, click-to-seek against virtualized transcript rows, direct byte-range streaming, volume/mute controls, and backend-generated waveform peaks. Remaining polish is manual-scroll follow behavior, waveform persistence, and wider media-container edge testing.

14. **Transcript editing** - Direct editor UX first pass done
   Transcript editing is a core product area, not a finished polish item. The completed foundation proves that edited segment text can be persisted safely through the approved architecture. The direct editor first pass makes the transcript text itself editable while keeping timestamps as the media seek target.

   Phase 1: persistence foundation - Done
   - Add shared contracts:
     - `updateTranscriptSegmentInputSchema`
     - `updateTranscriptSegmentResultSchema`
   - Add storage support:
     - migration columns `edited_at` and `original_text`
     - `updateTranscriptSegmentText(db, jobId, segmentId, text)`
     - keep `text` as the canonical export text
   - Add runtime support:
     - validate job/segment ownership before writing
     - log edit events for debugging
   - Add desktop bridge:
     - `transcripts:update-segment`
     - expose as `window.voxmire.transcripts.updateSegment(...)`
   - Add renderer UX:
     - click or explicit edit button enters edit mode for one segment
     - save on blur or Ctrl/Command+Enter
     - Escape cancels
     - keep normal click-to-seek behavior separate from text editing
     - prevent active playback scrolling from stealing focus while editing
   - Add export behavior:
     - TXT, JSON, SRT, and VTT read the edited `text` field with no separate export path

   Phase 2: direct editor UX - Done for first pass
   - Replaced the explicit edit-button flow with direct text editing.
   - Made transcript text the editable target.
   - Moved seek behavior to timestamps so editing and seeking do not fight each other.
   - Defined keyboard rules:
     - Enter commits and moves to the next segment by default.
     - Shift+Enter inserts a deliberate line break.
     - Escape cancels the active edit.
     - Ctrl/Command+S saves.
   - Added autosave/debounce with clear saving/error state.
   - Disabled playback auto-follow while the user is actively editing.
   - Kept virtualization stable for long transcripts.

   Phase 3: structure editing - Next
   - split and merge adjacent segments
   - timestamp correction
   - validation for segment order and subtitle-safe timings

   Phase 4: advanced editor tools - Planned
   - speaker labels
   - undo/redo edit history
   - find/replace
   - edit conflict handling if a job is still transcribing

15. **Packaging** - Planned
   Add electron-builder and resource packaging. Sidecar executables and runtime DLLs must be packaged outside ASAR under `process.resourcesPath/resources/...`.

## Test Plan

- Run after each implementation slice:
  - `npm run typecheck`
  - `corepack pnpm --filter @voxmire/desktop build`
- Add Vitest for package-level tests before core/storage logic grows.
- Test contracts with valid and invalid job, segment, model, and export payloads.
- Test core state transitions, including invalid transitions.
- Test storage repositories against a temporary SQLite database.
- Test transcript segment editing:
  - [x] updating one segment changes stored text
  - [x] edit metadata is written
  - [x] updating a missing segment returns a safe not-found result
  - generated source media paths are not touched
- Test exporters with fixed transcript fixtures.
- [x] Test exports after editing so TXT, JSON, SRT, and VTT use edited text.
- Manual desktop checks:
  - app opens
  - file picker creates a job
  - progress updates render
  - transcript segments appear incrementally
  - cancel works
  - completed transcript exports to TXT/JSON
  - segment text can be edited, canceled, and saved
  - editing does not break click-to-seek
  - playback follow does not steal focus while editing
- Agent checks:
  - CLI can resolve paths and resource status without Electron
  - CLI can list jobs
  - CLI can read structured runtime logs
  - CLI can create a transcription job without Electron
  - CLI can export transcript output
  - CLI can seed a large completed transcript for renderer stress testing
  - MCP tools return job IDs for long-running work and allow status polling
  - MCP smoke test starts the stdio server, lists tools, reads the machine profile, seeds a transcript, lists jobs, reads a transcript slice, and exports TXT
  - CLI can print the local machine profile with `npm run cli -- profile`
  - CLI can create jobs with `--preset balanced|fast|quality|low-memory` and optional `--backend cpu|cuda|vulkan`

## Assumptions

- First milestone uses the **real whisper.cpp CPU path**, not a mock pipeline.
- `docs/IMPLEMENTATION_PLAN.md` should be created as the source of truth.
- Web and mobile remain placeholders.
- No cloud transcription.
- `faster-whisper` remains optional future work.
- CPU fallback is mandatory; CUDA/Vulkan come later.
- Large model files and binaries are not committed unless explicitly intended.
- Agent interfaces must remain local-first and opt-in. Do not expose a network API by default.
