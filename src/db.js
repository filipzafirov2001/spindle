export class LocalLibraryDB {
    constructor() {
        this.dbName = 'SpindleMusicPlayerDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve) => {
            const req = indexedDB.open(this.dbName, this.dbVersion);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('audioFiles')) {
                    db.createObjectStore('audioFiles', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('appState')) {
                    db.createObjectStore('appState', { keyPath: 'key' });
                }
            };
            req.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            req.onerror = () => resolve();
        });
    }

    async saveAudioBlob(id, blob) {
        if (!this.db) return;
        return new Promise((resolve) => {
            const tx = this.db.transaction('audioFiles', 'readwrite');
            tx.objectStore('audioFiles').put({ id, blob });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }

    async getAudioBlob(id) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const tx = this.db.transaction('audioFiles', 'readonly');
            const req = tx.objectStore('audioFiles').get(id);
            req.onsuccess = () => resolve(req.result ? req.result.blob : null);
            req.onerror = () => resolve(null);
        });
    }

    async saveMetadata(tracksMeta, playlists) {
        if (!this.db) return;
        return new Promise((resolve) => {
            const tx = this.db.transaction('appState', 'readwrite');
            const store = tx.objectStore('appState');
            const serializableTracks = {};
            Object.values(tracksMeta).forEach(t => {
                const copy = { ...t };
                delete copy.url;
                serializableTracks[t.id] = copy;
            });
            store.put({ key: 'library', tracks: serializableTracks, playlists });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }

    async loadMetadata() {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const tx = this.db.transaction('appState', 'readonly');
            const req = tx.objectStore('appState').get('library');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }
}

export const storageDB = new LocalLibraryDB();
