import './style.css';
import { DEFAULT_SYNTH_TRACKS } from './constants.js';
import { storageDB } from './db.js';
import { AppState, getCurrentTrack, persistState, getViewedPlaylist } from './state.js';
import { audioEngine } from './audio.js';
import { Turntable3D } from './turntable.js';
import {
    setTurntable,
    getTurntable,
    renderSidebarView,
    updatePlayerUI,
    closeContextMenu,
    closeModal,
    togglePlayPause,
    stopPlayback,
    playNextTrack,
    playPrevTrack,
    handleTrackEnded,
    showCreatePlaylistModal,
    showChangePlaylistArtworkModal,
    showAddSongsModal,
    openPlaylistContextMenu,
    handleLocalFiles,
    formatTime,
    selectAndPlayTrack
} from './ui.js';

async function hydrateLibrary() {
    await storageDB.init();
    const saved = await storageDB.loadMetadata();

    if (saved && saved.playlists && saved.playlists.length > 0 && saved.tracks) {
        AppState.tracksById = saved.tracks;
        AppState.playlists = saved.playlists;

        for (const track of Object.values(AppState.tracksById)) {
            if (!track.isSynth) {
                const blob = await storageDB.getAudioBlob(track.id);
                if (blob) {
                    track.url = URL.createObjectURL(blob);
                }
            }
        }
        DEFAULT_SYNTH_TRACKS.forEach(st => {
            if (!AppState.tracksById[st.id]) AppState.tracksById[st.id] = { ...st };
        });
    } else {
        DEFAULT_SYNTH_TRACKS.forEach(t => {
            AppState.tracksById[t.id] = { ...t };
        });
        AppState.playlists = [
            {
                id: 'pl-default-1',
                name: 'Late Night Sessions',
                color: '#C85A32',
                artwork: null,
                trackIds: ['synth-1', 'synth-2', 'synth-3', 'synth-4']
            },
            {
                id: 'pl-default-2',
                name: 'Evening Ambient',
                color: '#2A6F97',
                artwork: null,
                trackIds: ['synth-2', 'synth-3']
            }
        ];
        await persistState();
    }

    AppState.playingPlaylistId = null;
    AppState.hasActiveSession = false;
    AppState.currentIndex = 0;
}

async function initApp() {
    await hydrateLibrary();

    const turntableInstance = new Turntable3D('canvas-container');
    setTurntable(turntableInstance);

    // Audio engine callbacks
    audioEngine.setAudioElement(document.getElementById('html5-audio'));
    audioEngine.onTimeUpdate = () => updatePlayerUI();
    audioEngine.onLoadedMetadata = () => {
        renderSidebarView();
        updatePlayerUI();
    };
    audioEngine.onEnded = () => handleTrackEnded();

    renderSidebarView();
    updatePlayerUI();

    // Initial Startup "Click to Open" Intro Transition
    const introOverlay = document.getElementById('intro-overlay');
    const introPrompt = document.getElementById('intro-prompt');
    const sidebarPanel = document.getElementById('sidebar-panel');
    const hudTop = document.getElementById('hud-top');
    const hudBottom = document.getElementById('hud-bottom-hint');

    let isIntroActive = true;
    function handleIntroOpen() {
        if (!isIntroActive) return;
        isIntroActive = false;

        // 1. Fade out intro prompt & disable click catcher immediately
        if (introOverlay) {
            introOverlay.style.pointerEvents = 'none';
            introOverlay.remove();
        }
        if (introPrompt) {
            introPrompt.classList.add('opacity-0');
            setTimeout(() => introPrompt.remove(), 700);
        }

        // 2. Slide sidebar panel into view from the left
        if (sidebarPanel) {
            sidebarPanel.classList.remove('intro-hidden');
            sidebarPanel.addEventListener('transitionend', () => {
                const tt = getTurntable();
                if (tt) tt.resize();
            }, { once: true });
        }

        // 3. Fade in HUD controls
        if (hudTop) {
            hudTop.classList.remove('opacity-0');
        }
        if (hudBottom) {
            hudBottom.classList.remove('opacity-0');
        }

        // 4. Open turntable cover & glide smoothly to ISO view
        const currentTurntable = getTurntable();
        if (currentTurntable) {
            currentTurntable.revealFromIntro();
        }

        window.removeEventListener('keydown', onIntroKey);
        window.removeEventListener('click', handleIntroOpen, true);
    }

    function onIntroKey(e) {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            handleIntroOpen();
        }
    }

    if (introOverlay) {
        introOverlay.addEventListener('click', handleIntroOpen);
    }
    window.addEventListener('click', handleIntroOpen, { capture: true, once: true });
    window.addEventListener('keydown', onIntroKey);

    window.addEventListener('click', () => closeContextMenu());

    // Compact Left-to-Right Light / Dark Theme Toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        AppState.isDarkMode = !AppState.isDarkMode;
        document.body.classList.toggle('dark-theme', AppState.isDarkMode);

        const thumb = document.getElementById('theme-toggle-thumb');
        const lightLbl = document.getElementById('theme-label-light');
        const darkLbl = document.getElementById('theme-label-dark');

        if (AppState.isDarkMode) {
            thumb.style.transform = 'translateX(32px)';
            lightLbl.className = 'w-6 h-6 flex items-center justify-center text-muted transition-colors duration-300';
            darkLbl.className = 'w-6 h-6 flex items-center justify-center text-alabaster transition-colors duration-300';
        } else {
            thumb.style.transform = 'translateX(0px)';
            lightLbl.className = 'w-6 h-6 flex items-center justify-center text-alabaster transition-colors duration-300';
            darkLbl.className = 'w-6 h-6 flex items-center justify-center text-muted transition-colors duration-300';
        }

        const currentTurntable = getTurntable();
        if (currentTurntable) {
            currentTurntable.setTheme(AppState.isDarkMode);
        }
    });

    // Bind Transport Controls
    document.getElementById('btn-play').addEventListener('click', togglePlayPause);
    document.getElementById('btn-stop').addEventListener('click', stopPlayback);
    document.getElementById('btn-next').addEventListener('click', playNextTrack);
    document.getElementById('btn-prev').addEventListener('click', playPrevTrack);

    document.getElementById('btn-shuffle').addEventListener('click', () => {
        AppState.shuffleEnabled = !AppState.shuffleEnabled;
        updatePlayerUI();
    });

    document.getElementById('btn-repeat').addEventListener('click', () => {
        const modes = ['OFF', 'ALL', 'ONE'];
        AppState.repeatMode = modes[(modes.indexOf(AppState.repeatMode) + 1) % modes.length];
        updatePlayerUI();
    });

    // Opened Playlist Hero Controls
    document.getElementById('btn-back-playlists').addEventListener('click', () => {
        AppState.uiView = 'PLAYLISTS';
        AppState.isReorderMode = false;
        renderSidebarView();
        const currentTurntable = getTurntable();
        if (currentTurntable) {
            currentTurntable.setCameraView('side');
        }
    });

    document.getElementById('btn-hero-playlist-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        const pl = getViewedPlaylist();
        if (pl) openPlaylistContextMenu(e.currentTarget, pl);
    });

    document.getElementById('hero-playlist-artwork').addEventListener('click', () => {
        const pl = getViewedPlaylist();
        if (pl) showChangePlaylistArtworkModal(pl);
    });

    document.getElementById('btn-hero-play').addEventListener('click', () => {
        const pl = getViewedPlaylist();
        if (pl && pl.trackIds.length > 0) {
            AppState.playingPlaylistId = pl.id;
            selectAndPlayTrack(0);
        }
    });

    document.getElementById('btn-hero-add-songs').addEventListener('click', () => {
        if (AppState.viewedPlaylistId) {
            showAddSongsModal(AppState.viewedPlaylistId);
        }
    });

    document.getElementById('btn-toggle-reorder').addEventListener('click', () => {
        AppState.isReorderMode = !AppState.isReorderMode;
        renderSidebarView();
    });

    document.getElementById('btn-create-playlist').addEventListener('click', showCreatePlaylistModal);

    // Modal close handlers
    document.getElementById('modal-close').addEventListener('click', closeModal);
    const modalBackdrop = document.getElementById('modal-backdrop');
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
    });

    // Seek Slider
    const seekSlider = document.getElementById('seek-slider');
    seekSlider.addEventListener('input', (e) => {
        AppState.isSeeking = true;
        const ratio = parseFloat(e.target.value) / 1000;
        const previewTime = ratio * AppState.duration;
        document.getElementById('seek-fill').style.width = `${ratio * 100}%`;
        document.getElementById('time-current').textContent = formatTime(previewTime);
    });
    seekSlider.addEventListener('change', (e) => {
        const ratio = parseFloat(e.target.value) / 1000;
        audioEngine.seek(ratio * AppState.duration);
        AppState.isSeeking = false;
        updatePlayerUI();
    });

    // Volume & Mute
    const volSlider = document.getElementById('vol-slider');
    volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        AppState.isMuted = val === 0;
        audioEngine.setVolume(val);
        document.getElementById('vol-fill').style.width = `${val * 100}%`;
    });

    document.getElementById('btn-mute').addEventListener('click', () => {
        AppState.isMuted = !AppState.isMuted;
        audioEngine.setVolume(AppState.volume);
        document.getElementById('vol-fill').style.width = AppState.isMuted ? '0%' : `${AppState.volume * 100}%`;
    });

    // Crackle Toggle
    document.getElementById('btn-crackle').addEventListener('click', () => {
        AppState.crackleEnabled = !AppState.crackleEnabled;
        const dot = document.getElementById('crackle-dot');
        dot.className = AppState.crackleEnabled
            ? 'w-2 h-2 rounded-full bg-terracotta'
            : 'w-2 h-2 rounded-full bg-stone';
        audioEngine.updateCrackleLevel();
    });

    // Acrylic Dust Cover Toggle
    const coverBtn = document.getElementById('btn-cover-toggle');
    coverBtn.addEventListener('click', () => {
        const currentTurntable = getTurntable();
        if (currentTurntable) {
            const isOpen = currentTurntable.toggleDustCover();
            coverBtn.className = isOpen
                ? 'px-2.5 py-1 rounded-xl font-mono text-[11px] text-espresso hover:bg-oatmeal transition'
                : 'px-2.5 py-1 rounded-xl font-mono text-[11px] bg-terracotta text-alabaster transition';
        }
    });

    // Manual Camera Angle Presets
    document.querySelectorAll('.cam-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const currentTurntable = getTurntable();
            if (currentTurntable) {
                currentTurntable.setCameraView(btn.dataset.cam);
            }
        });
    });

    // File Uploads & Drag-and-Drop
    document.getElementById('file-upload-audio').addEventListener('change', (e) => {
        handleLocalFiles(e.target.files, AppState.pendingAddSongsPlaylistId);
        AppState.pendingAddSongsPlaylistId = null;
        e.target.value = '';
    });

    document.getElementById('file-upload-artwork').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file && AppState.artworkUploadCallback) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (AppState.artworkUploadCallback) {
                    AppState.artworkUploadCallback(ev.target.result);
                    AppState.artworkUploadCallback = null;
                }
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    });

    const dropOverlay = document.getElementById('drop-overlay');
    window.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            dropOverlay.classList.remove('hidden');
            dropOverlay.classList.add('flex');
        }
    });
    window.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null) {
            dropOverlay.classList.add('hidden');
            dropOverlay.classList.remove('flex');
        }
    });
    window.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            dropOverlay.classList.add('hidden');
            dropOverlay.classList.remove('flex');
            handleLocalFiles(e.dataTransfer.files);
        }
    });

    // Timer ticker for built-in synth tracks
    setInterval(() => {
        const track = getCurrentTrack();
        if (AppState.playbackState === 'PLAYING' && track && track.isSynth && !AppState.isSeeking) {
            AppState.currentTime += 0.25;
            if (AppState.currentTime >= AppState.duration) {
                handleTrackEnded();
            } else {
                updatePlayerUI();
            }
        }
    }, 250);

    function animate() {
        requestAnimationFrame(animate);
        const currentTurntable = getTurntable();
        if (currentTurntable) {
            currentTurntable.update();
        }
    }
    animate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
