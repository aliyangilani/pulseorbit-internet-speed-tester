/**
 * Three.js hero scene: a fibre-optic "network planet".
 * Globe core + wireframe, network nodes, curved data arcs with travelling
 * particles, orbital rings with beads, dust, and a completion shock-wave.
 *
 * createScene() rejects if WebGL or Three.js is unavailable; the caller then
 * keeps the CSS fallback visible. The scene never touches the speed test.
 */
import { CONFIG } from './config.js';

async function loadThree() {
  const urls = [new URL(CONFIG.three.local, import.meta.url).href, CONFIG.three.cdn];
  let last;
  for (const u of urls) {
    try {
      return await import(u);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('Three.js could not be loaded');
}

const PALETTE = {
  dark: { primary: 0x22d3ee, secondary: 0x8b5cf6, ok: 0x34d399, upload: 0xf472b6, additive: true, wire: 0.28, arcs: 0.35, core: 0.55 },
  light: { primary: 0x0e7490, secondary: 0x6d28d9, ok: 0x059669, upload: 0xbe185d, additive: false, wire: 0.3, arcs: 0.4, core: 0.5 },
};

export async function createScene(container, { theme = 'dark', reducedMotion = false } = {}) {
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL is not available');

  const THREE = await loadThree();

  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const lowPower = coarse || window.innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  let maxDpr = lowPower ? 1.25 : 1.75;

  const renderer = new THREE.WebGLRenderer({ antialias: !lowPower, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  container.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 0, 8.2);

  const root = new THREE.Group();
  scene.add(root);
  const R = 1.6;

  // ---- sprite texture for round, soft points ----------------------------
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  // ---- core sphere with fresnel rim -------------------------------------
  const coreMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBase: { value: new THREE.Color(0x0b1430) },
      uRim: { value: new THREE.Color(0x22d3ee) },
      uStrength: { value: 0.55 },
    },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; uniform vec3 uBase; uniform vec3 uRim; uniform float uStrength;
      void main(){ float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.4);
        vec3 c = mix(uBase, uRim, f); gl_FragColor = vec4(c, 0.28 + f*uStrength); }`,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), coreMat);
  root.add(core);

  const wireMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false });
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R * 1.005, 2)), wireMat);
  root.add(wire);

  // ---- nodes -----------------------------------------------------------
  const nodeCount = lowPower ? 44 : 72;
  const nodePts = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < nodeCount; i++) {
    const y = 1 - (i / (nodeCount - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    nodePts.push(new THREE.Vector3(Math.cos(ga * i) * r * R, y * R, Math.sin(ga * i) * r * R));
  }
  const nodeGeo = new THREE.BufferGeometry().setFromPoints(nodePts);
  const nodeMat = new THREE.PointsMaterial({ map: tex, size: 0.14, transparent: true, depthWrite: false, sizeAttenuation: true });
  root.add(new THREE.Points(nodeGeo, nodeMat));

  // ---- curved data arcs + travelling particles --------------------------
  const arcCount = lowPower ? 16 : 28;
  const curves = [];
  const segs = [];
  let guard = 0;
  while (curves.length < arcCount && guard++ < 2000) {
    const a = nodePts[(Math.random() * nodeCount) | 0];
    const b = nodePts[(Math.random() * nodeCount) | 0];
    const d = a.distanceTo(b);
    if (d < 1.2 || d > 3.0) continue;
    const ctrl = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(R + d * 0.5);
    const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
    curves.push(curve);
    const p = curve.getPoints(28);
    for (let j = 0; j < p.length - 1; j++) segs.push(p[j], p[j + 1]);
  }
  const arcMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), arcMat));

  const parts = [];
  curves.forEach((c) => {
    for (let k = 0; k < 2; k++) parts.push({ c, t: Math.random(), s: 0.25 + Math.random() * 0.35 });
  });
  const partPos = new Float32Array(parts.length * 3);
  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
  const partMat = new THREE.PointsMaterial({ map: tex, size: 0.2, transparent: true, depthWrite: false, sizeAttenuation: true });
  root.add(new THREE.Points(partGeo, partMat));

  // ---- orbital fibre rings with beads -----------------------------------
  const ringDefs = [
    { r: 2.15, tilt: [1.2, 0.2, 0], spd: 0.35 },
    { r: 2.5, tilt: [0.5, 0.6, 0.9], spd: -0.26 },
    { r: 2.85, tilt: [-0.35, 0.1, 0.35], spd: 0.18 },
  ];
  const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
  const beadMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const rings = ringDefs.map((d) => {
    const g = new THREE.Group();
    g.rotation.set(...d.tilt);
    g.add(new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.012, 8, lowPower ? 96 : 160), ringMat));
    const pivot = new THREE.Group();
    const bead = new THREE.Sprite(beadMat);
    bead.scale.setScalar(0.32);
    bead.position.set(d.r, 0, 0);
    pivot.add(bead);
    g.add(pivot);
    root.add(g);
    return { g, pivot, spd: d.spd };
  });

  // ---- dust ----------------------------------------------------------------
  const dustN = lowPower ? 90 : 220;
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    const r = 4 + Math.random() * 3.5;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    dustPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th)], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ map: tex, size: 0.07, transparent: true, opacity: 0.6, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // ---- completion shock-wave ---------------------------------------------------
  const shockMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), shockMat);
  scene.add(shock);
  let shockT = -1;

  // ---- theme / accent -------------------------------------------------------
  let pal = PALETTE[theme] || PALETTE.dark;
  const accent = new THREE.Color(pal.primary);
  const accentTarget = new THREE.Color(pal.primary);
  const tmpColor = new THREE.Color();
  let stage = 'idle';

  function stageColor() {
    if (stage === 'upload') return pal.upload;
    if (stage === 'done') return pal.ok;
    return pal.primary;
  }

  function applyTheme(name) {
    pal = PALETTE[name] || PALETTE.dark;
    const blend = pal.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    [nodeMat, partMat, ringMat, beadMat, arcMat, wireMat, dustMat, shockMat].forEach((m) => {
      m.blending = blend;
      m.needsUpdate = true;
    });
    coreMat.uniforms.uBase.value.set(name === 'dark' ? 0x0b1430 : 0xdbe7f7);
    coreMat.uniforms.uStrength.value = pal.core;
    arcMat.color.set(pal.secondary);
    arcMat.opacity = pal.arcs;
    wireMat.color.set(pal.primary);
    wireMat.opacity = pal.wire;
    dustMat.color.set(name === 'dark' ? 0x9fb4ff : 0x64748b);
    accentTarget.set(stageColor());
    if (reducedMotion) accent.copy(accentTarget);
    dirty = true;
  }

  // ---- state ---------------------------------------------------------------
  let dirty = true;
  let rotSpeed = 0.07;
  let rotTarget = 0.07;
  let flow = 0.5;
  let flowTarget = 0.5;
  let level = 0;
  let glow = 1;
  let glowTarget = 1;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let visible = true;
  let raf = 0;
  let last = performance.now();
  let slowFrames = 0;
  let frames = 0;

  function recompute() {
    const testing = stage === 'ping' || stage === 'download' || stage === 'upload';
    rotTarget = testing ? 0.28 + level * 0.9 : stage === 'done' ? 0.12 : 0.07;
    flowTarget = testing ? 1.1 + level * 2.2 : stage === 'done' ? 0.7 : 0.5;
    glowTarget = testing ? 1.25 : stage === 'done' ? 1.4 : 1;
    accentTarget.set(stageColor());
    dirty = true;
  }

  // ---- sizing --------------------------------------------------------------
  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 0.9 ? 11 : 9.4;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ---- input ---------------------------------------------------------------
  const finePointer = !coarse;
  const onMove = (e) => {
    const r = container.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    mouse.tx = Math.max(-1.2, Math.min(1.2, mouse.tx));
    mouse.ty = Math.max(-1.2, Math.min(1.2, mouse.ty));
    dirty = true;
  };
  if (finePointer) window.addEventListener('pointermove', onMove, { passive: true });

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) kick();
  });
  io.observe(container);
  const onVis = () => {
    if (!document.hidden) kick();
  };
  document.addEventListener('visibilitychange', onVis);

  let lost = false;
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    container.classList.remove('has-webgl');
  };
  canvas.addEventListener('webglcontextlost', onLost);

  // ---- render loop -----------------------------------------------------------
  const tmpV = new THREE.Vector3();

  function update(dt) {
    const k = dt === 0 ? 1 : 1 - Math.pow(0.001, dt); // frame-rate independent easing; 1 = jump (reduced motion)
    rotSpeed += (rotTarget - rotSpeed) * k;
    flow += (flowTarget - flow) * k;
    glow += (glowTarget - glow) * k;
    accent.lerp(accentTarget, Math.min(1, k * 2));
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, k * 1.5);
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, k * 1.5);

    root.rotation.y += dt * rotSpeed;
    root.rotation.x = mouse.y * 0.28 + Math.sin(performance.now() * 0.0004) * 0.04;
    root.rotation.z = -mouse.x * 0.08;
    camera.position.x = mouse.x * 0.35;
    camera.lookAt(0, 0, 0);

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.t = (p.t + dt * p.s * flow * 0.5) % 1;
      p.c.getPoint(p.t, tmpV);
      partPos[i * 3] = tmpV.x;
      partPos[i * 3 + 1] = tmpV.y;
      partPos[i * 3 + 2] = tmpV.z;
    }
    partGeo.attributes.position.needsUpdate = true;

    rings.forEach((r) => (r.pivot.rotation.z += dt * r.spd * (0.6 + flow)));
    dust.rotation.y += dt * 0.02 * (1 + flow);

    nodeMat.color.copy(accent);
    partMat.color.copy(accent);
    ringMat.color.copy(accent);
    beadMat.color.copy(accent);
    coreMat.uniforms.uRim.value.copy(accent);
    partMat.size = 0.2 * (0.9 + glow * 0.2);
    ringMat.opacity = Math.min(0.9, 0.45 * glow);

    if (shockT >= 0) {
      shockT += dt / 1.4;
      if (shockT >= 1) {
        shockT = -1;
        shockMat.opacity = 0;
      } else {
        const e = 1 - Math.pow(1 - shockT, 3);
        shock.scale.setScalar(1.4 + e * 3.4);
        shockMat.opacity = (1 - shockT) * 0.9;
        shock.quaternion.copy(camera.quaternion);
        tmpColor.copy(accent);
        shockMat.color.copy(tmpColor);
      }
      root.scale.setScalar(1 + Math.sin(Math.min(1, shockT * 2.5) * Math.PI) * 0.05);
    }
  }

  function frame(now) {
    raf = 0;
    if (lost || !visible || document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Adaptive quality: drop pixel ratio once if frames are consistently slow.
    if (++frames > 30 && maxDpr > 1) {
      slowFrames = dt > 0.034 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 40) {
        maxDpr = 1;
        resize();
        slowFrames = 0;
      }
    }

    update(reducedMotion ? 0 : dt);
    renderer.render(scene, camera);
    dirty = false;
    if (!reducedMotion || shockT >= 0) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && !lost && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  applyTheme(theme);
  resize();
  recompute();
  accent.copy(accentTarget);
  container.classList.add('has-webgl');
  kick();

  // ---- public API ----------------------------------------------------------------
  return {
    setTheme(name) {
      applyTheme(name);
      kick();
    },
    /** 'idle' | 'ping' | 'download' | 'upload' | 'done' */
    setStage(s) {
      stage = s;
      if (s === 'idle' || s === 'ping') level = 0;
      recompute();
      kick();
    },
    /** 0..1 fraction of the gauge scale; speeds up the scene. */
    setLevel(f) {
      level = Math.max(0, Math.min(1, f || 0));
      recompute();
    },
    pulse() {
      if (!reducedMotion) shockT = 0; // no moving shock-wave when motion is reduced
      kick();
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => x.dispose?.());
      });
      tex.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
      container.classList.remove('has-webgl');
    },
  };
}
