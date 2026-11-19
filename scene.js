// 3D 무대: 링, 조명, 관중석, 내 글러브, 불꽃, 카메라(내 눈)
// 단위는 미터예요. 나는 z=0에 서 있고, 펀치봇은 앞쪽(z가 마이너스인 쪽)에 있어요.

import * as THREE from "three";

export const EYE_HEIGHT = 1.6; // 내 눈높이 (m)
const RING_HALF = 3; // 링 한 변의 절반 (6m × 6m 링)
const RING_CENTER_Z = -0.75; // 링 가운데 (나와 펀치봇 사이)

// 화질 단계 (버벅이면 낮춰요)
//  pixelRatio: 화면 픽셀의 몇 배로 그릴지 (높을수록 선명하지만 무거워요)
//  shadow: 그림자 해상도 (0이면 그림자 끄기)
//  crowdRows: 관중석 줄 수 (최대 4)
//  faceEvery: 얼굴 위치를 몇 화면에 한 번 읽을지
export const QUALITY = {
  high: { pixelRatio: Math.min(window.devicePixelRatio, 2), shadow: 1024, crowdRows: 4, faceEvery: 2 },
  normal: { pixelRatio: 1, shadow: 512, crowdRows: 4, faceEvery: 3 },
  light: { pixelRatio: 0.75, shadow: 0, crowdRows: 2, faceEvery: 2 },
};

export function createWorld(container) {
  // ── 그리는 도구 (WebGL) ──
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: 뒤가 비쳐 보일 수 있게
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // 일반 그림자 (부드러운 그림자보다 가벼워요)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = "three";
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07040a);
  scene.fog = new THREE.Fog(0x07040a, 7, 22); // 멀리 있는 관중은 어둠 속으로

  // 내 눈 = 카메라
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 60);
  camera.position.set(0, EYE_HEIGHT, 0);

  // 경기장 화면에서만 보이는 것들 (관중, 바닥, 천장 조명). 웹캠 화면에서는 숨겨요.
  const arena = new THREE.Group();
  scene.add(arena);
  const arenaBackground = scene.background;
  const arenaFog = scene.fog;

  const spot = addLights(scene, arena);
  addRing(scene, arena);
  const crowd = addCrowd(arena);
  const flashes = crowd.flashes;

  // 내 글러브 (파랑 코너 = 나, 빨강 코너 = 펀치봇)
  const gloves = {
    left: makeGlove(0x2563eb, -1, 0.06),
    right: makeGlove(0x2563eb, 1, 0.06),
  };
  scene.add(gloves.left, gloves.right);

  // 화면 크기가 바뀌면 3D 화면도 맞춰요
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ── 흔들림 ──
  let shakeAmount = 0;
  const lookTarget = new THREE.Vector3(0, 1.45, -1.5); // 펀치봇 쪽을 바라봐요

  // ── 불꽃 ──
  const sparks = [];

  const world = {
    renderer,
    scene,
    camera,
    gloves,

    // 보기 바꾸기
    //  "webcam": 웹캠 영상 위에 펀치봇·글러브·로프만 겹쳐 그려요 (뒤가 비쳐요)
    //  "arena": 어두운 경기장, 관중석까지 다 그려요
    setView(view) {
      const webcam = view === "webcam";
      arena.visible = !webcam;
      scene.background = webcam ? null : arenaBackground;
      scene.fog = webcam ? null : arenaFog;
    },

    // 화질 바꾸기 (QUALITY 중 하나)
    setQuality(q) {
      renderer.setPixelRatio(q.pixelRatio);
      resize();
      spot.castShadow = q.shadow > 0;
      if (q.shadow > 0 && spot.shadow.mapSize.x !== q.shadow) {
        spot.shadow.mapSize.set(q.shadow, q.shadow);
        spot.shadow.map?.dispose(); // 새 크기로 다시 만들게 해요
        spot.shadow.map = null;
      }
      crowd.setRows(q.crowdRows);
    },

    // head: 머리 위치로 옮길 양 (m). 매 화면마다 불러요.
    update(dt, now, head) {
      shakeAmount *= Math.pow(0.02, dt); // 흔들림은 금방 잦아들어요
      const k = 1 - Math.pow(0.001, dt); // 부드럽게 따라가기
      camera.position.x += (head.x - camera.position.x) * k;
      camera.position.y += (EYE_HEIGHT + head.y - camera.position.y) * k;
      camera.lookAt(lookTarget.x + camera.position.x * 0.3, lookTarget.y, lookTarget.z);
      if (shakeAmount > 0.001) {
        camera.position.x += (Math.random() - 0.5) * shakeAmount;
        camera.position.y += (Math.random() - 0.5) * shakeAmount;
        camera.rotation.z += (Math.random() - 0.5) * shakeAmount * 0.5;
      }

      // 관중석 카메라 플래시가 가끔 번쩍
      flashes.forEach((f) => {
        if (f.visible) f.visible = now < f.userData.until;
        else if (Math.random() < 0.004) {
          f.visible = true;
          f.userData.until = now + 60;
        }
      });

      // 불꽃 움직이기
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const age = (now - s.born) / 1000;
        if (age > s.life) {
          scene.remove(s.points);
          s.points.geometry.dispose();
          s.points.material.dispose();
          sparks.splice(i, 1);
          continue;
        }
        const pos = s.points.geometry.attributes.position;
        for (let j = 0; j < s.velocities.length; j++) {
          const v = s.velocities[j];
          v.y -= 3 * dt; // 살짝 떨어지게
          pos.setXYZ(j, pos.getX(j) + v.x * dt, pos.getY(j) + v.y * dt, pos.getZ(j) + v.z * dt);
        }
        pos.needsUpdate = true;
        s.points.material.opacity = 1 - age / s.life;
      }
    },

    render() {
      renderer.render(scene, camera);
    },

    shake(amount) {
      shakeAmount = Math.max(shakeAmount, amount);
    },

    // 타격 불꽃 (position: 3D 위치)
    burst(position, color, count = 30) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const velocities = [];
      for (let i = 0; i < count; i++) {
        positions.set([position.x, position.y, position.z], i * 3);
        const dir = new THREE.Vector3().randomDirection();
        velocities.push(dir.multiplyScalar(0.8 + Math.random() * 1.8));
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color,
        size: 0.035,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      sparks.push({ points, velocities, born: performance.now(), life: 0.45 });
    },

    // 3D 위치 → 화면 위 픽셀 위치 (글자를 띄울 때 써요)
    toScreen(position) {
      const v = position.clone().project(camera);
      return {
        x: ((v.x + 1) / 2) * container.clientWidth,
        y: ((1 - v.y) / 2) * container.clientHeight,
      };
    },

    // 화면 위 한 점(-1~1)에서 앞으로 나가는 방향
    rayDirection(ndcX, ndcY) {
      return new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    },
  };
  return world;
}

// ─────────────────────────────────────────
// 조명: 링 위에서 내리쬐는 스포트라이트 + 은은한 빛 + 뒤쪽 파란 빛
// ─────────────────────────────────────────
function addLights(scene, arena) {
  scene.add(new THREE.HemisphereLight(0x8899cc, 0x221018, 0.6));

  const spot = new THREE.SpotLight(0xfff1dd, 4, 0, 0.75, 0.55, 0);
  spot.position.set(0, 7, RING_CENTER_Z + 0.5);
  spot.target.position.set(0, 0, RING_CENTER_Z - 0.5);
  spot.castShadow = true;
  spot.shadow.mapSize.set(512, 512);
  scene.add(spot, spot.target);

  // 펀치봇 뒤쪽에서 비추는 테두리 빛 (빨강·파랑)
  const rimRed = new THREE.PointLight(0xff3344, 2, 0, 0);
  rimRed.position.set(-2.5, 2.5, -4);
  const rimBlue = new THREE.PointLight(0x3366ff, 2, 0, 0);
  rimBlue.position.set(2.5, 2.5, -4);
  scene.add(rimRed, rimBlue);

  // 천장 조명 틀 (빛나는 막대)
  const barMat = new THREE.MeshBasicMaterial({ color: 0xfff7e6 });
  for (let i = -1; i <= 1; i += 2) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.08, 0.25), barMat);
    bar.position.set(0, 5.5, RING_CENTER_Z + i * 1.6);
    arena.add(bar);
  }
  return spot;
}

// ─────────────────────────────────────────
// 링: 바닥, 기둥 4개, 로프 3줄 × 4면
// ─────────────────────────────────────────
function addRing(scene, arena) {
  // 경기장 바닥 (링 바깥)
  const arenaFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x0d0a10, roughness: 1 }),
  );
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.position.y = -0.6;
  arena.add(arenaFloor);

  // 링 바닥 (매트) + 옆면 천
  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(RING_HALF * 2, 0.6, RING_HALF * 2),
    [
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d }), // 옆
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d }),
      new THREE.MeshStandardMaterial({ map: makeMatTexture(), roughness: 0.85 }), // 위
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d }),
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d }),
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d }),
    ],
  );
  mat.position.set(0, -0.3, RING_CENTER_Z);
  mat.receiveShadow = true;
  arena.add(mat);

  // 코너 기둥: 내 쪽은 파랑, 펀치봇 쪽은 빨강
  const corners = [
    [-1, 1, 0x2563eb],
    [1, 1, 0xe5e7eb],
    [-1, -1, 0xe5e7eb],
    [1, -1, 0xdc2626],
  ];
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.5, 12);
  const padGeo = new THREE.BoxGeometry(0.2, 1.0, 0.2);
  const postPoints = [];
  corners.forEach(([sx, sz, padColor]) => {
    const x = sx * RING_HALF;
    const z = RING_CENTER_Z + sz * RING_HALF;
    const post = new THREE.Mesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.8, roughness: 0.3 }));
    post.position.set(x, 0.75, z);
    const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: padColor, roughness: 0.6 }));
    pad.position.set(x, 0.85, z);
    scene.add(post, pad);
    postPoints.push(new THREE.Vector3(x, 0, z));
  });

  // 로프: 빨강 / 하양 / 파랑 3줄
  const ropeColors = [0xdc2626, 0xf1f5f9, 0x2563eb];
  const heights = [0.45, 0.85, 1.25];
  const order = [0, 1, 3, 2, 0]; // 기둥을 한 바퀴 도는 순서
  heights.forEach((y, row) => {
    const material = new THREE.MeshStandardMaterial({ color: ropeColors[row], roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const a = postPoints[order[i]].clone().setY(y);
      const b = postPoints[order[i + 1]].clone().setY(y);
      scene.add(cylinderBetween(a, b, 0.022, material));
    }
  });
}

// 링 바닥 무늬 (캔버스로 직접 그려요)
function makeMatTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#1e3a8a";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.lineWidth = 6;
  g.strokeRect(20, 20, 472, 472);
  g.beginPath();
  g.arc(256, 256, 90, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.font = "bold 64px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("AI", 256, 256);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ─────────────────────────────────────────
// 관중석: 어두운 사람 모양 실루엣 + 가끔 번쩍이는 카메라 플래시
// ─────────────────────────────────────────
function addCrowd(scene) {
  const spots = [];
  const rowEnds = []; // 각 줄이 끝나는 번호 (화질을 낮추면 앞줄만 보여요)
  for (let row = 0; row < 4; row++) {
    const distance = RING_HALF + 1.5 + row * 0.9; // 링에서 바깥으로
    const y = -0.6 + row * 0.45; // 뒷줄일수록 높게
    for (let t = -distance; t <= distance; t += 0.65) {
      spots.push([t, y, RING_CENTER_Z - distance]); // 앞쪽 (펀치봇 뒤)
      spots.push([-distance, y, RING_CENTER_Z + t]); // 왼쪽
      spots.push([distance, y, RING_CENTER_Z + t]); // 오른쪽
    }
    rowEnds.push(spots.length);
  }

  const bodyMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.2, 0.45, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    spots.length,
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  spots.forEach(([x, y, z], i) => {
    const jx = x + (Math.random() - 0.5) * 0.2;
    const jz = z + (Math.random() - 0.5) * 0.2;
    const tall = 0.9 + Math.random() * 0.2;
    m.makeScale(1, tall, 1).setPosition(jx, y + 0.45 * tall, jz);
    bodyMesh.setMatrixAt(i, m);
    m.makeTranslation(jx, y + 0.95 * tall, jz);
    headMesh.setMatrixAt(i, m);
    color.setHSL(Math.random() < 0.5 ? 0.62 : 0.97, 0.3, 0.08 + Math.random() * 0.06);
    bodyMesh.setColorAt(i, color);
    headMesh.setColorAt(i, color);
  });
  scene.add(bodyMesh, headMesh);

  // 카메라 플래시
  const flashes = [];
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (let i = 0; i < 24; i++) {
    const [x, y, z] = spots[Math.floor(Math.random() * rowEnds[1])]; // 앞 두 줄에서만
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), flashMat);
    flash.position.set(x, y + 1.1, z);
    flash.visible = false;
    flash.userData.until = 0;
    scene.add(flash);
    flashes.push(flash);
  }

  return {
    flashes,
    setRows(rows) {
      const count = rowEnds[Math.max(1, Math.min(4, rows)) - 1];
      bodyMesh.count = count;
      headMesh.count = count;
    },
  };
}

// ─────────────────────────────────────────
// 도우미
// ─────────────────────────────────────────

// 두 점 사이를 잇는 원기둥 (로프, 팔)
export function cylinderBetween(a, b, radius, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10), material);
  placeBetween(mesh, a, b);
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
export function placeBetween(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, Math.max(0.001, length), 1);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}

// 복싱 글러브 모양 (side: -1 왼손, +1 오른손)
// 주먹 앞면이 +z 방향이에요. (lookAt으로 방향을 정해요)
export function makeGlove(color, side, radius = 0.075) {
  const glove = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });

  const fist = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), leather);
  fist.scale.set(1, 0.9, 1.15);
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.42, 14, 10), leather);
  thumb.position.set(-side * radius * 0.75, -radius * 0.2, radius * 0.25);
  // 손목 밴드: 주먹 뒤 아래쪽으로 비스듬히 (팔이 아래에서 올라오는 것처럼)
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.58, radius * 0.7, 18), white);
  cuff.rotation.x = Math.PI / 2 - 0.8;
  cuff.position.set(0, -radius * 0.75, -radius * 0.75);

  [fist, thumb, cuff].forEach((part) => {
    part.castShadow = true;
    glove.add(part);
  });
  return glove;
}
