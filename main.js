// AI 복싱 스파링 VR: 웹캠 → 손·얼굴 위치 인식 → 3D 링에서 펀치봇과 복싱
//  - 주먹을 뻗으면 펀치, 두 주먹을 얼굴 앞에 모으면 가드
//  - 고개를 움직이면 3D 시점이 따라 움직이고, 재빨리 옆으로 빼거나 숙이면 피하기
// 영상은 브라우저 안에서만 분석해요. (서버로 보내거나 저장하지 않아요)

// MediaPipe 도구 (버전 1.2.2로 고정)
// 버전을 바꾸면 아래 WASM_URL의 버전도 같이 바꿔야 해요.
import {
  FaceDetector,
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs";
import { createWorld, QUALITY } from "./scene.js";
import { createRobot } from "./robot.js";
import {
  calmOpponent,
  createOpponent,
  hitOpponent,
  LEVELS,
  OPPONENT_HP,
  resetOpponent,
  STATE_NAMES,
  updateOpponent,
  ZONE_NAMES,
} from "./opponent.js";
import {
  faceCenter,
  fistPoint,
  GUARD,
  HEAD,
  handSize,
  isFist,
  isGuardPose,
  knuckleWidth,
  PUNCH,
  punchPower,
} from "./gestures.js";
import {
  initSound,
  playBell,
  playBlock,
  playHurt,
  playPunch,
  playSwoosh,
  playWarn,
  setSoundEnabled,
} from "./sound.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// 얼굴 "위치"만 찾는 가벼운 도구예요. 누구인지는 알아보지 않아요.
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

// 경기 규칙 (바꿔 보면서 놀아도 돼요)
const ROUNDS = 3; // 라운드 수
const ROUND_SECONDS = 60; // 한 라운드 시간
const COUNTDOWN_MS = 3000; // 라운드 시작 전 3, 2, 1
const BREAK_MS = 4000; // 라운드 사이 휴식
const PLAYER_HP = 100; // 내 체력
const ROUND_HEAL = 15; // 휴식 때 회복하는 내 체력
const PUNCH_DAMAGE = 5; // 보통 펀치 데미지
const COUNTER_DAMAGE = 12; // 카운터(상대가 비틀거릴 때) 데미지
const COMBO_MS = 1000; // 이 시간(ms) 안에 또 맞히면 콤보가 이어져요
const COMBO_BONUS_AT = 3; // 이 콤보부터
const COMBO_BONUS = 2; // 데미지 +2
// 등급: 점수가 min 이상이면 그 등급 (위에서부터 확인)
const RANKS = [
  { min: 180, name: "챔피언" },
  { min: 120, name: "프로 복서" },
  { min: 60, name: "아마추어 복서" },
  { min: 0, name: "체육관 연습생" },
];
const BEST_KEY = "boxing-vr-best-score"; // 최고 기록 저장 이름 (이 브라우저에만 저장)

// 내 글러브가 3D 화면 속에서 얼마나 앞에 있을지 (m)
const GLOVE = {
  restDistance: 0.5, // 평소
  punchDistance: 1.15, // 펀치를 뻗었을 때 (펀치봇 바로 앞)
  depthGain: 0.5, // 주먹이 카메라에 다가온 만큼 화면 속에서도 앞으로
};

// 화면 요소
const video = document.getElementById("video");
const pipCanvas = document.getElementById("pip");
const pip = pipCanvas.getContext("2d");
const startButton = document.getElementById("start");
const playButton = document.getElementById("play");
const stopButton = document.getElementById("stop");
const levelSelect = document.getElementById("level");
const introCard = document.getElementById("intro");
const fullscreenButton = document.getElementById("fullscreen");
const debugButton = document.getElementById("debugToggle");
const soundCheckbox = document.getElementById("sound");
const statusText = document.getElementById("status");
const overlay = document.getElementById("overlay");
const warnText = document.getElementById("warn");
const hurtLayer = document.getElementById("hurt");
const myHpBar = document.getElementById("myHp");
const myHpText = document.getElementById("myHpText");
const aiHpBar = document.getElementById("aiHp");
const aiHpText = document.getElementById("aiHpText");
const roundText = document.getElementById("round");
const timeText = document.getElementById("time");
const comboText = document.getElementById("combo");
const blocksText = document.getElementById("blocks");
const dodgesText = document.getElementById("dodges");
const bestText = document.getElementById("best");
const debugText = document.getElementById("debug");
const stage = document.querySelector(".stage");

// 3D 무대와 펀치봇은 페이지를 열자마자 만들어요 (카메라 켜기 전에도 링이 보여요)
const world = createWorld(stage);
const robot = createRobot(world.scene);

// 화질은 "가벼움"으로 고정해요. (바꾸고 싶으면 아래 light를 normal이나 high로)
const QUALITY_LEVEL = QUALITY.light;
function quality() {
  return QUALITY_LEVEL;
}
world.setQuality(quality());

world.setView("arena"); // 어두운 경기장 (웹캠은 오른쪽 아래 작은 창)

// [⛶ 전체화면]: 브라우저 탭·주소창까지 숨겨요. 나올 때는 Esc
fullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "⛶ 창 모드" : "⛶ 전체화면";
});

// [진단]: 분석 속도·손·머리 상태를 보여줘요 (잘 안 될 때 원인 찾기용)
debugButton.addEventListener("click", () => {
  debugText.hidden = !debugText.hidden;
  debugButton.classList.toggle("on", !debugText.hidden);
});

let handLandmarker = null; // 손 인식 도구
let faceDetector = null; // 얼굴 위치 도구
let stream = null; // 웹캠 영상
let running = false; // 카메라가 켜져 있는지
let lastVideoTime = -1; // 같은 화면을 두 번 분석하지 않게
let lastFrameTime = 0;
let frameCount = 0;
let resultTimer = null;

const op = createOpponent(); // AI 상대의 두뇌
// 손마다 기억 (키: "Left" / "Right")
const handStates = new Map();
const guard = { lastAt: -Infinity }; // 마지막으로 가드 자세였던 시간
const dodge = { lastAt: -Infinity }; // 마지막으로 피하는 자세였던 시간
// 내 글러브 두 개가 가야 할 곳 (화면 위 위치 -1~1, 앞으로 나간 거리)
const gloveAims = {
  left: { ndcX: -0.4, ndcY: -0.6, dist: GLOVE.restDistance, seenAt: -Infinity },
  right: { ndcX: 0.4, ndcY: -0.6, dist: GLOVE.restDistance, seenAt: -Infinity },
};
// 머리 위치 (0~1 비율). base는 "평소 자세"로, 천천히 따라와요.
const head = { visible: false, x: 0.5, y: 0.5, baseX: 0.5, baseY: 0.5, seenAt: -Infinity, box: null };
let lastHands = []; // 작은 웹캠 창에 점 찍기용

// 게임 상태
//  practice: 자유 연습 (상대가 공격은 하지만 체력은 안 깎여요)
//  countdown → fighting → break → … → result
const game = {
  mode: "practice",
  round: 1,
  startsAt: 0,
  roundEndsAt: 0,
  breakUntil: 0,
  playerHp: PLAYER_HP,
  damageDealt: 0,
  hits: 0,
  counters: 0,
  blocks: 0,
  dodges: 0,
  combo: 0,
  lastHitAt: 0,
  best: loadBest(),
};
bestText.textContent = game.best;

// 진단 표시용
const diag = { analyses: 0, frames: 0, windowStart: 0, perSecond: 0, fps: 0, hands: [], lastRender: 0 };

function level() {
  return LEVELS[levelSelect.value] ?? LEVELS.normal;
}

// 상대가 공격해도 되는 때: 연습 중이거나 시합 중
function canAttack() {
  return running && (game.mode === "practice" || game.mode === "fighting");
}

function isGuarding(now) {
  return now - guard.lastAt < GUARD.memoryMs;
}

// 평소 자세에서 머리를 얼마나 움직였는지 (+x 오른쪽, +y 아래)
function headOffset() {
  if (!head.visible) return { x: 0, y: 0 };
  return { x: head.x - head.baseX, y: head.y - head.baseY };
}

function isDodging() {
  const off = headOffset();
  return head.visible && (Math.abs(off.x) >= HEAD.dodgeX || off.y >= HEAD.duckY);
}

// ─────────────────────────────────────────
// 최고 기록 (브라우저 저장소. 막혀 있어도 게임은 돼요)
// ─────────────────────────────────────────
function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(score) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // 저장이 막힌 브라우저면 그냥 넘어가요
  }
}

// ─────────────────────────────────────────
// 인식 도구 불러오기: GPU(빠름)로 해 보고, 안 되면 CPU로
// ─────────────────────────────────────────
async function loadModels() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const handOptions = (delegate) => ({
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 2, // 양손 펀치 + 가드
  });
  const faceOptions = (delegate) => ({
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
  });
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, handOptions("GPU"));
  } catch {
    handLandmarker = await HandLandmarker.createFromOptions(vision, handOptions("CPU"));
  }
  try {
    faceDetector = await FaceDetector.createFromOptions(vision, faceOptions("GPU"));
  } catch {
    try {
      faceDetector = await FaceDetector.createFromOptions(vision, faceOptions("CPU"));
    } catch {
      faceDetector = null; // 얼굴 도구가 없어도 게임은 돼요 (시점 고정, 피하기만 안 돼요)
    }
  }
}

// [카메라 켜기]
startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  initSound(); // 버튼을 누른 지금 소리 장치를 깨워 둬요
  try {
    if (!handLandmarker) {
      statusText.textContent = "인식 프로그램을 불러오는 중… (처음 한 번만 몇 초 걸려요)";
      await loadModels();
    }

    statusText.textContent =
      "카메라를 켜는 중… (브라우저가 허락을 물어보면 [허용]을 눌러 주세요)";
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    pipCanvas.width = video.videoWidth;
    pipCanvas.height = video.videoHeight;

    running = true;
    stage.classList.add("live");
    startButton.hidden = true;
    playButton.hidden = false;
    stopButton.hidden = false;
    introCard.hidden = true; // 처음 안내 카드 닫기
    calmOpponent(op, performance.now(), level()); // 켜자마자 공격하지 않게
  } catch (error) {
    console.error(error);
    statusText.textContent =
      error?.name === "NotAllowedError"
        ? "카메라 사용이 거절됐어요. 주소창 옆 카메라 아이콘에서 허용해 주세요."
        : "시작하지 못했어요. 인터넷 연결과 카메라를 확인해 주세요.";
  } finally {
    startButton.disabled = false;
  }
});

// [시합 시작] → 3, 2, 1 → 3라운드
playButton.addEventListener("click", () => {
  initSound();
  clearTimeout(resultTimer);
  const now = performance.now();
  Object.assign(game, {
    mode: "countdown",
    round: 1,
    startsAt: now + COUNTDOWN_MS,
    playerHp: PLAYER_HP,
    damageDealt: 0,
    hits: 0,
    counters: 0,
    blocks: 0,
    dodges: 0,
    combo: 0,
  });
  resetOpponent(op, now, level());
  playButton.disabled = true;
  levelSelect.disabled = true; // 시합 중에는 난이도를 못 바꿔요
});

// [카메라 끄기]
stopButton.addEventListener("click", stopCamera);

soundCheckbox.addEventListener("change", () => {
  setSoundEnabled(soundCheckbox.checked);
  if (soundCheckbox.checked) initSound();
});

function stopCamera() {
  running = false;
  stream?.getTracks().forEach((track) => track.stop()); // 카메라 불 끄기
  stream = null;
  video.srcObject = null;
  stage.classList.remove("live");
  handStates.clear();
  lastHands = [];
  head.visible = false;
  clearTimeout(resultTimer);
  lastVideoTime = -1;
  game.mode = "practice";
  game.playerHp = PLAYER_HP;
  op.hp = OPPONENT_HP;
  calmOpponent(op, performance.now(), level());
  overlay.hidden = true;
  debugText.textContent = "";
  startButton.hidden = false;
  playButton.hidden = true;
  playButton.disabled = false;
  stopButton.hidden = true;
  introCard.hidden = false;
  levelSelect.disabled = false;
  statusText.textContent = "카메라를 껐어요.";
}

// ─────────────────────────────────────────
// 매 화면마다 반복 (보통 1초에 60번). 카메라가 꺼져 있어도 3D 링은 계속 그려요.
// ─────────────────────────────────────────
function loop(now) {
  const dt = Math.min(0.05, (now - (lastFrameTime || now)) / 1000);
  lastFrameTime = now;
  const lv = level();

  if (running) {
    // 1) 경기 시간 흐르기
    updateGame(now);

    // 2) AI 상대: 공격 예고 / 공격
    const event = updateOpponent(op, now, lv, canAttack());
    if (event === "windup") {
      playWarn();
      robot.setAim(world.camera.position); // 지금 내 얼굴 위치를 노려요
    }
    if (event === "strike") resolveStrike(now, lv);

    // 3) 새 화면이 들어왔을 때만 손·얼굴을 분석해요
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      frameCount += 1;
      updateHands(handLandmarker.detectForVideo(video, now), now);
      // 얼굴은 몇 화면에 한 번만 (컴퓨터가 덜 힘들게. 화질 단계마다 달라요)
      if (faceDetector && frameCount % quality().faceEvery === 0) {
        updateHead(faceDetector.detectForVideo(video, now), now);
      }
      diag.analyses += 1;
      drawPip();
    }
  }

  // 4) 머리 위치 → 3D 시점
  updateHeadBaseline(now, dt);
  if (isDodging()) dodge.lastAt = now;
  const off = headOffset();
  const camX = clamp(off.x * HEAD.moveX + (head.visible ? (head.baseX - 0.5) * 0.4 : 0), -0.5, 0.5);
  const camY = clamp(-off.y * HEAD.moveY, -0.4, 0.2);
  world.update(dt, now, { x: camX, y: camY });

  // 5) 펀치봇, 내 글러브 움직이고 그리기
  robot.update(op, now, dt, lv, world.camera);
  updateGloves(now, dt);
  world.render();

  // 6) 글자들
  updateHud(now, lv);
  updateWarn(now);
  if (running) updateDebug(now);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 공격 예고 표시: 가드나 회피 자세가 되면 초록색으로 바뀌어요
function updateWarn(now) {
  const show = running && op.state === "windup" && op.hp > 0;
  warnText.hidden = !show;
  if (!show) return;
  const guarding = isGuarding(now);
  const dodging = now - dodge.lastAt < HEAD.memoryMs;
  const text = guarding ? "✔ 가드 OK!" : dodging ? "✔ 회피 자세!" : "⚠️ 가드! 또는 피하기!";
  if (warnText.textContent !== text) warnText.textContent = text;
  warnText.classList.toggle("ok", guarding || dodging);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// ─────────────────────────────────────────
// 머리: 얼굴 상자 가운데를 따라가요
// ─────────────────────────────────────────
function updateHead(result, now) {
  // 가장 큰 얼굴 = 카메라 앞의 나
  const face = result.detections
    .filter((d) => d.boundingBox)
    .sort((a, b) => b.boundingBox.width - a.boundingBox.width)[0];
  if (!face) {
    head.box = null;
    return;
  }
  const c = faceCenter(face, video.videoWidth, video.videoHeight);
  if (!head.visible) {
    // 처음 보였을 때는 지금 자리가 평소 자세
    head.baseX = c.x;
    head.baseY = c.y;
    head.x = c.x;
    head.y = c.y;
  }
  head.visible = true;
  head.seenAt = now;
  head.x += (c.x - head.x) * 0.6; // 살짝 부드럽게
  head.y += (c.y - head.y) * 0.6;
  head.box = face.boundingBox;
}

function updateHeadBaseline(now, dt) {
  if (head.visible && now - head.seenAt > HEAD.lostMs) head.visible = false;
  if (!head.visible) return;
  // 공격이 오는 동안에는 평소 자세를 멈춰 둬요 (그래야 피한 만큼이 정확히 재져요)
  if (op.state === "windup" || op.state === "strike") return;
  const k = 1 - Math.exp(-dt / HEAD.baselineSeconds);
  head.baseX += (head.x - head.baseX) * k;
  head.baseY += (head.y - head.baseY) * k;
}

// ─────────────────────────────────────────
// 손: 주먹 + 빠르게 뻗기 = 펀치 / 두 손을 위에 모으기 = 가드
// ─────────────────────────────────────────
function updateHands(result, now) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const seen = new Set();
  const hands = [];

  // 1단계: 손마다 위치, 주먹인지, 얼마나 빨리 움직였는지
  result.landmarks.forEach((landmarks, i) => {
    let key = result.handedness[i]?.[0]?.categoryName ?? `hand${i}`;
    if (seen.has(key)) key += i;
    seen.add(key);

    const points = landmarks.map((p) => ({ x: p.x * vw, y: p.y * vh }));
    const point = fistPoint(points);
    const size = handSize(points);
    const fist = isFist(landmarks);
    const width = knuckleWidth(points);

    let state = handStates.get(key);
    if (!state) {
      state = { prev: null, width, baseWidth: width, lastFistAt: -Infinity, punching: false, punchStart: 0, cooldownUntil: 0 };
      handStates.set(key, state);
    }
    state.width = state.width * 0.5 + width * 0.5;
    if (fist) state.lastFistAt = now;

    let speed = 0;
    let growth = 0;
    const prev = state.prev;
    if (prev && now - prev.t < PUNCH.maxGapMs) {
      const seconds = (now - prev.t) / 1000;
      speed = Math.hypot(point.x - prev.x, point.y - prev.y) / seconds / size;
      growth = Math.max(0, (state.width - prev.width) / prev.width / seconds);
    }
    hands.push({ key, points, point, size, fist, state, speed, growth, power: punchPower(speed, growth) });
  });

  for (const key of handStates.keys()) {
    if (!seen.has(key)) handStates.delete(key);
  }
  lastHands = hands;

  // 2단계: 가드 자세인지
  const guardNow = isGuardPose(hands, vw, vh);
  if (guardNow) guard.lastAt = now;

  // 3단계: 펀치 판정 + 내 글러브 위치
  diag.hands = [];
  hands.forEach((hand) => {
    const { state, point } = hand;
    const fistReady = now - state.lastFistAt < PUNCH.fistMemoryMs;

    // 웹캠 위치 → 3D 화면 위 위치 (거울처럼 좌우 반전, -1~1)
    const ndcX = clamp((1 - point.x / vw) * 2 - 1, -0.95, 0.95);
    const ndcY = clamp(1 - (point.y / vh) * 2, -0.95, 0.95);

    if (!state.punching) {
      if (fistReady && !guardNow && hand.power >= 1 && now >= state.cooldownUntil) {
        state.punching = true;
        state.punchStart = now;
        playSwoosh();
      }
    } else if (hand.power < PUNCH.endPower || now - state.punchStart > PUNCH.maxPunchMs) {
      state.punching = false;
      state.cooldownUntil = now + PUNCH.cooldownMs;
      landPunch(ndcX, ndcY, now);
    }

    // 평소 주먹 폭은 천천히 따라가요 (펀치 중에는 멈춰요)
    if (!state.punching) state.baseWidth += (state.width - state.baseWidth) * 0.03;
    state.prev = { x: point.x, y: point.y, t: now, width: state.width };

    // 이 손이 어느 글러브인지 (MediaPipe는 거울 기준이라 "Left" 라벨이 내 오른손)
    const side = hand.key.startsWith("Left") ? "right" : hand.key.startsWith("Right") ? "left" : ndcX < 0 ? "left" : "right";
    const reach = clamp(state.width / state.baseWidth - 1, 0, 1);
    Object.assign(gloveAims[side], {
      ndcX,
      ndcY,
      dist: state.punching ? GLOVE.punchDistance : GLOVE.restDistance + reach * GLOVE.depthGain,
      seenAt: now,
    });

    const handName = side === "right" ? "오른손" : "왼손";
    diag.hands.push(
      `${handName}: ${hand.fist ? "주먹 ✊" : "주먹 아님"}` +
        ` · 이동 ${hand.speed.toFixed(1)}(기준 ${PUNCH.minSpeed})` +
        ` · 다가옴 ${hand.growth.toFixed(1)}(기준 ${PUNCH.minGrowth})` +
        ` → ${state.punching ? "펀치!" : fistReady ? "준비" : "대기"}`,
    );
  });
}

// 내 글러브를 3D 화면 속 자리로 옮겨요
function updateGloves(now, dt) {
  const camera = world.camera;
  ["left", "right"].forEach((side) => {
    const aim = gloveAims[side];
    const glove = world.gloves[side];
    // 손이 안 보이면 화면 아래 제자리로
    if (now - aim.seenAt > 300) {
      aim.ndcX = side === "left" ? -0.4 : 0.4;
      aim.ndcY = -0.6;
      aim.dist = GLOVE.restDistance;
    }
    const dir = world.rayDirection(aim.ndcX, aim.ndcY);
    const target = camera.position.clone().addScaledVector(dir, aim.dist);
    glove.position.lerp(target, 1 - Math.pow(0.5, dt * 60));
    glove.lookAt(glove.position.clone().add(dir)); // 주먹 앞면이 앞을 봐요
  });
}

// 내 펀치가 도착했을 때 (ndcX, ndcY: 화면 위 위치 -1~1)
function landPunch(ndcX, ndcY, now) {
  if (op.hp <= 0) return;
  const lv = level();
  const hit = robot.hitTest(world.camera, ndcX, ndcY);
  if (!hit) {
    popupAtScreen(ndcX, ndcY, "헛손질", "#cbd5e1", 0.7);
    return;
  }

  const kind = hitOpponent(op, hit.zone, now, lv, canAttack());
  if (kind === "blocked") {
    playBlock();
    world.burst(hit.point, 0xcbd5e1, 12);
    popupAt(hit.point, "막힘!", "#cbd5e1", 0.8);
    game.combo = 0;
    return;
  }

  // 맞혔어요!
  game.combo = now - game.lastHitAt <= COMBO_MS ? game.combo + 1 : 1;
  game.lastHitAt = now;
  const counter = kind === "counter";
  let damage = counter ? COUNTER_DAMAGE : PUNCH_DAMAGE;
  if (game.combo >= COMBO_BONUS_AT) damage += COMBO_BONUS;

  playPunch(counter);
  world.burst(hit.point, counter ? 0xfde047 : 0xff8c42, counter ? 60 : 30);
  world.shake(counter ? 0.04 : 0.015);

  const fighting = game.mode === "fighting";
  const label = counter ? `카운터!${fighting ? ` -${damage}` : ""}` : fighting ? `-${damage}` : "퍽!";
  popupAt(hit.point, label, counter ? "#fde047" : "#ffffff", counter ? 1.3 : 1);
  if (game.combo >= 2) popupAt(hit.point, `${game.combo} 콤보!`, "#fb923c", 0.75, 50);

  if (!fighting) return; // 연습 중엔 체력이 안 깎여요
  op.hp = Math.max(0, op.hp - damage);
  game.damageDealt += damage;
  game.hits += 1;
  if (counter) game.counters += 1;
  if (op.hp <= 0) finishGame("ko-win", now);
}

// 상대 공격이 들어왔을 때: 가드했거나 피했으면 괜찮고, 아니면 맞아요
function resolveStrike(now, lv) {
  if (!canAttack()) {
    op.blocked = false;
    return;
  }
  const blocked = isGuarding(now);
  // 주먹이 도착하기 조금 전(HEAD.memoryMs)부터 한 번이라도 피했으면 피한 걸로
  const dodged = !blocked && now - dodge.lastAt < HEAD.memoryMs;
  op.blocked = blocked || dodged; // 막거나 피하면 상대가 비틀거려요
  const fighting = game.mode === "fighting";

  if (blocked) {
    playBlock();
    world.burst(robot.attackGlovePosition(op), 0x93c5fd, 40);
    world.shake(0.02);
    popupAtScreen(0, 0.55, "막았다! 지금 반격!", "#93c5fd", 1);
    if (fighting) game.blocks += 1;
    return;
  }
  if (dodged) {
    playSwoosh();
    popupAtScreen(0, 0.55, "피했다! 지금 반격!", "#86efac", 1);
    if (fighting) game.dodges += 1;
    return;
  }

  // 맞았어요: 화면이 크게 흔들리고 빨갛게 번쩍, 잠깐 흐려져요
  playHurt();
  world.shake(0.12);
  restartAnimation(hurtLayer, "on");
  restartAnimation(stage, "dazed");
  game.combo = 0;
  if (!fighting) {
    popupAtScreen(0, 0.55, "맞았어요! (연습이라 괜찮아요)", "#f87171", 0.9);
    return;
  }
  game.playerHp = Math.max(0, game.playerHp - lv.damage);
  popupAtScreen(0, 0.55, `-${lv.damage}`, "#f87171", 1.4);
  if (game.playerHp <= 0) finishGame("ko-lose", now);
}

// CSS 애니메이션을 처음부터 다시 틀어요 (연속으로 맞아도 매번 보이게)
function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // 브라우저가 "지웠다"는 걸 알아차리게 해요
  element.classList.add(className);
}

// 떠오르는 글자: 3D 위치에 / 화면 위치(-1~1)에
function popupAt(worldPoint, text, color, scale = 1, offsetY = 0) {
  const p = world.toScreen(worldPoint);
  showPopup(p.x, p.y + offsetY, text, color, scale);
}

function popupAtScreen(ndcX, ndcY, text, color, scale = 1) {
  showPopup(((ndcX + 1) / 2) * stage.clientWidth, ((1 - ndcY) / 2) * stage.clientHeight, text, color, scale);
}

function showPopup(x, y, text, color, scale) {
  const el = document.createElement("div");
  el.className = "pop";
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  el.style.fontSize = `${Math.round(stage.clientHeight * 0.065 * scale)}px`;
  el.addEventListener("animationend", () => el.remove());
  stage.append(el);
}

// 작은 웹캠 창: 손 점과 얼굴 상자를 그려요 (내 자세 확인용)
function drawPip() {
  pip.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
  lastHands.forEach((hand) => {
    pip.fillStyle = hand.state.punching ? "#fb923c" : hand.fist ? "#f87171" : "#e2e8f0";
    hand.points.forEach((p) => {
      pip.beginPath();
      pip.arc(p.x, p.y, 6, 0, Math.PI * 2);
      pip.fill();
    });
  });
  if (head.box) {
    pip.lineWidth = 4;
    pip.strokeStyle = isDodging() ? "#4ade80" : "#60a5fa";
    pip.strokeRect(head.box.originX, head.box.originY, head.box.width, head.box.height);
  }
}

// ─────────────────────────────────────────
// 경기 시간 흐르기
// ─────────────────────────────────────────
function updateGame(now) {
  if (game.mode === "countdown") {
    const left = game.startsAt - now;
    if (left > 0) {
      showOverlay(
        `<div>${game.round}라운드</div><div class="big">${Math.ceil(left / 1000)}</div>` +
          `<div>두 주먹을 들고 준비!</div>`,
      );
    } else {
      game.mode = "fighting";
      game.roundEndsAt = now + ROUND_SECONDS * 1000;
      calmOpponent(op, now, level());
      playBell(1);
    }
  }

  if (game.mode === "fighting") {
    const elapsed = now - (game.roundEndsAt - ROUND_SECONDS * 1000);
    if (elapsed < 700) showOverlay(`<div class="big">FIGHT!</div>`);
    else overlay.hidden = true;
    if (now >= game.roundEndsAt) endRound(now);
  }

  if (game.mode === "break") {
    showOverlay(
      `<div>${game.round - 1}라운드 끝!</div><div class="big">휴식</div>` +
        `<div>체력 +${ROUND_HEAL} · 곧 ${game.round}라운드</div>`,
    );
    if (now >= game.breakUntil) {
      game.mode = "countdown";
      game.startsAt = now + COUNTDOWN_MS;
    }
  }

  if (game.combo > 0 && now - game.lastHitAt > COMBO_MS) game.combo = 0;
}

function endRound(now) {
  playBell(2);
  if (game.round >= ROUNDS) {
    finishGame("decision", now);
    return;
  }
  game.round += 1;
  game.mode = "break";
  game.breakUntil = now + BREAK_MS;
  game.playerHp = Math.min(PLAYER_HP, game.playerHp + ROUND_HEAL);
  calmOpponent(op, now, level());
}

// kind: "ko-win"(상대 KO) / "ko-lose"(내가 KO) / "decision"(판정: 남은 체력 비교)
function finishGame(kind, now) {
  game.mode = "result";
  game.combo = 0;
  calmOpponent(op, now, level());

  let outcome = kind;
  if (kind === "decision") {
    outcome = game.playerHp > op.hp ? "win" : game.playerHp < op.hp ? "lose" : "draw";
  }
  const titles = {
    "ko-win": "🏆 KO 승리!",
    "ko-lose": "😵 KO 패배…",
    win: "🏆 판정승!",
    lose: "판정패…",
    draw: "무승부",
  };
  const won = outcome === "ko-win" || outcome === "win";

  // 점수 = 준 데미지 + 막은 공격×3 + 피한 공격×4 + 남은 체력 + 승리 보너스
  const score =
    game.damageDealt +
    game.blocks * 3 +
    game.dodges * 4 +
    game.playerHp +
    (won ? 50 : 0) +
    (outcome === "ko-win" ? 30 : 0);
  const rank = RANKS.find((r) => score >= r.min).name;
  const newBest = score > game.best;
  if (newBest) {
    game.best = score;
    saveBest(score);
    bestText.textContent = score;
  }

  playBell(3);
  showOverlay(
    `<div>${titles[outcome]}</div>` +
      `<div class="big">${score}점</div>` +
      `<div class="rank">${rank}</div>` +
      `<div>명중 ${game.hits} · 카운터 ${game.counters} · 가드 ${game.blocks} · 회피 ${game.dodges}` +
      `${newBest ? " · 🎉 최고 기록!" : ""}</div>`,
  );
  playButton.disabled = false;
  playButton.textContent = "다시 시합 (3라운드)";
  levelSelect.disabled = false;

  // 6초 뒤 결과창을 닫고 연습으로
  resultTimer = setTimeout(() => {
    if (game.mode !== "result") return;
    game.mode = "practice";
    game.playerHp = PLAYER_HP;
    op.hp = OPPONENT_HP;
    calmOpponent(op, performance.now(), level());
    overlay.hidden = true;
  }, 6000);
}

function showOverlay(html) {
  if (overlay.innerHTML !== html) overlay.innerHTML = html;
  overlay.hidden = false;
}

// 체력바·시계·안내 글자 바꾸기
function updateHud(now, lv) {
  const myPct = (game.playerHp / PLAYER_HP) * 100;
  const aiPct = (op.hp / OPPONENT_HP) * 100;
  myHpBar.style.width = `${myPct}%`;
  aiHpBar.style.width = `${aiPct}%`;
  myHpBar.classList.toggle("low", myPct <= 30);
  aiHpBar.classList.toggle("low", aiPct <= 30);
  myHpText.textContent = game.playerHp;
  aiHpText.textContent = op.hp;
  comboText.textContent = game.combo;
  blocksText.textContent = game.blocks;
  dodgesText.textContent = game.dodges;

  if (game.mode === "practice") {
    roundText.textContent = "연습";
    timeText.textContent = "–";
  } else if (game.mode === "result") {
    roundText.textContent = "경기 끝";
    timeText.textContent = "0";
  } else {
    roundText.textContent = `${game.round} / ${ROUNDS} 라운드`;
    timeText.textContent =
      game.mode === "fighting" ? Math.max(0, Math.ceil((game.roundEndsAt - now) / 1000)) : ROUND_SECONDS;
  }

  statusText.textContent = statusMessage(lv);
}

function statusMessage(lv) {
  if (!running) return "[카메라 켜기]를 누르면 링에 올라가요.";
  if (game.mode === "countdown") return "곧 시작해요…";
  if (game.mode === "break") return "숨 고르기… 팔을 가볍게 털어 주세요.";
  if (game.mode === "result") return "시합 끝! [다시 시합]으로 재도전할 수 있어요.";
  if (lastHands.length === 0) return "손을 카메라에 보여 주세요. (한 걸음 뒤에서 상체가 보이게)";

  const tag = game.mode === "practice" ? " (지금은 연습 · [시합 시작]을 누르면 3라운드)" : "";
  if (op.state === "windup") return "⚠️ 공격이 와요! 두 주먹으로 가드하거나, 고개를 옆으로 빼서 피하세요!";
  if (op.state === "stagger") return "💫 상대가 비틀거려요! 아무 데나 치면 카운터 2배!";
  if (game.combo >= COMBO_BONUS_AT) return `🔥 ${game.combo} 콤보! 데미지 +${COMBO_BONUS}`;
  if (lv.showTarget) return `🎯 빈틈: ${ZONE_NAMES[op.open]}을 노려요!${tag}`;
  return `🎯 빈틈을 찾아 치세요! (어려움은 표시가 없어요)${tag}`;
}

function updateDebug(now) {
  diag.frames += 1;
  if (now - diag.windowStart >= 1000) {
    const seconds = (now - diag.windowStart) / 1000;
    diag.perSecond = Math.round(diag.analyses / seconds);
    diag.fps = Math.round(diag.frames / seconds);
    diag.analyses = 0;
    diag.frames = 0;
    diag.windowStart = now;
  }
  if (now - diag.lastRender < 200) return;
  diag.lastRender = now;
  const off = headOffset();
  const slow = diag.fps > 0 && diag.fps < 40;
  debugText.textContent = [
    `화면 ${diag.fps}fps · 분석 ${diag.perSecond}회/초` +
      (slow ? "  ← 버벅여요. 다른 탭·프로그램을 닫아 보세요" : "") +
      (diag.perSecond > 0 && diag.perSecond < 15 ? "  ← 분석이 느려요 (빠른 펀치를 놓칠 수 있어요)" : ""),
    ...(diag.hands.length > 0 ? diag.hands : ["손: 안 보여요"]),
    faceDetector
      ? head.visible
        ? `머리: 좌우 ${off.x.toFixed(2)}(피하기 ±${HEAD.dodgeX}) · 아래 ${off.y.toFixed(2)}(숙이기 ${HEAD.duckY})` +
          ` → ${isDodging() ? "피하는 중 🟢" : "평소 자세"}`
        : "머리: 안 보여요 (얼굴이 카메라에 보이게 서 주세요)"
      : "머리: 얼굴 도구를 못 불러왔어요 (피하기 없이 가드만 돼요)",
    `가드: ${isGuarding(now) ? "🛡️ 가드 중" : "안 함"} · 상대: ${STATE_NAMES[op.state]}`,
  ].join("\n");
}

// 다른 탭으로 가거나 페이지를 닫으면 카메라를 꺼요.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) stopCamera();
});
