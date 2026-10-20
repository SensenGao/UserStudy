# Video Quality Study

An anonymous, blinded, paired video quality study. The server holds50 fixed cases and assigns10 distinct cases per participant. Participants see a reference clip and versions A and B, then choose their preferred version.

## Study behavior

- Random participant IDs; no registration or personal information required.
- Ten fixed cases per participant, with balanced exposure across the50-case pool.
- Independently randomized A/B order, balanced five/five within each participant's assignments.
- Synchronized reference/A/B playback, replay, slow motion, frame stepping, zoom and fullscreen.
- English and Chinese interfaces, mobile layout, and automatic durable vote saving.
- Resume keys retain assignments and choices across reloads and server restarts.
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

`config.js` points the static GitHub Pages frontend at the study API. Local previews use the same-origin API. The static frontend alone does not allocate trials or save votes; the backend and persistent storage must remain online. A temporary public tunnel is suitable for reviewing the site; long-running data collection should use a stable HTTPS host or a named tunnel with a fixed domain.

## Validate and export

```sh
npm test
STUDY_PRIVATE_ROOT=/path/to/private-study npm run export -- /path/to/private/results.json
```

The export is an owner-side command. It includes private A/B mappings and resolved method choices. Keep the export outside this repository. There is no public results or method-mapping endpoint.

API credentials are used by the separate offline generation process. They are never needed by participants or shipped to the frontend. Media delivery removes audio and descriptive container metadata while copying the encoded video stream, preserving the compared pictures.
