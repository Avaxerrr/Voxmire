# Architecture

## High-Level Model

```txt
Renderer UI
  |
  | typed IPC
  v
Preload Bridge
  |
  v
Electron Main
  |
  +--> packages/core
  +--> packages/contracts
  +--> packages/runtime
  |     +--> packages/engine
  |     +--> packages/storage
  |     +--> packages/exporters
  |
  +--> resources/engines
  +--> resources/ffmpeg
  +--> resources/models
```

## Layer Responsibilities

### Renderer

The renderer is the React UI. It should not directly access the filesystem, SQLite, ffmpeg, or Whisper binaries.

Responsibilities:

- Import UI
- Job dashboard
- Progress display
- Transcript viewer
- Settings UI
- Export commands
- Model manager UI

### Preload

The preload layer exposes a narrow, typed API to the renderer.

Example shape:

```ts
window.voxmire.jobs.create(input)
window.voxmire.jobs.pause(jobId)
window.voxmire.jobs.resume(jobId)
window.voxmire.jobs.cancel(jobId)
window.voxmire.transcripts.get(jobId)
window.voxmire.exports.create(jobId, format)
```

### Electron Main

The main process is the desktop adapter around the local runtime.

Responsibilities:

- Validate IPC inputs.
- Open native file dialogs.
- Create and configure the runtime.
- Forward IPC requests to runtime methods.
- Broadcast runtime progress events to renderer windows.
- Handle app lifecycle.

### Runtime Package

`packages/runtime` coordinates local transcription work without depending on Electron or React.

Responsibilities:

- Create source-file and job records.
- Run transcription jobs through `packages/engine`.
- Persist progress and transcript segments through `packages/storage`.
- Export transcripts through `packages/exporters`.
- Emit progress events through an injected callback.

This is the shared boundary for future headless or CLI execution.

### Core Package

`packages/core` contains product rules that do not depend on Electron.

Examples:

- Job state transitions
- Transcript segment model
- Chunking policy
- Model selection rules
- Retry and resume policy

### Engine Package

`packages/engine` hides implementation details of Whisper and ffmpeg.

The app should depend on an interface, not directly on a specific binary.

```ts
export interface TranscriptionEngine {
  id: string;
  detect(): Promise<EngineAvailability>;
  transcribe(input: TranscriptionInput): AsyncIterable<TranscriptionEvent>;
}
```

### Storage Package

`packages/storage` owns SQLite access and migrations.

The rest of the app should not build raw SQL strings throughout the codebase.

### Exporters Package

`packages/exporters` turns transcript data into output formats.

Initial formats:

- TXT
- SRT
- VTT
- JSON

Future formats:

- DOCX
- PDF
- Markdown

## Scaling Rule

Platform-specific code goes in `apps/*`.

Reusable product logic goes in `packages/*`.

This keeps future web and mobile work possible without forcing the desktop app to wait for those platforms.
