import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_SYNTH_TRACKS } from './constants.js';
import { AppState } from './state.js';

export class Turntable3D {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(
            35,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            100
        );
        // Startup in ISO view
        this.camera.position.set(5.9, 5.1, 6.7);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.02;
        this.container.appendChild(this.renderer.domElement);

        // Soft studio environment map for metallic PBR reflections
        this.scene.environment = this.createStudioEnvMap();

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.target.set(0, 0.2, 0);
        this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
        this.controls.minDistance = 3.8;
        this.controls.maxDistance = 14;

        // Cancel automated camera transition if user manually grabs the orbit canvas
        this.renderer.domElement.addEventListener('pointerdown', () => {
            this.camAnim = null;
        });

        this.clock = new THREE.Clock();
        this.currentRPM = 0;
        this.targetRPM = 0;

        this.mechState = 'IDLE_STOPPED';
        this.recordHeight = 0.0;
        this.armYaw = 0.0;
        this.armPitch = 0.0;
        this.powerSwitchAngle = -0.35;
        this.dustCoverOpen = true;
        this.dustCoverAngle = 1.02;

        // Spherical smooth camera transition state
        this.camAnim = null;

        this.initLights();
        this.buildTurntable();
        this.bindResize();
    }

    // --- PROCEDURAL ENVIRONMENT & TEXTURES ---
    createStudioEnvMap() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Base studio horizon gradient
        const bg = ctx.createLinearGradient(0, 0, 0, 256);
        bg.addColorStop(0.0, '#181A1F');
        bg.addColorStop(0.45, '#2C2825');
        bg.addColorStop(0.5, '#12100E');
        bg.addColorStop(1.0, '#080706');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 512, 256);

        // Warm key softbox reflection strip
        const softbox1 = ctx.createRadialGradient(140, 60, 5, 140, 60, 95);
        softbox1.addColorStop(0, 'rgba(255, 246, 230, 0.95)');
        softbox1.addColorStop(0.5, 'rgba(255, 235, 205, 0.35)');
        softbox1.addColorStop(1, 'rgba(255, 235, 205, 0)');
        ctx.fillStyle = softbox1;
        ctx.fillRect(0, 0, 512, 160);

        // Cool rim softbox reflection strip
        const softbox2 = ctx.createRadialGradient(390, 75, 5, 390, 75, 80);
        softbox2.addColorStop(0, 'rgba(210, 230, 255, 0.85)');
        softbox2.addColorStop(0.5, 'rgba(190, 215, 245, 0.25)');
        softbox2.addColorStop(1, 'rgba(190, 215, 245, 0)');
        ctx.fillStyle = softbox2;
        ctx.fillRect(0, 0, 512, 160);

        // Overhead specular ribbon for chrome tonearm highlights
        ctx.fillStyle = 'rgba(255, 252, 245, 0.45)';
        ctx.fillRect(60, 22, 390, 10);

        const tex = new THREE.CanvasTexture(canvas);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.encoding = THREE.sRGBEncoding;

        if (this.renderer) {
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            pmrem.compileEquirectangularShader();
            const envRT = pmrem.fromEquirectangular(tex);
            tex.dispose();
            pmrem.dispose();
            return envRT.texture;
        }
        return tex;
    }

    createWalnutTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // 1. Natural warm vintage walnut & teak base gradient
        const baseGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
        baseGrad.addColorStop(0.0, '#52341E');
        baseGrad.addColorStop(0.35, '#422714');
        baseGrad.addColorStop(0.65, '#5A371F');
        baseGrad.addColorStop(1.0, '#361E0F');
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, 0, 1024, 1024);

        // 2. Subtle warm amber subsurface depth
        const warmGlow = ctx.createRadialGradient(512, 512, 80, 512, 512, 750);
        warmGlow.addColorStop(0.0, 'rgba(180, 105, 45, 0.08)');
        warmGlow.addColorStop(0.5, 'rgba(130, 70, 28, 0.04)');
        warmGlow.addColorStop(1.0, 'rgba(50, 22, 10, 0.06)');
        ctx.fillStyle = warmGlow;
        ctx.fillRect(0, 0, 1024, 1024);

        // 3. Flowing cathedral grain waves (deep umber, warm chestnut, and soft caramel)
        for (let i = 0; i < 420; i++) {
            const yBase = (i / 420) * 1024;
            const amp = 4.5 + Math.sin(i * 0.065) * 14;
            const freq = 0.0028 + (i % 7) * 0.00055;
            const phase = (i * 0.41) % (Math.PI * 2);

            ctx.beginPath();
            ctx.lineWidth = 1.0 + (i % 4) * 0.8;
            ctx.strokeStyle = i % 3 === 0
                ? 'rgba(28, 12, 5, 0.22)'      // Deep dark umber grain
                : i % 2 === 0
                    ? 'rgba(150, 90, 45, 0.12)'  // Subtle warm caramel highlight
                    : 'rgba(68, 34, 16, 0.18)';  // Medium walnut midtone

            for (let x = 0; x <= 1024; x += 24) {
                const y = yBase
                    + Math.sin(x * freq + phase) * amp
                    + Math.cos(x * freq * 2.2) * (amp * 0.32);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // 4. Fine interlocking wood pores & warm mineral streaks
        for (let i = 0; i < 1800; i++) {
            const w = 6 + Math.random() * 22;
            ctx.fillStyle = i % 4 === 0
                ? 'rgba(160, 100, 50, 0.08)'
                : 'rgba(28, 12, 5, 0.20)';
            ctx.fillRect(Math.random() * 1024, Math.random() * 1024, w, 1.2);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    }

    createBrushedMetalTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 512, 512);
        grad.addColorStop(0, '#D5D1C8');
        grad.addColorStop(0.5, '#E2DFD7');
        grad.addColorStop(1, '#CFCBC2');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);

        // Anisotropic hairline brush strokes
        for (let i = 0; i < 2600; i++) {
            const shade = 190 + Math.floor(Math.random() * 50);
            const alpha = 0.08 + Math.random() * 0.12;
            ctx.fillStyle = `rgba(${shade}, ${shade - 1}, ${shade - 4}, ${alpha})`;
            ctx.fillRect(0, Math.random() * 512, 512, 0.75 + Math.random() * 0.75);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    }

    createKnurlBumpTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 512, 64);

        const steps = 128;
        const stepW = 512 / steps;
        for (let i = 0; i < steps; i++) {
            ctx.fillStyle = i % 2 === 0 ? '#FFFFFF' : '#202020';
            ctx.fillRect(i * stepW, 0, stepW * 0.6, 64);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    createCounterweightScaleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#E4E2DD';
        ctx.fillRect(0, 0, 512, 128);

        ctx.strokeStyle = '#181614';
        ctx.fillStyle = '#181614';
        ctx.font = 'bold 26px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';

        for (let i = 0; i < 35; i++) {
            const x = (i / 35) * 512;
            const isMajor = i % 5 === 0;
            ctx.lineWidth = isMajor ? 3.5 : 1.8;
            ctx.beginPath();
            ctx.moveTo(x, 128);
            ctx.lineTo(x, isMajor ? 68 : 90);
            ctx.stroke();

            if (isMajor) {
                const val = ((i / 5) * 0.5).toFixed(1).replace('.0', '');
                ctx.fillText(val, x, 52);
            }
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    }

    createPitchScaleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Anodized dark bezel background
        ctx.fillStyle = '#1B1917';
        ctx.fillRect(0, 0, 128, 512);

        // Subtle metallic outer border
        ctx.strokeStyle = '#4A453E';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, 124, 508);

        // Header label
        ctx.fillStyle = '#9E9689';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PITCH ADJ. %', 64, 22);

        ctx.strokeStyle = '#BDB6AC';
        ctx.font = 'bold 17px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';

        const labels = ['-8', '-6', '-4', '-2', '0', '+2', '+4', '+6', '+8'];
        for (let i = 0; i <= 32; i++) {
            const y = 44 + (i / 32) * 432;
            const isMajor = i % 4 === 0;
            ctx.lineWidth = isMajor ? 2.8 : 1.4;
            ctx.strokeStyle = (i === 16) ? '#52C478' : '#BDB6AC';
            ctx.beginPath();
            ctx.moveTo(isMajor ? 40 : 52, y);
            ctx.lineTo(72, y);
            ctx.stroke();

            if (isMajor) {
                const lbl = labels[i / 4];
                ctx.fillStyle = lbl === '0' ? '#52C478' : '#DCD6CB';
                ctx.fillText(lbl, 35, y + 6);
            }
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    }

    createBadgeTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#141210';
        ctx.fillRect(0, 0, 512, 96);

        ctx.strokeStyle = '#C8A248';
        ctx.lineWidth = 4;
        ctx.strokeRect(6, 6, 500, 84);

        ctx.fillStyle = '#DFB858';
        ctx.font = 'bold 34px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.letterSpacing = '6px';
        ctx.fillText('CHRONO-FIDELITY', 256, 52);

        ctx.fillStyle = '#A09070';
        ctx.font = '14px "JetBrains Mono", monospace';
        ctx.fillText('DIRECT DRIVE TURNTABLE SYSTEM', 256, 76);

        const tex = new THREE.CanvasTexture(canvas);
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    }

    // Deep Charcoal Vinyl Grooves + Anisotropic Butterfly Sheen + Dynamic Record Label
    createVinylTexture(track) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        const cx = 512, cy = 512;

        // Base vinyl tone: deep charcoal/carbon black with subtle warmth
        ctx.fillStyle = '#0E0D0C';
        ctx.fillRect(0, 0, 1024, 1024);

        // 1. Primary vinyl anisotropic reflection lobes (butterfly/bow-tie light sheen)
        const grad1 = ctx.createConicGradient(0.78, cx, cy);
        grad1.addColorStop(0.00, 'rgba(255, 255, 255, 0.0)');
        grad1.addColorStop(0.09, 'rgba(255, 255, 255, 0.12)');
        grad1.addColorStop(0.125, 'rgba(255, 255, 255, 0.25)');
        grad1.addColorStop(0.16, 'rgba(255, 255, 255, 0.12)');
        grad1.addColorStop(0.25, 'rgba(255, 255, 255, 0.0)');
        grad1.addColorStop(0.50, 'rgba(255, 255, 255, 0.0)');
        grad1.addColorStop(0.59, 'rgba(255, 255, 255, 0.12)');
        grad1.addColorStop(0.625, 'rgba(255, 255, 255, 0.25)');
        grad1.addColorStop(0.66, 'rgba(255, 255, 255, 0.12)');
        grad1.addColorStop(0.75, 'rgba(255, 255, 255, 0.0)');
        grad1.addColorStop(1.00, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad1;
        ctx.fillRect(0, 0, 1024, 1024);

        // 2. Secondary orthogonal cross-reflection sheen (4-point studio highlight)
        const grad2 = ctx.createConicGradient(2.35, cx, cy);
        grad2.addColorStop(0.00, 'rgba(255, 255, 255, 0.0)');
        grad2.addColorStop(0.10, 'rgba(255, 255, 255, 0.08)');
        grad2.addColorStop(0.125, 'rgba(255, 255, 255, 0.16)');
        grad2.addColorStop(0.15, 'rgba(255, 255, 255, 0.08)');
        grad2.addColorStop(0.25, 'rgba(255, 255, 255, 0.0)');
        grad2.addColorStop(0.50, 'rgba(255, 255, 255, 0.0)');
        grad2.addColorStop(0.60, 'rgba(255, 255, 255, 0.08)');
        grad2.addColorStop(0.625, 'rgba(255, 255, 255, 0.16)');
        grad2.addColorStop(0.65, 'rgba(255, 255, 255, 0.08)');
        grad2.addColorStop(0.75, 'rgba(255, 255, 255, 0.0)');
        grad2.addColorStop(1.00, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad2;
        ctx.fillRect(0, 0, 1024, 1024);

        // 3. Dense concentric micro-grooves with track gaps
        const isTrackGap = (r) => (r > 264 && r < 270) || (r > 348 && r < 354) || (r > 426 && r < 431);

        for (let r = 172; r < 492; r += 1.5) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            if (isTrackGap(r)) {
                // Smooth dark glossy unmodulated gap between tracks
                ctx.strokeStyle = '#080706';
                ctx.lineWidth = 1.6;
            } else {
                // Alternating groove ridges and deep troughs for realistic contrast
                const isRidge = (Math.round(r * 2) % 3) === 0;
                ctx.strokeStyle = isRidge
                    ? 'rgba(255, 255, 255, 0.075)'
                    : 'rgba(0, 0, 0, 0.70)';
                ctx.lineWidth = 0.95;
            }
            ctx.stroke();
        }

        // 4. Glossy outer lead-in groove margin
        ctx.beginPath();
        ctx.arc(cx, cy, 496, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // 5. Glossy inner lead-out runout grooves
        for (let r = 168; r < 172; r += 1.0) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }

        // 6. Center Vinyl Label
        const labelRadius = 165;
        ctx.beginPath();
        ctx.arc(cx, cy, labelRadius, 0, Math.PI * 2);
        ctx.fillStyle = (track && track.labelColor) || '#C85A32';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, labelRadius - 14, 0, Math.PI * 2);
        ctx.strokeStyle = (track && track.accentColor) || '#F6F4F0';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, labelRadius - 24, Math.PI, Math.PI * 2);
        ctx.fillStyle = '#F6F4F0';
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#1E1B18';
        ctx.font = 'bold 24px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SPINDLE', cx, cy - 82);

        ctx.font = '16px "JetBrains Mono", monospace';
        ctx.fillText('STEREO 33⅓', cx, cy - 52);

        ctx.fillStyle = '#F6F4F0';
        ctx.font = 'bold 23px "Plus Jakarta Sans", sans-serif';
        const cleanTitle = ((track && track.title) || 'UNTITLED').substring(0, 18).toUpperCase();
        ctx.fillText(cleanTitle, cx, cy + 68);

        ctx.font = '17px "Plus Jakarta Sans", sans-serif';
        const cleanArtist = ((track && track.artist) || 'UNKNOWN ARTIST').substring(0, 22);
        ctx.fillText(cleanArtist, cx, cy + 96);

        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.fillStyle = '#1E1B18';
        ctx.fill();

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 4;
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    // --- LIGHTING ---
    initLights() {
        if (!this.scene.environment) {
            this.scene.environment = this.createStudioEnvMap();
        }

        this.ambientLight = new THREE.AmbientLight(0xFFF8EE, 0.35);
        this.scene.add(this.ambientLight);

        this.hemiLight = new THREE.HemisphereLight(0xFFF6E8, 0x1D1814, 0.42);
        this.hemiLight.position.set(0, 10, 0);
        this.scene.add(this.hemiLight);

        // Warm key light with tightened shadow frustum for crisp tonearm/stylus shadows
        this.dirLight = new THREE.DirectionalLight(0xFFF5E4, 1.25);
        this.dirLight.position.set(-4.2, 9.2, 5.8);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.dirLight.shadow.camera.near = 2.0;
        this.dirLight.shadow.camera.far = 20.0;
        const d = 3.45;
        this.dirLight.shadow.camera.left = -d;
        this.dirLight.shadow.camera.right = d;
        this.dirLight.shadow.camera.top = d;
        this.dirLight.shadow.camera.bottom = -d;
        this.dirLight.shadow.bias = -0.0003;
        this.dirLight.shadow.radius = 2.2;
        this.scene.add(this.dirLight);

        // Cool back-right rim light to separate chrome tonearm and acrylic edges
        this.rimLight = new THREE.DirectionalLight(0xDCE6F2, 0.65);
        this.rimLight.position.set(6.5, 3.4, -5.2);
        this.scene.add(this.rimLight);

        // Overhead specular fill for vinyl groove sheen
        this.vinylSheenLight = new THREE.DirectionalLight(0xFFF9F0, 0.32);
        this.vinylSheenLight.position.set(-0.5, 6.0, -3.5);
        this.scene.add(this.vinylSheenLight);

        // Neon orange strobe prism light
        this.strobeLight = new THREE.PointLight(0xFF5A1F, 1.1, 1.9, 2.0);
        this.strobeLight.position.set(-1.82, 0.55, 1.38);
        this.scene.add(this.strobeLight);

        // Pop-up stylus target light (defaults to 0 intensity when off)
        this.targetLight = new THREE.PointLight(0xFFCC77, 0.0, 1.8, 2.0);
        this.targetLight.position.set(0.75, 0.58, 1.22);
        this.scene.add(this.targetLight);
    }

    setTheme(isDark) {
        if (isDark) {
            this.ambientLight.intensity = 0.28;
            if (this.hemiLight) this.hemiLight.intensity = 0.32;
            this.dirLight.intensity = 1.05;
            this.renderer.toneMappingExposure = 0.96;
        } else {
            this.ambientLight.intensity = 0.35;
            if (this.hemiLight) this.hemiLight.intensity = 0.42;
            this.dirLight.intensity = 1.25;
            this.renderer.toneMappingExposure = 1.02;
        }
    }

    // --- TURNTABLE 3D MESH HIERARCHY ---
    buildTurntable() {
        this.turntableGroup = new THREE.Group();
        this.scene.add(this.turntableGroup);

        // --- PBR MATERIALS ---
        const walnutTex = this.createWalnutTexture();
        const walnutMat = new THREE.MeshPhysicalMaterial({
            map: walnutTex,
            bumpMap: walnutTex,
            bumpScale: 0.003,
            roughness: 0.38,
            metalness: 0.02,
            clearcoat: 0.35,
            clearcoatRoughness: 0.26
        });

        const brushedTex = this.createBrushedMetalTexture();
        const topPlateMat = new THREE.MeshStandardMaterial({
            map: brushedTex,
            bumpMap: brushedTex,
            bumpScale: 0.0025,
            color: 0xDFDBD2,
            roughness: 0.26,
            metalness: 0.82
        });

        const knurlTex = this.createKnurlBumpTexture();
        const knurledAlumMat = new THREE.MeshStandardMaterial({
            color: 0xE2E0DC,
            bumpMap: knurlTex,
            bumpScale: 0.012,
            roughness: 0.28,
            metalness: 0.88
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xFFFFFF,
            roughness: 0.05,
            metalness: 0.98
        });

        const machinedAlumMat = new THREE.MeshStandardMaterial({
            color: 0xE2E0DC,
            roughness: 0.20,
            metalness: 0.88
        });

        const brassMat = new THREE.MeshStandardMaterial({
            color: 0xE2BA4C,
            roughness: 0.16,
            metalness: 0.94
        });

        const darkMat = new THREE.MeshStandardMaterial({
            color: 0x181614,
            roughness: 0.45,
            metalness: 0.28
        });

        const rubberMat = new THREE.MeshStandardMaterial({
            color: 0x11100F,
            roughness: 0.88,
            metalness: 0.03
        });

        // 1. Invisible Shadow Floor
        const shadowFloor = new THREE.Mesh(
            new THREE.PlaneGeometry(30, 30),
            new THREE.ShadowMaterial({ opacity: 0.22 })
        );
        shadowFloor.rotation.x = -Math.PI / 2;
        shadowFloor.position.y = -0.46;
        shadowFloor.receiveShadow = true;
        this.scene.add(shadowFloor);

        // 2. Walnut Cabinet Plinth with Mitered Surround & Recessed Shadow Reveal
        const plinthCore = new THREE.Mesh(new THREE.BoxGeometry(5.16, 0.56, 4.16), walnutMat);
        plinthCore.castShadow = true;
        plinthCore.receiveShadow = true;
        this.turntableGroup.add(plinthCore);

        // Top & bottom chamfer bevel trim on the walnut cabinet
        const bevelTrimTop = new THREE.Mesh(new THREE.BoxGeometry(5.20, 0.50, 4.20), walnutMat);
        bevelTrimTop.castShadow = true;
        bevelTrimTop.receiveShadow = true;
        this.turntableGroup.add(bevelTrimTop);

        const wallThickness = 0.18;
        const wallHeight = 0.075;
        const wallY = 0.28 + wallHeight / 2;

        const frontBackGeo = new THREE.BoxGeometry(5.16, wallHeight, wallThickness);
        const frontWall = new THREE.Mesh(frontBackGeo, walnutMat);
        frontWall.position.set(0, wallY, 2.08 - wallThickness / 2);
        frontWall.castShadow = true;
        frontWall.receiveShadow = true;
        this.turntableGroup.add(frontWall);

        const backWall = new THREE.Mesh(frontBackGeo, walnutMat);
        backWall.position.set(0, wallY, -2.08 + wallThickness / 2);
        backWall.castShadow = true;
        backWall.receiveShadow = true;
        this.turntableGroup.add(backWall);

        const leftRightGeo = new THREE.BoxGeometry(wallThickness, wallHeight, 4.16 - wallThickness * 2);
        const leftWall = new THREE.Mesh(leftRightGeo, walnutMat);
        leftWall.position.set(-2.58 + wallThickness / 2, wallY, 0);
        leftWall.castShadow = true;
        leftWall.receiveShadow = true;
        this.turntableGroup.add(leftWall);

        const rightWall = new THREE.Mesh(leftRightGeo, walnutMat);
        rightWall.position.set(2.58 - wallThickness / 2, wallY, 0);
        rightWall.castShadow = true;
        rightWall.receiveShadow = true;
        this.turntableGroup.add(rightWall);

        // Dark recessed shadow-gap liner between walnut surround and brushed aluminum deck
        const deckLiner = new THREE.Mesh(new THREE.BoxGeometry(4.82, 0.045, 3.82), darkMat);
        deckLiner.position.y = 0.29;
        this.turntableGroup.add(deckLiner);

        const subSkirt = new THREE.Mesh(new THREE.BoxGeometry(4.85, 0.08, 3.85), darkMat);
        subSkirt.position.y = -0.30;
        this.turntableGroup.add(subSkirt);

        // Front Engraved Brass & Anodized Nameplate Badge
        const badgeTrim = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.18, 0.025), brassMat);
        badgeTrim.position.set(0, 0.02, 2.095);
        this.turntableGroup.add(badgeTrim);

        const badgePlate = new THREE.Mesh(
            new THREE.BoxGeometry(0.98, 0.145, 0.03),
            new THREE.MeshStandardMaterial({
                map: this.createBadgeTexture(),
                roughness: 0.25,
                metalness: 0.6
            })
        );
        badgePlate.position.set(0, 0.02, 2.10);
        this.turntableGroup.add(badgePlate);

        // Brushed Aluminum Top Deck Plate (slightly inset to show dark perimeter reveal)
        const deck = new THREE.Mesh(new THREE.BoxGeometry(4.76, 0.05, 3.76), topPlateMat);
        deck.position.y = 0.295;
        deck.receiveShadow = true;
        this.turntableGroup.add(deck);

        // Corner Hex Socket Cap Bolts & Washers
        const boltCoords = [
            [-2.23, 0.322, -1.73],
            [2.23, 0.322, -1.73],
            [-2.23, 0.322, 1.73],
            [2.23, 0.322, 1.73]
        ];
        boltCoords.forEach(([bx, by, bz]) => {
            const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.006, 20), machinedAlumMat);
            washer.position.set(bx, by, bz);
            this.turntableGroup.add(washer);

            const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.018, 16), chromeMat);
            bolt.position.set(bx, by + 0.006, bz);
            this.turntableGroup.add(bolt);

            const hexSocket = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 6), darkMat);
            hexSocket.position.set(bx, by + 0.008, bz);
            this.turntableGroup.add(hexSocket);
        });

        // 45 RPM Machined Aluminum Puck Adapter in Recessed Well
        const adapterWell = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 32), darkMat);
        adapterWell.position.set(-2.02, 0.315, -1.42);
        this.turntableGroup.add(adapterWell);

        const rpmAdapter = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.045, 32), machinedAlumMat);
        rpmAdapter.position.set(-2.02, 0.33, -1.42);
        rpmAdapter.castShadow = true;
        this.turntableGroup.add(rpmAdapter);

        const adapterInnerStep = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.052, 32), chromeMat);
        adapterInnerStep.position.set(-2.02, 0.33, -1.42);
        this.turntableGroup.add(adapterInnerStep);

        const adapterHole = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.058, 24), darkMat);
        adapterHole.position.set(-2.02, 0.335, -1.42);
        this.turntableGroup.add(adapterHole);

        // Multi-Tiered Vibration-Damped Isolation Feet
        const footPositions = [
            [-2.15, -0.36, -1.65],
            [2.15, -0.36, -1.65],
            [-2.15, -0.36, 1.65],
            [2.15, -0.36, 1.65]
        ];
        footPositions.forEach(([fx, fy, fz]) => {
            const footRubber = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.25, 0.11, 32), rubberMat);
            footRubber.position.set(fx, fy - 0.035, fz);
            footRubber.castShadow = true;
            this.turntableGroup.add(footRubber);

            const footAlumSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.295, 0.07, 32), machinedAlumMat);
            footAlumSkirt.position.set(fx, fy + 0.03, fz);
            this.turntableGroup.add(footAlumSkirt);

            const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.035, 32), brassMat);
            collar.position.set(fx, fy + 0.065, fz);
            this.turntableGroup.add(collar);
        });

        // 3. Recessed Platter Well & Die-Cast Strobe Platter
        const platterWell = new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.78, 0.022, 64), darkMat);
        platterWell.position.set(-0.52, 0.312, 0);
        this.turntableGroup.add(platterWell);

        this.platterGroup = new THREE.Group();
        this.platterGroup.position.set(-0.52, 0.355, 0);
        this.turntableGroup.add(this.platterGroup);

        // Machined Aluminum Tapered Platter Base
        const platterBase = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.74, 0.11, 64), machinedAlumMat);
        platterBase.castShadow = true;
        platterBase.receiveShadow = true;
        this.platterGroup.add(platterBase);

        // Polished Chrome Upper Rim (sits cleanly atop the tapered platter)
        const platterTopRim = new THREE.Mesh(new THREE.CylinderGeometry(1.685, 1.68, 0.035, 64), chromeMat);
        platterTopRim.position.y = 0.065;
        this.platterGroup.add(platterTopRim);

        // 60 Equally Distanced Vertical Pairs of Stroboscopic Teeth
        const dotCount = 60;
        for (let i = 0; i < dotCount; i++) {
            const angle = (i / dotCount) * Math.PI * 2;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            const upperTooth = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.02), darkMat);
            upperTooth.position.set(cosA * 1.702, 0.022, sinA * 1.702);
            upperTooth.rotation.y = -angle;
            this.platterGroup.add(upperTooth);

            const lowerTooth = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.024, 0.02), darkMat);
            lowerTooth.position.set(cosA * 1.722, -0.022, sinA * 1.722);
            lowerTooth.rotation.y = -angle;
            this.platterGroup.add(lowerTooth);
        }

        // Heavy Damped Rubber Platter Mat with Concentric Ribs & Center Metal Ring
        const matMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.635, 1.635, 0.022, 64), rubberMat);
        matMesh.position.y = 0.082;
        matMesh.receiveShadow = true;
        this.platterGroup.add(matMesh);

        const matCenterTrim = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.42, 48), machinedAlumMat);
        matCenterTrim.rotation.x = -Math.PI / 2;
        matCenterTrim.position.y = 0.094;
        this.platterGroup.add(matCenterTrim);

        [0.58, 0.85, 1.12, 1.38, 1.54].forEach(radius => {
            const gripRing = new THREE.Mesh(
                new THREE.TorusGeometry(radius, 0.005, 8, 64),
                darkMat
            );
            gripRing.rotation.x = Math.PI / 2;
            gripRing.position.y = 0.094;
            this.platterGroup.add(gripRing);
        });

        // Precision Center Spindle & Brass Bearing Shoulder
        const spindleCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.025, 32), machinedAlumMat);
        spindleCollar.position.y = 0.096;
        this.platterGroup.add(spindleCollar);

        const spindleShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.040, 0.34, 24), chromeMat);
        spindleShaft.position.y = 0.18;
        spindleShaft.castShadow = true;
        this.platterGroup.add(spindleShaft);

        const spindleTip = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.05, 24), chromeMat);
        spindleTip.position.y = 0.375;
        this.platterGroup.add(spindleTip);

        // 4. Vinyl Record Disc with Clearcoat Groove Sheen & Raised Center Label
        this.recordGroup = new THREE.Group();
        this.recordGroup.position.y = 0.105;
        this.platterGroup.add(this.recordGroup);

        const vinylTex = this.createVinylTexture({
            labelColor: '#C85A32',
            accentColor: '#F4A261',
            title: 'SPINDLE',
            artist: 'STEREO 33'
        });
        if (vinylTex) vinylTex.encoding = THREE.sRGBEncoding;

        this.vinylMat = new THREE.MeshPhysicalMaterial({
            map: vinylTex,
            bumpMap: vinylTex,
            bumpScale: 0.003,
            roughness: 0.22,
            metalness: 0.10,
            clearcoat: 0.95,
            clearcoatRoughness: 0.08,
            envMapIntensity: 0.95
        });

        const recordGeo = new THREE.CylinderGeometry(1.60, 1.60, 0.024, 64);
        this.recordMesh = new THREE.Mesh(recordGeo, [
            darkMat,
            this.vinylMat,
            this.vinylMat
        ]);
        this.recordMesh.castShadow = true;
        this.recordMesh.receiveShadow = true;
        this.recordGroup.add(this.recordMesh);

        // Raised outer lead-in rim bead (gruve-guard)
        const recordOuterBead = new THREE.Mesh(
            new THREE.TorusGeometry(1.588, 0.014, 12, 64),
            darkMat
        );
        recordOuterBead.rotation.x = Math.PI / 2;
        recordOuterBead.scale.z = 0.35;
        this.recordGroup.add(recordOuterBead);

        const spindleBushing = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.030, 32), brassMat);
        spindleBushing.position.y = 0.004;
        this.recordGroup.add(spindleBushing);

        // 5. Precision S-Shaped Tonearm & Multi-Axis Gimbal Assembly
        const armBasePos = new THREE.Vector3(1.65, 0.32, -1.05);

        // VTA (Vertical Tracking Angle) Helicoid Base & Lock Lever
        const armBase = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.49, 0.07, 48), darkMat);
        armBase.position.copy(armBasePos);
        armBase.castShadow = true;
        this.turntableGroup.add(armBase);

        const vtaScaleRing = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.43, 0.035, 48), knurledAlumMat);
        vtaScaleRing.position.set(armBasePos.x, armBasePos.y + 0.045, armBasePos.z);
        this.turntableGroup.add(vtaScaleRing);

        const armBaseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.37, 0.055, 36), machinedAlumMat);
        armBaseRing.position.set(armBasePos.x, armBasePos.y + 0.07, armBasePos.z);
        this.turntableGroup.add(armBaseRing);

        const vtaLockLever = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.05), brassMat);
        vtaLockLever.position.set(armBasePos.x - 0.38, armBasePos.y + 0.04, armBasePos.z - 0.18);
        vtaLockLever.rotation.y = 0.45;
        this.turntableGroup.add(vtaLockLever);

        const armCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.25, 0.22, 32), chromeMat);
        armCollar.position.set(armBasePos.x, armBasePos.y + 0.14, armBasePos.z);
        this.turntableGroup.add(armCollar);

        // Calibrated Anti-Skate Dial with Knurled Rim & Indicator Pointer
        const antiSkatePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.02, 24), machinedAlumMat);
        antiSkatePlate.position.set(armBasePos.x + 0.31, armBasePos.y + 0.038, armBasePos.z + 0.08);
        this.turntableGroup.add(antiSkatePlate);

        const antiSkateBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.10, 0.07, 24), darkMat);
        antiSkateBase.position.set(armBasePos.x + 0.31, armBasePos.y + 0.068, armBasePos.z + 0.08);
        this.turntableGroup.add(antiSkateBase);

        const antiSkateKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.055, 24), knurledAlumMat);
        antiSkateKnob.position.set(armBasePos.x + 0.31, armBasePos.y + 0.12, armBasePos.z + 0.08);
        this.turntableGroup.add(antiSkateKnob);

        const antiSkateCap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 24), brassMat);
        antiSkateCap.position.set(armBasePos.x + 0.31, armBasePos.y + 0.122, armBasePos.z + 0.08);
        this.turntableGroup.add(antiSkateCap);

        // Hydraulic Cueing Cylinder & Lever
        const cueCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.18, 20), chromeMat);
        cueCylinder.position.set(armBasePos.x - 0.24, armBasePos.y + 0.14, armBasePos.z + 0.28);
        this.turntableGroup.add(cueCylinder);

        const cuePiston = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 16), brassMat);
        cuePiston.position.set(armBasePos.x - 0.24, armBasePos.y + 0.22, armBasePos.z + 0.28);
        this.turntableGroup.add(cuePiston);

        this.cueLever = new THREE.Group();
        this.cueLever.position.set(armBasePos.x - 0.16, armBasePos.y + 0.18, armBasePos.z + 0.28);
        this.turntableGroup.add(this.cueLever);

        const cueHub = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 16), machinedAlumMat);
        cueHub.rotation.z = Math.PI / 2;
        this.cueLever.add(cueHub);

        const cueRod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12), chromeMat);
        cueRod.rotation.x = Math.PI / 2;
        cueRod.position.z = 0.14;
        this.cueLever.add(cueRod);

        const cueTip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.020, 0.09, 16), darkMat);
        cueTip.rotation.x = Math.PI / 2;
        cueTip.position.z = 0.26;
        this.cueLever.add(cueTip);

        // Tonearm Gimbal Yaw Group
        this.tonearmYawGroup = new THREE.Group();
        this.tonearmYawGroup.position.set(armBasePos.x, armBasePos.y + 0.28, armBasePos.z);
        this.turntableGroup.add(this.tonearmYawGroup);

        const gimbalBottomYoke = new THREE.Mesh(new THREE.BoxGeometry(0.365, 0.04, 0.095), machinedAlumMat);
        gimbalBottomYoke.position.set(0, -0.12, 0);
        this.tonearmYawGroup.add(gimbalBottomYoke);

        const gimbalPillarL = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.30, 0.095), machinedAlumMat);
        gimbalPillarL.position.set(-0.16, 0.02, 0);
        gimbalPillarL.castShadow = true;
        this.tonearmYawGroup.add(gimbalPillarL);

        const gimbalPillarR = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.30, 0.095), machinedAlumMat);
        gimbalPillarR.position.set(0.16, 0.02, 0);
        gimbalPillarR.castShadow = true;
        this.tonearmYawGroup.add(gimbalPillarR);

        // Side gimbal bearing screws
        [-0.188, 0.188].forEach(px => {
            const sideBearing = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 16), brassMat);
            sideBearing.rotation.z = Math.PI / 2;
            sideBearing.position.set(px, 0.0, 0);
            this.tonearmYawGroup.add(sideBearing);
        });

        const gimbalBridge = new THREE.Mesh(new THREE.BoxGeometry(0.365, 0.048, 0.095), machinedAlumMat);
        gimbalBridge.position.set(0, 0.16, 0);
        gimbalBridge.castShadow = true;
        this.tonearmYawGroup.add(gimbalBridge);

        const topPivotScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.045, 20), brassMat);
        topPivotScrew.position.set(0, 0.19, 0);
        this.tonearmYawGroup.add(topPivotScrew);

        const topScrewSlot = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.01, 0.01), darkMat);
        topScrewSlot.position.set(0, 0.212, 0);
        this.tonearmYawGroup.add(topScrewSlot);

        // Curved Rubber-Topped Cueing Lift Rail
        const cueBar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.022, 0.042), chromeMat);
        cueBar.position.set(-0.08, -0.09, 0.34);
        this.tonearmYawGroup.add(cueBar);

        const cueBarPad = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.036), rubberMat);
        cueBarPad.position.set(-0.08, -0.075, 0.34);
        this.tonearmYawGroup.add(cueBarPad);

        // Tonearm Pitch Group
        this.tonearmPitchGroup = new THREE.Group();
        this.tonearmYawGroup.add(this.tonearmPitchGroup);

        const innerGimbal = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.18, 28), brassMat);
        innerGimbal.rotation.z = Math.PI / 2;
        this.tonearmPitchGroup.add(innerGimbal);

        const innerGimbalSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 24), darkMat);
        innerGimbalSleeve.rotation.x = Math.PI / 2;
        this.tonearmPitchGroup.add(innerGimbalSleeve);

        // Tubular Chrome S-Shaped Tonearm
        const sArmCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, -0.10),
            new THREE.Vector3(0, 0, 0.18),
            new THREE.Vector3(0.125, 0, 0.68),
            new THREE.Vector3(0.135, 0, 1.22),
            new THREE.Vector3(0.04, 0, 1.72),
            new THREE.Vector3(0, 0, 2.00)
        ]);
        const sArmGeo = new THREE.TubeGeometry(sArmCurve, 64, 0.032, 24, false);
        const sArmMesh = new THREE.Mesh(sArmGeo, chromeMat);
        sArmMesh.castShadow = true;
        this.tonearmPitchGroup.add(sArmMesh);

        // Bayonet Headshell Locking Collar
        const lockingCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.06, 24), knurledAlumMat);
        lockingCollar.rotation.x = Math.PI / 2;
        lockingCollar.position.set(0, 0, 1.98);
        this.tonearmPitchGroup.add(lockingCollar);

        // Rear Counterweight Stub & Calibrated Counterweight Assembly
        const rearStub = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.48, 24), machinedAlumMat);
        rearStub.rotation.x = Math.PI / 2;
        rearStub.position.z = -0.32;
        this.tonearmPitchGroup.add(rearStub);

        const rearStubEndCap = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.03, 20), darkMat);
        rearStubEndCap.rotation.x = Math.PI / 2;
        rearStubEndCap.position.z = -0.565;
        this.tonearmPitchGroup.add(rearStubEndCap);

        const counterweightBody = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.22, 36), darkMat);
        counterweightBody.rotation.x = Math.PI / 2;
        counterweightBody.position.z = -0.35;
        counterweightBody.castShadow = true;
        this.tonearmPitchGroup.add(counterweightBody);

        const weightKnurlGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.07, 36), knurledAlumMat);
        weightKnurlGrip.rotation.x = Math.PI / 2;
        weightKnurlGrip.position.z = -0.39;
        this.tonearmPitchGroup.add(weightKnurlGrip);

        // Calibrated Tracking Force Scale Ring
        const scaleMat = new THREE.MeshStandardMaterial({
            map: this.createCounterweightScaleTexture(),
            roughness: 0.22,
            metalness: 0.78
        });
        const weightScaleRing = new THREE.Mesh(new THREE.CylinderGeometry(0.169, 0.169, 0.065, 36), [
            scaleMat,
            machinedAlumMat,
            machinedAlumMat
        ]);
        weightScaleRing.rotation.x = Math.PI / 2;
        weightScaleRing.position.z = -0.225;
        this.tonearmPitchGroup.add(weightScaleRing);

        const weightBrassTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.168, 0.04, 36), brassMat);
        weightBrassTrim.rotation.x = Math.PI / 2;
        weightBrassTrim.position.z = -0.48;
        this.tonearmPitchGroup.add(weightBrassTrim);

        // Perforated Die-Cast Headshell & Moving-Coil Cartridge
        const headshellGroup = new THREE.Group();
        headshellGroup.position.set(0, 0, 2.00);
        headshellGroup.rotation.y = -0.38;
        this.tonearmPitchGroup.add(headshellGroup);

        const headshellNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.09, 20), machinedAlumMat);
        headshellNeck.rotation.x = Math.PI / 2;
        headshellNeck.position.set(0, 0.004, 0.035);
        headshellGroup.add(headshellNeck);

        const headshellSlope = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.07), darkMat);
        headshellSlope.position.set(0, 0.012, 0.075);
        headshellSlope.rotation.x = -0.22;
        headshellGroup.add(headshellSlope);

        const headshellTop = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.024, 0.30), darkMat);
        headshellTop.position.set(0, 0.018, 0.19);
        headshellTop.castShadow = true;
        headshellGroup.add(headshellTop);

        // Classic circular weight-relief perforations on top of the headshell
        [0.12, 0.17, 0.22].forEach(hz => {
            [-0.042, 0.042].forEach(hx => {
                const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.026, 16), rubberMat);
                hole.position.set(hx, 0.018, hz);
                headshellGroup.add(hole);
            });
        });

        // Dual slotted cartridge mounting screws + brass nuts
        [-0.048, 0.048].forEach(sx => {
            const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.016, 16), brassMat);
            screw.position.set(sx, 0.030, 0.255);
            headshellGroup.add(screw);
        });

        // 4 Color-Coded Litz Lead Wires (Red=R+, White=L+, Green=R-, Blue=L-)
        const wireConfigs = [
            { x: -0.052, y: -0.012, color: 0xECECEC }, // White (Left +)
            { x: -0.024, y: -0.024, color: 0x2B6CB0 }, // Blue  (Left -)
            { x:  0.024, y: -0.024, color: 0x2F855A }, // Green (Right -)
            { x:  0.052, y: -0.012, color: 0xD93829 }  // Red   (Right +)
        ];
        wireConfigs.forEach(cfg => {
            const wireCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(cfg.x * 0.55, 0.0, 0.04),
                new THREE.Vector3(cfg.x * 1.15, cfg.y - 0.01, 0.085),
                new THREE.Vector3(cfg.x * 0.85, cfg.y, 0.13)
            ]);
            const wireGeo = new THREE.TubeGeometry(wireCurve, 12, 0.0045, 8, false);
            const wireMat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.4, metalness: 0.1 });
            headshellGroup.add(new THREE.Mesh(wireGeo, wireMat));
        });

        // Moving-Coil Phono Cartridge Body, Mounting Plate & Stylus Cantilever
        const cartMountPlate = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.018, 0.23), machinedAlumMat);
        cartMountPlate.position.set(0, -0.002, 0.205);
        headshellGroup.add(cartMountPlate);

        const cartridgeBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.142, 0.092, 0.22),
            new THREE.MeshPhysicalMaterial({
                color: 0xC85A32,
                roughness: 0.22,
                metalness: 0.18,
                clearcoat: 0.65
            })
        );
        cartridgeBody.position.set(0, -0.052, 0.205);
        cartridgeBody.castShadow = true;
        headshellGroup.add(cartridgeBody);

        const stylusGuard = new THREE.Mesh(new THREE.BoxGeometry(0.146, 0.038, 0.065), brassMat);
        stylusGuard.position.set(0, -0.076, 0.295);
        headshellGroup.add(stylusGuard);

        // Angled Aluminum Cantilever Tube & Diamond Stylus Tip
        const cantilever = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.005, 0.095, 10), chromeMat);
        cantilever.rotation.x = Math.PI / 2 + 0.36;
        cantilever.position.set(0, -0.102, 0.265);
        headshellGroup.add(cantilever);

        const needle = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.032, 12), chromeMat);
        needle.rotation.x = Math.PI;
        needle.position.set(0, -0.122, 0.298);
        headshellGroup.add(needle);

        // Sculpted Chrome Finger Lift with Rolled Tip
        const fingerLiftCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.082, 0.016, 0.22),
            new THREE.Vector3(0.125, 0.022, 0.225),
            new THREE.Vector3(0.155, 0.052, 0.24),
            new THREE.Vector3(0.162, 0.044, 0.255)
        ]);
        const fingerLiftGeo = new THREE.TubeGeometry(fingerLiftCurve, 20, 0.0065, 12, false);
        const fingerLift = new THREE.Mesh(fingerLiftGeo, chromeMat);
        headshellGroup.add(fingerLift);

        // 6. Tonearm Rest Post, U-Cradle & Flip Lock Latch
        const restBase = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.03, 20), machinedAlumMat);
        restBase.position.set(1.65, 0.33, 0.25);
        this.turntableGroup.add(restBase);

        const restPost = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.042, 0.24, 20), darkMat);
        restPost.position.set(1.65, 0.42, 0.25);
        this.turntableGroup.add(restPost);

        const restCradleBase = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.075), brassMat);
        restCradleBase.position.set(1.65, 0.535, 0.25);
        this.turntableGroup.add(restCradleBase);

        [-0.052, 0.052].forEach(cx => {
            const prong = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, 0.075), brassMat);
            prong.position.set(1.65 + cx, 0.568, 0.25);
            this.turntableGroup.add(prong);
        });

        const restLockClip = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.065, 0.045), darkMat);
        restLockClip.position.set(1.59, 0.585, 0.25);
        restLockClip.rotation.z = -0.35;
        this.turntableGroup.add(restLockClip);

        // 7. Front & Side Controls (Strobe Prism, Speed Switches, Target Light, Pitch Fader)
        const strobeBaseCollar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.24), darkMat);
        strobeBaseCollar.position.set(-1.95, 0.325, 1.48);
        strobeBaseCollar.rotation.y = 0.62;
        this.turntableGroup.add(strobeBaseCollar);

        const strobeTower = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.20), machinedAlumMat);
        strobeTower.position.set(-1.95, 0.39, 1.48);
        strobeTower.rotation.y = 0.62;
        strobeTower.castShadow = true;
        this.turntableGroup.add(strobeTower);

        const strobeHood = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.025, 0.22), machinedAlumMat);
        strobeHood.position.set(-1.94, 0.475, 1.47);
        strobeHood.rotation.y = 0.62;
        this.turntableGroup.add(strobeHood);

        this.strobeLens = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.085, 0.04),
            new THREE.MeshStandardMaterial({
                color: 0xFF5500,
                emissive: 0xFF4500,
                emissiveIntensity: 1.65,
                roughness: 0.15
            })
        );
        this.strobeLens.position.set(-1.89, 0.40, 1.41);
        this.strobeLens.rotation.y = 0.62;
        this.turntableGroup.add(this.strobeLens);

        // Rectangular Machined Start/Stop Tactile Switch
        const startStopBezel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.28), darkMat);
        startStopBezel.position.set(-1.98, 0.325, 1.80);
        this.turntableGroup.add(startStopBezel);

        const startStopCap = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.042, 0.22), machinedAlumMat);
        startStopCap.position.set(-1.98, 0.34, 1.80);
        this.turntableGroup.add(startStopCap);

        // Dedicated 33 & 45 RPM Speed Selector Buttons + Active LED
        [-1.62, -1.40].forEach((bx, idx) => {
            const rpmBezel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.15), darkMat);
            rpmBezel.position.set(bx, 0.324, 1.84);
            this.turntableGroup.add(rpmBezel);

            const rpmCap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.036, 0.11), idx === 0 ? chromeMat : machinedAlumMat);
            rpmCap.position.set(bx, 0.336, 1.84);
            this.turntableGroup.add(rpmCap);

            const rpmLed = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.008, 0.02),
                new THREE.MeshStandardMaterial({
                    color: idx === 0 ? 0xFF4500 : 0x3A2018,
                    emissive: idx === 0 ? 0xFF3A00 : 0x000000,
                    emissiveIntensity: idx === 0 ? 1.2 : 0.0
                })
            );
            rpmLed.position.set(bx, 0.355, 1.81);
            this.turntableGroup.add(rpmLed);
        });

        // Pop-up Stylus Target Illuminator Tower
        const targetWell = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 24), darkMat);
        targetWell.position.set(0.78, 0.322, 1.28);
        this.turntableGroup.add(targetWell);

        const targetTower = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.145, 24), chromeMat);
        targetTower.position.set(0.78, 0.37, 1.28);
        targetTower.castShadow = true;
        this.turntableGroup.add(targetTower);

        this.targetBulb = new THREE.Mesh(
            new THREE.BoxGeometry(0.062, 0.055, 0.042),
            new THREE.MeshBasicMaterial({ color: 0x4A3A28 })
        );
        this.targetBulb.position.set(0.74, 0.40, 1.24);
        this.targetBulb.rotation.y = -0.6;
        this.turntableGroup.add(this.targetBulb);

        // Recessed Pitch Control Scale, Dust Slot, Sculpted Fader Cap & Quartz LED
        const pitchPlate = new THREE.Mesh(
            new THREE.PlaneGeometry(0.35, 1.26),
            new THREE.MeshStandardMaterial({
                map: this.createPitchScaleTexture(),
                roughness: 0.35,
                metalness: 0.25
            })
        );
        pitchPlate.rotation.x = -Math.PI / 2;
        pitchPlate.position.set(2.14, 0.322, 0.25);
        pitchPlate.receiveShadow = true;
        this.turntableGroup.add(pitchPlate);

        const pitchSlot = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.016, 1.04), darkMat);
        pitchSlot.position.set(2.17, 0.324, 0.25);
        this.turntableGroup.add(pitchSlot);

        // Quartz-Lock Zero Indicator LED next to pitch center
        const quartzBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16), darkMat);
        quartzBezel.position.set(1.91, 0.323, 0.25);
        this.turntableGroup.add(quartzBezel);

        const quartzLed = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.018, 0.016, 16),
            new THREE.MeshStandardMaterial({
                color: 0x48D878,
                emissive: 0x28C858,
                emissiveIntensity: 1.1,
                roughness: 0.2
            })
        );
        quartzLed.position.set(1.91, 0.325, 0.25);
        this.turntableGroup.add(quartzLed);

        // Pitch Fader Knob with Index Stripe
        this.pitchFaderKnob = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.092, 0.13), machinedAlumMat);
        this.pitchFaderKnob.position.set(2.17, 0.365, 0.25);
        this.pitchFaderKnob.castShadow = true;
        this.turntableGroup.add(this.pitchFaderKnob);

        const faderIndexLine = new THREE.Mesh(
            new THREE.BoxGeometry(0.188, 0.012, 0.014),
            new THREE.MeshBasicMaterial({ color: 0xFFFFFF })
        );
        faderIndexLine.position.set(0, 0.042, 0);
        this.pitchFaderKnob.add(faderIndexLine);

        // Rotary Power / Master Turntable Switch & Speed Trim Dial
        const knobEscutcheon = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.22, 0.015, 32), darkMat);
        knobEscutcheon.position.set(1.75, 0.324, 1.48);
        this.turntableGroup.add(knobEscutcheon);

        const knobBase = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.09, 32), brassMat);
        knobBase.position.set(1.75, 0.355, 1.48);
        knobBase.castShadow = true;
        this.turntableGroup.add(knobBase);

        this.powerLever = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.095, 0.25), darkMat);
        this.powerLever.position.set(1.75, 0.425, 1.48);
        this.powerLever.castShadow = true;
        this.turntableGroup.add(this.powerLever);

        const speedBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.075, 28), knurledAlumMat);
        speedBtn.position.set(1.25, 0.345, 1.48);
        speedBtn.castShadow = true;
        this.turntableGroup.add(speedBtn);

        const speedBtnCap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 24), chromeMat);
        speedBtnCap.position.set(1.25, 0.348, 1.48);
        this.turntableGroup.add(speedBtn);

        // 8. Hinged Smoked-Acrylic Dust Cover with Spring Hinges & Corner Bumpers
        [-1.8, 1.8].forEach(hx => {
            const hingeBase = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.15), darkMat);
            hingeBase.position.set(hx, 0.36, -1.96);
            this.turntableGroup.add(hingeBase);

            const hingeClip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.13, 0.065), chromeMat);
            hingeClip.position.set(hx, 0.42, -1.92);
            this.turntableGroup.add(hingeClip);

            const hingePin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.28, 16), brassMat);
            hingePin.rotation.z = Math.PI / 2;
            hingePin.position.set(hx, 0.44, -1.94);
            this.turntableGroup.add(hingePin);
        });

        this.dustCoverGroup = new THREE.Group();
        this.dustCoverGroup.position.set(0, 0.38, -1.96);
        this.turntableGroup.add(this.dustCoverGroup);

        const acrylicMat = new THREE.MeshPhysicalMaterial({
            color: 0xEFE9DF,
            transparent: true,
            opacity: 0.19,
            roughness: 0.05,
            metalness: 0.02,
            reflectivity: 0.95,
            clearcoat: 1.0,
            clearcoatRoughness: 0.04,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const coverShell = new THREE.Mesh(new THREE.BoxGeometry(4.96, 0.72, 3.92), acrylicMat);
        coverShell.position.set(0, 0.36, 1.96);
        this.dustCoverGroup.add(coverShell);

        const coverEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(4.96, 0.72, 3.92)),
            new THREE.LineBasicMaterial({ color: 0xFFFDF8, transparent: true, opacity: 0.34 })
        );
        coverEdges.position.set(0, 0.36, 1.96);
        this.dustCoverGroup.add(coverEdges);

        // Front Rubber Cushion Bumpers on the Dust Cover
        [-2.32, 2.32].forEach(bx => {
            const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), rubberMat);
            bumper.position.set(bx, 0.01, 3.86);
            this.dustCoverGroup.add(bumper);
        });

        const coverLiftTab = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.042, 0.065), brassMat);
        coverLiftTab.position.set(0, 0.05, 3.925);
        this.dustCoverGroup.add(coverLiftTab);
    }

    toggleDustCover() {
        this.dustCoverOpen = !this.dustCoverOpen;
        return this.dustCoverOpen;
    }

    updateRecordLabel(track) {
        if (!this.vinylMat || !track) return;
        const newTex = this.createVinylTexture(track);
        if (this.vinylMat.map) this.vinylMat.map.dispose();
        this.vinylMat.map = newTex;
        this.vinylMat.bumpMap = newTex;
        this.vinylMat.needsUpdate = true;
    }

    triggerTrackChange(track, autoPlay = true) {
        if (!track) return;
        if (this.mechState === 'IDLE_STOPPED') {
            this.updateRecordLabel(track);
            this.recordHeight = 2.0;
            if (autoPlay) {
                this.mechState = 'DROPPING_RECORD';
            }
        } else {
            this.pendingTrack = track;
            this.pendingAutoPlay = autoPlay;
            this.mechState = 'SWAPPING_OUT';
        }
    }

    // Smooth Spherical Arc Camera Transition with Smootherstep Easing
    setCameraView(preset) {
        let endPos, endLook;
        if (preset === 'iso') {
            endPos = new THREE.Vector3(5.9, 5.1, 6.7);
            endLook = new THREE.Vector3(0, 0.2, 0);
        } else if (preset === 'top') {
            endPos = new THREE.Vector3(0.0, 8.6, 0.8);
            endLook = new THREE.Vector3(-0.2, 0, 0);
        } else if (preset === 'side') {
            endPos = new THREE.Vector3(3.6, 1.8, 3.8);
            endLook = new THREE.Vector3(0.4, 0.35, 0.2);
        } else {
            return;
        }

        const startLook = this.controls.target.clone();
        const startOffset = this.camera.position.clone().sub(startLook);
        const endOffset = endPos.clone().sub(endLook);

        const startSpherical = new THREE.Spherical().setFromVector3(startOffset);
        const endSpherical = new THREE.Spherical().setFromVector3(endOffset);

        // Shortest angular path around Y axis (theta)
        let deltaTheta = endSpherical.theta - startSpherical.theta;
        while (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
        while (deltaTheta < -Math.PI) deltaTheta += Math.PI * 2;
        endSpherical.theta = startSpherical.theta + deltaTheta;

        this.camAnim = {
            startSpherical,
            endSpherical,
            startLook,
            endLook,
            elapsed: 0,
            duration: 1.65 // 1.65s cinematic orbital glide
        };

        // Sync the manual camera preset buttons in the top-right HUD
        document.querySelectorAll('.cam-btn').forEach(btn => {
            if (btn.dataset.cam === preset) {
                btn.className = 'cam-btn px-2.5 py-1 rounded-xl font-mono text-[11px] bg-terracotta text-alabaster transition';
            } else {
                btn.className = 'cam-btn px-2.5 py-1 rounded-xl font-mono text-[11px] text-espresso hover:bg-oatmeal transition';
            }
        });
    }

    bindResize() {
        window.addEventListener('resize', () => {
            if (!this.container) return;
            const w = this.container.clientWidth;
            const h = this.container.clientHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        });
    }

    update() {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const elapsed = this.clock.getElapsedTime();

        const progress = AppState.duration > 0
            ? Math.min(1, Math.max(0, AppState.currentTime / AppState.duration))
            : 0;

        const grooveYaw = 0.44 + progress * 0.34;

        switch (this.mechState) {
            case 'IDLE_STOPPED':
                this.targetRPM = 0;
                this.armPitch += (0.0 - this.armPitch) * 8 * dt;
                this.armYaw += (0.0 - this.armYaw) * 6 * dt;
                this.recordHeight += (0.0 - this.recordHeight) * 7 * dt;
                this.powerSwitchAngle += (-0.35 - this.powerSwitchAngle) * 8 * dt;
                break;

            case 'SWAPPING_OUT':
                this.targetRPM = 0;
                this.armPitch += (0.15 - this.armPitch) * 10 * dt;
                this.armYaw += (0.0 - this.armYaw) * 7 * dt;
                if (this.armYaw < 0.12) {
                    this.recordHeight += (2.2 - this.recordHeight) * 8 * dt;
                    if (this.recordHeight > 1.8) {
                        if (this.pendingTrack) {
                            this.updateRecordLabel(this.pendingTrack);
                        }
                        this.mechState = this.pendingAutoPlay ? 'DROPPING_RECORD' : 'IDLE_STOPPED';
                    }
                }
                break;

            case 'DROPPING_RECORD':
                this.targetRPM = 0;
                this.recordHeight += (0.0 - this.recordHeight) * 8 * dt;
                this.armPitch += (0.15 - this.armPitch) * 8 * dt;
                if (this.recordHeight < 0.03) {
                    this.recordHeight = 0;
                    this.mechState = 'CUIING_ARM';
                }
                break;

            case 'CUIING_ARM':
                this.targetRPM = AppState.rpmMode;
                this.powerSwitchAngle += (0.35 - this.powerSwitchAngle) * 8 * dt;
                this.armPitch += (0.15 - this.armPitch) * 9 * dt;
                this.armYaw += (grooveYaw - this.armYaw) * 6 * dt;

                if (Math.abs(this.armYaw - grooveYaw) < 0.015) {
                    this.armPitch += (0.02 - this.armPitch) * 6 * dt;
                    if (this.armPitch < 0.035) {
                        this.mechState = 'PLAYING';
                    }
                }
                break;

            case 'PLAYING':
                this.targetRPM = AppState.rpmMode;
                this.powerSwitchAngle += (0.35 - this.powerSwitchAngle) * 8 * dt;
                this.recordHeight += (0.0 - this.recordHeight) * 10 * dt;
                const microFlutter = Math.sin(elapsed * 28) * 0.0012;
                this.armPitch += ((0.018 + microFlutter) - this.armPitch) * 10 * dt;
                this.armYaw += (grooveYaw - this.armYaw) * 5 * dt;
                break;

            case 'PAUSED':
                this.targetRPM = 0;
                this.armPitch += (0.11 - this.armPitch) * 8 * dt;
                this.armYaw += (grooveYaw - this.armYaw) * 5 * dt;
                break;

            case 'RETURNING_ARM':
                this.targetRPM = 0;
                this.powerSwitchAngle += (-0.35 - this.powerSwitchAngle) * 8 * dt;
                this.armPitch += (0.15 - this.armPitch) * 10 * dt;
                if (this.armPitch > 0.10) {
                    this.armYaw += (0.0 - this.armYaw) * 6 * dt;
                    if (this.armYaw < 0.02) {
                        this.mechState = 'IDLE_STOPPED';
                    }
                }
                break;
        }

        this.currentRPM += (this.targetRPM - this.currentRPM) * 3.5 * dt;
        if (this.currentRPM < 0.05 && this.targetRPM === 0) this.currentRPM = 0;

        const radPerSec = (this.currentRPM / 60) * Math.PI * 2;
        this.platterGroup.rotation.y -= radPerSec * dt;
        this.recordMesh.rotation.z = Math.sin(this.platterGroup.rotation.y) * 0.004;

        this.recordGroup.position.y = 0.105 + this.recordHeight;
        this.tonearmYawGroup.rotation.y = -this.armYaw;
        this.tonearmPitchGroup.rotation.x = -this.armPitch;

        this.powerLever.rotation.y = this.powerSwitchAngle;

        if (this.cueLever) {
            this.cueLever.rotation.x = -this.armPitch * 2.4;
        }

        const forceOpen = this.recordHeight > 0.15;
        const targetCoverAngle = (this.dustCoverOpen || forceOpen) ? 1.02 : 0.0;
        this.dustCoverAngle += (targetCoverAngle - this.dustCoverAngle) * 5 * dt;
        if (this.dustCoverGroup) {
            this.dustCoverGroup.rotation.x = -this.dustCoverAngle;
        }

        const strobeActive = this.currentRPM > 1.0 || this.mechState !== 'IDLE_STOPPED';
        this.strobeLight.intensity = strobeActive ? 1.1 + Math.sin(elapsed * 60) * 0.12 : 0.15;
        this.strobeLens.material.color.setHex(strobeActive ? 0xFF5500 : 0x4A2511);

        this.targetLight.intensity = strobeActive ? 0.65 : 0.0;
        this.targetBulb.material.color.setHex(strobeActive ? 0xFFE0A3 : 0x4A3A28);

        // Execute smooth spherical camera transition with quintic smootherstep easing
        if (this.camAnim) {
            this.camAnim.elapsed += dt;
            const rawT = Math.min(1, this.camAnim.elapsed / this.camAnim.duration);
            // Quintic smootherstep: zero 1st and 2nd derivatives at start & end
            const ease = rawT * rawT * rawT * (rawT * (rawT * 6 - 15) + 10);

            this.controls.target.lerpVectors(this.camAnim.startLook, this.camAnim.endLook, ease);

            const currentSpherical = new THREE.Spherical(
                THREE.MathUtils.lerp(this.camAnim.startSpherical.radius, this.camAnim.endSpherical.radius, ease),
                THREE.MathUtils.lerp(this.camAnim.startSpherical.phi, this.camAnim.endSpherical.phi, ease),
                THREE.MathUtils.lerp(this.camAnim.startSpherical.theta, this.camAnim.endSpherical.theta, ease)
            );

            const offsetVec = new THREE.Vector3().setFromSpherical(currentSpherical);
            this.camera.position.copy(this.controls.target).add(offsetVec);
            this.camera.lookAt(this.controls.target);

            if (rawT >= 1) {
                this.camAnim = null;
                this.controls.update();
            }
        } else {
            this.controls.update();
        }

        this.renderer.render(this.scene, this.camera);
    }
}
