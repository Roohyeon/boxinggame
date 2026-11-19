// AI 상대 "펀치봇"의 두뇌: 규칙대로 움직이는 스파링 로봇이에요.
// (인터넷 AI를 쓰지 않아요. 아래 규칙과 숫자로 움직여요)
// 모양과 움직임 그리기는 robot.js, 여기는 "생각"만 해요.
//
// 상태 흐름:
//   idle(자세 잡기, 가드 위치를 바꿔요)
//     → windup(공격 준비! 주먹을 뒤로 빼요 = 가드하거나 피하라는 예고)
//     → strike(공격!)
//        → 막거나 피했으면 stagger(비틀비틀, 아무 데나 맞아요 = 카운터 기회)
//        → 맞혔으면 recover(자세 회복)
//     → 다시 idle
//
// 똑똑한 점: 내가 자주 치는 곳은 기억해 두었다가, 그곳을 더 자주 막아요.

export const OPPONENT_HP = 100;

// 난이도별 숫자 (ms = 1000분의 1초)
export const LEVELS = {
  easy: {
    idleMin: 2600, // 공격과 공격 사이 쉬는 시간 (최소~최대 중 무작위)
    idleMax: 4000,
    windupMs: 1100, // 공격 예고 시간 (길수록 막기 쉬워요)
    shiftMs: 2400, // 가드 위치를 바꾸는 간격
    staggerMs: 1400, // 막거나 피했을 때 상대가 비틀거리는 시간
    damage: 8, // 내가 맞으면 깎이는 체력
    counterChance: 0.1, // 맞은 직후 바로 반격할 확률
    showTarget: true, // 빈틈에 초록 고리 표시
  },
  normal: {
    idleMin: 1700,
    idleMax: 3000,
    windupMs: 800,
    shiftMs: 1600,
    staggerMs: 1100,
    damage: 12,
    counterChance: 0.25,
    showTarget: true,
  },
  hard: {
    idleMin: 1000,
    idleMax: 2000,
    windupMs: 600,
    shiftMs: 1000,
    staggerMs: 850,
    damage: 16,
    counterChance: 0.45,
    showTarget: false,
  },
};

// 칠 수 있는 곳 3군데 (왼쪽/오른쪽은 "내가 보는" 기준)
export const ZONES = ["headL", "headR", "body"];
export const ZONE_NAMES = { headL: "왼쪽 얼굴", headR: "오른쪽 얼굴", body: "몸통" };
export const STATE_NAMES = {
  idle: "자세 잡는 중",
  windup: "공격 준비!",
  strike: "공격!",
  stagger: "비틀비틀",
  recover: "자세 회복",
};

const STRIKE_MS = 260; // 주먹이 날아오는 시간
const RECOVER_MS = 500; // 공격이 맞은 뒤 자세를 되찾는 시간
export const FLINCH_MS = 300; // 맞았을 때 움찔하는 시간

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function createOpponent() {
  return {
    hp: OPPONENT_HP,
    state: "idle",
    stateUntil: 0, // 지금 상태가 끝나는 시각
    nextShiftAt: 0, // 다음에 가드를 바꿀 시각
    open: "body", // 지금 비어 있는 곳 (나머지 두 곳은 장갑으로 막고 있어요)
    attackGlove: 0, // 공격하는 장갑 (0: 내가 보기에 왼쪽, 1: 오른쪽)
    blocked: false, // 방금 공격을 내가 막았거나 피했는지
    flinchUntil: 0,
    flinchX: 0, // 맞고 밀려나는 방향 (+1: 오른쪽, -1: 왼쪽)
    flinchBody: false, // 몸통을 맞았는지 (허리를 숙여요)
    streak: 0, // 연속으로 맞은 횟수
    hitsTaken: { headL: 0, headR: 0, body: 0 }, // 어디를 많이 맞았는지 기억
  };
}

// 새 시합: 체력과 기억을 처음으로
export function resetOpponent(op, now, level) {
  op.hp = OPPONENT_HP;
  op.hitsTaken = { headL: 0, headR: 0, body: 0 };
  op.streak = 0;
  calmOpponent(op, now, level);
}

// 하던 공격을 멈추고 자세를 잡아요 (라운드 시작·끝, 카메라 켤 때)
export function calmOpponent(op, now, level) {
  op.state = "idle";
  op.stateUntil = now + rand(level.idleMin, level.idleMax);
  op.nextShiftAt = now + level.shiftMs;
  op.blocked = false;
}

// 장갑 두 개가 각각 막고 있는 곳 [장갑0, 장갑1]
export function guardedPair(op) {
  if (op.open === "headL") return ["body", "headR"];
  if (op.open === "headR") return ["headL", "body"];
  return ["headL", "headR"];
}

// 지금 때리면 들어가는 곳들
export function openZones(op) {
  if (op.state === "stagger") return ZONES; // 비틀거릴 땐 다 열려 있어요
  if (op.state === "strike") return []; // 공격하는 순간엔 몸을 웅크려요
  if (op.state === "windup") {
    // 공격하려고 장갑을 뒤로 빼면, 그 장갑이 막던 곳도 열려요
    return [op.open, guardedPair(op)[op.attackGlove]];
  }
  return [op.open];
}

// 가드 위치 바꾸기: 많이 맞은 곳일수록 덜 비워 둬요 (= 더 자주 막아요)
function shiftGuard(op) {
  const choices = ZONES.filter((zone) => zone !== op.open);
  const weights = choices.map((zone) => 1 / (1 + op.hitsTaken[zone] * 0.5));
  let pick = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < choices.length; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      op.open = choices[i];
      return;
    }
  }
  op.open = choices[choices.length - 1];
}

// 매 화면마다 상대 상태를 넘겨요.
// 돌려주는 값: "windup"(공격 예고 시작) / "strike"(공격 들어옴) / null
export function updateOpponent(op, now, level, canAttack) {
  if (op.hp <= 0) return null; // 쓰러졌어요

  switch (op.state) {
    case "idle":
      if (now >= op.nextShiftAt) {
        shiftGuard(op);
        op.nextShiftAt = now + level.shiftMs * rand(0.7, 1.3);
      }
      if (canAttack && now >= op.stateUntil) {
        op.state = "windup";
        op.stateUntil = now + level.windupMs;
        op.attackGlove = Math.random() < 0.5 ? 0 : 1;
        return "windup";
      }
      break;
    case "windup":
      if (now >= op.stateUntil) {
        op.state = "strike";
        op.stateUntil = now + STRIKE_MS;
        return "strike"; // main.js가 내가 막았는지/피했는지 보고 op.blocked를 정해요
      }
      break;
    case "strike":
      if (now >= op.stateUntil) {
        op.state = op.blocked ? "stagger" : "recover";
        op.stateUntil = now + (op.blocked ? level.staggerMs : RECOVER_MS);
      }
      break;
    case "stagger":
    case "recover":
      if (now >= op.stateUntil) calmOpponent(op, now, level);
      break;
  }
  return null;
}

// 내 펀치가 zone에 닿았을 때. 돌려주는 값: "hit" / "counter" / "blocked"
export function hitOpponent(op, zone, now, level, canAttack) {
  let kind;
  if (op.state === "stagger") kind = "counter";
  else if (openZones(op).includes(zone)) kind = "hit";
  else kind = "blocked";

  if (kind === "blocked") {
    op.streak = 0;
    return kind;
  }

  // 움찔! (왼쪽 얼굴을 맞으면 오른쪽으로 밀리고, 몸통을 맞으면 허리를 숙여요)
  op.flinchUntil = now + FLINCH_MS;
  op.flinchX = zone === "headL" ? 1 : zone === "headR" ? -1 : 0;
  op.flinchBody = zone === "body";
  op.hitsTaken[zone] += 1;

  if (kind === "hit") {
    op.streak += 1;
    if (op.streak >= 3) {
      // 3번 연속 맞으면 정신 차리고 가드를 바로 바꿔요
      shiftGuard(op);
      op.streak = 0;
      op.nextShiftAt = now + level.shiftMs;
    } else if (canAttack && op.state === "idle" && Math.random() < level.counterChance) {
      // 맞고 화가 나서 곧바로 반격!
      op.stateUntil = Math.min(op.stateUntil, now + 350);
    }
  }
  return kind;
}
