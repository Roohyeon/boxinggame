// 손을 "판단"하는 함수 모음이에요.
// (상대는 opponent.js, 그리기 효과는 effects.js, 판단은 여기)

// 펀치 기준값 (잘 안 되면 여기 숫자를 조절해요)
export const PUNCH = {
  // 옆·위로 뻗는 펀치: 주먹이 1초에 "손 크기의 몇 배"만큼 움직여야 펀치로 인정할지
  minSpeed: 6,
  // 카메라 쪽으로 뻗는 펀치: 주먹 폭이 1초에 몇 배 비율로 커져야 펀치로 인정할지
  // (가까워질수록 주먹이 크게 보여요. 2 = 1초에 200%씩 커지는 빠르기)
  minGrowth: 2,
  // 펀치 힘이 기준의 이 비율 밑으로 떨어지면 "다 뻗었다"로 보고 그 자리에서 맞혀요
  endPower: 0.5,
  // 펀치가 이 시간(ms)보다 길어지면 그 자리에서 맞은 걸로 쳐요
  maxPunchMs: 300,
  // 한 번 친 손은 이 시간(ms) 동안 다시 펀치가 안 나가요 (한 번 뻗었는데 두 번 맞는 걸 막아요)
  cooldownMs: 250,
  // 빠르게 뻗으면 화면이 흐려져서 주먹을 잘못 읽을 때가 있어요.
  // 그래서 이 시간(ms) 안에 한 번이라도 주먹을 쥐었으면 "주먹"으로 인정해요.
  fistMemoryMs: 400,
  // 손이 이 시간(ms) 넘게 안 보였다가 나타나면, 순간이동으로 보고 펀치로 치지 않아요.
  maxGapMs: 200,
};

// 가드 기준값
export const GUARD = {
  // 두 손이 화면 위에서부터 이 비율 안에 있어야 해요 (0.6 = 화면 위쪽 60%)
  maxY: 0.6,
  // 두 손 사이 가로 거리가 화면 폭의 이 비율보다 가까워야 해요
  maxGapX: 0.32,
  // 손이 하나만 보일 때: 손 크기가 화면 높이의 이 비율보다 크면(아주 가까우면) 가드로 쳐요
  bigHand: 0.25,
  // 가드를 풀어도 이 시간(ms) 동안은 가드한 걸로 쳐 줘요 (인식이 잠깐 흔들려도 괜찮게)
  memoryMs: 300,
};

// 고개(머리) 기준값: 시점 움직이기 + 피하기
// 숫자는 "웹캠 화면 크기에 대한 비율"이에요. (0.1 = 화면 폭의 10%)
export const HEAD = {
  // 평소 자세(기준 위치)에서 이만큼 옆으로 움직이면 "피했다"
  dodgeX: 0.06,
  // 평소 자세에서 이만큼 아래로 숙이면 "숙여서 피했다"
  duckY: 0.05,
  // 기준 위치는 천천히(이 초만큼에 걸쳐) 지금 자세를 따라가요.
  // 그래서 오래 비스듬히 서 있어도 괜찮고, 재빠르게 움직인 것만 "피하기"로 쳐요.
  baselineSeconds: 2.5,
  // 3D 시점이 머리를 따라 움직이는 정도 (미터. 화면 폭만큼 움직이면 몇 m)
  moveX: 1.6,
  moveY: 1.2,
  // 주먹이 도착하기 이 시간(ms) 전부터 한 번이라도 피했으면 피한 걸로 쳐요
  memoryMs: 400,
  // 얼굴이 이 시간(ms) 넘게 안 보이면 시점을 가운데로 돌려요
  lostMs: 500,
};

// 얼굴 상자에서 가운데 위치 (0~1 비율, 거울처럼 좌우 뒤집은 화면 기준)
export function faceCenter(detection, videoWidth, videoHeight) {
  const box = detection.boundingBox;
  return {
    x: 1 - (box.originX + box.width / 2) / videoWidth,
    y: (box.originY + box.height / 2) / videoHeight,
    size: box.width / videoWidth,
  };
}

// 두 점 사이 거리
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 주먹을 쥐었는지 판단해요. (손가락 4개 중 3개 이상이 접혀 있으면 "주먹")
// 원리: 손가락 끝이 가운데 마디보다 손목에 더 가까우면 그 손가락은 접힌 거예요.
//   검지(끝 8, 마디 6) · 중지(12, 10) · 약지(16, 14) · 새끼(20, 18)
export function isFist(landmarks) {
  const wrist = landmarks[0];
  const fingers = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ];
  const curled = fingers.filter(
    ([tip, joint]) => distance(wrist, landmarks[tip]) < distance(wrist, landmarks[joint]),
  ).length;
  return curled >= 3;
}

// 손 크기 (손목 0 ~ 중지 뿌리 9 길이, 픽셀). 움직인 거리를 잴 때 기준으로 써요.
export function handSize(points) {
  return Math.max(1, distance(points[0], points[9]));
}

// 주먹 폭 (검지 뿌리 5 ~ 새끼 뿌리 17 길이, 픽셀)
// 카메라 쪽으로 주먹을 뻗어도 이 폭은 옆으로 누워 있어서, 가까워질수록 그대로 커져 보여요.
export function knuckleWidth(points) {
  return Math.max(1, distance(points[5], points[17]));
}

// 주먹 위치: 손가락 뿌리 관절 4개(5, 9, 13, 17)의 가운데 = 주먹 앞면
export function fistPoint(points) {
  const ids = [5, 9, 13, 17];
  return {
    x: ids.reduce((sum, i) => sum + points[i].x, 0) / ids.length,
    y: ids.reduce((sum, i) => sum + points[i].y, 0) / ids.length,
  };
}

// 펀치 힘: 옆으로 빠르게 움직였거나, 카메라 쪽으로 빠르게 다가왔거나 (둘 중 큰 쪽)
// 1 이상이면 펀치예요.
export function punchPower(speed, growth) {
  return Math.max(speed / PUNCH.minSpeed, growth / PUNCH.minGrowth);
}

// 가드 자세인지 판단해요.
// hands: [{ point, size, power }]  (power: 지금 펀치 힘. 빠르게 움직이는 손은 가드가 아니에요)
export function isGuardPose(hands, width, height) {
  const still = hands.filter((hand) => hand.power < 1);

  // 두 손이 화면 위쪽에서 가까이 모여 있으면 가드
  if (still.length >= 2) {
    const [a, b] = still;
    const high = a.point.y < height * GUARD.maxY && b.point.y < height * GUARD.maxY;
    const close = Math.abs(a.point.x - b.point.x) < width * GUARD.maxGapX;
    return high && close;
  }

  // 두 손이 겹쳐서 하나만 보일 때: 아주 가까이(크게) 위쪽에 있으면 가드
  return still.some(
    (hand) => hand.size > height * GUARD.bigHand && hand.point.y < height * GUARD.maxY,
  );
}
