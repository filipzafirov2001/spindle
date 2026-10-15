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

        // Dark-ceiling studio environment map so horizontal vinyl stays deep black while vertical chrome shines
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

    createStudioEnvMap() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const bg = ctx.createLinearGradient(0, 0, 0, 256);
        bg.addColorStop(0, '#0D0C0B');
        bg.addColorStop(0.38, '#1A1816');
        bg.addColorStop(0.50, '#C8C0B4');
        bg.addColorStop(0.62, '#2A2622');
        bg.addColorStop(1, '#0F0E0D');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 512, 256);

        ctx.fillStyle = '#FFF9F0';
        ctx.fillRect(40, 114, 140, 26);
        ctx.fillStyle = '#FFE4C4';
        ctx.fillRect(320, 116, 130, 24);

        const tex = new THREE.CanvasTexture(canvas);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
    }

    initLights() {
        this.ambientLight = new THREE.AmbientLight(0xFFF8EE, 0.50);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xFFF5E4, 1.18);
        this.dirLight.position.set(-4.2, 9.2, 5.8);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.dirLight.shadow.camera.near = 1;
        this.dirLight.shadow.camera.far = 25;
        const d = 5;
        this.dirLight.shadow.camera.left = -d;
        this.dirLight.shadow.camera.right = d;
        this.dirLight.shadow.camera.top = d;
        this.dirLight.shadow.camera.bottom = -d;
        this.dirLight.shadow.bias = -0.0005;
        this.scene.add(this.dirLight);

        this.rimLight = new THREE.DirectionalLight(0xDCE6F2, 0.52);
        this.rimLight.position.set(6.5, 3.0, -5.2);
        this.scene.add(this.rimLight);

        this.strobeLight = new THREE.PointLight(0xFF5A1F, 0.9, 1.9);
        this.strobeLight.position.set(-1.82, 0.55, 1.38);
        this.scene.add(this.strobeLight);

        this.targetLight = new THREE.PointLight(0xFFCC77, 0.0, 1.8);
        this.targetLight.position.set(0.75, 0.58, 1.22);
        this.scene.add(this.targetLight);
    }

    setTheme(isDark) {
        if (isDark) {
            this.ambientLight.intensity = 0.42;
            this.dirLight.intensity = 1.02;
            this.renderer.toneMappingExposure = 0.96;
        } else {
            this.ambientLight.intensity = 0.50;
            this.dirLight.intensity = 1.18;
            this.renderer.toneMappingExposure = 1.02;
        }
    }

    createWalnutTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        const baseGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
        baseGrad.addColorStop(0, '#4E2E18');
        baseGrad.addColorStop(0.5, '#3E2210');
        baseGrad.addColorStop(1, '#4A2A15');
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, 0, 1024, 1024);

        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = i % 3 === 0
                ? 'rgba(22, 10, 4, 0.18)'
                : i % 2 === 0
                    ? 'rgba(110, 68, 36, 0.11)'
                    : 'rgba(55, 30, 14, 0.14)';
            const y = Math.random() * 1024;
            const h = 1 + Math.random() * 4;
            ctx.fillRect(0, y, 1024, h);
        }

        ctx.fillStyle = 'rgba(18, 8, 3, 0.25)';
        for (let i = 0; i < 1600; i++) {
            ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 8 + Math.random() * 24, 1);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        return tex;
    }

    createBrushedMetalTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#D8D4CD';
        ctx.fillRect(0, 0, 512, 512);

        for (let i = 0; i < 1400; i++) {
            const shade = 200 + Math.floor(Math.random() * 35);
            ctx.fillStyle = `rgba(${shade}, ${shade - 2}, ${shade - 5}, 0.18)`;
            ctx.fillRect(0, Math.random() * 512, 512, 1);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    createPitchScaleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#23201D';
        ctx.fillRect(0, 0, 128, 512);

        ctx.strokeStyle = '#BDB6AC';
        ctx.fillStyle = '#DCD6CB';
        ctx.font = 'bold 18px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';

        const labels = ['-8', '-6', '-4', '-2', '0', '+2', '+4', '+6', '+8'];
        for (let i = 0; i <= 32; i++) {
            const y = 36 + (i / 32) * 440;
            const isMajor = i % 4 === 0;
            ctx.lineWidth = isMajor ? 3 : 1.5;
            ctx.beginPath();
            ctx.moveTo(isMajor ? 42 : 54, y);
            ctx.lineTo(70, y);
            ctx.stroke();

            if (isMajor) {
                const lbl = labels[i / 4];
                ctx.fillStyle = lbl === '0' ? '#C85A32' : '#DCD6CB';
                ctx.fillText(lbl, 36, y + 6);
            }
        }

        return new THREE.CanvasTexture(canvas);
    }

    // Deep Jet-Black Procedural Vinyl Grooves + Dynamic Song/Artist Label
    createVinylTexture(track) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        const cx = 512, cy = 512;

        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, 1024, 1024);

        const grad1 = ctx.createConicGradient(0.4, cx, cy);
        grad1.addColorStop(0, 'rgba(255,255,255,0)');
        grad1.addColorStop(0.12, 'rgba(255,255,255,0.045)');
        grad1.addColorStop(0.25, 'rgba(255,255,255,0)');
        grad1.addColorStop(0.5, 'rgba(255,255,255,0)');
        grad1.addColorStop(0.62, 'rgba(255,255,255,0.045)');
        grad1.addColorStop(0.75, 'rgba(255,255,255,0)');
        grad1.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad1;
        ctx.fillRect(0, 0, 1024, 1024);

        for (let r = 175; r < 495; r += 2.0) {
            const isTrackGap = (r > 265 && r < 270) || (r > 350 && r < 355) || (r > 430 && r < 434);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = isTrackGap
                ? '#020202'
                : (Math.random() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.85)');
            ctx.lineWidth = 1.05;
            ctx.stroke();
        }

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
        return texture;
    }

    buildTurntable() {
        this.turntableGroup = new THREE.Group();
        this.scene.add(this.turntableGroup);

        const walnutTex = this.createWalnutTexture();
        const walnutMat = new THREE.MeshStandardMaterial({
            map: walnutTex,
            bumpMap: walnutTex,
            bumpScale: 0.008,
            roughness: 0.36,
            metalness: 0.06
        });

        const brushedTex = this.createBrushedMetalTexture();
        const topPlateMat = new THREE.MeshStandardMaterial({
            map: brushedTex,
            bumpMap: brushedTex,
            bumpScale: 0.003,
            color: 0xDFDBD2,
            roughness: 0.28,
            metalness: 0.78
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xFFFFFF,
            roughness: 0.08,
            metalness: 0.96
        });

        const machinedAlumMat = new THREE.MeshStandardMaterial({
            color: 0xE2E0DC,
            roughness: 0.22,
            metalness: 0.88
        });

        const brassMat = new THREE.MeshStandardMaterial({
            color: 0xDFB848,
            roughness: 0.18,
            metalness: 0.92
        });

        const darkMat = new THREE.MeshStandardMaterial({
            color: 0x181614,
            roughness: 0.5,
            metalness: 0.25
        });

        const rubberMat = new THREE.MeshStandardMaterial({
            color: 0x121110,
            roughness: 0.85,
            metalness: 0.04
        });

        // 1. Invisible Shadow Floor
        const shadowFloor = new THREE.Mesh(
            new THREE.PlaneGeometry(30, 30),
            new THREE.ShadowMaterial({ opacity: 0.18 })
        );
        shadowFloor.rotation.x = -Math.PI / 2;
        shadowFloor.position.y = -0.46;
        shadowFloor.receiveShadow = true;
        this.scene.add(shadowFloor);

        // 2. Walnut Cabinet Plinth with Mitered Surround & Recessed Top Deck
        const plinthCore = new THREE.Mesh(new THREE.BoxGeometry(5.16, 0.56, 4.16), walnutMat);
        plinthCore.castShadow = true;
        plinthCore.receiveShadow = true;
        this.turntableGroup.add(plinthCore);

        const wallThickness = 0.18;
        const wallHeight = 0.07;
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

        const subSkirt = new THREE.Mesh(new THREE.BoxGeometry(4.85, 0.08, 3.85), darkMat);
        subSkirt.position.y = -0.30;
        this.turntableGroup.add(subSkirt);

        const badgePlate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.03), darkMat);
        badgePlate.position.set(0, 0.02, 2.085);
        this.turntableGroup.add(badgePlate);

        const badgeTrim = new THREE.Mesh(new THREE.BoxGeometry(0.99, 0.17, 0.02), brassMat);
        badgeTrim.position.set(0, 0.02, 2.08);
        this.turntableGroup.add(badgeTrim);

        const deck = new THREE.Mesh(new THREE.BoxGeometry(4.82, 0.05, 3.82), topPlateMat);
        deck.position.y = 0.295;
        deck.receiveShadow = true;
        this.turntableGroup.add(deck);

        const boltCoords = [
            [-2.25, 0.322, -1.75],
            [2.25, 0.322, -1.75],
            [-2.25, 0.322, 1.75],
            [2.25, 0.322, 1.75]
        ];
        boltCoords.forEach(([bx, by, bz]) => {
            const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 16), chromeMat);
            bolt.position.set(bx, by, bz);
            this.turntableGroup.add(bolt);
        });

        const adapterWell = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 32), darkMat);
        adapterWell.position.set(-2.02, 0.315, -1.42);
        this.turntableGroup.add(adapterWell);

        const rpmAdapter = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.045, 32), machinedAlumMat);
        rpmAdapter.position.set(-2.02, 0.33, -1.42);
        rpmAdapter.castShadow = true;
        this.turntableGroup.add(rpmAdapter);

        const adapterHole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), darkMat);
        adapterHole.position.set(-2.02, 0.335, -1.42);
        this.turntableGroup.add(adapterHole);

        const footPositions = [
            [-2.15, -0.36, -1.65],
            [2.15, -0.36, -1.65],
            [-2.15, -0.36, 1.65],
            [2.15, -0.36, 1.65]
        ];
        footPositions.forEach(([fx, fy, fz]) => {
            const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.25, 0.18, 32), rubberMat);
            foot.position.set(fx, fy, fz);
            foot.castShadow = true;
            this.turntableGroup.add(foot);

            const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.045, 32), brassMat);
            collar.position.set(fx, fy + 0.05, fz);
            this.turntableGroup.add(collar);
        });

        // 3. Recessed Platter Well & Die-Cast Strobe Platter
        const platterWell = new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.78, 0.02, 64), darkMat);
        platterWell.position.set(-0.52, 0.315, 0);
        this.turntableGroup.add(platterWell);

        this.platterGroup = new THREE.Group();
        this.platterGroup.position.set(-0.52, 0.355, 0);
        this.turntableGroup.add(this.platterGroup);

        const platterBase = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.74, 0.11, 64), machinedAlumMat);
        platterBase.castShadow = true;
        platterBase.receiveShadow = true;
        this.platterGroup.add(platterBase);

        const platterTopRim = new THREE.Mesh(new THREE.CylinderGeometry(1.685, 1.68, 0.04, 64), chromeMat);
        platterTopRim.position.y = 0.065;
        this.platterGroup.add(platterTopRim);

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

        const matMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.63, 1.63, 0.025, 64), rubberMat);
        matMesh.position.y = 0.088;
        matMesh.receiveShadow = true;
        this.platterGroup.add(matMesh);

        [0.65, 0.95, 1.25, 1.52].forEach(radius => {
            const gripRing = new THREE.Mesh(
                new THREE.TorusGeometry(radius, 0.006, 8, 64),
                darkMat
            );
            gripRing.rotation.x = Math.PI / 2;
            gripRing.position.y = 0.101;
            this.platterGroup.add(gripRing);
        });

        const spindleShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.34, 24), chromeMat);
        spindleShaft.position.y = 0.18;
        spindleShaft.castShadow = true;
        this.platterGroup.add(spindleShaft);

        const spindleTip = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.05, 24), chromeMat);
        spindleTip.position.y = 0.375;
        this.platterGroup.add(spindleTip);

        // 4. Vinyl Record Disc
        this.recordGroup = new THREE.Group();
        this.recordGroup.position.y = 0.105;
        this.platterGroup.add(this.recordGroup);

        const vinylTex = this.createVinylTexture(DEFAULT_SYNTH_TRACKS[0]);
        this.vinylMat = new THREE.MeshStandardMaterial({
            map: vinylTex,
            bumpMap: vinylTex,
            bumpScale: 0.002,
            roughness: 0.32,
            metalness: 0.06,
            envMapIntensity: 0.35
        });

        const recordGeo = new THREE.CylinderGeometry(1.60, 1.60, 0.026, 64);
        this.recordMesh = new THREE.Mesh(recordGeo, [
            darkMat,
            this.vinylMat,
            this.vinylMat
        ]);
        this.recordMesh.castShadow = true;
        this.recordMesh.receiveShadow = true;
        this.recordGroup.add(this.recordMesh);

        const spindleBushing = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.032, 32), brassMat);
        spindleBushing.position.y = 0.004;
        this.recordGroup.add(spindleBushing);

        // 5. Precision S-Shaped Tonearm & Multi-Axis Gimbal Assembly
        const armBasePos = new THREE.Vector3(1.65, 0.32, -1.05);

        const armBase = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.48, 0.08, 36), darkMat);
        armBase.position.copy(armBasePos);
        armBase.castShadow = true;
        this.turntableGroup.add(armBase);

        const armBaseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.06, 36), machinedAlumMat);
        armBaseRing.position.set(armBasePos.x, armBasePos.y + 0.06, armBasePos.z);
        this.turntableGroup.add(armBaseRing);

        const armCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.22, 32), chromeMat);
        armCollar.position.set(armBasePos.x, armBasePos.y + 0.14, armBasePos.z);
        this.turntableGroup.add(armCollar);

        const antiSkateBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.10, 0.08, 24), darkMat);
        antiSkateBase.position.set(armBasePos.x + 0.31, armBasePos.y + 0.06, armBasePos.z + 0.08);
        this.turntableGroup.add(antiSkateBase);

        const antiSkateKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 24), chromeMat);
        antiSkateKnob.position.set(armBasePos.x + 0.31, armBasePos.y + 0.12, armBasePos.z + 0.08);
        this.turntableGroup.add(antiSkateKnob);

        const cueCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 16), chromeMat);
        cueCylinder.position.set(armBasePos.x - 0.24, armBasePos.y + 0.14, armBasePos.z + 0.28);
        this.turntableGroup.add(cueCylinder);

        this.cueLever = new THREE.Group();
        this.cueLever.position.set(armBasePos.x - 0.16, armBasePos.y + 0.18, armBasePos.z + 0.28);
        this.turntableGroup.add(this.cueLever);

        const cueRod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12), chromeMat);
        cueRod.rotation.x = Math.PI / 2;
        cueRod.position.z = 0.14;
        this.cueLever.add(cueRod);

        const cueTip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.08, 12), darkMat);
        cueTip.rotation.x = Math.PI / 2;
        cueTip.position.z = 0.26;
        this.cueLever.add(cueTip);

        this.tonearmYawGroup = new THREE.Group();
        this.tonearmYawGroup.position.set(armBasePos.x, armBasePos.y + 0.28, armBasePos.z);
        this.turntableGroup.add(this.tonearmYawGroup);

        const gimbalPillarL = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.30, 0.09), machinedAlumMat);
        gimbalPillarL.position.set(-0.16, 0.02, 0);
        this.tonearmYawGroup.add(gimbalPillarL);

        const gimbalPillarR = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.30, 0.09), machinedAlumMat);
        gimbalPillarR.position.set(0.16, 0.02, 0);
        this.tonearmYawGroup.add(gimbalPillarR);

        const gimbalBridge = new THREE.Mesh(new THREE.BoxGeometry(0.365, 0.045, 0.09), machinedAlumMat);
        gimbalBridge.position.set(0, 0.16, 0);
        this.tonearmYawGroup.add(gimbalBridge);

        const topPivotScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16), brassMat);
        topPivotScrew.position.set(0, 0.19, 0);
        this.tonearmYawGroup.add(topPivotScrew);

        const cueBar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.04), chromeMat);
        cueBar.position.set(-0.08, -0.09, 0.34);
        this.tonearmYawGroup.add(cueBar);

        this.tonearmPitchGroup = new THREE.Group();
        this.tonearmYawGroup.add(this.tonearmPitchGroup);

        const innerGimbal = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 24), brassMat);
        innerGimbal.rotation.z = Math.PI / 2;
        this.tonearmPitchGroup.add(innerGimbal);

        const sArmCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, -0.10),
            new THREE.Vector3(0, 0, 0.18),
            new THREE.Vector3(0.12, 0, 0.68),
            new THREE.Vector3(0.13, 0, 1.22),
            new THREE.Vector3(0.04, 0, 1.72),
            new THREE.Vector3(0, 0, 2.00)
        ]);
        const sArmGeo = new THREE.TubeGeometry(sArmCurve, 48, 0.032, 20, false);
        const sArmMesh = new THREE.Mesh(sArmGeo, chromeMat);
        sArmMesh.castShadow = true;
        this.tonearmPitchGroup.add(sArmMesh);

        // Properly aligned cylindrical locking collar nut at the front of the S-Arm
        const lockingCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.055, 20), chromeMat);
        lockingCollar.rotation.x = Math.PI / 2;
        lockingCollar.position.set(0, 0, 1.98);
        this.tonearmPitchGroup.add(lockingCollar);

        const rearStub = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.45, 20), machinedAlumMat);
        rearStub.rotation.x = Math.PI / 2;
        rearStub.position.z = -0.30;
        this.tonearmPitchGroup.add(rearStub);

        const counterweightBody = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.24, 32), darkMat);
        counterweightBody.rotation.x = Math.PI / 2;
        counterweightBody.position.z = -0.34;
        counterweightBody.castShadow = true;
        this.tonearmPitchGroup.add(counterweightBody);

        const weightScaleRing = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.055, 32), chromeMat);
        weightScaleRing.rotation.x = Math.PI / 2;
        weightScaleRing.position.z = -0.23;
        this.tonearmPitchGroup.add(weightScaleRing);

        const weightBrassTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.165, 0.04, 32), brassMat);
        weightBrassTrim.rotation.x = Math.PI / 2;
        weightBrassTrim.position.z = -0.47;
        this.tonearmPitchGroup.add(weightBrassTrim);

        // Clean, Flush Headshell & Cartridge Assembly
        const headshellGroup = new THREE.Group();
        headshellGroup.position.set(0, 0, 2.00);
        headshellGroup.rotation.y = -0.38;
        this.tonearmPitchGroup.add(headshellGroup);

        const headshellNeck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.032, 0.08), machinedAlumMat);
        headshellNeck.position.set(0, 0.01, 0.03);
        headshellGroup.add(headshellNeck);

        const headshellTop = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.026, 0.32), darkMat);
        headshellTop.position.set(0, 0.014, 0.17);
        headshellTop.castShadow = true;
        headshellGroup.add(headshellTop);

        [-0.04, 0.04].forEach(sx => {
            const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), brassMat);
            screw.position.set(sx, 0.028, 0.21);
            headshellGroup.add(screw);
        });

        const cartridgeBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.145, 0.10, 0.24),
            new THREE.MeshStandardMaterial({ color: 0xC85A32, roughness: 0.25, metalness: 0.15 })
        );
        cartridgeBody.position.set(0, -0.045, 0.175);
        headshellGroup.add(cartridgeBody);

        const stylusGuard = new THREE.Mesh(new THREE.BoxGeometry(0.148, 0.04, 0.06), brassMat);
        stylusGuard.position.set(0, -0.07, 0.27);
        headshellGroup.add(stylusGuard);

        // Subtle, flush curved finger-lift wire attached cleanly to the side of the headshell
        const fingerLiftCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.082, 0.012, 0.20),
            new THREE.Vector3(0.118, 0.018, 0.205),
            new THREE.Vector3(0.142, 0.042, 0.22)
        ]);
        const fingerLiftGeo = new THREE.TubeGeometry(fingerLiftCurve, 16, 0.0065, 10, false);
        const fingerLift = new THREE.Mesh(fingerLiftGeo, chromeMat);
        headshellGroup.add(fingerLift);

        const needle = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.065, 12), chromeMat);
        needle.rotation.x = Math.PI;
        needle.position.set(0, -0.108, 0.24);
        headshellGroup.add(needle);

        // 6. Tonearm Rest Post & Locking Latch
        const restPost = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.045, 0.25, 20), darkMat);
        restPost.position.set(1.65, 0.42, 0.25);
        this.turntableGroup.add(restPost);

        const restCradle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.045, 0.08), brassMat);
        restCradle.position.set(1.65, 0.54, 0.25);
        this.turntableGroup.add(restCradle);

        // 7. Front & Side Deck Controls: Strobe Tower, Stylus Target Light, Pitch Fader & Switches
        const strobeTower = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.20), machinedAlumMat);
        strobeTower.position.set(-1.95, 0.39, 1.48);
        strobeTower.rotation.y = 0.62;
        strobeTower.castShadow = true;
        this.turntableGroup.add(strobeTower);

        this.strobeLens = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.08, 0.04),
            new THREE.MeshBasicMaterial({ color: 0xFF5500 })
        );
        this.strobeLens.position.set(-1.89, 0.40, 1.41);
        this.strobeLens.rotation.y = 0.62;
        this.turntableGroup.add(this.strobeLens);

        const startStopBezel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.26), darkMat);
        startStopBezel.position.set(-1.98, 0.325, 1.80);
        this.turntableGroup.add(startStopBezel);

        const startStopCap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.20), machinedAlumMat);
        startStopCap.position.set(-1.98, 0.34, 1.80);
        this.turntableGroup.add(startStopCap);

        const targetTower = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 20), chromeMat);
        targetTower.position.set(0.78, 0.37, 1.28);
        this.turntableGroup.add(targetTower);

        this.targetBulb = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.05, 0.04),
            new THREE.MeshBasicMaterial({ color: 0x4A3A28 })
        );
        this.targetBulb.position.set(0.74, 0.40, 1.24);
        this.targetBulb.rotation.y = -0.6;
        this.turntableGroup.add(this.targetBulb);

        const pitchPlate = new THREE.Mesh(
            new THREE.PlaneGeometry(0.34, 1.25),
            new THREE.MeshBasicMaterial({ map: this.createPitchScaleTexture() })
        );
        pitchPlate.rotation.x = -Math.PI / 2;
        pitchPlate.position.set(2.14, 0.322, 0.25);
        this.turntableGroup.add(pitchPlate);

        const pitchSlot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 1.02), darkMat);
        pitchSlot.position.set(2.17, 0.324, 0.25);
        this.turntableGroup.add(pitchSlot);

        this.pitchFaderKnob = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.12), machinedAlumMat);
        this.pitchFaderKnob.position.set(2.17, 0.365, 0.25);
        this.pitchFaderKnob.castShadow = true;
        this.turntableGroup.add(this.pitchFaderKnob);

        const knobBase = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.09, 32), brassMat);
        knobBase.position.set(1.75, 0.355, 1.48);
        this.turntableGroup.add(knobBase);

        this.powerLever = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.24), darkMat);
        this.powerLever.position.set(1.75, 0.425, 1.48);
        this.turntableGroup.add(this.powerLever);

        const speedBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.11, 0.07, 24), chromeMat);
        speedBtn.position.set(1.25, 0.345, 1.48);
        this.turntableGroup.add(speedBtn);

        // 8. Hinged Smoked Acrylic Dust Cover Assembly (Rear Pivot)
        [-1.8, 1.8].forEach(hx => {
            const hingeBase = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.16, 0.14), darkMat);
            hingeBase.position.set(hx, 0.36, -1.96);
            this.turntableGroup.add(hingeBase);

            const hingeClip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.06), chromeMat);
            hingeClip.position.set(hx, 0.42, -1.92);
            this.turntableGroup.add(hingeClip);
        });

        this.dustCoverGroup = new THREE.Group();
        this.dustCoverGroup.position.set(0, 0.38, -1.96);
        this.turntableGroup.add(this.dustCoverGroup);

        const acrylicMat = new THREE.MeshPhysicalMaterial({
            color: 0xF5EFE6,
            transparent: true,
            opacity: 0.20,
            roughness: 0.08,
            metalness: 0.05,
            reflectivity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const coverShell = new THREE.Mesh(new THREE.BoxGeometry(4.96, 0.72, 3.92), acrylicMat);
        coverShell.position.set(0, 0.36, 1.96);
        this.dustCoverGroup.add(coverShell);

        const coverEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(4.96, 0.72, 3.92)),
            new THREE.LineBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.30 })
        );
        coverEdges.position.set(0, 0.36, 1.96);
        this.dustCoverGroup.add(coverEdges);

        const coverLiftTab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.06), brassMat);
        coverLiftTab.position.set(0, 0.05, 3.92);
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
        this.strobeLight.intensity = strobeActive ? 0.9 + Math.sin(elapsed * 60) * 0.1 : 0.15;
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
