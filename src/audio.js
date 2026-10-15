import { AppState, getCurrentTrack } from './state.js';

export class SoundEngine {
    constructor(htmlAudioElement) {
        this.ctx = null;
        this.masterGain = null;
        this.crackleGain = null;
        this.synthInterval = null;
        this.stepCounter = 0;
        this.htmlAudio = htmlAudioElement || document.getElementById('html5-audio');

        this.onTimeUpdate = null;
        this.onLoadedMetadata = null;
        this.onEnded = null;

        if (this.htmlAudio) {
            this.bindAudioEvents();
        }
    }

    setAudioElement(el) {
        this.htmlAudio = el;
        this.bindAudioEvents();
    }

    bindAudioEvents() {
        this.htmlAudio.addEventListener('timeupdate', () => {
            const track = getCurrentTrack();
            if (track && !track.isSynth && !AppState.isSeeking) {
                AppState.currentTime = this.htmlAudio.currentTime;
                if (this.htmlAudio.duration && !isNaN(this.htmlAudio.duration)) {
                    AppState.duration = this.htmlAudio.duration;
                }
                if (this.onTimeUpdate) this.onTimeUpdate();
            }
        });

        this.htmlAudio.addEventListener('loadedmetadata', () => {
            const track = getCurrentTrack();
            if (track && !track.isSynth && this.htmlAudio.duration && !isNaN(this.htmlAudio.duration)) {
                track.duration = this.htmlAudio.duration;
                AppState.duration = this.htmlAudio.duration;
                if (this.onLoadedMetadata) this.onLoadedMetadata();
            }
        });

        this.htmlAudio.addEventListener('ended', () => {
            if (this.onEnded) this.onEnded();
        });
    }

    initContext() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = AppState.isMuted ? 0 : AppState.volume;
            this.masterGain.connect(this.ctx.destination);
            this.setupVinylCrackle();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setupVinylCrackle() {
        const bufferSize = 2 * this.ctx.sampleRate;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            let sample = (Math.random() * 2 - 1) * 0.012;
            if (Math.random() < 0.0012) {
                sample += (Math.random() * 2 - 1) * 0.35;
            }
            output[i] = sample;
        }

        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1900;
        filter.Q.value = 0.9;

        this.crackleGain = this.ctx.createGain();
        this.crackleGain.gain.value = 0;

        whiteNoise.connect(filter);
        filter.connect(this.crackleGain);
        this.crackleGain.connect(this.masterGain);
        whiteNoise.start(0);
    }

    updateCrackleLevel() {
        if (!this.crackleGain || !this.ctx) return;
        const shouldCrackle = AppState.playbackState === 'PLAYING' && AppState.crackleEnabled;
        this.crackleGain.gain.setTargetAtTime(shouldCrackle ? 0.25 : 0, this.ctx.currentTime, 0.15);
    }

    setVolume(val) {
        AppState.volume = val;
        if (this.htmlAudio) {
            this.htmlAudio.volume = AppState.isMuted ? 0 : val;
        }
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(AppState.isMuted ? 0 : val, this.ctx.currentTime, 0.05);
        }
    }

    playTrack(track, startTime = 0) {
        if (!track) return;
        this.initContext();
        this.stopAllAudioOnly();

        if (track.isSynth) {
            if (this.htmlAudio) this.htmlAudio.pause();
            AppState.currentTime = startTime;
            AppState.duration = track.duration;
            this.startSynthSequencer(track.synthPreset);
        } else {
            if (this.htmlAudio) {
                if (this.htmlAudio.src !== track.url) {
                    this.htmlAudio.src = track.url;
                }
                this.htmlAudio.currentTime = startTime;
                this.htmlAudio.volume = AppState.isMuted ? 0 : AppState.volume;
                this.htmlAudio.play().catch(() => {});
            }
        }
        this.updateCrackleLevel();
    }

    pauseAudio() {
        const track = getCurrentTrack();
        if (!track) return;
        if (track.isSynth) {
            this.stopSynthSequencer();
        } else {
            if (this.htmlAudio) this.htmlAudio.pause();
        }
        this.updateCrackleLevel();
    }

    stopAllAudioOnly() {
        this.stopSynthSequencer();
        if (this.htmlAudio) this.htmlAudio.pause();
        this.updateCrackleLevel();
    }

    seek(seconds) {
        const track = getCurrentTrack();
        if (!track) return;
        AppState.currentTime = seconds;
        if (!track.isSynth && this.htmlAudio) {
            this.htmlAudio.currentTime = seconds;
        }
    }

    startSynthSequencer(preset) {
        this.stopSynthSequencer();
        const stepMs = 450;

        const triggerStep = () => {
            if (AppState.playbackState !== 'PLAYING') return;
            this.playSynthStep(preset, this.stepCounter);
            this.stepCounter++;
        };

        triggerStep();
        this.synthInterval = setInterval(triggerStep, stepMs);
    }

    stopSynthSequencer() {
        if (this.synthInterval) {
            clearInterval(this.synthInterval);
            this.synthInterval = null;
        }
    }

    playSynthStep(preset, step) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const chords = {
            lofi_jazz: [
                [261.63, 329.63, 392.00, 493.88],
                [220.00, 261.63, 329.63, 392.00],
                [293.66, 349.23, 440.00, 523.25],
                [196.00, 246.94, 293.66, 349.23]
            ],
            ambient_waltz: [
                [293.66, 369.99, 440.00, 554.37],
                [246.94, 329.63, 392.00, 493.88],
                [329.63, 392.00, 493.88, 587.33],
                [220.00, 277.18, 329.63, 392.00]
            ],
            zen_pluck: [
                [261.63, 293.66, 329.63, 392.00, 440.00, 523.25],
                [196.00, 220.00, 261.63, 293.66, 329.63, 392.00]
            ],
            warm_synth: [
                [174.61, 220.00, 261.63, 329.63],
                [164.81, 196.00, 246.94, 293.66],
                [146.83, 174.61, 220.00, 261.63],
                [130.81, 164.81, 196.00, 246.94]
            ]
        };

        const set = chords[preset] || chords.lofi_jazz;
        const chordIdx = Math.floor(step / 8) % set.length;
        const currentChord = set[chordIdx];

        if (step % 8 === 0) {
            currentChord.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = preset === 'warm_synth' ? 'sawtooth' : 'sine';
                osc.frequency.value = freq;

                const lp = this.ctx.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = 950;

                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.055 / (idx * 0.35 + 1), now + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.0008, now + 3.2);

                osc.connect(lp);
                lp.connect(gain);
                gain.connect(this.masterGain);

                osc.start(now);
                osc.stop(now + 3.3);
            });
        }

        if (step % 2 === 0 || Math.random() > 0.45) {
            const noteFreq = currentChord[step % currentChord.length] * (step % 4 === 0 ? 2 : 1);
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.value = noteFreq;

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.04, now + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.9);

            osc.connect(gain);
            gain.connect(this.masterGain);

            osc.start(now);
            osc.stop(now + 0.95);
        }

        if (step % 4 === 0) {
            const bassOsc = this.ctx.createOscillator();
            const bassGain = this.ctx.createGain();
            bassOsc.type = 'sine';
            bassOsc.frequency.value = currentChord[0] / 2;

            bassGain.gain.setValueAtTime(0.001, now);
            bassGain.gain.linearRampToValueAtTime(0.09, now + 0.04);
            bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

            bassOsc.connect(bassGain);
            bassGain.connect(this.masterGain);

            bassOsc.start(now);
            bassOsc.stop(now + 0.75);
        }
    }
}

export const audioEngine = new SoundEngine();
