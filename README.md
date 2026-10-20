# Video Quality Study

An anonymous, blinded, paired video quality study. The server holds50 fixed cases and assigns10 distinct cases per participant. Participants see a reference clip and versions A and B, then choose their preferred version.

## Study behavior

- Random participant IDs; no registration or personal information required.
- Ten fixed cases per participant, with balanced exposure across the50-case pool.
- Independently randomized A/B order, balanced five/five within each participant's assignments.
- The current reference/A/B triplet downloads completely before playback, with visible download progress. The next triplet preloads while reviewing; an in-memory cache retains at most six clips. Playback and seeking use complete local blobs rather than live network streams.
- Synchronized reference/A/B playback, replay, slow motion, frame stepping, zoom and fullscreen. All three pause together during decoding waits and resume when ready.
- Each trial displays its generation prompt, rendered as plain text.
- English and Chinese interfaces, mobile layout, and automatic durable vote saving.
- Participants judge A/B clarity, detail, naturalness, artifacts and temporal stability. The reference is available for viewing; similarity to it is not an evaluation criterion.
- Resume keys retain assignments and choices across reloads and server restarts.
- Start another response creates a new participant and ten trials while retaining the previous answers.
- Vote exports distinguish original and approximately10MB web media profiles. Existing results keep their original profile.
- Method names, source paths, original sample numbers, mappings and results stay on the server. Participant-facing media addresses use signed, opaque assignment IDs.
- Only the shared121-frame,24fps interval is evaluated. Playback does not include any format-adaptation tail frames.

## Run

Requires Node24 or newer; no dependency installation is needed.

```sh
export STUDY_PRIVATE_ROOT=/absolute/path/outside/this/repository
npm start
```

The private directory contains `study-manifest.json`, the media, `study.sqlite` and `server-secret`. Its manifest has exactly50 entries with keys `id`, `reference`, `first`, `second`, and `duration`; these paths point to verified local MP4 files. `active` must remain false until every file is verified and ready. The manifest and method mappings must not be committed to this public repository. The server refuses to alter the fixed cases after participation starts.

The default address is `http://127.0.0.1:8900`. Set `STUDY_HOST=0.0.0.0` only when deploying behind your own HTTPS proxy. Mount the private directory as persistent storage when using the Dockerfile.

Optional `prompts` in the private manifest maps case IDs to generation prompt text. This metadata can be updated without changing case assignments. An optional private `study-media-delivery.json` maps existing local media paths to HTTPS original-file URLs; A/B mappings remain unchanged and missing entries fall back to local streaming.

`config.js` points the static GitHub Pages frontend at the study API. Local previews use the same-origin API. The static frontend alone does not allocate trials or save votes; the backend and persistent storage must remain online. A temporary public tunnel is suitable for reviewing the site; long-running data collection should use a stable HTTPS host or a named tunnel with a fixed domain.

`STUDY_API_BASES` can specify alternate routes to the same backend and database. Requests try the current route first, with an eight-second timeout and failover on gateway or network errors. A connection failure is displayed separately from a study that is not yet active, with automatic and manual retry.

## Validate and export

```sh
npm test
STUDY_PRIVATE_ROOT=/path/to/private-study npm run export -- /path/to/private/results.json
```

The export is an owner-side command. It includes private A/B mappings and resolved method choices. Keep the export outside this repository. There is no public results or method-mapping endpoint.

API credentials are used by the separate offline generation process. They are never needed by participants or shipped to the frontend. Original archival videos remain unchanged. Optional `study-web-media.json` maps original paths to CPU-encoded web copies; signed URLs include the profile so caches cannot combine original and web bytes. A/B web copies use the same H.264 two-pass15Mbps policy, retain2560×1440 and24fps, and include the shared121-frame interval.
