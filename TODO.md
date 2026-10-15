# Spindle Music Player - Project TODO & Ideas

## 1. Visual & 3D Interactive Polish
- [ ] Audio-Reactive Visuals: Connect a Web Audio `AnalyserNode` to drive the strobe light, platter vibration, and analog VU needle meters on the turntable plinth based on actual frequencies.
- [ ] Pitch Fader Integration: Connect the 3D pitch fader to audio `playbackRate` for true vinyl pitch/tempo bending.
- [x] Interactive Tonearm / Needle Dropping: Drag the 3D tonearm onto specific vinyl grooves to seek track position, or click directly on grooves.
- [x] Distinct Needle Lift & Drop Sounds: Procedurally synthesized analog cartridge pop, micro-friction drag, and vinyl touchdown thuds for pausing, track ending, stopping, and manual needle cueing.
- [ ] Manual Vinyl Scrubbing / Scratching: Interactive disc nudging and scratch sound fx on drag.
- [ ] RPM Speed Switching: Functional 33⅓ vs 45 RPM toggle with realistic speed pitch shift.
- [ ] 3-Band Equalizer / Audio FX: Tactile tone knobs (Bass, Mid, Treble) linked to Web Audio BiquadFilterNodes.
- [ ] Resource & Memory Cleanup: Ensure WebGL textures, geometries, and canvas instances are disposed on track switch.
- [ ] Mobile/Touch UX: Prevent orbit controls conflict with tracklist scrolling.

## 2. Audio & Library Management
- [ ] Metadata Parsing: Integrate robust audio tag parsing (e.g. embedded album art, FLAC/Vorbis/ID3 tags).
- [ ] Storage Quota Management: Monitor browser/local storage limits for cached audio blobs.

## 3. Desktop Application Architecture (Cross-Platform)
- [x] Wrapped with Electron for a high-performance native desktop app (`npm run dev:desktop`, `npm run electron`).
- [x] Local filesystem storage for tracks in `~/Music/Spindle/<Playlist>/` with custom privileged `spindle-media://` range streaming protocol (supporting HTTP 206 seeking).

## 4. YouTube Music / URL Downloader Feature
- [x] Integrated `yt-dlp` and `ffmpeg` backend execution via IPC with real-time download and conversion progress streaming.
- [x] Accepts YouTube & YT Music URLs, extracts best-quality MP3 (320kbps / VBR 0), embeds album artwork and ID3 metadata.
- [x] Real-time UI modal with live video metadata preview (thumbnail, editable song title, artist, duration) and smooth progress bar.
- [x] Automatically indexes downloaded tracks into the Spindle playlist system, opens the playlist, drops the needle, and begins immediate 3D turntable playback.
- [x] Direct shortcuts added to opened playlist hero, playlists overview header, "Add Songs" modal, and 3-dot context menus ("Import from YouTube", "Show in File Manager").
