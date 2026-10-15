import { VINYL_COLORS } from './constants.js';
import { storageDB } from './db.js';
import { AppState, getPlayingPlaylist, getViewedPlaylist, getCurrentTrack, persistState, parseAudioTitleArtist } from './state.js';
import { audioEngine } from './audio.js';

let turntable3D = null;

export function setTurntable(instance) {
    turntable3D = instance;
}

export function getTurntable() {
    return turntable3D;
}

export function formatTime(sec) {
    if (!sec || isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTotalDuration(trackIds) {
    let total = 0;
    trackIds.forEach(id => {
        const t = AppState.tracksById[id];
        if (t && t.duration) total += t.duration;
    });
    return formatTime(total);
}

export function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Updates the bottom Now Playing bar (hidden until a song/playlist is started)
export function updatePlayerUI() {
    const nowPlayingSection = document.getElementById('now-playing-section');
    const stateBadge = document.getElementById('state-badge');
    const statusLed = document.getElementById('status-led');

    const track = getCurrentTrack();
    if (!AppState.hasActiveSession || !track) {
        nowPlayingSection.classList.add('hidden');
        nowPlayingSection.classList.remove('flex');
        if (stateBadge) {
            stateBadge.textContent = 'Stopped';
            stateBadge.className = 'font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-oatmeal text-muted border border-stone uppercase tracking-wider';
        }
        if (statusLed) {
            statusLed.className = 'w-2.5 h-2.5 rounded-full bg-stone shadow-sm';
        }
        return;
    }

    nowPlayingSection.classList.remove('hidden');
    nowPlayingSection.classList.add('flex');

    const playingPl = getPlayingPlaylist();
    document.getElementById('NowPlaying-playlist-name').textContent = playingPl ? playingPl.name : 'Playlist';
    document.getElementById('current-title').textContent = track.title;
    document.getElementById('current-artist').textContent = track.artist;

    const coverDisc = document.getElementById('cover-disc');
    coverDisc.style.background = `radial-gradient(circle, ${track.labelColor} 0%, ${track.labelColor} 28%, #141413 30%, #242424 46%, #111 48%, #292929 65%, #111 70%, #1c1c1c 100%)`;

    if (AppState.playbackState === 'PLAYING') {
        coverDisc.classList.add('playing');
    } else {
        coverDisc.classList.remove('playing');
    }

    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');

    if (AppState.playbackState === 'PLAYING') {
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
        if (stateBadge) {
            stateBadge.textContent = 'Playing';
            stateBadge.className = 'font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-terracotta/15 text-terracotta border border-terracotta/30 uppercase tracking-wider';
        }
        if (statusLed) {
            statusLed.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm animate-pulse';
        }
    } else if (AppState.playbackState === 'PAUSED') {
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
        if (stateBadge) {
            stateBadge.textContent = 'Paused';
            stateBadge.className = 'font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30 uppercase tracking-wider';
        }
        if (statusLed) {
            statusLed.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm';
        }
    } else {
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
        if (stateBadge) {
            stateBadge.textContent = 'Stopped';
            stateBadge.className = 'font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-oatmeal text-muted border border-stone uppercase tracking-wider';
        }
        if (statusLed) {
            statusLed.className = 'w-2.5 h-2.5 rounded-full bg-terracotta shadow-sm';
        }
    }

    const pct = AppState.duration > 0 ? (AppState.currentTime / AppState.duration) * 100 : 0;
    if (!AppState.isSeeking) {
        document.getElementById('seek-slider').value = Math.round(pct * 10);
    }
    document.getElementById('seek-fill').style.width = `${Math.min(100, pct)}%`;
    document.getElementById('time-current').textContent = formatTime(AppState.currentTime);
    document.getElementById('time-total').textContent = formatTime(AppState.duration);

    const btnShuffle = document.getElementById('btn-shuffle');
    btnShuffle.className = `p-1.5 rounded-xl transition active:scale-95 ${
        AppState.shuffleEnabled ? 'text-terracotta bg-oatmeal' : 'text-muted hover:text-espresso hover:bg-oatmeal'
    }`;

    const btnRepeat = document.getElementById('btn-repeat');
    const repeatOneBadge = document.getElementById('repeat-one-badge');
    btnRepeat.className = `p-1.5 rounded-xl transition active:scale-95 relative ${
        AppState.repeatMode !== 'OFF' ? 'text-terracotta bg-oatmeal' : 'text-muted hover:text-espresso hover:bg-oatmeal'
    }`;
    if (AppState.repeatMode === 'ONE') {
        repeatOneBadge.classList.remove('hidden');
    } else {
        repeatOneBadge.classList.add('hidden');
    }
}

// Renders the Sidebar: either Playlists Overview OR Opened Playlist (Top Hero + Songs List)
export function renderSidebarView() {
    const heroSection = document.getElementById('opened-playlist-hero');
    const overviewHeader = document.getElementById('playlists-overview-header');

    if (AppState.uiView === 'PLAYLISTS') {
        heroSection.classList.add('hidden');
        heroSection.classList.remove('flex');
        overviewHeader.classList.remove('hidden');
        document.getElementById('playlist-count').textContent = AppState.playlists.length;
        renderPlaylistsOverviewList();
    } else {
        const pl = getViewedPlaylist();
        if (!pl) {
            AppState.uiView = 'PLAYLISTS';
            renderSidebarView();
            return;
        }
        overviewHeader.classList.add('hidden');
        heroSection.classList.remove('hidden');
        heroSection.classList.add('flex');

        document.getElementById('hero-playlist-title').textContent = pl.name;
        document.getElementById('hero-playlist-meta').textContent = `${pl.trackIds.length} ${pl.trackIds.length === 1 ? 'song' : 'songs'} • ${formatTotalDuration(pl.trackIds)}`;

        const heroArt = document.getElementById('hero-playlist-artwork');
        if (pl.artwork) {
            heroArt.innerHTML = `<img src="${pl.artwork}" class="w-full h-full object-cover" alt="">`;
        } else {
            heroArt.innerHTML = `
                <div class="w-20 h-20 sm:w-22 sm:h-22 rounded-full border-4 border-neutral-800 flex items-center justify-center" style="background: radial-gradient(circle, ${pl.color || '#C85A32'} 0%, ${pl.color || '#C85A32'} 28%, #141413 30%, #222 45%, #111 47%, #292929 65%, #111 70%, #1c1c1c 100%);">
                    <div class="w-2.5 h-2.5 rounded-full bg-alabaster"></div>
                </div>
                <div class="absolute inset-0 bg-gradient-to-tr from-black/30 via-transparent to-white/10 pointer-events-none"></div>
            `;
        }

        const reorderBtn = document.getElementById('btn-toggle-reorder');
        const reorderLabel = document.getElementById('reorder-btn-label');
        if (AppState.isReorderMode) {
            reorderBtn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-terracotta bg-terracotta text-alabaster text-xs font-medium transition active:scale-95';
            reorderLabel.textContent = 'Done';
        } else {
            reorderBtn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone bg-alabaster hover:bg-oatmeal text-espresso text-xs font-medium transition active:scale-95';
            reorderLabel.textContent = 'Reorder';
        }

        renderOpenedPlaylistTracks(pl);
    }
}

export function createPlaylistRow(pl) {
    const isSelected = AppState.hasActiveSession && pl.id === AppState.playingPlaylistId;
    const isPlaying = isSelected && AppState.playbackState === 'PLAYING';

    const row = document.createElement('div');
    row.className = `group flex items-center justify-between px-3.5 py-2.5 rounded-2xl cursor-pointer transition-all border ${
        isSelected
            ? 'bg-alabaster border-stone shadow-sm'
            : 'bg-transparent border-transparent hover:bg-alabaster/60 hover:border-stone/40'
    }`;

    const artworkHtml = pl.artwork
        ? `<div class="w-10 h-10 rounded-xl overflow-hidden shrink-0 relative border border-stone">
            <img src="${pl.artwork}" class="w-full h-full object-cover" alt="">
           </div>`
        : `<div class="w-10 h-10 rounded-xl bg-espresso flex items-center justify-center shrink-0 relative border border-stone">
            <div class="w-7 h-7 rounded-full flex items-center justify-center" style="background: radial-gradient(circle, ${pl.color || '#C85A32'} 0%, ${pl.color || '#C85A32'} 35%, #1E1B18 38%, #1E1B18 100%);">
                ${
                    isPlaying
                        ? `<div class="flex items-end gap-0.5 h-3">
                            <span class="w-0.5 bg-alabaster eq-bar-1"></span>
                            <span class="w-0.5 bg-alabaster eq-bar-2"></span>
                            <span class="w-0.5 bg-alabaster eq-bar-3"></span>
                           </div>`
                        : `<div class="w-1.5 h-1.5 rounded-full bg-alabaster"></div>`
                }
            </div>
           </div>`;

    row.innerHTML = `
        <div class="flex items-center gap-3.5 min-w-0 flex-1">
            ${artworkHtml}
            <div class="flex flex-col min-w-0 flex-1">
                <span class="text-sm font-medium ${isSelected ? 'text-terracotta font-semibold' : 'text-espresso'} truncate">
                    ${escapeHtml(pl.name)}
                </span>
                <span class="text-xs text-muted truncate">${pl.trackIds.length} ${pl.trackIds.length === 1 ? 'song' : 'songs'}</span>
            </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 ml-2">
            <span class="font-mono text-xs text-muted">${formatTotalDuration(pl.trackIds)}</span>
            <button class="btn-pl-menu p-1.5 rounded-xl text-muted hover:text-espresso hover:bg-oatmeal transition" title="Playlist Options">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                </svg>
            </button>
        </div>
    `;

    row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-pl-menu')) return;
        openPlaylist(pl.id);
    });

    row.querySelector('.btn-pl-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        openPlaylistContextMenu(e.currentTarget, pl);
    });

    return row;
}

export function createSearchResultTrackRow(pl, track, idx) {
    const isSelected = AppState.hasActiveSession && (pl.id === AppState.playingPlaylistId && idx === AppState.currentIndex);
    const isPlaying = isSelected && AppState.playbackState === 'PLAYING';

    const row = document.createElement('div');
    row.className = `group flex items-center justify-between px-3.5 py-2.5 rounded-2xl cursor-pointer transition-all border ${
        isSelected
            ? 'bg-alabaster border-stone shadow-sm'
            : 'bg-transparent border-transparent hover:bg-alabaster/60 hover:border-stone/40'
    }`;

    row.innerHTML = `
        <div class="flex items-center gap-3.5 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 relative" style="background: radial-gradient(circle, ${track.labelColor} 0%, ${track.labelColor} 35%, #1E1B18 38%, #1E1B18 100%);">
                ${
                    isPlaying
                        ? `<div class="flex items-end gap-0.5 h-3.5">
                            <span class="w-0.5 bg-alabaster eq-bar-1"></span>
                            <span class="w-0.5 bg-alabaster eq-bar-2"></span>
                            <span class="w-0.5 bg-alabaster eq-bar-3"></span>
                           </div>`
                        : `<div class="w-1.5 h-1.5 rounded-full bg-alabaster"></div>`
                }
            </div>

            <div class="flex flex-col min-w-0 flex-1">
                <span class="text-sm font-medium ${isSelected ? 'text-terracotta font-semibold' : 'text-espresso'} truncate">
                    ${escapeHtml(track.title)}
                </span>
                <span class="text-xs text-muted truncate">
                    ${escapeHtml(track.artist)} • <span class="text-espresso/70">${escapeHtml(pl.name)}</span>
                </span>
            </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 ml-2">
            <span class="font-mono text-xs text-muted">${formatTime(track.duration)}</span>
        </div>
    `;

    row.addEventListener('click', () => {
        AppState.playingPlaylistId = pl.id;
        AppState.viewedPlaylistId = pl.id;
        AppState.uiView = 'PLAYLIST_DETAIL';
        renderSidebarView();
        selectAndPlayTrack(idx);
    });

    return row;
}

export function renderPlaylistsOverviewList() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = '';

    const query = (AppState.searchQuery || '').trim().toLowerCase();

    // Normal overview (no search active)
    if (!query) {
        AppState.playlists.forEach((pl) => {
            container.appendChild(createPlaylistRow(pl));
        });
        return;
    }

    // Searching: filter matching playlists
    const matchingPlaylists = AppState.playlists.filter(pl => {
        if (pl.name.toLowerCase().includes(query)) return true;
        return pl.trackIds.some(tid => {
            const t = AppState.tracksById[tid];
            return t && (t.title.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query));
        });
    });

    // Find all matching songs across playlists
    const matchingSongs = [];
    const seenSongs = new Set();
    AppState.playlists.forEach(pl => {
        pl.trackIds.forEach((tid, idx) => {
            const track = AppState.tracksById[tid];
            if (!track) return;
            if (track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query)) {
                const key = `${pl.id}-${tid}-${idx}`;
                if (!seenSongs.has(key)) {
                    seenSongs.add(key);
                    matchingSongs.push({ pl, track, idx });
                }
            }
        });
    });

    if (matchingPlaylists.length === 0 && matchingSongs.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 px-4">
                <p class="text-sm font-medium text-espresso">No matches found</p>
                <p class="text-xs text-muted mt-1">No playlists or songs matching "${escapeHtml(AppState.searchQuery)}"</p>
            </div>
        `;
        return;
    }

    if (matchingPlaylists.length > 0) {
        const header = document.createElement('div');
        header.className = 'px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-muted font-medium';
        header.textContent = `Playlists (${matchingPlaylists.length})`;
        container.appendChild(header);

        matchingPlaylists.forEach(pl => {
            container.appendChild(createPlaylistRow(pl));
        });
    }

    if (matchingSongs.length > 0) {
        const header = document.createElement('div');
        header.className = 'px-3 pt-3 pb-1.5 text-[11px] font-mono uppercase tracking-wider text-muted font-medium';
        header.textContent = `Songs (${matchingSongs.length})`;
        container.appendChild(header);

        matchingSongs.forEach(({ pl, track, idx }) => {
            container.appendChild(createSearchResultTrackRow(pl, track, idx));
        });
    }
}

export function openPlaylist(playlistId) {
    AppState.viewedPlaylistId = playlistId;
    AppState.uiView = 'PLAYLIST_DETAIL';
    AppState.isReorderMode = false;
    renderSidebarView();

    if (turntable3D) {
        turntable3D.setCameraView(AppState.hasActiveSession ? 'top' : 'side');
    }
}

export function renderOpenedPlaylistTracks(pl) {
    const container = document.getElementById('playlist-container');
    container.innerHTML = '';

    const query = (AppState.searchQuery || '').trim().toLowerCase();

    if (pl.trackIds.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 px-4">
                <p class="text-sm font-medium text-espresso">No songs in this playlist</p>
                <p class="text-xs text-muted mt-1">Click "Add Songs" above or drag audio files here.</p>
            </div>
        `;
        return;
    }

    const allEntries = pl.trackIds
        .map((trackId, idx) => ({ trackId, idx, track: AppState.tracksById[trackId] }))
        .filter(item => item.track);

    const filteredEntries = query
        ? allEntries.filter(({ track }) => {
            return track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query);
        })
        : allEntries;

    if (query && filteredEntries.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 px-4">
                <p class="text-sm font-medium text-espresso">No matching songs in "${escapeHtml(pl.name)}"</p>
                <p class="text-xs text-muted mt-1">No songs matching "${escapeHtml(AppState.searchQuery)}"</p>
                <button id="btn-search-all-pl" class="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-stone bg-oatmeal/70 hover:bg-oatmeal text-xs font-medium text-espresso transition active:scale-95">
                    Search all playlists & songs
                </button>
            </div>
        `;
        container.querySelector('#btn-search-all-pl')?.addEventListener('click', () => {
            AppState.uiView = 'PLAYLISTS';
            renderSidebarView();
        });
        return;
    }

    if (query && filteredEntries.length > 0) {
        const searchHeader = document.createElement('div');
        searchHeader.className = 'flex items-center justify-between px-3 pb-2 text-[11px] font-mono text-muted';
        searchHeader.innerHTML = `
            <span>Showing ${filteredEntries.length} of ${allEntries.length} songs</span>
            <button id="btn-search-all-link" class="hover:text-espresso underline">Search all</button>
        `;
        searchHeader.querySelector('#btn-search-all-link')?.addEventListener('click', () => {
            AppState.uiView = 'PLAYLISTS';
            renderSidebarView();
        });
        container.appendChild(searchHeader);
    }

    const isReorderActive = AppState.isReorderMode && !query;

    filteredEntries.forEach(({ track, idx }) => {
        const isSelected = AppState.hasActiveSession && (pl.id === AppState.playingPlaylistId && idx === AppState.currentIndex);
        const isPlaying = isSelected && AppState.playbackState === 'PLAYING';

        const row = document.createElement('div');
        row.dataset.index = idx;
        row.draggable = isReorderActive;
        row.className = `group flex items-center justify-between px-3.5 py-2.5 rounded-2xl cursor-pointer transition-all border ${
            isReorderActive
                ? 'bg-alabaster/90 border-stone border-dashed cursor-move hover:border-terracotta'
                : isSelected
                    ? 'bg-alabaster border-stone shadow-sm'
                    : 'bg-transparent border-transparent hover:bg-alabaster/60 hover:border-stone/40'
        }`;

        row.innerHTML = `
            <div class="flex items-center gap-3.5 min-w-0 flex-1">
                ${
                    isReorderActive
                        ? `<div class="text-muted hover:text-espresso cursor-grab active:cursor-grabbing" title="Drag to reorder">
                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                                <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                                <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                            </svg>
                           </div>`
                        : ''
                }

                <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 relative" style="background: radial-gradient(circle, ${track.labelColor} 0%, ${track.labelColor} 35%, #1E1B18 38%, #1E1B18 100%);">
                    ${
                        isPlaying
                            ? `<div class="flex items-end gap-0.5 h-3.5">
                                <span class="w-0.5 bg-alabaster eq-bar-1"></span>
                                <span class="w-0.5 bg-alabaster eq-bar-2"></span>
                                <span class="w-0.5 bg-alabaster eq-bar-3"></span>
                               </div>`
                            : `<div class="w-1.5 h-1.5 rounded-full bg-alabaster"></div>`
                    }
                </div>

                <div class="flex flex-col min-w-0 flex-1">
                    <span class="text-sm font-medium ${isSelected ? 'text-terracotta font-semibold' : 'text-espresso'} truncate">
                        ${escapeHtml(track.title)}
                    </span>
                    <span class="text-xs text-muted truncate">${escapeHtml(track.artist)}</span>
                </div>
            </div>

            <div class="flex items-center gap-2 shrink-0 ml-2">
                ${
                    isReorderActive
                        ? `
                        <button class="btn-move-up p-1 rounded-lg bg-oatmeal hover:bg-stone text-espresso disabled:opacity-30 transition" ${idx === 0 ? 'disabled' : ''} title="Move Up">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/>
                            </svg>
                        </button>
                        <button class="btn-move-down p-1 rounded-lg bg-oatmeal hover:bg-stone text-espresso disabled:opacity-30 transition" ${idx === pl.trackIds.length - 1 ? 'disabled' : ''} title="Move Down">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
                            </svg>
                        </button>
                        `
                        : `
                        <span class="font-mono text-xs text-muted">${formatTime(track.duration)}</span>
                        <button class="btn-song-menu p-1.5 rounded-xl text-muted hover:text-espresso hover:bg-oatmeal transition" title="Song Options">
                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                            </svg>
                        </button>
                        `
                }
            </div>
        `;

        if (isReorderActive) {
            const upBtn = row.querySelector('.btn-move-up');
            const downBtn = row.querySelector('.btn-move-down');
            if (upBtn) {
                upBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveTrackInPlaylist(pl.id, idx, idx - 1);
                });
            }
            if (downBtn) {
                downBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveTrackInPlaylist(pl.id, idx, idx + 1);
                });
            }

            row.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
                row.classList.add('opacity-40');
            });

            row.addEventListener('dragend', () => {
                row.classList.remove('opacity-40');
                container.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                const rect = row.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                row.classList.remove('drag-over-top', 'drag-over-bottom');
                if (e.clientY < midY) {
                    row.classList.add('drag-over-top');
                } else {
                    row.classList.add('drag-over-bottom');
                }
            });

            row.addEventListener('dragleave', () => {
                row.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over-top', 'drag-over-bottom');
                const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                if (isNaN(fromIdx) || fromIdx === idx) return;

                const rect = row.getBoundingClientRect();
                const dropAfter = e.clientY >= rect.top + rect.height / 2;
                let toIdx = dropAfter ? idx + 1 : idx;
                if (fromIdx < toIdx) toIdx--;
                moveTrackInPlaylist(pl.id, fromIdx, toIdx);
            });
        } else {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.btn-song-menu')) return;
                AppState.playingPlaylistId = pl.id;
                selectAndPlayTrack(idx);
            });

            row.querySelector('.btn-song-menu')?.addEventListener('click', (e) => {
                e.stopPropagation();
                openSongContextMenu(e.currentTarget, pl, track, idx);
            });
        }

        container.appendChild(row);
    });
}

export function moveTrackInPlaylist(playlistId, fromIdx, toIdx) {
    const pl = AppState.playlists.find(p => p.id === playlistId);
    if (!pl || toIdx < 0 || toIdx >= pl.trackIds.length || fromIdx === toIdx) return;

    const isPlayingThisPl = (AppState.playingPlaylistId === playlistId);
    const activeIdx = AppState.currentIndex;

    const [movedId] = pl.trackIds.splice(fromIdx, 1);
    pl.trackIds.splice(toIdx, 0, movedId);

    if (isPlayingThisPl) {
        if (activeIdx === fromIdx) {
            AppState.currentIndex = toIdx;
        } else if (fromIdx < activeIdx && toIdx >= activeIdx) {
            AppState.currentIndex--;
        } else if (fromIdx > activeIdx && toIdx <= activeIdx) {
            AppState.currentIndex++;
        }
    }

    persistState();
    renderSidebarView();
}

// 3-Dot Context Menus
export function closeContextMenu() {
    const contextMenuEl = document.getElementById('context-menu');
    contextMenuEl.classList.add('hidden');
    contextMenuEl.innerHTML = '';
}

export function positionContextMenu(triggerBtn) {
    const contextMenuEl = document.getElementById('context-menu');
    const rect = triggerBtn.getBoundingClientRect();
    contextMenuEl.classList.remove('hidden');
    const menuWidth = 195;
    const menuHeight = contextMenuEl.offsetHeight || 150;

    let left = rect.right - menuWidth;
    let top = rect.bottom + 6;
    if (left < 12) left = 12;
    if (top + menuHeight > window.innerHeight - 12) {
        top = rect.top - menuHeight - 6;
    }
    contextMenuEl.style.left = `${left}px`;
    contextMenuEl.style.top = `${top}px`;
}

export function openPlaylistContextMenu(triggerBtn, playlist) {
    const isDesktop = typeof window !== 'undefined' && !!window.spindleDesktop;
    const contextMenuEl = document.getElementById('context-menu');
    contextMenuEl.innerHTML = `
        <button data-action="import-yt" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <svg class="w-3.5 h-3.5 text-terracotta" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
            <span>Import from YouTube</span>
        </button>
        <button data-action="rename" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <span>Rename</span>
        </button>
        <button data-action="artwork" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <span>Change Artwork</span>
        </button>
        ${isDesktop ? `
        <button data-action="open-folder" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <svg class="w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
            <span>Show in File Manager</span>
        </button>
        ` : ''}
        <div class="my-1 border-t border-stone/40"></div>
        <button data-action="remove" class="w-full text-left px-3.5 py-2 hover:bg-red-500/10 text-red-600 flex items-center gap-2.5 transition">
            <span>Remove</span>
        </button>
    `;
    positionContextMenu(triggerBtn);

    contextMenuEl.querySelector('[data-action="import-yt"]').onclick = () => {
        closeContextMenu();
        showYoutubeImportModal(playlist.id);
    };
    contextMenuEl.querySelector('[data-action="rename"]').onclick = () => {
        closeContextMenu();
        showRenamePlaylistModal(playlist);
    };
    contextMenuEl.querySelector('[data-action="artwork"]').onclick = () => {
        closeContextMenu();
        showChangePlaylistArtworkModal(playlist);
    };
    if (isDesktop && contextMenuEl.querySelector('[data-action="open-folder"]')) {
        contextMenuEl.querySelector('[data-action="open-folder"]').onclick = () => {
            closeContextMenu();
            window.spindleDesktop.openMusicFolder(playlist.name);
        };
    }
    contextMenuEl.querySelector('[data-action="remove"]').onclick = () => {
        closeContextMenu();
        removePlaylist(playlist.id);
    };
}

export function openSongContextMenu(triggerBtn, playlist, track, index) {
    const isDesktop = typeof window !== 'undefined' && !!window.spindleDesktop;
    const contextMenuEl = document.getElementById('context-menu');
    contextMenuEl.innerHTML = `
        <button data-action="edit" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <span>Edit Song Info</span>
        </button>
        <button data-action="copy-to" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <span>Add to Another Playlist</span>
        </button>
        <button data-action="reorder" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <span>Reorder Playlist</span>
        </button>
        ${isDesktop && track.filePath ? `
        <button data-action="show-file" class="w-full text-left px-3.5 py-2 hover:bg-oatmeal flex items-center gap-2.5 transition">
            <svg class="w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
            <span>Show File in Folder</span>
        </button>
        ` : ''}
        <div class="my-1 border-t border-stone/40"></div>
        <button data-action="remove-song" class="w-full text-left px-3.5 py-2 hover:bg-red-500/10 text-red-600 flex items-center gap-2.5 transition">
            <span>Remove from Playlist</span>
        </button>
    `;
    positionContextMenu(triggerBtn);

    contextMenuEl.querySelector('[data-action="edit"]').onclick = () => {
        closeContextMenu();
        showEditTrackModal(track);
    };
    contextMenuEl.querySelector('[data-action="copy-to"]').onclick = () => {
        closeContextMenu();
        showCopyTrackToPlaylistModal(track);
    };
    contextMenuEl.querySelector('[data-action="reorder"]').onclick = () => {
        closeContextMenu();
        AppState.isReorderMode = true;
        renderSidebarView();
    };
    if (isDesktop && contextMenuEl.querySelector('[data-action="show-file"]')) {
        contextMenuEl.querySelector('[data-action="show-file"]').onclick = () => {
            closeContextMenu();
            window.spindleDesktop.openMusicFolder(playlist.name);
        };
    }
    contextMenuEl.querySelector('[data-action="remove-song"]').onclick = () => {
        closeContextMenu();
        removeSongFromPlaylist(playlist.id, index);
    };
}

export function removePlaylist(playlistId) {
    if (AppState.playlists.length <= 1) {
        alert('You must keep at least one playlist.');
        return;
    }
    const idx = AppState.playlists.findIndex(p => p.id === playlistId);
    if (idx === -1) return;

    const wasPlaying = (AppState.playingPlaylistId === playlistId);
    AppState.playlists.splice(idx, 1);

    if (wasPlaying) {
        stopPlayback();
        AppState.playingPlaylistId = null;
        AppState.hasActiveSession = false;
        AppState.currentIndex = 0;
    }
    if (AppState.viewedPlaylistId === playlistId) {
        AppState.viewedPlaylistId = null;
        AppState.uiView = 'PLAYLISTS';
    }

    persistState();
    renderSidebarView();
    updatePlayerUI();
}

export function removeSongFromPlaylist(playlistId, songIndex) {
    const pl = AppState.playlists.find(p => p.id === playlistId);
    if (!pl) return;

    const isPlayingThisPl = (AppState.playingPlaylistId === playlistId);
    pl.trackIds.splice(songIndex, 1);

    if (isPlayingThisPl) {
        if (pl.trackIds.length === 0) {
            stopPlayback();
            AppState.hasActiveSession = false;
            AppState.currentIndex = 0;
        } else if (songIndex === AppState.currentIndex) {
            AppState.currentIndex = Math.min(songIndex, pl.trackIds.length - 1);
            if (AppState.playbackState === 'PLAYING') {
                selectAndPlayTrack(AppState.currentIndex);
            }
        } else if (songIndex < AppState.currentIndex) {
            AppState.currentIndex--;
        }
    }

    persistState();
    renderSidebarView();
    updatePlayerUI();
}

// Modals
export function openModal(title, htmlContent) {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    modalTitle.textContent = title;
    modalBody.innerHTML = htmlContent;
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.classList.add('flex');
}

export function closeModal() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalBody = document.getElementById('modal-body');

    modalBackdrop.classList.add('hidden');
    modalBackdrop.classList.remove('flex');
    modalBody.innerHTML = '';
}

export function showCreatePlaylistModal() {
    const modalBody = document.getElementById('modal-body');
    let selectedColor = VINYL_COLORS[0].label;
    let customArtwork = null;

    openModal('Create Playlist', `
        <div class="space-y-4">
            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-1">Playlist Name</label>
                <input id="input-pl-name" type="text" placeholder="e.g. Late Night Sessions" class="w-full px-3.5 py-2 rounded-xl bg-oatmeal/60 border border-stone text-sm text-espresso focus:outline-none focus:border-terracotta">
            </div>
            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-2">Artwork or Color</label>
                <div class="flex items-center gap-3">
                    <div id="create-art-preview" class="w-14 h-14 rounded-2xl bg-espresso border border-stone overflow-hidden shrink-0 flex items-center justify-center">
                        <div class="w-10 h-10 rounded-full" style="background: radial-gradient(circle, ${selectedColor} 0%, ${selectedColor} 35%, #111 38%, #111 100%);"></div>
                    </div>
                    <div class="flex-1 space-y-2">
                        <div class="flex flex-wrap gap-2" id="color-swatches">
                            ${VINYL_COLORS.map((c, i) => `
                                <button type="button" data-color="${c.label}" class="w-6 h-6 rounded-full border-2 ${i === 0 ? 'border-terracotta scale-110' : 'border-transparent'} transition" style="background: ${c.label}" title="${c.name}"></button>
                            `).join('')}
                        </div>
                        <button type="button" id="btn-create-upload-art" class="px-2.5 py-1 rounded-lg border border-stone bg-alabaster hover:bg-oatmeal text-xs font-mono text-espresso transition">
                            Upload Artwork...
                        </button>
                    </div>
                </div>
            </div>
            <div class="pt-2 flex justify-end gap-2">
                <button type="button" id="btn-cancel-modal" class="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:bg-oatmeal transition">Cancel</button>
                <button type="button" id="btn-save-pl" class="px-5 py-2 rounded-xl bg-terracotta text-alabaster hover:bg-[#b04b25] text-xs font-medium transition shadow-sm">Create</button>
            </div>
        </div>
    `);

    const nameInput = modalBody.querySelector('#input-pl-name');
    const preview = modalBody.querySelector('#create-art-preview');
    nameInput.focus();

    modalBody.querySelectorAll('#color-swatches button').forEach(btn => {
        btn.onclick = () => {
            selectedColor = btn.dataset.color;
            customArtwork = null;
            preview.innerHTML = `<div class="w-10 h-10 rounded-full" style="background: radial-gradient(circle, ${selectedColor} 0%, ${selectedColor} 35%, #111 38%, #111 100%);"></div>`;
            modalBody.querySelectorAll('#color-swatches button').forEach(b => b.classList.remove('border-terracotta', 'scale-110'));
            btn.classList.add('border-terracotta', 'scale-110');
        };
    });

    modalBody.querySelector('#btn-create-upload-art').onclick = () => {
        AppState.artworkUploadCallback = (dataUrl) => {
            customArtwork = dataUrl;
            preview.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover">`;
        };
        document.getElementById('file-upload-artwork').click();
    };

    modalBody.querySelector('#btn-cancel-modal').onclick = closeModal;
    const saveFn = () => {
        const name = nameInput.value.trim() || `Playlist #${AppState.playlists.length + 1}`;
        const newPl = {
            id: 'pl-' + Date.now(),
            name,
            color: selectedColor,
            artwork: customArtwork,
            trackIds: []
        };
        AppState.playlists.push(newPl);
        persistState();
        closeModal();
        openPlaylist(newPl.id);
    };
    modalBody.querySelector('#btn-save-pl').onclick = saveFn;
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveFn();
    });
}

export function showRenamePlaylistModal(playlist) {
    const modalBody = document.getElementById('modal-body');
    openModal('Rename Playlist', `
        <div class="space-y-4">
            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-1">Playlist Name</label>
                <input id="input-rename-pl" type="text" value="${escapeHtml(playlist.name)}" class="w-full px-3.5 py-2 rounded-xl bg-oatmeal/60 border border-stone text-sm text-espresso focus:outline-none focus:border-terracotta">
            </div>
            <div class="pt-2 flex justify-end gap-2">
                <button type="button" id="btn-cancel-modal" class="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:bg-oatmeal transition">Cancel</button>
                <button type="button" id="btn-save-rename" class="px-5 py-2 rounded-xl bg-terracotta text-alabaster hover:bg-[#b04b25] text-xs font-medium transition shadow-sm">Save</button>
            </div>
        </div>
    `);

    const input = modalBody.querySelector('#input-rename-pl');
    input.focus();
    input.select();

    const saveFn = () => {
        const val = input.value.trim();
        if (val) {
            playlist.name = val;
            persistState();
            renderSidebarView();
            updatePlayerUI();
        }
        closeModal();
    };

    modalBody.querySelector('#btn-cancel-modal').onclick = closeModal;
    modalBody.querySelector('#btn-save-rename').onclick = saveFn;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveFn();
    });
}

export function showChangePlaylistArtworkModal(playlist) {
    const modalBody = document.getElementById('modal-body');
    let chosenColor = playlist.color || VINYL_COLORS[0].label;
    let chosenArtwork = playlist.artwork || null;

    openModal('Change Playlist Artwork', `
        <div class="space-y-4">
            <div class="flex items-center gap-4">
                <div id="art-preview" class="w-20 h-20 rounded-2xl bg-espresso border border-stone overflow-hidden shrink-0 flex items-center justify-center">
                    ${chosenArtwork
                        ? `<img src="${chosenArtwork}" class="w-full h-full object-cover">`
                        : `<div class="w-14 h-14 rounded-full" style="background: radial-gradient(circle, ${chosenColor} 0%, ${chosenColor} 35%, #111 38%, #111 100%);"></div>`
                    }
                </div>
                <div class="flex flex-col gap-2">
                    <button type="button" id="btn-pick-art" class="px-3.5 py-1.5 rounded-xl bg-terracotta text-alabaster hover:bg-[#b04b25] text-xs font-medium transition">
                        Upload Image...
                    </button>
                    <button type="button" id="btn-reset-art" class="px-3.5 py-1 rounded-xl border border-stone text-xs text-muted hover:text-espresso transition">
                        Reset to Default
                    </button>
                </div>
            </div>
            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-2">Or Pick Accent Color</label>
                <div class="flex flex-wrap gap-2.5" id="art-swatches">
                    ${VINYL_COLORS.map(c => `
                        <button type="button" data-color="${c.label}" class="w-7 h-7 rounded-full border-2 ${c.label === chosenColor ? 'border-terracotta scale-110' : 'border-transparent'} transition" style="background: ${c.label}"></button>
                    `).join('')}
                </div>
            </div>
            <div class="pt-2 flex justify-end gap-2">
                <button type="button" id="btn-cancel-modal" class="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:bg-oatmeal transition">Cancel</button>
                <button type="button" id="btn-save-art" class="px-5 py-2 rounded-xl bg-terracotta text-alabaster hover:bg-[#b04b25] text-xs font-medium transition shadow-sm">Save</button>
            </div>
        </div>
    `);

    const preview = modalBody.querySelector('#art-preview');

    modalBody.querySelector('#btn-pick-art').onclick = () => {
        AppState.artworkUploadCallback = (dataUrl) => {
            chosenArtwork = dataUrl;
            preview.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover">`;
        };
        document.getElementById('file-upload-artwork').click();
    };

    modalBody.querySelector('#btn-reset-art').onclick = () => {
        chosenArtwork = null;
        preview.innerHTML = `<div class="w-14 h-14 rounded-full" style="background: radial-gradient(circle, ${chosenColor} 0%, ${chosenColor} 35%, #111 38%, #111 100%);"></div>`;
    };

    modalBody.querySelectorAll('#art-swatches button').forEach(btn => {
        btn.onclick = () => {
            chosenColor = btn.dataset.color;
            chosenArtwork = null;
            preview.innerHTML = `<div class="w-14 h-14 rounded-full" style="background: radial-gradient(circle, ${chosenColor} 0%, ${chosenColor} 35%, #111 38%, #111 100%);"></div>`;
            modalBody.querySelectorAll('#art-swatches button').forEach(b => b.classList.remove('border-terracotta', 'scale-110'));
            btn.classList.add('border-terracotta', 'scale-110');
        };
    });

    modalBody.querySelector('#btn-cancel-modal').onclick = closeModal;
    modalBody.querySelector('#btn-save-art').onclick = () => {
        playlist.color = chosenColor;
        playlist.artwork = chosenArtwork;
        persistState();
        renderSidebarView();
        closeModal();
    };
}

export function showEditTrackModal(track) {
    const modalBody = document.getElementById('modal-body');
    let chosenColor = track.labelColor || VINYL_COLORS[0].label;
    let chosenAccent = track.accentColor || VINYL_COLORS[0].accent;

    openModal('Edit Song Info', `
        <div class="space-y-4">
            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-1">Song Title</label>
                <input id="input-track-title" type="text" value="${escapeHtml(track.title)}" class="w-full px-3.5 py-2 rounded-xl bg-oatmeal/60 border border-stone text-sm text-espresso focus:outline-none focus:border-terracotta">
            </div>
            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-1">Artist</label>
                <input id="input-track-artist" type="text" value="${escapeHtml(track.artist)}" class="w-full px-3.5 py-2 rounded-xl bg-oatmeal/60 border border-stone text-sm text-espresso focus:outline-none focus:border-terracotta">
            </div>
            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-2">Label Color</label>
                <div class="flex flex-wrap gap-2.5" id="track-swatches">
                    ${VINYL_COLORS.map(c => `
                        <button type="button" data-color="${c.label}" data-accent="${c.accent}" class="w-7 h-7 rounded-full border-2 ${c.label === chosenColor ? 'border-terracotta scale-110' : 'border-transparent'} transition" style="background: ${c.label}"></button>
                    `).join('')}
                </div>
            </div>
            <div class="pt-2 flex justify-end gap-2">
                <button type="button" id="btn-cancel-modal" class="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:bg-oatmeal transition">Cancel</button>
                <button type="button" id="btn-save-track" class="px-5 py-2 rounded-xl bg-terracotta text-alabaster hover:bg-[#b04b25] text-xs font-medium transition shadow-sm">Save</button>
            </div>
        </div>
    `);

    modalBody.querySelectorAll('#track-swatches button').forEach(btn => {
        btn.onclick = () => {
            chosenColor = btn.dataset.color;
            chosenAccent = btn.dataset.accent;
            modalBody.querySelectorAll('#track-swatches button').forEach(b => b.classList.remove('border-terracotta', 'scale-110'));
            btn.classList.add('border-terracotta', 'scale-110');
        };
    });

    modalBody.querySelector('#btn-cancel-modal').onclick = closeModal;
    modalBody.querySelector('#btn-save-track').onclick = () => {
        const tVal = modalBody.querySelector('#input-track-title').value.trim();
        const aVal = modalBody.querySelector('#input-track-artist').value.trim();
        if (tVal) track.title = tVal;
        if (aVal) track.artist = aVal;
        track.labelColor = chosenColor;
        track.accentColor = chosenAccent;

        if (turntable3D && getCurrentTrack() && getCurrentTrack().id === track.id) {
            turntable3D.updateRecordLabel(track);
        }
        persistState();
        renderSidebarView();
        updatePlayerUI();
        closeModal();
    };
}

export function showAddSongsModal(playlistId) {
    const modalBody = document.getElementById('modal-body');
    const pl = AppState.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const allTracks = Object.values(AppState.tracksById);

    openModal(`Add Songs to ${pl.name}`, `
        <div class="space-y-4">
            <div class="p-4 rounded-2xl bg-oatmeal/60 border border-stone flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 rounded-xl bg-terracotta/15 text-terracotta flex items-center justify-center shrink-0">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                    </div>
                    <div class="min-w-0">
                        <h4 class="font-medium text-sm text-espresso truncate">Import from YouTube / URL</h4>
                        <p class="text-xs text-muted truncate mt-0.5">Paste link to extract high-quality audio.</p>
                    </div>
                </div>
                <button type="button" id="btn-modal-import-yt" class="px-3.5 py-2 rounded-xl border border-stone bg-alabaster hover:bg-oatmeal text-espresso text-xs font-medium shrink-0 transition shadow-sm active:scale-95">
                    Import URL
                </button>
            </div>

            <div class="p-4 rounded-2xl bg-oatmeal/60 border border-stone flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 rounded-xl bg-stone/70 text-espresso flex items-center justify-center shrink-0">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 15a4 4 0 004 4h10a4 4 0 004-4M12 4v12m0-12l-4 4m4-4l4 4"/>
                        </svg>
                    </div>
                    <div class="min-w-0">
                        <h4 class="font-medium text-sm text-espresso truncate">Upload Audio Files</h4>
                        <p class="text-xs text-muted truncate mt-0.5">Select local audio files from your device.</p>
                    </div>
                </div>
                <button type="button" id="btn-modal-upload-files" class="px-3.5 py-2 rounded-xl bg-terracotta text-alabaster hover:bg-[#b04b25] text-xs font-medium shrink-0 transition shadow-sm active:scale-95">
                    Browse Files
                </button>
            </div>

            <div>
                <label class="block font-mono text-[11px] uppercase text-muted mb-2">Or Add from Library</label>
                <div class="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    ${allTracks.map(t => `
                        <div class="flex items-center justify-between px-3 py-2 rounded-xl bg-alabaster border border-stone/60">
                            <div class="min-w-0 flex-1 pr-2">
                                <p class="text-xs font-medium text-espresso truncate">${escapeHtml(t.title)}</p>
                                <p class="text-[11px] text-muted truncate">${escapeHtml(t.artist)} • ${formatTime(t.duration)}</p>
                            </div>
                            <button type="button" data-track-id="${t.id}" class="btn-add-existing px-2.5 py-1 rounded-lg text-[11px] font-mono bg-oatmeal hover:bg-terracotta hover:text-alabaster text-espresso transition">
                                + Add
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="pt-1 flex justify-end">
                <button type="button" id="btn-done-adding" class="px-5 py-2 rounded-xl bg-terracotta text-alabaster text-xs font-medium">Done</button>
            </div>
        </div>
    `);

    modalBody.querySelector('#btn-modal-import-yt').onclick = () => {
        closeModal();
        showYoutubeImportModal(playlistId);
    };

    modalBody.querySelector('#btn-modal-upload-files').onclick = () => {
        AppState.pendingAddSongsPlaylistId = playlistId;
        closeModal();
        document.getElementById('file-upload-audio').click();
    };

    modalBody.querySelectorAll('.btn-add-existing').forEach(btn => {
        btn.onclick = () => {
            pl.trackIds.push(btn.dataset.trackId);
            btn.textContent = 'Added ✓';
            persistState();
            renderSidebarView();
        };
    });

    modalBody.querySelector('#btn-done-adding').onclick = closeModal;
}

export function showCopyTrackToPlaylistModal(track) {
    const modalBody = document.getElementById('modal-body');
    openModal('Add to Playlist', `
        <div class="space-y-2">
            ${AppState.playlists.map(pl => `
                <button type="button" data-pl-id="${pl.id}" class="btn-pick-target-pl w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-oatmeal/50 hover:bg-oatmeal border border-stone/60 transition text-left">
                    <span class="text-sm font-medium text-espresso truncate">${escapeHtml(pl.name)}</span>
                    <span class="font-mono text-xs text-terracotta">+ Add</span>
                </button>
            `).join('')}
        </div>
    `);

    modalBody.querySelectorAll('.btn-pick-target-pl').forEach(btn => {
        btn.onclick = () => {
            const targetPl = AppState.playlists.find(p => p.id === btn.dataset.plId);
            if (targetPl) {
                targetPl.trackIds.push(track.id);
                persistState();
                renderSidebarView();
            }
            closeModal();
        };
    });
}

export async function showYoutubeImportModal(targetPlaylistId = null) {
    const isDesktop = typeof window !== 'undefined' && !!window.spindleDesktop;
    const destPlId = targetPlaylistId || AppState.viewedPlaylistId || (AppState.playlists[0] ? AppState.playlists[0].id : null);
    let selectedPl = AppState.playlists.find(p => p.id === destPlId) || AppState.playlists[0];

    if (!isDesktop) {
        openModal('Import Audio from YouTube', `
            <div class="space-y-4">
                <div class="p-4 rounded-2xl bg-oatmeal/60 border border-stone/80 text-espresso space-y-2.5">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-terracotta"></span>
                        <h4 class="font-serif text-lg font-medium text-espresso">Spindle Desktop App Feature</h4>
                    </div>
                    <p class="text-xs text-muted leading-relaxed">
                        YouTube and YouTube Music audio extraction runs natively in the Spindle Desktop application. It uses local <code>yt-dlp</code> and <code>ffmpeg</code> to download high-resolution audio files (320kbps MP3) with embedded tags directly to <code>~/Music/Spindle/</code>.
                    </p>
                    <div class="p-3 rounded-xl bg-alabaster border border-stone/60 font-mono text-[11px] text-espresso select-all">
                        npm run dev:desktop
                    </div>
                </div>
                <div class="pt-2 flex justify-end gap-2">
                    <button type="button" id="btn-browser-browse-files" class="px-4 py-2 rounded-xl border border-stone bg-oatmeal hover:bg-stone text-xs font-medium text-espresso transition">
                        Browse Local Files
                    </button>
                    <button type="button" id="btn-close-modal" class="px-5 py-2 rounded-xl bg-terracotta text-alabaster text-xs font-medium transition shadow-sm">
                        Close
                    </button>
                </div>
            </div>
        `);

        document.getElementById('modal-body').querySelector('#btn-browser-browse-files').onclick = () => {
            closeModal();
            AppState.pendingAddSongsPlaylistId = destPlId;
            document.getElementById('file-upload-audio').click();
        };
        document.getElementById('modal-body').querySelector('#btn-close-modal').onclick = closeModal;
        return;
    }

    // Inside Electron Desktop
    openModal('Import Audio from YouTube', `
        <div class="space-y-4">
            <div id="yt-checking-tools" class="flex items-center gap-2 text-xs font-mono text-muted py-2">
                <span class="w-2 h-2 rounded-full bg-terracotta animate-ping"></span>
                <span>Verifying audio download tools (yt-dlp &amp; ffmpeg)...</span>
            </div>
            <div id="yt-content-wrapper" class="hidden space-y-4">
                <!-- Target playlist picker -->
                <div>
                    <label class="block font-mono text-[11px] uppercase text-muted mb-1">Add to Playlist</label>
                    <select id="select-yt-playlist" class="w-full px-3 py-2 rounded-xl bg-oatmeal/60 border border-stone text-xs text-espresso focus:outline-none focus:border-terracotta">
                        ${AppState.playlists.map(p => `
                            <option value="${p.id}" ${p.id === (selectedPl ? selectedPl.id : '') ? 'selected' : ''}>
                                ${escapeHtml(p.name)} (${p.trackIds.length} songs)
                            </option>
                        `).join('')}
                    </select>
                </div>

                <!-- URL input -->
                <div>
                    <label class="block font-mono text-[11px] uppercase text-muted mb-1">YouTube / YouTube Music URL</label>
                    <div class="flex gap-2">
                        <input 
                            id="input-yt-url" 
                            type="text" 
                            placeholder="https://www.youtube.com/watch?v=... or youtu.be" 
                            class="flex-1 px-3.5 py-2 rounded-xl bg-oatmeal/60 border border-stone text-xs text-espresso focus:outline-none focus:border-terracotta"
                            autocomplete="off"
                            spellcheck="false"
                        />
                        <button type="button" id="btn-fetch-yt-info" class="px-3.5 py-2 rounded-xl bg-stone/60 hover:bg-stone text-espresso text-xs font-mono font-medium transition active:scale-95 shrink-0">
                            Fetch Info
                        </button>
                    </div>
                </div>

                <!-- Info Loading Indicator -->
                <div id="yt-loading-card" class="hidden items-center justify-center gap-2 py-6 px-4 rounded-2xl bg-oatmeal/40 border border-stone/60 text-xs font-mono text-muted">
                    <span class="w-2.5 h-2.5 rounded-full bg-terracotta animate-bounce"></span>
                    <span>Fetching metadata from YouTube...</span>
                </div>

                <!-- Preview Card -->
                <div id="yt-preview-card" class="hidden p-3.5 rounded-2xl bg-alabaster border border-stone/80 gap-3.5 shadow-sm items-center">
                    <div id="yt-thumb-box" class="w-16 h-16 rounded-xl bg-espresso border border-stone overflow-hidden shrink-0 flex items-center justify-center">
                        <img id="yt-thumb-img" src="" class="w-full h-full object-cover">
                    </div>
                    <div class="min-w-0 flex-1 space-y-1.5">
                        <div>
                            <label class="block font-mono text-[9px] uppercase text-muted">Song Title</label>
                            <input id="input-yt-title" type="text" class="w-full px-2.5 py-1 rounded-lg bg-oatmeal/60 border border-stone/70 text-xs font-medium text-espresso focus:outline-none focus:border-terracotta">
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="flex-1">
                                <label class="block font-mono text-[9px] uppercase text-muted">Artist</label>
                                <input id="input-yt-artist" type="text" class="w-full px-2.5 py-1 rounded-lg bg-oatmeal/60 border border-stone/70 text-xs text-espresso focus:outline-none focus:border-terracotta">
                            </div>
                            <div class="shrink-0 text-right">
                                <label class="block font-mono text-[9px] uppercase text-muted">Duration</label>
                                <span id="yt-duration-badge" class="font-mono text-xs text-espresso">00:00</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Real-time Progress Bar -->
                <div id="yt-progress-box" class="hidden p-4 rounded-2xl bg-oatmeal/60 border border-stone space-y-2">
                    <div class="flex items-center justify-between text-xs font-mono">
                        <span id="yt-progress-stage" class="text-espresso font-medium flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-terracotta animate-pulse"></span>
                            <span>Downloading audio...</span>
                        </span>
                        <span id="yt-progress-percent" class="text-terracotta font-semibold">0%</span>
                    </div>
                    <div class="w-full h-2 bg-stone/70 rounded-full overflow-hidden">
                        <div id="yt-progress-bar" class="h-full bg-terracotta transition-all duration-150 rounded-full" style="width: 0%;"></div>
                    </div>
                    <p id="yt-progress-detail" class="font-mono text-[10px] text-muted truncate"></p>
                </div>

                <!-- Error Container -->
                <div id="yt-error-box" class="hidden p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-xs font-mono break-words leading-relaxed"></div>

                <!-- Action Buttons -->
                <div class="pt-2 flex justify-end gap-2" id="yt-actions">
                    <button type="button" id="btn-cancel-yt" class="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:bg-oatmeal transition">
                        Cancel
                    </button>
                    <button type="button" id="btn-submit-yt" class="cursor-pointer inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-terracotta text-alabaster hover:bg-[#b04b25] text-xs font-medium transition shadow-sm active:scale-95 disabled:opacity-50 disabled:pointer-events-none">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/>
                        </svg>
                        <span id="btn-submit-yt-label">Import Audio</span>
                    </button>
                </div>
            </div>
        </div>
    `);

    const modalBody = document.getElementById('modal-body');
    const checkingEl = modalBody.querySelector('#yt-checking-tools');
    const contentEl = modalBody.querySelector('#yt-content-wrapper');

    let tools = { hasYtdlp: false, hasFfmpeg: false };
    try {
        tools = await window.spindleDesktop.checkTools();
    } catch (_) {}

    if (!tools.hasYtdlp || !tools.hasFfmpeg) {
        checkingEl.innerHTML = `
            <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-espresso space-y-2 w-full">
                <h4 class="font-medium text-sm text-amber-800">Prerequisites Required</h4>
                <p class="text-xs text-muted leading-relaxed">
                    YouTube audio extraction requires <code>yt-dlp</code> and <code>ffmpeg</code> installed on your system.
                </p>
                <div class="p-2.5 rounded-xl bg-alabaster border border-stone font-mono text-[11px] select-all">
                    sudo apt update &amp;&amp; sudo apt install -y ffmpeg yt-dlp
                </div>
                <div class="pt-2 flex justify-end">
                    <button type="button" id="btn-close-tools" class="px-4 py-1.5 rounded-xl bg-stone/70 hover:bg-stone text-espresso text-xs font-medium">Close</button>
                </div>
            </div>
        `;
        checkingEl.querySelector('#btn-close-tools')?.addEventListener('click', closeModal);
        return;
    }

    checkingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const selectPl = modalBody.querySelector('#select-yt-playlist');
    const urlInput = modalBody.querySelector('#input-yt-url');
    const fetchBtn = modalBody.querySelector('#btn-fetch-yt-info');
    const loadingCard = modalBody.querySelector('#yt-loading-card');
    const previewCard = modalBody.querySelector('#yt-preview-card');
    const thumbImg = modalBody.querySelector('#yt-thumb-img');
    const titleInput = modalBody.querySelector('#input-yt-title');
    const artistInput = modalBody.querySelector('#input-yt-artist');
    const durationBadge = modalBody.querySelector('#yt-duration-badge');
    const progressBox = modalBody.querySelector('#yt-progress-box');
    const progressBar = modalBody.querySelector('#yt-progress-bar');
    const progressStage = modalBody.querySelector('#yt-progress-stage');
    const progressPercent = modalBody.querySelector('#yt-progress-percent');
    const progressDetail = modalBody.querySelector('#yt-progress-detail');
    const errorBox = modalBody.querySelector('#yt-error-box');
    const cancelBtn = modalBody.querySelector('#btn-cancel-yt');
    const submitBtn = modalBody.querySelector('#btn-submit-yt');
    const submitLabel = modalBody.querySelector('#btn-submit-yt-label');

    urlInput.focus();

    let fetchedMetadata = null;
    let isFetching = false;
    let isDownloading = false;

    async function fetchInfo() {
        const url = urlInput.value.trim();
        if (!url || isFetching || isDownloading) return;

        errorBox.classList.add('hidden');
        errorBox.textContent = '';
        isFetching = true;
        fetchBtn.disabled = true;
        loadingCard.classList.remove('hidden');
        loadingCard.classList.add('flex');
        previewCard.classList.add('hidden');
        previewCard.classList.remove('flex');

        try {
            const data = await window.spindleDesktop.getYoutubeInfo(url);
            fetchedMetadata = data;
            titleInput.value = data.title || '';
            artistInput.value = data.artist || '';
            durationBadge.textContent = formatTime(data.duration || 0);

            if (data.thumbnail) {
                thumbImg.src = data.thumbnail;
                thumbImg.classList.remove('hidden');
            } else {
                thumbImg.classList.add('hidden');
            }

            loadingCard.classList.add('hidden');
            loadingCard.classList.remove('flex');
            previewCard.classList.remove('hidden');
            previewCard.classList.add('flex');
            submitLabel.textContent = 'Import & Play';
        } catch (err) {
            loadingCard.classList.add('hidden');
            loadingCard.classList.remove('flex');
            errorBox.textContent = `Could not fetch video info: ${err.message || err}`;
            errorBox.classList.remove('hidden');
        } finally {
            isFetching = false;
            fetchBtn.disabled = false;
        }
    }

    fetchBtn.addEventListener('click', fetchInfo);

    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!fetchedMetadata) {
                fetchInfo();
            } else {
                startDownload();
            }
        }
    });

    urlInput.addEventListener('paste', () => {
        setTimeout(fetchInfo, 100);
    });

    cancelBtn.addEventListener('click', closeModal);

    async function startDownload() {
        const url = urlInput.value.trim();
        if (!url || isDownloading) return;

        const targetPl = AppState.playlists.find(p => p.id === selectPl.value) || AppState.playlists[0];
        if (!targetPl) return;

        isDownloading = true;
        urlInput.disabled = true;
        fetchBtn.disabled = true;
        selectPl.disabled = true;
        cancelBtn.disabled = true;
        submitBtn.disabled = true;
        errorBox.classList.add('hidden');

        progressBox.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';
        progressStage.innerHTML = `<span class="w-2 h-2 rounded-full bg-terracotta animate-pulse"></span><span>Starting download...</span>`;
        progressDetail.textContent = 'Connecting to stream servers...';

        const unsubscribe = window.spindleDesktop.onDownloadProgress((prog) => {
            if (prog.percent !== undefined) {
                const pct = Math.round(prog.percent);
                progressBar.style.width = `${pct}%`;
                progressPercent.textContent = `${pct}%`;
            }
            if (prog.message) {
                progressStage.innerHTML = `<span class="w-2 h-2 rounded-full bg-terracotta animate-pulse"></span><span>${escapeHtml(prog.message)}</span>`;
            }
            if (prog.speed && prog.eta) {
                progressDetail.textContent = `Speed: ${prog.speed} • ETA: ${prog.eta} • Total: ${prog.size || ''}`;
            }
        });

        try {
            const customTitle = titleInput.value.trim() || (fetchedMetadata && fetchedMetadata.title) || null;
            const customArtist = artistInput.value.trim() || (fetchedMetadata && fetchedMetadata.artist) || null;

            const res = await window.spindleDesktop.downloadYoutubeTrack({
                url,
                playlistName: targetPl.name,
                customTitle,
                customArtist,
                thumbnail: fetchedMetadata ? fetchedMetadata.thumbnail : null,
                duration: fetchedMetadata ? fetchedMetadata.duration : null
            });

            if (!res || !res.success) {
                throw new Error('Download did not return success.');
            }

            unsubscribe();

            // Track creation
            const id = `yt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const palette = VINYL_COLORS[Object.keys(AppState.tracksById).length % VINYL_COLORS.length];
            const newTrack = {
                id,
                title: res.title || customTitle || 'Track',
                artist: res.artist || customArtist || 'Unknown Artist',
                duration: res.duration || 180,
                isSynth: false,
                url: res.url,
                filePath: res.filePath,
                artwork: res.thumbnail || null,
                labelColor: palette.label,
                accentColor: palette.accent
            };

            AppState.tracksById[id] = newTrack;
            const insertIndex = targetPl.trackIds.length;
            targetPl.trackIds.push(id);
            await persistState();

            closeModal();
            openPlaylist(targetPl.id);
            AppState.playingPlaylistId = targetPl.id;
            selectAndPlayTrack(insertIndex);

        } catch (err) {
            unsubscribe();
            isDownloading = false;
            urlInput.disabled = false;
            fetchBtn.disabled = false;
            selectPl.disabled = false;
            cancelBtn.disabled = false;
            submitBtn.disabled = false;
            progressBox.classList.add('hidden');
            errorBox.textContent = `Import failed: ${err.message || err}`;
            errorBox.classList.remove('hidden');
        }
    }

    submitBtn.addEventListener('click', () => {
        if (!fetchedMetadata && urlInput.value.trim()) {
            fetchInfo().then(() => {
                if (fetchedMetadata) startDownload();
            });
        } else {
            startDownload();
        }
    });
}

// Playback Actions
export function selectAndPlayTrack(index) {
    const pl = getPlayingPlaylist();
    if (!pl || !pl.trackIds.length) return;

    const boundedIdx = Math.max(0, Math.min(index, pl.trackIds.length - 1));
    const isSameTrack = AppState.hasActiveSession && boundedIdx === AppState.currentIndex && AppState.playbackState !== 'STOPPED';
    AppState.currentIndex = boundedIdx;
    AppState.hasActiveSession = true;

    const track = getCurrentTrack();
    if (!track) return;

    AppState.duration = track.duration || 135;
    AppState.currentTime = 0;
    AppState.playbackState = 'PLAYING';

    if (turntable3D) {
        if (AppState.uiView === 'PLAYLIST_DETAIL') {
            turntable3D.setCameraView('top');
        }
        if (isSameTrack && turntable3D.mechState === 'PAUSED') {
            turntable3D.mechState = 'PLAYING';
        } else {
            turntable3D.triggerTrackChange(track, true);
        }
    }

    audioEngine.playTrack(track, 0);
    renderSidebarView();
    updatePlayerUI();
}

export function togglePlayPause() {
    let track = getCurrentTrack();
    if (!track) {
        const pl = getViewedPlaylist() || AppState.playlists[0];
        if (pl && pl.trackIds.length > 0) {
            AppState.playingPlaylistId = pl.id;
            AppState.currentIndex = 0;
            track = getCurrentTrack();
        }
    }
    if (!track) return;

    AppState.hasActiveSession = true;

    if (AppState.playbackState === 'PLAYING') {
        AppState.playbackState = 'PAUSED';
        audioEngine.pauseAudio();
        if (turntable3D) turntable3D.mechState = 'PAUSED';
    } else if (AppState.playbackState === 'PAUSED') {
        AppState.playbackState = 'PLAYING';
        audioEngine.playTrack(track, AppState.currentTime);
        if (turntable3D) {
            if (AppState.uiView === 'PLAYLIST_DETAIL') {
                turntable3D.setCameraView('top');
            }
            turntable3D.mechState = 'PLAYING';
        }
    } else {
        AppState.playbackState = 'PLAYING';
        if (turntable3D) {
            if (AppState.uiView === 'PLAYLIST_DETAIL') {
                turntable3D.setCameraView('top');
            }
            turntable3D.triggerTrackChange(track, true);
        }
        audioEngine.playTrack(track, AppState.currentTime);
    }

    renderSidebarView();
    updatePlayerUI();
}

export function stopPlayback() {
    audioEngine.playNeedleLiftSound();
    AppState.playbackState = 'STOPPED';
    AppState.currentTime = 0;
    audioEngine.stopAllAudioOnly();
    if (turntable3D) {
        turntable3D.mechState = 'RETURNING_ARM';
    }
    renderSidebarView();
    updatePlayerUI();
}

export function handleTrackEnded() {
    audioEngine.playNeedleLiftSound();
    const pl = getPlayingPlaylist();
    if (!pl || !pl.trackIds.length) return;

    if (AppState.repeatMode === 'ONE') {
        selectAndPlayTrack(AppState.currentIndex);
        return;
    }

    if (AppState.shuffleEnabled && pl.trackIds.length > 1) {
        let nextIdx = AppState.currentIndex;
        while (nextIdx === AppState.currentIndex) {
            nextIdx = Math.floor(Math.random() * pl.trackIds.length);
        }
        selectAndPlayTrack(nextIdx);
        return;
    }

    const isLast = AppState.currentIndex >= pl.trackIds.length - 1;
    if (isLast && AppState.repeatMode === 'OFF') {
        stopPlayback();
    } else {
        playNextTrack();
    }
}

export function playNextTrack() {
    const pl = getPlayingPlaylist();
    if (!pl || !pl.trackIds.length) return;

    if (AppState.shuffleEnabled && pl.trackIds.length > 1) {
        let nextIdx = AppState.currentIndex;
        while (nextIdx === AppState.currentIndex) {
            nextIdx = Math.floor(Math.random() * pl.trackIds.length);
        }
        selectAndPlayTrack(nextIdx);
        return;
    }

    const nextIdx = (AppState.currentIndex + 1) % pl.trackIds.length;
    selectAndPlayTrack(nextIdx);
}

export function playPrevTrack() {
    const pl = getPlayingPlaylist();
    if (!pl || !pl.trackIds.length) return;

    if (AppState.currentTime > 4) {
        audioEngine.seek(0);
        updatePlayerUI();
        return;
    }
    const prevIdx = (AppState.currentIndex - 1 + pl.trackIds.length) % pl.trackIds.length;
    selectAndPlayTrack(prevIdx);
}

export async function handleLocalFiles(fileList, targetPlaylistId = null) {
    if (!fileList || fileList.length === 0) return;
    const validFiles = Array.from(fileList).filter(f =>
        f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(f.name)
    );
    if (validFiles.length === 0) return;

    const destPlId = targetPlaylistId || AppState.viewedPlaylistId || AppState.playingPlaylistId || AppState.playlists[0].id;
    const destPl = AppState.playlists.find(p => p.id === destPlId) || AppState.playlists[0];
    const firstAddedIndex = destPl.trackIds.length;

    for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const id = `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const url = URL.createObjectURL(file);
        const meta = await parseAudioTitleArtist(file);

        const palette = VINYL_COLORS[(Object.keys(AppState.tracksById).length + i) % VINYL_COLORS.length];
        const newTrack = {
            id,
            title: meta.title,
            artist: meta.artist,
            duration: 180,
            isSynth: false,
            url,
            labelColor: palette.label,
            accentColor: palette.accent
        };

        AppState.tracksById[id] = newTrack;
        destPl.trackIds.push(id);
        await storageDB.saveAudioBlob(id, file);

        const tempAudio = new Audio(url);
        tempAudio.addEventListener('loadedmetadata', () => {
            if (tempAudio.duration && !isNaN(tempAudio.duration)) {
                newTrack.duration = tempAudio.duration;
                if (getCurrentTrack() && getCurrentTrack().id === newTrack.id) {
                    AppState.duration = tempAudio.duration;
                }
                persistState();
                renderSidebarView();
                updatePlayerUI();
            }
        });
    }

    await persistState();
    AppState.playingPlaylistId = destPl.id;
    openPlaylist(destPl.id);
    selectAndPlayTrack(firstAddedIndex);
}
