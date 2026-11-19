// 3D 펀치봇: 모양 만들기 + 상태에 맞춰 움직이기
// (무엇을 할지 "생각"은 opponent.js, 여기는 몸을 움직이고 그려요)
//
// 펀치봇은 z=-1.5(내 앞 1.5m)에 서서 나를 바라봐요.
// 펀치봇 기준 좌표: x 마이너스 = 내가 보기에 왼쪽, z 플러스 = 내 쪽

import * as THREE from "three";
import { FLINCH_MS, guardedPair, openZones, ZONES } from "./opponent.js";
import { makeGlove, placeBetween } from "./scene.js";

export const ROBOT_Z = -1.5;
const HEAD_Y = 0.72; // 상체 기준 머리 높이 (땅에서 1.62m)
const HIPS_Y = 0.9; // 허리 높이

const EYE_COLORS = {
  idle: 0x22d3ee,
  recover: 0x22d3ee,
  windup: 0xf97316,
  strike: 0xef4444,
  stagger: 0xfacc15,
  down: 0x475569,
};

export function createRobot(scene) {
  const metal = new THREE.MeshStandardMaterial({ color: 0xa9b6c8, metalness: 0.3, roughness: 0.4 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x4b5a70, metalness: 0.3, roughness: 0.45 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.45 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.7, roughness: 0.15 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: EYE_COLORS.idle, emissiveIntensity: 3 });

  const root = new THREE.Group(); // 발밑 (쓰러질 때 여기를 축으로 넘어가요)
  root.position.set(0, 0, ROBOT_Z);
  scene.add(root);

  const add = (parent, mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ── 다리 ──
  [-1, 1].forEach((side) => {
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.85, 16), metal), side * 0.12, 0.45, 0);
    add(root, new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.24), darkMetal), side * 0.12, 0.035, 0.04);
  });

  // ── 상체 (허리를 축으로 숙이고 비틀어요) ──
  const body = new THREE.Group();
  body.position.y = HIPS_Y;
  root.add(body);

  add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.24, 24), red), 0, 0.02, 0); // 반바지
  const torso = add(body, new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.28, 8, 20), metal), 0, 0.33, 0);
  torso.scale.set(1.25, 1, 0.8);
  const chestLight = add(body, new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), eyeMat), 0, 0.4, 0.15);
  chestLight.castShadow = false;
  [-1, 1].forEach((side) => {
    add(body, new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), darkMetal), side * 0.28, 0.5, 0);
  });
  add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 12), darkMetal), 0, 0.6, 0);

  // ── 머리 ──
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  body.add(head);
  add(head, new THREE.Mesh(new THREE.SphereGeometry(0.14, 28, 20), red), 0, 0, 0); // 헤드기어
  [-1, 1].forEach((side) => add(head, new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), red), side * 0.13, 0, 0));
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.09, 0.07), visorMat), 0, 0.005, 0.11); // 얼굴 화면
  [-1, 1].forEach((side) => add(head, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.01), eyeMat), side * 0.048, 0.008, 0.147));
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.028, 0.03), white), 0, -0.07, 0.12); // 마우스피스

  // 비틀거릴 때 머리 위를 도는 별
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
  const stars = [0, 1, 2].map(() => {
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.025), starMat);
    star.visible = false;
    head.add(star);
    return star;
  });

  // ── 팔과 글러브 (빨강 코너) ──
  // 글러브0 = 내가 보기에 왼쪽(x 마이너스), 글러브1 = 오른쪽
  const SIDES = [-1, 1];
  const gloves = SIDES.map((side) => {
    const glove = makeGlove(0xdc2626, -side, 0.085);
    root.add(glove);
    return glove;
  });
  const arms = SIDES.map(() => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 1, 12), metal);
    arm.castShadow = true;
    root.add(arm);
    return arm;
  });

  // ── 맞았는지 확인하는 투명한 판정 상자 (화면에는 안 보여요) ──
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), hitMat);
  head.add(headHit);
  const bodyHit = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.6, 0.45), hitMat);
  bodyHit.position.y = 0.3;
  body.add(bodyHit);

  // ── 빈틈 표시 고리 ──
  const ringGeo = new THREE.TorusGeometry(1, 0.08, 8, 40);
  const makeRing = (parent, x, y, z, size) => {
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.9, depthTest: false }),
    );
    ring.position.set(x, y, z);
    ring.userData.size = size;
    ring.renderOrder = 10;
    ring.visible = false;
    parent.add(ring);
    return ring;
  };
  const rings = {
    headL: makeRing(head, -0.07, 0, 0.2, 0.065),
    headR: makeRing(head, 0.07, 0, 0.2, 0.065),
    body: makeRing(body, 0, 0.3, 0.25, 0.13),
  };

  // 펀치봇이 공격할 때 노릴 곳 (펀치봇 기준 좌표). main.js가 정해 줘요.
  const aim = new THREE.Vector3(0, 1.6, -ROBOT_Z - 0.25);
  const tmp = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  // 글러브가 가야 할 자리 (펀치봇 기준 좌표)
  function gloveTarget(op, i, now) {
    const side = SIDES[i];
    const down = op.hp <= 0;
    if (down || op.state === "stagger") return tmp.set(side * 0.3, 0.95, 0.12);
    if (op.state === "windup" && i === op.attackGlove) return tmp.set(side * 0.38, 1.38, -0.08);
    if (op.state === "strike" && i === op.attackGlove) return tmp.copy(aim);
    const zone = guardedPair(op)[i];
    const wiggle = Math.sin(now / 300 + i * 2) * 0.012; // 살짝 들썩
    if (zone === "body") return tmp.set(side * 0.1, 1.18 + wiggle, 0.27);
    return tmp.set(zone === "headL" ? -0.075 : 0.075, 1.58 + wiggle, 0.25);
  }

  const robot = {
    root,

    setAim(worldPoint) {
      // 내 얼굴 바로 앞(25cm)까지 날아와요
      aim.set(worldPoint.x - root.position.x, worldPoint.y - 0.03, worldPoint.z - ROBOT_Z - 0.25);
    },

    update(op, now, dt, level, camera) {
      const down = op.hp <= 0;
      const look = down ? "down" : op.state;
      const k = (speed) => 1 - Math.pow(1 - speed, dt * 60); // 부드럽게 따라가는 비율

      // 눈·가슴 불빛 색 (공격 준비 중엔 깜빡여요)
      eyeMat.emissive.setHex(EYE_COLORS[look]);
      eyeMat.emissiveIntensity = op.state === "windup" && Math.floor(now / 100) % 2 ? 0.4 : 3;

      // 몸 전체: 통통 튀는 스텝, 쓰러지면 뒤로 넘어가요
      const bounce = down ? 0 : Math.abs(Math.sin(now / 260)) * 0.025;
      const sway = down ? 0 : Math.sin(now / 900) * 0.06;
      root.position.y += (bounce - root.position.y) * k(0.3);
      root.position.x += (sway - root.position.x) * k(0.1);
      root.rotation.x += ((down ? -1.35 : 0) - root.rotation.x) * k(0.06);

      // 상체: 상태에 따라 숙이고 비틀어요
      const attackSide = SIDES[op.attackGlove];
      let lean = 0;
      let twist = 0;
      let tilt = 0;
      if (op.state === "windup") {
        lean = -0.1;
        twist = attackSide * 0.3;
      } else if (op.state === "strike") {
        lean = 0.15;
        twist = -attackSide * 0.35;
      } else if (op.state === "stagger") {
        tilt = Math.sin(now / 130) * 0.15;
        lean = -0.08;
      }
      let headTurn = 0;
      if (now < op.flinchUntil) {
        const a = (op.flinchUntil - now) / FLINCH_MS;
        if (op.flinchBody) lean += 0.35 * a;
        else {
          headTurn = op.flinchX * 0.6 * a;
          tilt += op.flinchX * 0.15 * a;
        }
      }
      body.rotation.x += (lean - body.rotation.x) * k(0.25);
      body.rotation.y += (twist - body.rotation.y) * k(0.25);
      body.rotation.z += (tilt - body.rotation.z) * k(0.25);
      head.rotation.y += (headTurn - head.rotation.y) * k(0.35);
      head.rotation.z = -head.rotation.y * 0.3;

      // 별
      stars.forEach((star, i) => {
        star.visible = op.state === "stagger" && !down;
        const a = now / 220 + (i * Math.PI * 2) / 3;
        star.position.set(Math.cos(a) * 0.17, 0.17 + Math.sin(a * 2) * 0.02, Math.sin(a) * 0.17);
        star.rotation.y = now / 100;
      });

      // 글러브와 팔
      gloves.forEach((glove, i) => {
        const target = gloveTarget(op, i, now);
        const fast = op.state === "strike" && i === op.attackGlove;
        glove.position.lerp(target, k(fast ? 0.4 : 0.18));
        glove.lookAt(camera.position); // 주먹 앞면이 나를 봐요

        // 어깨 → 글러브를 원기둥으로 이어요
        const shoulder = body.localToWorld(new THREE.Vector3(SIDES[i] * 0.28, 0.5, 0));
        root.worldToLocal(shoulder);
        const wrist = glove.position.clone().add(new THREE.Vector3(0, 0, -0.08));
        placeBetween(arms[i], shoulder, wrist);
      });

      // 빈틈 고리
      const open = down ? [] : op.state === "stagger" ? ZONES : level.showTarget ? openZones(op) : [];
      const pulse = 1 + Math.sin(now / 140) * 0.12;
      ZONES.forEach((zone) => {
        const ring = rings[zone];
        ring.visible = open.includes(zone);
        ring.material.color.setHex(op.state === "stagger" ? 0xfacc15 : 0x4ade80);
        ring.scale.setScalar(ring.userData.size * pulse);
      });
    },

    // 화면 위 한 점(-1~1)으로 펀치를 뻗었을 때, 펀치봇 어디에 맞는지
    // 돌려주는 값: { zone, point } 또는 null(헛손질)
    hitTest(camera, ndcX, ndcY) {
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = raycaster.intersectObjects([headHit, bodyHit], false)[0];
      if (!hit) return null;
      if (hit.object === bodyHit) return { zone: "body", point: hit.point };
      const local = head.worldToLocal(hit.point.clone());
      return { zone: local.x < 0 ? "headL" : "headR", point: hit.point };
    },

    // 공격 글러브의 지금 위치 (불꽃 위치용)
    attackGlovePosition(op) {
      return gloves[op.attackGlove].getWorldPosition(new THREE.Vector3());
    },
  };
  return robot;
}
