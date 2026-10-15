const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const { pathToFileURL } = require('url');

// 1. Register privileged protocol for local audio streaming & seeking (HTTP range requests)
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'spindle-media',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
            bypassCSP: true,
            corsEnabled: true
        }
    }
]);

let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function getMusicDir() {
    const defaultMusic = app.getPath('music') || path.join(os.homedir(), 'Music');
    const spindleDir = path.join(defaultMusic, 'Spindle');
    if (!fs.existsSync(spindleDir)) {
        fs.mkdirSync(spindleDir, { recursive: true });
    }
    return spindleDir;
}

function sanitizeName(str) {
    return (str || 'Track').replace(/[/\\?%*:|"<>]/g, '_').trim();
}

function findBinary(name) {
    try {
        const out = execSync(`which ${name}`, { encoding: 'utf8' }).trim();
        if (out && fs.existsSync(out)) return out;
    } catch (_) {}

    const commonPaths = [
        `/usr/bin/${name}`,
        `/usr/local/bin/${name}`,
        path.join(os.homedir(), '.local', 'bin', name),
        path.join(app.getAppPath(), 'bin', name)
    ];
    for (const p of commonPaths) {
        if (fs.existsSync(p)) return p;
    }
    return name;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 920,
        minHeight: 640,
        backgroundColor: '#1E1B18',
        title: 'Spindle Music Player',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: true
        }
    });

    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';

    if (isDev && process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(devUrl);
    } else {
        const distIndex = path.join(__dirname, '../dist/index.html');
        if (fs.existsSync(distIndex)) {
            mainWindow.loadFile(distIndex);
        } else {
            mainWindow.loadURL(devUrl);
        }
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Setup custom streaming media protocol and app lifecycle
app.whenReady().then(() => {
    protocol.handle('spindle-media', (request) => {
        try {
            // URL format: spindle-media://local/<absolute-path>
            const urlPath = request.url.replace(/^spindle-media:\/\/local\//i, '');
            const filePath = decodeURIComponent(urlPath);
            return net.fetch(pathToFileURL(filePath).toString());
        } catch (err) {
            console.error('Failed to load local media file:', err);
            return new Response('File not found', { status: 404 });
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handler: Basic App & System Info
ipcMain.handle('spindle:get-app-info', async () => {
    return {
        version: app.getVersion(),
        platform: process.platform,
        musicDir: getMusicDir(),
        isPackaged: app.isPackaged
    };
});

// IPC Handler: Verify yt-dlp & ffmpeg
ipcMain.handle('spindle:check-tools', async () => {
    let hasYtdlp = false;
    let hasFfmpeg = false;
    let ytdlpVersion = '';
    let ffmpegVersion = '';

    try {
        const yt = findBinary('yt-dlp');
        ytdlpVersion = execSync(`"${yt}" --version`, { encoding: 'utf8' }).trim();
        hasYtdlp = true;
    } catch (_) {}

    try {
        const ff = findBinary('ffmpeg');
        const ffOut = execSync(`"${ff}" -version`, { encoding: 'utf8' });
        ffmpegVersion = ffOut.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0];
        hasFfmpeg = true;
    } catch (_) {}

    return {
        hasYtdlp,
        hasFfmpeg,
        ytdlpVersion,
        ffmpegVersion
    };
});

// IPC Handler: Fetch YouTube Video / Audio Metadata
ipcMain.handle('spindle:youtube-info', async (_event, url) => {
    return new Promise((resolve, reject) => {
        if (!url || typeof url !== 'string') {
            return reject(new Error('Please provide a valid YouTube URL.'));
        }

        const ytBin = findBinary('yt-dlp');
        const proc = spawn(ytBin, [
            '--dump-single-json',
            '--no-playlist',
            '--no-warnings',
            '--skip-download',
            url.trim()
        ]);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(stderr || `yt-dlp exited with status code ${code}`));
            }

            try {
                const data = JSON.parse(stdout);

                // Extract highest resolution thumbnail
                let thumb = data.thumbnail || '';
                if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
                    thumb = data.thumbnails[data.thumbnails.length - 1].url || thumb;
                }

                // Determine cleaned title & artist
                let title = data.title || 'Unknown Title';
                let artist = data.artist || data.creator || data.uploader || 'YouTube';
                if (data.track) title = data.track;
                if (data.artist) artist = data.artist;

                if (title.includes(' - ') && (!data.artist || artist === data.uploader)) {
                    const parts = title.split(' - ');
                    artist = parts[0].trim();
                    title = parts.slice(1).join(' - ').trim();
                }

                resolve({
                    id: data.id,
                    title,
                    artist,
                    duration: Math.round(data.duration || 0),
                    thumbnail: thumb,
                    webpage_url: data.webpage_url || url
                });
            } catch (err) {
                reject(new Error('Failed to parse metadata: ' + err.message));
            }
        });
    });
});

// IPC Handler: Download YouTube Track to Local MP3 with Embedded Tags
ipcMain.handle('spindle:youtube-download', async (event, { url, playlistName, customTitle, customArtist, thumbnail: passedThumb, duration: passedDuration }) => {
    return new Promise((resolve, reject) => {
        const musicDir = getMusicDir();
        const plFolder = path.join(musicDir, sanitizeName(playlistName || 'Downloads'));
        if (!fs.existsSync(plFolder)) {
            fs.mkdirSync(plFolder, { recursive: true });
        }

        const ytBin = findBinary('yt-dlp');
        const ffBin = findBinary('ffmpeg');

        const outputTemplate = path.join(plFolder, '%(title)s.%(ext)s');

        const args = [
            '--no-playlist',
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0', // Best VBR / 320kbps
            '--embed-thumbnail',
            '--add-metadata',
            '--ffmpeg-location', path.dirname(ffBin),
            '--output', outputTemplate,
            '--print', 'after_move:filepath',
            '--newline',
            url.trim()
        ];

        const proc = spawn(ytBin, args);

        let exactFilepath = null;
        let jsonMetadata = null;
        let stderr = '';

        proc.stdout.on('data', (d) => {
            const text = d.toString();
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Download percentage & speed parsing
                // e.g. [download]  45.2% of  7.82MiB at  2.41MiB/s ETA 00:01
                const progressMatch = trimmed.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/);
                if (progressMatch) {
                    event.sender.send('spindle:download-progress', {
                        url,
                        percent: parseFloat(progressMatch[1]),
                        size: progressMatch[2],
                        speed: progressMatch[3],
                        eta: progressMatch[4],
                        stage: 'downloading',
                        message: `Downloading: ${progressMatch[1]}% (${progressMatch[3]})`
                    });
                    continue;
                }

                if (trimmed.includes('[ExtractAudio]')) {
                    event.sender.send('spindle:download-progress', {
                        url,
                        percent: 90,
                        stage: 'converting',
                        message: 'Extracting high-quality MP3...'
                    });
                    continue;
                }

                if (trimmed.includes('[EmbedThumbnail]') || trimmed.includes('[Metadata]')) {
                    event.sender.send('spindle:download-progress', {
                        url,
                        percent: 96,
                        stage: 'metadata',
                        message: 'Embedding artwork and ID3 tags...'
                    });
                    continue;
                }

                if (trimmed.endsWith('.mp3') && fs.existsSync(trimmed)) {
                    exactFilepath = trimmed;
                    continue;
                }

                // Check for JSON output at end
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        jsonMetadata = JSON.parse(trimmed);
                    } catch (_) {}
                }
            }
        });

        proc.stderr.on('data', (d) => {
            stderr += d.toString();
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(stderr || `Download failed with exit code ${code}`));
            }

            let targetFile = exactFilepath;
            if (!targetFile || !fs.existsSync(targetFile)) {
                // Find newest MP3 file in playlist folder
                const files = fs.readdirSync(plFolder)
                    .filter(f => f.toLowerCase().endsWith('.mp3'))
                    .map(f => ({ name: f, time: fs.statSync(path.join(plFolder, f)).mtimeMs }))
                    .sort((a, b) => b.time - a.time);

                if (files.length === 0) {
                    return reject(new Error('Downloaded MP3 could not be located in ' + plFolder));
                }

                targetFile = path.join(plFolder, files[0].name);
            }

            const baseName = path.basename(targetFile);
            let finalTitle = customTitle || (jsonMetadata && jsonMetadata.title) || baseName.replace(/\.mp3$/i, '');
            let finalArtist = customArtist || (jsonMetadata && (jsonMetadata.artist || jsonMetadata.uploader)) || 'Unknown Artist';
            let finalDuration = passedDuration || (jsonMetadata && jsonMetadata.duration) || 180;
            let thumbnail = passedThumb || (jsonMetadata && jsonMetadata.thumbnail) || '';

            if (baseName.includes(' - ') && !customTitle) {
                const parts = baseName.replace(/\.mp3$/i, '').split(' - ');
                finalArtist = parts[0].trim();
                finalTitle = parts.slice(1).join(' - ').trim();
            }

            const mediaUrl = `spindle-media://local/${encodeURIComponent(targetFile)}`;

            event.sender.send('spindle:download-progress', {
                url,
                percent: 100,
                stage: 'completed',
                message: 'Import complete!'
            });

            resolve({
                success: true,
                filePath: targetFile,
                url: mediaUrl,
                title: finalTitle,
                artist: finalArtist,
                duration: finalDuration,
                thumbnail: thumbnail || null
            });
        });
    });
});

// IPC Handler: Open local music folder in system file manager
ipcMain.handle('spindle:open-music-folder', async (_event, subPath) => {
    const musicDir = getMusicDir();
    const target = subPath ? path.join(musicDir, sanitizeName(subPath)) : musicDir;
    if (fs.existsSync(target)) {
        await shell.openPath(target);
    } else {
        await shell.openPath(musicDir);
    }
    return true;
});
