const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spindleDesktop', {
    isDesktop: true,
    getAppInfo: () => ipcRenderer.invoke('spindle:get-app-info'),
    checkTools: () => ipcRenderer.invoke('spindle:check-tools'),
    getYoutubeInfo: (url) => ipcRenderer.invoke('spindle:youtube-info', url),
    downloadYoutubeTrack: (params) => ipcRenderer.invoke('spindle:youtube-download', params),
    onDownloadProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('spindle:download-progress', handler);
        return () => {
            ipcRenderer.removeListener('spindle:download-progress', handler);
        };
    },
    openMusicFolder: (subPath) => ipcRenderer.invoke('spindle:open-music-folder', subPath)
});
