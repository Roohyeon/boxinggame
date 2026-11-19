// 효과음: 파일 없이 브라우저 안에서 소리를 직접 만들어요. (Web Audio)
// 마이크는 쓰지 않아요. 스피커로 소리만 내요.

let audio = null; // 소리 장치
let enabled = true; // 소리 켜짐/꺼짐

// 브라우저는 "버튼을 누른 뒤"에만 소리를 낼 수 있게 해요.
// 그래서 [카메라 켜기]를 누를 때 이 함수를 불러요.
export function initSound() {
  try {
    audio ??= new AudioContext();
    audio.resume();
  } catch {
    audio = null; // 소리를 못 내도 게임은 돼요
  }
}

export function setSoundEnabled(on) {
  enabled = on;
}

function ready() {
  return enabled && audio && audio.state === "running";
}

// 소리 크기를 "확 커졌다가 서서히 작아지게" 만드는 장치
function envelope(peak, attack, release, start) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
  gain.connect(audio.destination);
  return gain;
}

// 음 하나 (from Hz에서 to Hz로 미끄러지며)
function tone(type, from, to, seconds, peak, start) {
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + seconds);
  osc.connect(envelope(peak, 0.005, seconds, start));
  osc.start(start);
  osc.stop(start + seconds + 0.05);
}

// 쏴아- 하는 잡음 (필터로 높은 소리/낮은 소리만 걸러서)
function noise(filterType, frequency, seconds, peak, start) {
  const length = Math.floor(audio.sampleRate * seconds);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  source.connect(filter).connect(envelope(peak, 0.003, seconds, start));
  source.start(start);
}

// 휙 (펀치를 뻗을 때)
export function playSwoosh() {
  if (!ready()) return;
  noise("bandpass", 1500, 0.15, 0.2, audio.currentTime);
}

// 퍽! (맞혔을 때) / 카운터면 더 세게
export function playPunch(strong) {
  if (!ready()) return;
  const t = audio.currentTime;
  tone("sine", 180, 45, 0.18, 0.8, t);
  noise("lowpass", 1200, 0.08, 0.5, t);
  if (strong) {
    tone("square", 320, 80, 0.12, 0.25, t);
    noise("highpass", 3000, 0.06, 0.3, t);
  }
}

// 탁 (막혔을 때)
export function playBlock() {
  if (!ready()) return;
  const t = audio.currentTime;
  noise("highpass", 2500, 0.05, 0.4, t);
  tone("triangle", 900, 500, 0.08, 0.3, t);
}

// 쿵 (내가 맞았을 때)
export function playHurt() {
  if (!ready()) return;
  const t = audio.currentTime;
  tone("sawtooth", 140, 40, 0.35, 0.35, t);
  noise("lowpass", 600, 0.2, 0.6, t);
}

// 삐삐 (공격 예고)
export function playWarn() {
  if (!ready()) return;
  const t = audio.currentTime;
  tone("square", 880, 870, 0.07, 0.15, t);
  tone("square", 880, 870, 0.07, 0.15, t + 0.12);
}

// 땡! 공 소리 (times번 울려요)
export function playBell(times = 1) {
  if (!ready()) return;
  const t = audio.currentTime;
  for (let i = 0; i < times; i++) {
    [1180, 1770, 2650].forEach((f, j) => tone("sine", f, f * 0.995, 1.2, 0.2 / (j + 1), t + i * 0.35));
  }
}
