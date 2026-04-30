# Transcription Polish And Model Distribution Todo

Last updated: 2026-04-30

## Context

A 1 hour transcription test completed successfully with the current whisper.cpp runtime fallback work. The remaining work here is product polish and app distribution, not a blocker for the current CUDA runtime download path.

## CUDA Runtime Status

Status: beta-ready after one more clean-machine validation pass.

Implemented pieces:

- CUDA runtime is not bundled with the app installer.
- Settings can show CUDA as missing/downloadable.
- The app downloads the CUDA runtime from the runtime manifest URL.
- Downloaded runtime packages are SHA256 verified before install.
- Runtime packages are extracted to user app data under `resources/engines/<platform>/<runtimeId>/<version-folder>`.
- Temporary runtime download folders are cleaned after success/failure and stale startup leftovers are deleted on app startup.
- Runtime fallback remains CUDA, Vulkan, BLAS CPU, then plain CPU.

Validation checklist before calling this release-ready:

- Fresh Windows user profile with no user-installed CUDA runtime folder.
- Open Settings, confirm CUDA shows as downloadable.
- Download CUDA from the app.
- Restart the app and confirm CUDA is installed/available.
- Run a short transcription and confirm progress UI reports the CUDA runtime.
- Temporarily remove or break CUDA and confirm fallback still reaches Vulkan or CPU.

## Transcription Job Stats Todo

Goal: make long jobs explain what happened after transcription completes.

Add persisted metrics:

- Job processing started timestamp.
- Job processing completed timestamp.
- Active processing duration, excluding time spent paused if possible.
- Chunk count.
- Per-chunk started timestamp.
- Per-chunk completed timestamp.
- Per-chunk runtime id used.
- Per-chunk processing duration.
- Average chunk processing time.

Recommended display:

- In project/job details: `Processed in 12m 34s`.
- In project/job details: `7 chunks`.
- In project/job details: `Avg chunk 1m 47s`.
- Optional later: fastest chunk, slowest chunk, runtime fallback count.

Implementation notes:

- Do not derive processing time only from `createdAt` and `completedAt`; that includes queue time and pause time.
- Prefer adding explicit chunk `startedAt`/`completedAt` fields or a small job metrics table.
- If a chunk is retried with a fallback engine, only count the successful attempt in user-facing average time; log failed attempts separately.
- Keep renderer display read-only and derived from main/runtime/storage data.

## Progress Bar Todo

Problem: for a one-chunk job, the current progress bar can appear pinned near the initial transcription floor, so the user cannot see meaningful movement.

Desired behavior:

- Preparation/ffmpeg work: 0-10%.
- Transcription work: 10-99%.
- Completion: 100%.
- Single-chunk jobs should still move visibly from 10% toward 99%.
- Multi-chunk jobs should show total job progress based on chunk index plus current chunk progress.

Implementation notes:

- Pass `--print-progress` to `whisper-cli` so whisper.cpp emits progress lines consistently.
- Keep parsing whisper.cpp progress in the engine layer.
- For one chunk, map current chunk progress directly into the 10-99% transcription range.
- For many chunks, use `(completedChunks + currentChunkProgress) / totalChunks` mapped into the 10-99% range.
- Progress should reset only within the chunk internally; the displayed job progress should remain monotonic unless the job is explicitly restarted.

## Timestamp Field Width Todo

Problem: hour-scale timestamps can exceed the current compact text field width.

Desired behavior:

- Timestamp inputs should comfortably fit `HH:MM:SS.mmm`.
- Long jobs should not clip timestamps or force awkward horizontal scrolling.
- Mobile/narrow layouts should preserve readable timestamp editing without overlapping transcript text.

Implementation notes:

- Set a stable minimum width for timestamp fields based on the longest expected display format.
- Consider a responsive two-line segment header on narrow widths.
- Avoid changing transcript text sizing just to make timestamp fields fit.

## Model Distribution Plan

The app should eventually use the same pattern as CUDA runtimes for models, but as a separate model manager.

Recommended approach:

- Keep runtime packages and model packages in separate manifests or clearly separate manifest sections.
- Download public ggml models directly from Hugging Face using `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>` URLs.
- Do not embed Hugging Face credentials in the app.
- Public, non-gated model files should require no token.
- If private/gated models are ever supported, require a user-provided token and store it in OS credential storage, not in git, not in the app bundle, and not in a plain JSON settings file.
- Verify model SHA256 before install.
- Download into a temp folder, then move into the final user model directory only after verification.
- Reuse stale temp cleanup behavior so failed large model downloads do not leave dead files forever.
- Support split parts in the manifest even if the first version uses direct Hugging Face URLs.

Suggested user-facing model statuses:

- Bundled
- Installed
- Downloadable
- Downloading
- Update available
- Missing
- Checksum failed

## Initial Model Recommendation

Best default downloadable model: `large-v3-turbo`.

Reason:

- It is much smaller than `large-v3` in ggml form.
- It is much faster than full `large-v3`.
- It is the better practical default for consumer long-audio transcription.
- Full `large-v3` should be an optional quality model for users who explicitly want maximum quality and can afford the larger download and slower runtime.

Best bundled starter model candidate: `small-q5_1` or `small`.

Tradeoff:

- `small-q5_1` is a much smaller first-run model and keeps the app from shipping empty.
- `small` is larger but safer quality-wise than a heavily compressed model.
- `base` is small, but likely too weak as the first experience for long podcasts, accents, noise, or mixed audio.
- `large-v3-turbo-q5_0` is probably the best quality-per-byte option, but it is still around 547 MiB, so it may be too large for a lightweight starter bundle.

Current recommendation:

- Bundle `small-q5_1` only if installer size must stay low.
- Bundle full `small` if first-run quality matters more than installer size.
- Make `large-v3-turbo` the recommended download after first launch.
- Keep `large-v3` as an optional quality download, not the default.

## References

- Hugging Face ggml model repo: https://huggingface.co/ggerganov/whisper.cpp
- whisper.cpp README and model memory table: https://github.com/ggml-org/whisper.cpp/blob/master/README.md
- OpenAI `whisper-large-v3-turbo` model card: https://huggingface.co/openai/whisper-large-v3-turbo