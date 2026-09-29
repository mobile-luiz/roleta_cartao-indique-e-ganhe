/* =========================================================
   ROLETA DA SORTE — PAD Saúde+
   ========================================================= */

// ⚠️ CONFIGURE AQUI o WhatsApp da CLÍNICA (só números, com 55 + DDD).
// Ex.: "5581999999999". Se ficar vazio, o WhatsApp abre para a pessoa escolher o contato.
const CLINIC_WHATSAPP = "5581921434317";

const MAX_ROUNDS = 10;
const COUPON_VALID_DAYS = 7;       // validade do cupom de desconto
const GIFT_VALID_DAYS = 5;         // validade do brinde
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtDay = (ms) => new Date(ms).toLocaleDateString("pt-BR", { timeZone: "America/Recife" });
const SPIN_SPEED = 720;          // graus/segundo enquanto espera o servidor
const SPIN_ACCEL_MS = 350;       // tempo para chegar na velocidade máxima
const EXTRA_TURNS = 3;           // voltas completas antes de parar
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const segments = [
  { label: "50% OFF", type: "discount", value: 50 },
  { label: "ADESÃO GRÁTIS", type: "adesao", value: 0, lines: ["ADESÃO", "GRÁTIS", "CARTÃO PAD+"] },
  { label: "30% OFF", type: "discount", value: 30 },
  { label: "20% OFF", type: "discount", value: 20 },
  { label: "15% OFF", type: "discount", value: 15 },
  { label: "10% OFF", type: "discount", value: 10 },
  { label: "TENTE NOVAMENTE!", type: "retry", value: 0 },
  { label: "NÃO FOI DESTA VEZ!", type: "lose", value: 0 },
  { label: "QUASE LÁ!", type: "retry", value: 0 },
  { label: "BRINDE ESPECIAL!", type: "gift", value: 0 }
];
const segmentColors = ["#c52b61", "#f04b32", "#f59e0b", "#20aa57", "#17a9c9", "#1475cf", "#db3c9b", "#173f91", "#10a8a4", "#7b42c1"];
const SLICE_DEG = 360 / segments.length;

// ---------- Elementos ----------
const $ = (id) => document.getElementById(id);
const canvas = $("wheel");
const ctx = canvas.getContext("2d");
const spinBtn = $("spinBtn");
const hubBtn = $("hubBtn");
const roundsEl = $("rounds");
const roundsBar = $("roundsBar");
const panel = $("panel");
const formBox = $("formBox");
const readyBox = $("readyBox");
const resultBox = $("resultBox");
const leadForm = $("leadForm");
const submitBtn = $("submitBtn");
const nameInput = $("name");
const phoneInput = $("phone");
const consentInput = $("consent");
const loginStatus = $("loginStatus");
const spinError = $("spinError");
const againBtn = $("againBtn");
const whatsappBtn = $("whatsappBtn");
const copyBtn = $("copyBtn");
const soundBtn = $("soundBtn");
const myPrizesBtn = $("myPrizesBtn");
const myPrizesModal = $("myPrizesModal");
const closePrizesBtn = $("closePrizesBtn");
const searchPrizesBtn = $("searchPrizesBtn");
const prizesPhone = $("prizesPhone");
const prizesStatus = $("prizesStatus");
const prizesList = $("prizesList");

// ---------- Estado ----------
let uid = null;
let participant = null;          // { id, roundsUsed, name, phone }
let spinning = false;
let lastResult = null;
let angle = 0;                   // rotação atual da roleta (graus)
let audioContext = null;
let soundEnabled = safeStorageGet("pad_roleta_sound") !== "off";

// ---------- Utilidades ----------
function safeStorageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function safeStorageSet(key, v) { try { localStorage.setItem(key, v); } catch (_) {} }

function trackEvent(name, params = {}) {
  try { if (typeof window.gtag === "function") window.gtag("event", name, params); } catch (_) {}
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.substring(2);
  if (digits.length === 10) digits = digits.substring(0, 2) + "9" + digits.substring(2);
  return "55" + digits;
}
function validatePhone(value) { return /^55\d{11}$/.test(normalizePhone(value)); }

// Máscara (81) 99999-9999
function maskPhone(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.substring(2);
  d = d.substring(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
[phoneInput, prizesPhone].forEach(input => {
  input.addEventListener("input", () => {
    input.value = maskPhone(input.value);
    input.classList.remove("invalid");
  });
});
nameInput.addEventListener("input", () => nameInput.classList.remove("invalid"));

function friendlyError(error, fallback) {
  const code = String(error?.code || "");
  if (error instanceof RoletaDB.RoletaError) return error.message;
  if (/permission/i.test(code) || /permission/i.test(String(error?.message))) return fallback;
  if (/network|unavailable|disconnected/i.test(code)) return "Sem conexão. Verifique sua internet e tente de novo.";
  return fallback;
}

function isInViewport(el) {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}
function revealPanel() {
  if (!isInViewport(panel)) panel.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
}

// ---------- Som (Web Audio) ----------
function getAudioContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    audioContext = new AudioCtx();
  }
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function tone({ freq, freqEnd, type = "sine", vol = .15, start = 0, dur = .05 }) {
  if (!soundEnabled) return;
  const ac = getAudioContext();
  if (!ac) return;
  try {
    const now = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur * .8);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + .004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + .02);
  } catch (_) {}
}
let lastTickAt = 0;
function playTick() {
  const now = performance.now();
  if (now - lastTickAt < 35) return; // evita "chiado" quando gira muito rápido
  lastTickAt = now;
  tone({ freq: 1150, freqEnd: 700, type: "square", vol: .12, dur: .035 });
}
function playFanfare() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ freq: f, vol: .2, start: i * .1, dur: .25 }));
}
function playLoseSound() { tone({ freq: 320, freqEnd: 150, type: "sawtooth", vol: .1, dur: .4 }); }

function updateSoundButton() {
  soundBtn.textContent = soundEnabled ? "🔊 Som ligado" : "🔇 Som desligado";
  soundBtn.setAttribute("aria-pressed", String(soundEnabled));
  soundBtn.classList.toggle("off", !soundEnabled);
}
soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  safeStorageSet("pad_roleta_sound", soundEnabled ? "on" : "off");
  updateSoundButton();
  if (soundEnabled) playTick();
});
updateSoundButton();

// ---------- Desenho da roleta ----------
const WHEEL_SIZE = 600;

function drawWheel() {
  const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
  const c = WHEEL_SIZE / 2;
  const radius = c - 2;
  const slice = (Math.PI * 2) / segments.length;
  const display = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "Arial";

  canvas.width = WHEEL_SIZE * dpr;
  canvas.height = WHEEL_SIZE * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

  segments.forEach((seg, i) => {
    const start = i * slice - Math.PI / 2;
    const end = start + slice;
    const mid = start + slice / 2;

    // Fatia
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, radius, start, end);
    ctx.closePath();
    const grad = ctx.createRadialGradient(c, c, radius * .2, c, c, radius);
    grad.addColorStop(0, shade(segmentColors[i], 18));
    grad.addColorStop(1, segmentColors[i]);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.stroke();

    // Texto "de pé" (a base aponta para o centro), assim o prêmio que para
    // embaixo da seta fica sempre na posição certa de leitura.
    const drawLine = (text, r, size) => {
      ctx.save();
      ctx.translate(c + Math.cos(mid) * r, c + Math.sin(mid) * r);
      ctx.rotate(mid + Math.PI / 2);
      // Diminui a fonte até o texto caber na largura da fatia naquele raio
      const maxWidth = 2 * r * Math.tan(slice / 2) * .82;
      let px = size;
      ctx.font = `800 ${px}px ${display}`;
      while (px > 10 && ctx.measureText(text).width > maxWidth) {
        px -= 1;
        ctx.font = `800 ${px}px ${display}`;
      }
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,.35)";
      ctx.shadowOffsetY = 2;
      ctx.shadowBlur = 3;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };

    if (seg.type === "discount") {
      drawLine(`${seg.value}%`, radius * .77, 46);
      drawLine("OFF", radius * .61, 22);
    } else if (seg.lines) {
      drawLine(seg.lines[0], radius * .82, 22);
      drawLine(seg.lines[1], radius * .7, 22);
      drawLine(seg.lines[2], radius * .58, 14);
    } else {
      const words = seg.label.split(" ");
      const half = Math.ceil(words.length / 2);
      const lines = words.length > 1 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [seg.label];
      if (lines.length === 1) {
        drawLine(lines[0], radius * .72, 22);
      } else {
        drawLine(lines[0], radius * .8, 22);
        drawLine(lines[1], radius * .67, 22);
      }
    }
  });

  // Círculo interno atrás do botão central
  ctx.beginPath();
  ctx.arc(c, c, radius * .14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fill();
}

function shade(hex, percent) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.min(255, Math.max(0, Math.round(v + (255 * percent) / 100)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function setAngle(deg) {
  const prevSlice = Math.floor(angle / SLICE_DEG);
  angle = deg;
  canvas.style.transform = `rotate(${angle}deg)`;
  if (Math.floor(angle / SLICE_DEG) !== prevSlice) playTick();
}

// ---------- Animação (requestAnimationFrame) ----------
// Fase 1: gira livre enquanto o servidor sorteia (não trava se a função demorar).
// Fase 2: desacelera suavemente até parar no prêmio sorteado.
let freeSpin = null;

function startFreeSpin() {
  const t0 = performance.now();
  let last = t0;
  freeSpin = { velocity: 0, raf: 0 };
  const step = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    const accel = Math.min(1, (now - t0) / SPIN_ACCEL_MS);
    freeSpin.velocity = SPIN_SPEED * accel;
    setAngle(angle + freeSpin.velocity * dt);
    freeSpin.raf = requestAnimationFrame(step);
  };
  freeSpin.raf = requestAnimationFrame(step);
}

function landOn(targetAngle, minDuration = 0) {
  return new Promise(resolve => {
    const v0 = Math.max(120, freeSpin?.velocity || SPIN_SPEED);
    if (freeSpin) cancelAnimationFrame(freeSpin.raf);
    freeSpin = null;

    const from = angle;
    const distance = targetAngle - from;
    // easeOutCubic começa com velocidade 3*dist/D → casamos com a velocidade atual
    let duration = Math.max(minDuration, (3 * distance / v0) * 1000);
    if (REDUCED_MOTION) duration = Math.min(duration, 900);
    const t0 = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAngle(from + distance * eased);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function targetAngleFor(index) {
  // Centro da fatia "index" precisa ficar em 0° (embaixo da seta)
  const wanted = (360 - (index * SLICE_DEG + SLICE_DEG / 2)) % 360;
  const current = ((angle % 360) + 360) % 360;
  const delta = (wanted - current + 360) % 360;
  const turns = REDUCED_MOTION ? 1 : EXTRA_TURNS;
  return angle + turns * 360 + delta; // sempre para frente
}

// ---------- Interface ----------
function roundsLeft() { return participant ? Math.max(0, MAX_ROUNDS - Number(participant.roundsUsed || 0)) : 0; }

function renderRounds() {
  if (!participant) {
    roundsEl.textContent = "10 rodadas grátis por participação";
    roundsBar.innerHTML = "";
  } else {
    const used = Number(participant.roundsUsed || 0);
    const left = roundsLeft();
    roundsEl.textContent = left > 0
      ? `🎯 ${left} ${left === 1 ? "rodada restante" : "rodadas restantes"} de ${MAX_ROUNDS}`
      : "Você usou todas as rodadas desta participação";
    roundsBar.innerHTML = Array.from({ length: MAX_ROUNDS }, (_, i) => `<i class="${i < used ? "used" : ""}"></i>`).join("");
  }

  const canSpin = !!participant && roundsLeft() > 0 && !spinning;
  spinBtn.classList.toggle("locked", !participant);
  hubBtn.disabled = spinning;

  if (spinning) {
    spinBtn.disabled = true;
    spinBtn.textContent = "🎡 Girando…";
  } else if (!participant) {
    spinBtn.disabled = false; // leva até o formulário
    spinBtn.textContent = "🔒 Cadastre-se para girar";
  } else if (roundsLeft() <= 0) {
    spinBtn.disabled = true;
    spinBtn.textContent = "Rodadas esgotadas";
  } else {
    spinBtn.disabled = !canSpin;
    spinBtn.textContent = "🎡 GIRAR A ROLETA";
  }
}

function showPanel(which) {
  formBox.classList.toggle("hidden", which !== "form");
  readyBox.classList.toggle("hidden", which !== "ready");
  resultBox.classList.toggle("hidden", which !== "result");
  spinError.classList.add("hidden");
}

function goToForm() {
  revealPanel();
  setTimeout(() => (nameInput.value ? phoneInput : nameInput).focus({ preventScroll: true }), 300);
}

// ---------- Firebase ----------
async function initAuth() {
  try {
    const credential = await auth.signInAnonymously();
    uid = credential.user.uid;
    loginStatus.textContent = "";
  } catch (error) {
    console.error(error);
    loginStatus.classList.add("error");
    loginStatus.textContent = "Não foi possível conectar. Recarregue a página e tente de novo.";
  }
}

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.classList.remove("cooldown", "error");

  const name = nameInput.value.trim().replace(/\s+/g, " ");
  const phone = phoneInput.value.trim();

  if (name.length < 2) {
    nameInput.classList.add("invalid");
    loginStatus.classList.add("error");
    loginStatus.textContent = "Informe seu nome completo.";
    nameInput.focus();
    return;
  }
  if (!validatePhone(phone)) {
    phoneInput.classList.add("invalid");
    loginStatus.classList.add("error");
    loginStatus.textContent = "Informe um WhatsApp válido com DDD.";
    phoneInput.focus();
    return;
  }
  if (!consentInput.checked) {
    loginStatus.classList.add("error");
    loginStatus.textContent = "Marque a caixa de consentimento para participar.";
    return;
  }
  if (!uid) {
    loginStatus.textContent = "Ainda conectando… tente novamente em alguns segundos.";
    if (!auth.currentUser) initAuth();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Validando…";
  loginStatus.textContent = "";

  try {
    const response = await RoletaDB.register(name, phone);
    participant = { ...response, name, phone: normalizePhone(phone) };
    trackEvent("participant_registered", { participation_number: Number(participant.participationNumber || 1), max_rounds: MAX_ROUNDS });

    $("readyTitle").textContent = `Tudo pronto, ${name.split(" ")[0]}!`;
    showPanel("ready");
    renderRounds();
    // Mostra a roleta inteira (com a seta) + o botão de girar
    document.querySelector(".wheel-column").scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    loginStatus.textContent = friendlyError(error, "Não foi possível iniciar a participação.");
    loginStatus.classList.add(error.code === "cooldown" ? "cooldown" : "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Liberar a roleta 🎡";
  }
});

// ---------- Girar ----------
async function spin() {
  if (spinning) return;
  if (!participant) { goToForm(); return; }
  if (roundsLeft() <= 0) return;

  spinning = true;
  getAudioContext(); // libera o áudio no clique (exigência dos navegadores)
  spinError.classList.add("hidden");
  renderRounds();
  startFreeSpin();

  trackEvent("wheel_spin", { round_number: Number(participant.roundsUsed || 0) + 1 });

  try {
    lastResult = await RoletaDB.spin(participant);

    const index = segments.findIndex(s => s.label === lastResult.label);
    if (index < 0) throw new Error("Resultado da roleta inválido.");

    await landOn(targetAngleFor(index), REDUCED_MOTION ? 0 : 2600);

    participant.roundsUsed = Number(lastResult.roundsUsed);
    showResult(lastResult);
    if (["discount", "gift", "adesao"].includes(lastResult.type)) playFanfare();
    else playLoseSound();

    trackEvent("wheel_result", {
      result_type: String(lastResult.type || "unknown"),
      prize_label: String(lastResult.label || "").substring(0, 50),
      round_number: Number(lastResult.roundsUsed || 0)
    });
    if (lastResult.type === "discount") {
      trackEvent("prize_won", { discount_percent: Number(lastResult.value || 0), round_number: Number(lastResult.roundsUsed || 0) });
      trackEvent("coupon_generated", { discount_percent: Number(lastResult.value || 0) });
    }
    if (lastResult.type === "adesao") trackEvent("adesao_won", { round_number: Number(lastResult.roundsUsed || 0) });
    if (lastResult.type === "gift") trackEvent("gift_won", { round_number: Number(lastResult.roundsUsed || 0) });
  } catch (error) {
    console.error(error);
    // Para a roleta suavemente onde estiver
    await landOn(angle + 180, 700);
    spinError.textContent = friendlyError(error, "Não foi possível realizar a rodada. Tente novamente.");
    spinError.classList.remove("hidden");
    if (error.code === "exhausted") participant.roundsUsed = MAX_ROUNDS;
    revealPanel();
  } finally {
    spinning = false;
    renderRounds();
  }
}

function openWhatsApp(message) {
  const base = CLINIC_WHATSAPP ? `https://wa.me/${CLINIC_WHATSAPP.replace(/\D/g, "")}` : "https://wa.me/";
  window.open(`${base}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

function showResult(data) {
  const emoji = $("resultEmoji");
  const kicker = $("resultKicker");
  const main = $("resultMain");
  const prize = $("resultPrize");
  const text = $("resultText");
  const couponArea = $("couponArea");
  const coupon = $("coupon");
  const validity = $("validity");
  const round = `Rodada ${data.roundsUsed} de ${MAX_ROUNDS}`;
  const firstName = (participant?.name || "").split(" ")[0];

  prize.classList.remove("hidden");
  prize.classList.toggle("prize-long", data.type === "adesao");
  couponArea.classList.add("hidden");
  whatsappBtn.classList.add("hidden");
  whatsappBtn.innerHTML = "💳 Quero meu Cartão PAD Saúde+";

  if (data.type === "discount") {
    emoji.textContent = "🎉";
    kicker.textContent = "Parabéns!";
    main.textContent = "Você ganhou";
    prize.textContent = `${data.value}% OFF`;
    text.textContent = "Desconto na adesão do Cartão PAD Saúde+: descontos em consultas e exames para você e sua família.";
    coupon.textContent = data.coupon || "";
    couponArea.classList.remove("hidden");
    copyBtn.textContent = "Copiar";
    validity.textContent = `Válido por ${COUPON_VALID_DAYS} dias (até ${fmtDay(Date.now() + COUPON_VALID_DAYS * DAY_MS)}) · ${round}`;
    whatsappBtn.classList.remove("hidden");
    whatsappBtn.onclick = () => openWhatsApp(
      `Olá! Meu nome é ${participant?.name || ""}. Participei da Roleta do Cartão PAD Saúde+ e ganhei ${data.value}% de desconto na adesão do cartão. Meu cupom é ${data.coupon}. Gostaria de fazer meu Cartão PAD Saúde+.`
    );
  } else if (data.type === "adesao") {
    emoji.textContent = "💳";
    kicker.textContent = "Parabéns!";
    main.textContent = firstName ? `${firstName}, você ganhou` : "Você ganhou";
    prize.textContent = "ADESÃO GRÁTIS";
    text.textContent = "Adesão grátis no Cartão PAD Saúde+: descontos em consultas e exames para você e sua família.";
    coupon.textContent = data.coupon || "";
    couponArea.classList.remove("hidden");
    copyBtn.textContent = "Copiar";
    validity.textContent = `Válido por ${COUPON_VALID_DAYS} dias (até ${fmtDay(Date.now() + COUPON_VALID_DAYS * DAY_MS)}) · ${round}`;
    whatsappBtn.classList.remove("hidden");
    whatsappBtn.innerHTML = "💳 Quero meu Cartão PAD Saúde+";
    whatsappBtn.onclick = () => openWhatsApp(
      `Olá! Meu nome é ${participant?.name || ""}. Participei da Roleta do Cartão PAD Saúde+ e ganhei a ADESÃO GRÁTIS. Meu cupom é ${data.coupon}. Gostaria de fazer meu cartão.`
    );
  } else if (data.type === "gift") {
    emoji.textContent = "🎁";
    kicker.textContent = "Brinde especial";
    main.textContent = firstName ? `${firstName}, você ganhou` : "Você ganhou";
    prize.textContent = "BRINDE";
    text.textContent = "Fale com a equipe PAD Saúde+ para saber como retirar.";
    if (data.coupon) {
      coupon.textContent = data.coupon;
      couponArea.classList.remove("hidden");
      copyBtn.textContent = "Copiar";
    }
    whatsappBtn.innerHTML = "📲 Falar pelo WhatsApp";
    validity.textContent = `Retire em até ${GIFT_VALID_DAYS} dias (até ${fmtDay(Date.now() + GIFT_VALID_DAYS * DAY_MS)}) · ${round}`;
    whatsappBtn.classList.remove("hidden");
    whatsappBtn.onclick = () => openWhatsApp(
      `Olá! Meu nome é ${participant?.name || ""}. Participei da Roleta do Cartão PAD Saúde+ e ganhei um brinde especial (válido até ${fmtDay(Date.now() + GIFT_VALID_DAYS * DAY_MS)}).${data.coupon ? ` Meu cupom é ${data.coupon}.` : ""} Gostaria de saber como retirar.`
    );
  } else {
    const lose = data.type === "lose";
    emoji.textContent = lose ? "😕" : "🍀";
    kicker.textContent = lose ? "Não foi desta vez" : (data.label === "QUASE LÁ!" ? "Quase lá!" : "Tente novamente");
    main.textContent = lose ? "Mas ainda dá para ganhar" : "Foi por pouco!";
    prize.classList.add("hidden");
    text.textContent = roundsLeft() > 0 ? "Gire de novo e boa sorte!" : "Obrigado por participar!";
    validity.textContent = round;
  }

  const left = roundsLeft();
  againBtn.classList.toggle("hidden", left <= 0);
  againBtn.textContent = `Girar de novo (${left} ${left === 1 ? "restante" : "restantes"})`;

  showPanel("result");
  resultBox.classList.remove("pop");
  void resultBox.offsetWidth; // reinicia a animação
  resultBox.classList.add("pop");
  revealPanel();
}

copyBtn.addEventListener("click", async () => {
  const code = $("coupon").textContent.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch (_) {
    const range = document.createRange();
    range.selectNodeContents($("coupon"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("copy");
    sel.removeAllRanges();
  }
  copyBtn.textContent = "Copiado ✓";
  setTimeout(() => (copyBtn.textContent = "Copiar"), 2000);
});

againBtn.addEventListener("click", () => {
  if (!isInViewport(canvas)) document.querySelector(".wheel-column").scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
  spin();
});
spinBtn.addEventListener("click", spin);
hubBtn.addEventListener("click", spin);

// ---------- Meus prêmios ----------
let lastFocused = null;
function openPrizesModal() {
  lastFocused = document.activeElement;
  myPrizesModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  prizesStatus.textContent = "";
  prizesList.innerHTML = "";
  if (participant?.phone) prizesPhone.value = maskPhone(participant.phone);
  else if (phoneInput.value) prizesPhone.value = phoneInput.value;
  setTimeout(() => prizesPhone.focus(), 50);
}
function closePrizesModal() {
  myPrizesModal.classList.add("hidden");
  document.body.style.overflow = "";
  if (lastFocused) lastFocused.focus();
}

async function searchMyPrizes() {
  const phone = prizesPhone.value.trim();
  if (!validatePhone(phone)) { prizesStatus.textContent = "Informe um WhatsApp válido com DDD."; return; }
  if (!uid) { prizesStatus.textContent = "Ainda conectando… tente novamente em alguns segundos."; return; }

  searchPrizesBtn.disabled = true;
  prizesStatus.textContent = "Consultando seus prêmios…";
  prizesList.innerHTML = "";
  try {
    const prizes = await RoletaDB.myPrizes(phone);
    if (!prizes.length) {
      prizesStatus.textContent = "";
      prizesList.innerHTML = '<div class="empty-prizes">Nenhum prêmio encontrado para este WhatsApp.</div>';
      return;
    }
    prizesStatus.textContent = `${prizes.length} ${prizes.length === 1 ? "prêmio encontrado" : "prêmios encontrados"}`;
    lastPrizesPhone = phone;
    prizesList.innerHTML = prizes.map((item, index) => {
      const isDiscount = item.type === "discount";
      const isAdesao = item.type === "adesao";
      const title = isDiscount ? `${Number(item.value || 0)}% OFF` : isAdesao ? "Adesão grátis" : "Brinde especial";
      const subtitle = isDiscount ? "Desconto na adesão do Cartão PAD Saúde+" : isAdesao ? "Cartão PAD Saúde+ sem taxa de adesão" : "Retire com a equipe PAD Saúde+";
      const used = !!item.utilizado;
      // Validade: vem do servidor; se faltar (prêmio antigo), calcula pela data do prêmio
      const days = item.type === "gift" ? GIFT_VALID_DAYS : COUPON_VALID_DAYS;
      const validUntil = Number(item.validUntilMs) || (Number(item.createdAtMs) ? Number(item.createdAtMs) + days * DAY_MS : 0);
      const expired = !used && validUntil > 0 && Date.now() > validUntil;
      const statusText = used ? "Utilizado" : expired ? "Vencido" : "Disponível";
      const statusClass = used ? "used" : expired ? "expired" : "";
      const validText = validUntil ? `${expired ? "Venceu em" : "Válido até"} ${fmtDay(validUntil)}` : "";
      return `<div class="prize-card">
        <strong>${isDiscount ? "🏷️" : isAdesao ? "💳" : "🎁"} ${escapeHtml(title)}</strong>
        <div>${escapeHtml(subtitle)}</div>
        ${item.coupon ? `<div class="prize-code">${escapeHtml(item.coupon)}</div>` : ""}
        <div class="prize-meta">Rodada ${escapeHtml(item.roundNumber || "-")} · ${escapeHtml(item.date || "")} ${escapeHtml(item.time || "")}</div>
        ${validText ? `<div class="prize-valid ${statusClass}">⏳ ${escapeHtml(validText)}</div>` : ""}
        <span class="prize-status ${statusClass}">${statusText}</span>
        ${!used && !expired
          ? `<button class="redeem-btn" type="button" data-index="${index}">📲 Resgatar prêmio pelo WhatsApp</button>`
          : ""}
      </div>`;
    }).join("");
    lastPrizes = prizes;
    trackEvent("my_prizes_consulted", { result_count: prizes.length });
  } catch (error) {
    console.error(error);
    prizesStatus.textContent = friendlyError(error, "Não foi possível consultar seus prêmios.");
  } finally {
    searchPrizesBtn.disabled = false;
  }
}

// ---------- Resgatar prêmio (WhatsApp da clínica) ----------
let lastPrizes = [];
let lastPrizesPhone = "";
prizesList.addEventListener("click", (event) => {
  const btn = event.target.closest(".redeem-btn");
  if (!btn) return;
  const item = lastPrizes[Number(btn.dataset.index)];
  if (!item) return;
  const prizeName = item.type === "discount" ? `${Number(item.value || 0)}% OFF na adesão do Cartão PAD Saúde+`
    : item.type === "adesao" ? "Adesão grátis do Cartão PAD Saúde+"
    : "Brinde especial";
  const lines = [
    "Olá! Quero resgatar meu prêmio da Roleta do Cartão PAD Saúde+ 🎉",
    "",
    `🏆 Prêmio: ${prizeName}`,
    item.coupon ? `🎟️ Cupom: ${item.coupon}` : null,
    participant?.name ? `👤 Nome: ${participant.name}` : null,
    `📱 WhatsApp da participação: ${maskPhone(lastPrizesPhone)}`,
    `📅 Ganho em: ${[item.date, item.time].filter(Boolean).join(" ")}${item.roundNumber ? ` (rodada ${item.roundNumber})` : ""}`
  ].filter((l) => l !== null);
  trackEvent("prize_redeem_click", { prize_type: String(item.type || "") });
  openWhatsApp(lines.join("\n"));
});

myPrizesBtn.addEventListener("click", openPrizesModal);
closePrizesBtn.addEventListener("click", closePrizesModal);
myPrizesModal.addEventListener("click", e => { if (e.target === myPrizesModal) closePrizesModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !myPrizesModal.classList.contains("hidden")) closePrizesModal(); });
searchPrizesBtn.addEventListener("click", searchMyPrizes);
prizesPhone.addEventListener("keydown", e => { if (e.key === "Enter") searchMyPrizes(); });

// ---------- Início ----------
drawWheel();
// Redesenha quando a fonte da roleta terminar de carregar
if (document.fonts && document.fonts.load) {
  document.fonts.load('800 40px "Baloo 2"').then(drawWheel).catch(() => {});
}
renderRounds();
showPanel("form");
initAuth();
