import { storageDB } from './db.js';

export const AppState = {
    tracksById: {},
    playlists: [],
    uiView: 'PLAYLISTS',         // 'PLAYLISTS' (overview) | 'PLAYLIST_DETAIL' (opened playlist)
    viewedPlaylistId: null,
    playingPlaylistId: null,
    currentIndex: 0,
    hasActiveSession: false,     // Tracks whether a song has been started
    isReorderMode: false,
    playbackState: 'STOPPED',    // 'STOPPED' | 'PLAYING' | 'PAUSED'
    currentTime: 0,
    duration: 135,
    volume: 0.8,
    isMuted: false,
    crackleEnabled: true,
    rpmMode: 33.3,
    shuffleEnabled: false,
    repeatMode: 'OFF',           // 'OFF' | 'ALL' | 'ONE'
    isDarkMode: false,
    isSeeking: false,
    artworkUploadCallback: null,
    pendingAddSongsPlaylistId: null
};

export function getPlayingPlaylist() {
    if (!AppState.playingPlaylistId) return null;
    return AppState.playlists.find(p => p.id === AppState.playingPlaylistId) || null;
}

export function getViewedPlaylist() {
    return AppState.playlists.find(p => p.id === AppState.viewedPlaylistId) || null;
}

export function getCurrentTrack() {
    const pl = getPlayingPlaylist();
    if (!pl || !pl.trackIds.length) return null;
    const tid = pl.trackIds[AppState.currentIndex] || pl.trackIds[0];
    return AppState.tracksById[tid] || null;
}

export async function persistState() {
    await storageDB.saveMetadata(AppState.tracksById, AppState.playlists);
}

// Lightweight ID3v2 Title/Artist parser for local files
export async function parseAudioTitleArtist(file) {
    const rawName = file.name.replace(/\.[^/.]+$/, '');
    let artist = 'Unknown Artist';
    let title = rawName;
    if (rawName.includes(' - ')) {
        const parts = rawName.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
    }

    try {
        const buffer = await file.slice(0, 65536).arrayBuffer();
        const view = new DataView(buffer);
        if (view.byteLength > 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
            const version = view.getUint8(3);
            const tagSize = ((view.getUint8(6) & 0x7f) << 21) |
                            ((view.getUint8(7) & 0x7f) << 14) |
                            ((view.getUint8(8) & 0x7f) << 7) |
                            (view.getUint8(9) & 0x7f);
            const limit = Math.min(view.byteLength, tagSize + 10);
            let offset = 10;

            while (offset + 10 < limit) {
                const frameID = String.fromCharCode(
                    view.getUint8(offset),
                    view.getUint8(offset + 1),
                    view.getUint8(offset + 2),
                    view.getUint8(offset + 3)
                );
                if (!/^[A-Z0-9]{4}$/.test(frameID)) break;

                let frameSize = version === 4
                    ? ((view.getUint8(offset + 4) & 0x7f) << 21) |
                      ((view.getUint8(offset + 5) & 0x7f) << 14) |
                      ((view.getUint8(offset + 6) & 0x7f) << 7) |
                      (view.getUint8(offset + 7) & 0x7f)
                    : view.getUint32(offset + 4);

                if (frameSize <= 0 || offset + 10 + frameSize > limit) break;

                if (frameID === 'TIT2' || frameID === 'TPE1') {
                    const encoding = view.getUint8(offset + 10);
                    const bytes = new Uint8Array(buffer, offset + 11, frameSize - 1);
                    let text = '';
                    if (encoding === 0 || encoding === 3) {
                        text = new TextDecoder('utf-8').decode(bytes);
                    } else if (encoding === 1 || encoding === 2) {
                        text = new TextDecoder('utf-16').decode(bytes);
                    }
                    text = text.replace(/\0/g, '').trim();
                    if (text) {
                        if (frameID === 'TIT2') title = text;
                        if (frameID === 'TPE1') artist = text;
                    }
                }
                offset += 10 + frameSize;
            }
        }
    } catch (e) {}

    return { title, artist };
}
