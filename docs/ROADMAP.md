# Roadmap

## Phase 1: Project Foundation

- Create monorepo structure.
- Add Electron desktop app.
- Add shared packages.
- Add root TypeScript config.
- Add linting and formatting.
- Add documentation.

## Phase 2: Local Transcription MVP

- Add file import.
- Add ffmpeg probing.
- Add audio normalization.
- Add SQLite database.
- Add job queue.
- Add whisper.cpp CPU engine.
- Store transcript segments.
- Display progress.
- Export TXT and JSON.

## Phase 3: Long Audio Reliability

- Chunk long audio.
- Persist checkpoints.
- Resume interrupted jobs.
- Add pause, resume, and cancel.
- Add crash recovery.
- Add virtualized transcript viewer.
- Export SRT and VTT.

## Phase 4: Machine Profiles

- Detect CPU capabilities.
- Detect NVIDIA/CUDA availability.
- Add Vulkan option.
- Add model manager.
- Recommend model based on hardware.
- Add performance presets.

## Phase 5: Polish

- Search transcript.
- Edit transcript text.
- Export presets.
- Recent files.
- Better progress estimates.
- App packaging and installer.
- Update flow.

## Future

- Optional faster-whisper backend.
- Optional web app.
- Optional mobile app.
- Speaker diarization if local quality is strong enough.
- Summary and cleanup features using local models.
