# Changelog

## 2.0.0 — 2026-11-01

### Added

- Import local audio into either A/B slot without requesting microphone access. Files stay in memory and are limited to 20 MB / 120 seconds.
- JSON practice-summary backups with complete validation, deduplicated merge, and retention of the latest 120 summaries.
- Captured target range shown for each clip; hit-rate differences are suppressed when ranges differ.

### Fixed

- Compute pitch deviation in a shared logarithmic cents coordinate, preserving octave changes and continuity across note boundaries. Live summary statistics use raw detected pitch rather than display smoothing.
- Preserve 1.x summaries with a legacy-algorithm label and add `statistics_version` to CSV exports.
- Reject corrupted local history/settings safely. Reject invalid analysis frame/hop sizes that could otherwise loop indefinitely.
- Close decoder contexts on success/failure; preserve old clips after failed imports; prevent stale asynchronous analysis from restoring deleted clips; preserve OGG/WAV/MP3 download extensions.
- Prevent duplicate microphone startup, release a stream when startup fails, and invalidate pending work when leaving the page.
- Restrict offline cache cleanup and request interception to VoxBloom, preserving sibling GitHub Pages applications.
- Make the development server compatible with Node 18; reject malformed URL escapes and paths outside the project directory.

### Compatibility

- Existing storage keys remain readable. Older deviation values are preserved and labeled; they cannot be recomputed without the original audio and should not be directly compared with the corrected metric.
- Microphone clips remain capped at 15 seconds. Imported audio support depends on the browser's native decoder. No audio is uploaded or persisted in browser storage.
