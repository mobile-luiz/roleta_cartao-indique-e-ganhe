/* =========================================================
   PAINEL DO ADMINISTRADOR — Roleta PAD Saúde+
   ========================================================= */
const TZ = "America/Recife";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUOTAS = [
  { key: "50", label: "50% OFF", color: "#c52b61" },
  { key: "adesao", label: "💳 Adesão grátis", color: "#f04b32" },
  { key: "30", label: "30% OFF", color: "#f59e0b" },
  { key: "20", label: "20% OFF", color: "#20aa57" },
  { key: "15", label: "15% OFF", color: "#17a9c9" },
  { key: "10", label: "10% OFF", color: "#1475cf" },
  { key: "brinde", label: "🎁 Brinde", color: "#7b42c1" }
];

const $ = (id) => document.getElementById(id);
const COUPON_VALID_DAYS = 7;
const GIFT_VALID_DAYS = 5;

let currentDay = null;   // "AAAA-MM-DD"
let todayKey = null;
let summary = null;      // { cota, premios, participantes, giros }
let listeners = [];      // ouvintes do Realtime Database do dia aberto
let scheduleRef = null;

// ---------- Datas ----------
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function addDays(key, n) {
  const d = new Date(`${key}T12:00:00-03:00`);
  return dayKey(new Date(d.getTime() + n * DAY_MS));
}
function daysBetween(from, to) {
  const out = [];
  for (let k = from; k <= to && out.length < 93; k = addDays(k, 1)) out.push(k);
  return out;
}
function longDate(key) {
  const t = new Date(`${key}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function shortDate(key) {
  return new Date(`${key}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
}
const fmtTime = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtDay = (ms) => new Date(ms).toLocaleDateString("pt-BR", { timeZone: TZ });

// ---------- Utilidades ----------
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
function fmtPhone(p) {
  const d = String(p || "").replace(/\D/g, "").replace(/^55(?=\d{11}$)/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : p;
}
function setMsg(el, text, type = "") {
  el.textContent = text;
  el.className = `msg ${type}`;
}
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
function errText(e, fallback) {
  const text = String(e?.code || e?.message || "");
  if (/permission.denied/i.test(text)) return "Sem permissão no Realtime Database. Confira as regras do banco (arquivo regras-realtime-database.json).";
  if (/unavailable|network/i.test(text)) return "Sem conexão com o servidor.";
  return e?.message || fallback;
}
function dayRangeMs(key) {
  const start = Date.parse(`${key}T00:00:00-03:00`);
  return { start, end: start + DAY_MS };
}
function prizeStatus(p) {
  if (p.cancelado) return "cancelado";
  if (p.utilizado) return "utilizado";
  if (p.validadeAteMs && Date.now() > p.validadeAteMs) return "vencido";
  return "disponivel";
}

// ---------- Login ----------
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});

auth.onAuthStateChanged((user) => {
  const isAdminUser = user && !user.isAnonymous && user.email;
  $("loginView").classList.toggle("hidden", !!isAdminUser);
  $("appView").classList.toggle("hidden", !isAdminUser);
  if (isAdminUser) {
    $("userEmail").textContent = user.email;
    todayKey = dayKey();
    goToDay(currentDay || todayKey);
    watchSchedule();
    watchConfig();
  } else {
    stopDayListeners();
    if (scheduleRef) { scheduleRef.off(); scheduleRef = null; }
  }
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) { setMsg($("loginMsg"), "Informe e-mail e senha.", "err"); return; }
  $("loginBtn").disabled = true;
  setMsg($("loginMsg"), "");
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    const c = String(err.code || "");
    const text = c.includes("invalid") || c.includes("wrong-password") || c.includes("user-not-found")
      ? "E-mail ou senha incorretos."
      : c.includes("too-many-requests") ? "Muitas tentativas. Aguarde alguns minutos."
      : c.includes("operation-not-allowed") ? "Ative o login por E-mail/senha no Firebase Authentication."
      : (err.message || "Não foi possível entrar.");
    setMsg($("loginMsg"), text, "err");
  } finally {
    $("loginBtn").disabled = false;
  }
});

$("logoutBtn").addEventListener("click", () => auth.signOut());

// ---------- Tabela de cotas ----------
function buildQuotaRows() {
  const table = $("quotaTable");
  table.querySelectorAll(".qrow:not(.qhead)").forEach((r) => r.remove());
  QUOTAS.forEach((q) => {
    const row = document.createElement("div");
    row.className = "qrow";
    row.setAttribute("role", "row");
    row.dataset.key = q.key;
    row.innerHTML = `
      <span class="qname" role="cell"><i class="qdot" style="background:${q.color}"></i>${q.label.replace(" OFF", '<span class="off-sfx"> OFF</span>')}</span>
      <span role="cell"><input type="number" inputmode="numeric" min="0" step="1" value="0" aria-label="Pessoas que ganham ${q.label}"></span>
      <span class="qdone" role="cell">0</span>
      <span class="qleft" role="cell"><span class="qleft-n">0</span><span class="bar"><i style="width:0%"></i></span></span>`;
    row.querySelector("input").addEventListener("input", () => updateQuotaRows());
    table.appendChild(row);
  });
  const total = document.createElement("div");
  total.className = "qrow qtotal";
  total.setAttribute("role", "row");
  total.innerHTML = `<span role="cell">Total</span><span role="cell" id="qTotalPlanned" style="text-align:center">0</span><span role="cell" id="qTotalDone" class="qdone">0</span><span role="cell" id="qTotalLeft">0</span>`;
  table.appendChild(total);
}

function readItens() {
  const itens = {};
  document.querySelectorAll("#quotaTable .qrow[data-key]").forEach((row) => {
    const n = Math.max(0, Math.floor(Number(row.querySelector("input").value) || 0));
    itens[row.dataset.key] = n;
  });
  return itens;
}

function updateQuotaRows() {
  const delivered = summary?.cota?.entregues || {};
  let planned = 0, done = 0, left = 0;
  document.querySelectorAll("#quotaTable .qrow[data-key]").forEach((row) => {
    const key = row.dataset.key;
    const n = Math.max(0, Math.floor(Number(row.querySelector("input").value) || 0));
    const d = Number(delivered[key] || 0);
    const l = Math.max(0, n - d);
    planned += n; done += d; left += l;
    row.querySelector(".qdone").textContent = d;
    row.querySelector(".qleft-n").textContent = n ? `${l} de ${n}` : "—";
    row.querySelector(".bar i").style.width = n ? `${Math.min(100, (d / n) * 100)}%` : "0%";
    row.classList.toggle("over", n > 0 && d > n);
  });
  $("qTotalPlanned").textContent = planned;
  $("qTotalDone").textContent = done;
  $("qTotalLeft").textContent = planned ? `${left} restantes` : "—";
}

function fillQuotaForm() {
  const cota = summary?.cota;
  document.querySelectorAll("#quotaTable .qrow[data-key]").forEach((row) => {
    row.querySelector("input").value = Number(cota?.itens?.[row.dataset.key] || 0);
  });
  $("quotaOrder").value = cota?.ordem || "aleatorio";
  $("quotaActive").checked = cota ? cota.ativo !== false : true;
  $("repeatUntil").value = "";
  $("repeatUntil").min = currentDay;
  updateQuotaRows();

  const past = currentDay < todayKey;
  document.querySelectorAll("#quotaTable input, #quotaOrder, #quotaActive, #repeatUntil, #saveQuota, #clearQuota")
    .forEach((el) => (el.disabled = past));
  setMsg($("quotaMsg"), past ? "Dia encerrado: as cotas só podem ser consultadas." : "", past ? "warn" : "");
}

// ---------- Carregar dia (ao vivo, Realtime Database) ----------
function stopDayListeners() {
  listeners.forEach(({ ref, cb }) => ref.off("value", cb));
  listeners = [];
}
// Cada parte do painel trata o próprio erro: um erro nos giros não apaga os ganhadores.
function listen(ref, cb, onError) {
  const handler = ref.on("value", cb, (err) => {
    console.error(err);
    if (onError) onError(err);
  });
  listeners.push({ ref, cb: handler });
}

function normalizePrize(id, d) {
  const type = d.type || (d.desconto != null ? "discount" : "gift");
  const created = Number(d.createdAtMs || 0);
  return {
    id,
    type,
    valor: Number(d.desconto ?? 0),
    nome: d.name || "",
    telefone: String(d.phone || ""),
    cupom: d.codigoCupom || "",
    rodada: Number(d.rodada || 0),
    origem: d.origem || "antigo",   // sem "origem" = gravado pelo servidor antigo
    criadoEmMs: created,
    validadeAteMs: Number(d.validadeAteMs) || (created ? created + (type === "gift" ? GIFT_VALID_DAYS : COUPON_VALID_DAYS) * DAY_MS : 0),
    utilizado: d.utilizado === true,
    utilizadoEmMs: Number(d.utilizadoEmMs || 0),
    cancelado: d.cancelado === true,
    participantId: d.participantId || "",
    participationNumber: Number(d.participationNumber || 1)
  };
}

function goToDay(key) {
  currentDay = key;
  todayKey = dayKey();
  $("dayInput").value = key;
  $("dayTitle").textContent = longDate(key);
  const badge = $("dayBadge");
  badge.className = "pill " + (key === todayKey ? "today" : key < todayKey ? "past" : "future");
  badge.textContent = key === todayKey ? "Hoje" : key < todayKey ? "Encerrado" : "Programado";
  document.querySelectorAll(".sched-item").forEach((b) => b.classList.toggle("current", b.dataset.day === key));

  stopDayListeners();
  pages.winners.page = 1;
  pages.parts.page = 1;
  summary = { cota: null, premios: [], participantes: null, giros: null, entradas: [], girosPorParticipante: {} };
  let firstQuota = true;
  $("winnersBody").innerHTML = `<tr><td colspan="9" class="empty">Carregando…</td></tr>`;
  renderKpis();

  const { start, end } = dayRangeMs(key);

  // Cota do dia
  listen(rtdb.ref(`roleta_cotas/${key}`), (snap) => {
    if (key !== currentDay) return;
    const v = snap.val();
    summary.cota = v && v.itens ? {
      itens: v.itens || {},
      entregues: v.entregues || {},
      ordem: v.ordem || "aleatorio",
      ativo: v.ativo !== false
    } : null;
    if (firstQuota) { fillQuotaForm(); firstQuota = false; } else { updateQuotaRows(); }
    renderKpis();
  }, (err) => setMsg($("quotaMsg"), errText(err, "Não foi possível ler as cotas."), "err"));

  // Ganhadores do dia
  listen(rtdb.ref("premios").orderByChild("createdAtMs").startAt(start).endAt(end - 1), (snap) => {
    if (key !== currentDay) return;
    const list = [];
    snap.forEach((child) => { list.push(normalizePrize(child.key, child.val() || {})); });
    summary.premios = list.sort((a, b) => b.criadoEmMs - a.criadoEmMs);
    renderWinners();
    renderParticipants();
    renderKpis();
  }, (err) => {
    $("winnersBody").innerHTML = `<tr><td colspan="9" class="empty">${escapeHtml(errText(err, "Não foi possível ler os ganhadores."))}</td></tr>`;
    $("winnersPager").innerHTML = "";
  });

  // Participantes do dia
  listen(rtdb.ref("entradas").orderByChild("enteredAt").startAt(start).endAt(end - 1), (snap) => {
    if (key !== currentDay) return;
    const list = [];
    snap.forEach((child) => {
      const v = child.val() || {};
      list.push({
        id: child.key,
        nome: v.name || "",
        telefone: String(v.phone || ""),
        entrouEmMs: Number(v.enteredAt || 0),
        participantId: v.participantId || "",
        participationNumber: Number(v.participationNumber || 1)
      });
    });
    summary.entradas = list.sort((a, b) => b.entrouEmMs - a.entrouEmMs);
    summary.participantes = list.length;
    renderKpis();
    renderParticipants();
  }, (err) => {
    $("partsBody").innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(errText(err, "Não foi possível ler os participantes."))}</td></tr>`;
    $("partsPager").innerHTML = "";
  });

  // Giros de cada participante (gravado pelo servidor a cada giro)
  listen(rtdb.ref("roleta_giros").orderByChild("dia").equalTo(key), (snap) => {
    if (key !== currentDay) return;
    const map = {};
    snap.forEach((child) => { map[child.key] = child.val() || {}; });
    summary.girosPorParticipante = map;
    summary.girosSemPermissao = false;
    renderParticipants();
  }, () => {
    summary.girosSemPermissao = true;
    renderParticipants();
  });

  // Giros do dia
  listen(rtdb.ref(`roleta_stats/${key}/giros`), (snap) => {
    if (key !== currentDay) return;
    summary.giros = Number(snap.val() || 0);
    renderKpis();
  }, () => {});
}

function renderKpis() {
  const s = summary || {};
  $("kpiPart").textContent = s.participantes ?? "—";
  $("kpiSpins").textContent = s.giros ?? "—";
  $("kpiPrizes").textContent = s.premios ? s.premios.filter((p) => !p.cancelado).length : "—";
  renderServerAlert();
  if (s.cota && s.cota.ativo !== false) {
    const left = QUOTAS.reduce((sum, q) => sum + Math.max(0, Number(s.cota.itens?.[q.key] || 0) - Number(s.cota.entregues?.[q.key] || 0)), 0);
    $("kpiLeft").textContent = left;
  } else {
    $("kpiLeft").textContent = s.cota ? "Desativada" : "Sem cota";
  }
}


// ---------- Paginação ----------
const pages = {
  winners: { page: 1, size: 20 },
  parts: { page: 1, size: 20 }
};
function pageSlice(list, st) {
  const totalPages = Math.max(1, Math.ceil(list.length / st.size));
  if (st.page > totalPages) st.page = totalPages;   // lista diminuiu (filtro/atualização ao vivo)
  if (st.page < 1) st.page = 1;
  const start = (st.page - 1) * st.size;
  return { items: list.slice(start, start + st.size), totalPages, start };
}
function renderPager(elId, st, total, totalPages, start, rerender) {
  const el = $(elId);
  if (!total) { el.innerHTML = ""; return; }
  const end = Math.min(total, start + st.size);
  // números: 1 … (atual-1) atual (atual+1) … última
  const nums = [];
  for (let n = 1; n <= totalPages; n++) {
    if (n === 1 || n === totalPages || Math.abs(n - st.page) <= 1) nums.push(n);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  el.innerHTML = `
    <span class="pager-info">Mostrando <b>${start + 1}–${end}</b> de <b>${total}</b></span>
    <span class="pager-controls">
      <button class="pager-btn" type="button" data-go="${st.page - 1}" ${st.page <= 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>
      ${nums.map((n) => n === "…"
        ? `<span class="pager-gap">…</span>`
        : `<button class="pager-btn num ${n === st.page ? "current" : ""}" type="button" data-go="${n}" ${n === st.page ? 'aria-current="page"' : ""}>${n}</button>`).join("")}
      <button class="pager-btn" type="button" data-go="${st.page + 1}" ${st.page >= totalPages ? "disabled" : ""} aria-label="Próxima página">›</button>
      <select aria-label="Itens por página">
        ${[10, 20, 50, 100].map((n) => `<option value="${n}" ${n === st.size ? "selected" : ""}>${n} por página</option>`).join("")}
      </select>
    </span>`;
  el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
    st.page = Number(b.dataset.go);
    rerender();
    el.closest(".card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  el.querySelector("select").addEventListener("change", (e) => {
    st.size = Number(e.target.value);
    st.page = 1;
    rerender();
  });
}

// ---------- Ganhadores ----------
const isOutsideQuota = (p) => p.origem !== "cota";

function renderServerAlert() {
  // Versão sem servidor: a roleta grava direto no banco, não existe "servidor antigo".
  $("serverAlert").classList.add("hidden");
  return;
  const s = summary || {};
  const oldPrizes = (s.premios || []).filter((p) => p.origem === "antigo");
  const noSpinsCounted = currentDay === todayKey && s.participantes > 0 && !s.giros;
  const box = $("serverAlert");
  if (!oldPrizes.length && !noSpinsCounted) { box.classList.add("hidden"); return; }
  box.innerHTML = `⚠️ <b>A roleta ainda está usando o servidor antigo.</b> Ele sorteia prêmios sozinho e <b>ignora as cotas</b> deste painel`
    + (oldPrizes.length ? ` (${oldPrizes.length} ${oldPrizes.length === 1 ? "prêmio saiu" : "prêmios saíram"} fora da cota hoje)` : "")
    + `. Publique o servidor novo: pasta <b>roleta-pad-saude-site</b> → <b>deploy-servidor.bat</b>. Os prêmios que saíram errado podem ser cancelados na lista abaixo.`;
  box.classList.remove("hidden");
}

function filteredWinners() {
  const term = $("winnerSearch").value.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const filter = $("winnerFilter").value;
  return (summary?.premios || []).filter((p) => {
    if (filter === "fora") { if (!isOutsideQuota(p)) return false; }
    else if (filter && prizeStatus(p) !== filter) return false;
    if (!term) return true;
    return p.nome.toLowerCase().includes(term)
      || p.cupom.toLowerCase().includes(term)
      || (digits.length >= 3 && p.telefone.includes(digits));
  });
}

function renderWinners() {
  const list = filteredWinners();
  const total = summary?.premios?.length || 0;
  $("winnersCount").textContent = total ? `(${list.length}${list.length !== total ? ` de ${total}` : ""})` : "";
  if (!list.length) {
    $("winnersBody").innerHTML = `<tr><td colspan="9" class="empty">${total ? "Nenhum ganhador com esse filtro." : "Ninguém ganhou prêmio neste dia."}</td></tr>`;
    $("winnersPager").innerHTML = "";
    return;
  }
  const pg = pageSlice(list, pages.winners);
  renderPager("winnersPager", pages.winners, list.length, pg.totalPages, pg.start, renderWinners);
  $("winnersBody").innerHTML = pg.items.map((p) => {
    const st = prizeStatus(p);
    const stTag = st === "cancelado" ? `<span class="tag cancel">Cancelado</span>` : st === "utilizado"
      ? `<span class="tag used">Utilizado</span>${p.utilizadoEmMs ? `<div class="empty nowrap">${fmtDay(p.utilizadoEmMs)}</div>` : ""}`
      : st === "vencido" ? `<span class="tag exp">Vencido</span>` : `<span class="tag ok">Disponível</span>`;
    const prize = p.type === "gift" ? "🎁 Brinde" : p.type === "adesao" ? "💳 Adesão grátis" : `${p.valor}% OFF`;
    const phone = String(p.telefone || "").replace(/\D/g, "");
    return `<tr>
      <td class="nowrap" data-label="Hora">${p.criadoEmMs ? fmtTime(p.criadoEmMs) : "—"}</td>
      <td class="c-name" data-label="Nome">${escapeHtml(p.nome)}</td>
      <td data-label="WhatsApp">${phone ? `<a href="https://wa.me/${phone}" target="_blank" rel="noopener">${escapeHtml(fmtPhone(phone))}</a>` : "—"}</td>
      <td class="prize-name" data-label="Prêmio">${prize}</td>
      <td class="code" data-label="Cupom">${escapeHtml(p.cupom || "—")}</td>
      <td data-label="Origem"><span class="tag ${p.origem === "cota" ? "cota" : "fora"}" title="${p.origem === "cota" ? "Saiu de uma cota do painel" : "Não veio de cota do painel"}">${p.origem === "cota" ? "Cota" : "Fora da cota"}</span></td>
      <td class="nowrap" data-label="Validade">${p.validadeAteMs ? fmtDay(p.validadeAteMs) : "—"}</td>
      <td data-label="Situação">${stTag}</td>
      <td class="c-action nowrap">${p.cancelado
        ? `<button class="btn btn-small btn-light" type="button" data-cancel="${escapeHtml(p.id)}" data-on="0">Reativar</button>`
        : `<button class="btn btn-small ${p.utilizado ? "btn-light" : "btn-used"}" type="button" data-id="${escapeHtml(p.id)}" data-used="${p.utilizado ? "1" : "0"}">${p.utilizado ? "Desfazer" : "Marcar utilizado"}</button>`
          + (isOutsideQuota(p) && !p.utilizado ? `<button class="btn btn-small btn-cancel" type="button" data-cancel="${escapeHtml(p.id)}" data-on="1">Cancelar</button>` : "")}</td>
    </tr>`;
  }).join("");
}

$("winnersBody").addEventListener("click", async (e) => {
  const cBtn = e.target.closest("button[data-cancel]");
  if (!cBtn) return;
  const id = cBtn.dataset.cancel;
  const cancel = cBtn.dataset.on === "1";
  const p = summary.premios.find((x) => x.id === id);
  const prizeName = p ? (p.type === "gift" ? "brinde" : p.type === "adesao" ? "adesão grátis" : `${p.valor}% OFF`) : "prêmio";
  if (!confirm(cancel
    ? `Cancelar o ${prizeName} de ${p?.nome || "este cliente"}?\nO cupom deixa de valer e some de "Meus prêmios".`
    : `Reativar o ${prizeName} de ${p?.nome || "este cliente"}?`)) return;
  cBtn.disabled = true;
  try {
    await rtdb.ref(`premios/${id}`).update(cancel
      ? { cancelado: true, canceladoEmMs: firebase.database.ServerValue.TIMESTAMP, canceladoPor: auth.currentUser?.email || "" }
      : { cancelado: false, canceladoEmMs: null, canceladoPor: null });
    toast(cancel ? "Prêmio cancelado" : "Prêmio reativado");
  } catch (err) {
    console.error(err);
    toast(errText(err, "Não foi possível atualizar."));
    cBtn.disabled = false;
  }
});

$("winnersBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const id = btn.dataset.id;
  const makeUsed = btn.dataset.used !== "1";
  const p = summary.premios.find((x) => x.id === id);
  if (!makeUsed && !confirm(`Desfazer "utilizado" do prêmio de ${p?.nome || "este cliente"}?`)) return;
  btn.disabled = true;
  try {
    await rtdb.ref(`premios/${id}`).update(makeUsed
      ? { utilizado: true, utilizadoEmMs: firebase.database.ServerValue.TIMESTAMP, utilizadoPor: auth.currentUser?.email || "" }
      : { utilizado: false, utilizadoEmMs: null, utilizadoPor: null });
    toast(makeUsed ? "Prêmio marcado como utilizado" : "Prêmio disponível de novo");
  } catch (err) {
    console.error(err);
    toast(errText(err, "Não foi possível atualizar."));
    btn.disabled = false;
  }
});

$("winnerSearch").addEventListener("input", () => { pages.winners.page = 1; renderWinners(); });
$("winnerFilter").addEventListener("change", () => { pages.winners.page = 1; renderWinners(); });

$("exportCsv").addEventListener("click", () => {
  const list = filteredWinners();
  if (!list.length) { toast("Nada para exportar."); return; }
  const head = ["Data", "Hora", "Nome", "WhatsApp", "Prêmio", "Cupom", "Origem", "Rodada", "Válido até", "Situação"];
  const rows = list.map((p) => [
    p.criadoEmMs ? fmtDay(p.criadoEmMs) : "",
    p.criadoEmMs ? fmtTime(p.criadoEmMs) : "",
    p.nome,
    fmtPhone(p.telefone),
    p.type === "gift" ? "Brinde" : p.type === "adesao" ? "Adesão grátis Cartão PAD Saúde+" : `${p.valor}% OFF`,
    p.cupom,
    p.origem === "cota" ? "Cota" : "Fora da cota",
    p.rodada,
    p.validadeAteMs ? fmtDay(p.validadeAteMs) : "",
    { utilizado: "Utilizado", vencido: "Vencido", disponivel: "Disponível", cancelado: "Cancelado" }[prizeStatus(p)]
  ]);
  const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }); // \ufeff = acentos certos no Excel
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ganhadores-roleta-${currentDay}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});


// ---------- Participantes ----------
const MAX_ROUNDS = 10;
function prizeShort(p) {
  return p.type === "gift" ? "🎁 Brinde" : p.type === "adesao" ? "💳 Adesão grátis" : `${p.valor}% OFF`;
}
function participantRows() {
  const giros = summary?.girosPorParticipante || {};
  const prizes = summary?.premios || [];
  return (summary?.entradas || []).map((e) => {
    const g = giros[`${e.participantId}_${e.participationNumber}`] || null;
    const won = prizes.filter((p) => !p.cancelado && (
      p.participantId
        ? p.participantId === e.participantId && p.participationNumber === e.participationNumber
        : p.telefone === e.telefone
    ));
    return {
      ...e,
      giros: g ? Number(g.giros || 0) : 0,
      temRegistro: !!g,
      ultimoResultado: g?.ultimoResultado || "",
      ultimoGiroMs: Number(g?.ultimoGiroMs || 0),
      premios: won
    };
  });
}
function filteredParticipants() {
  const term = $("partSearch").value.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const filter = $("partFilter").value;
  return participantRows().filter((r) => {
    if (filter === "ganhou" && !r.premios.length) return false;
    if (filter === "jogando" && !(r.giros > 0 && r.giros < MAX_ROUNDS)) return false;
    if (filter === "terminou" && r.giros < MAX_ROUNDS) return false;
    if (filter === "nao-girou" && r.giros > 0) return false;
    if (!term) return true;
    return r.nome.toLowerCase().includes(term) || (digits.length >= 3 && r.telefone.includes(digits));
  });
}
function renderParticipants() {
  const all = summary?.entradas || [];
  $("partTabCount").textContent = all.length || "";
  $("girosAviso").classList.toggle("hidden", !summary?.girosSemPermissao);
  const list = filteredParticipants();
  $("partCount").textContent = all.length ? `(${list.length}${list.length !== all.length ? ` de ${all.length}` : ""})` : "";
  if (!list.length) {
    $("partsBody").innerHTML = `<tr><td colspan="7" class="empty">${all.length ? "Ninguém com esse filtro." : "Nenhum participante neste dia."}</td></tr>`;
    $("partsPager").innerHTML = "";
    return;
  }
  const pg = pageSlice(list, pages.parts);
  renderPager("partsPager", pages.parts, list.length, pg.totalPages, pg.start, renderParticipants);
  $("partsBody").innerHTML = pg.items.map((r) => {
    const phone = r.telefone.replace(/\D/g, "");
    const pct = Math.min(100, (r.giros / MAX_ROUNDS) * 100);
    const spins = `<div class="spins ${r.giros >= MAX_ROUNDS ? "done" : ""}">${r.giros} de ${MAX_ROUNDS}<span class="bar"><i style="width:${pct}%"></i></span></div>`;
    const prizes = r.premios.length
      ? `<div class="prize-list">${r.premios.map((p) => `<span class="tag ${p.origem === "cota" ? "cota" : "fora"}" title="Rodada ${p.rodada}${p.cupom ? " · " + escapeHtml(p.cupom) : ""}">${prizeShort(p)}</span>`).join("")}</div>`
      : `<span class="muted">—</span>`;
    const last = r.ultimoResultado
      ? `<span class="last">${escapeHtml(r.ultimoResultado)}</span><div class="muted">${fmtTime(r.ultimoGiroMs)}</div>`
      : `<span class="muted">${r.giros ? "—" : "Ainda não girou"}</span>`;
    return `<tr>
      <td class="nowrap" data-label="Hora">${r.entrouEmMs ? fmtTime(r.entrouEmMs) : "—"}</td>
      <td class="c-name" data-label="Nome">${escapeHtml(r.nome)}</td>
      <td data-label="WhatsApp">${phone ? `<a href="https://wa.me/${phone}" target="_blank" rel="noopener">${escapeHtml(fmtPhone(phone))}</a>` : "—"}</td>
      <td data-label="Participação">${r.participationNumber}ª</td>
      <td data-label="Giros">${spins}</td>
      <td data-label="Prêmios">${prizes}</td>
      <td data-label="Último resultado">${last}</td>
    </tr>`;
  }).join("");
}
$("partSearch").addEventListener("input", () => { pages.parts.page = 1; renderParticipants(); });
$("partFilter").addEventListener("change", () => { pages.parts.page = 1; renderParticipants(); });
$("exportPartCsv").addEventListener("click", () => {
  const list = filteredParticipants();
  if (!list.length) { toast("Nada para exportar."); return; }
  const head = ["Data", "Hora", "Nome", "WhatsApp", "Participação", "Giros", "Prêmios", "Último resultado"];
  const rows = list.map((r) => [
    r.entrouEmMs ? fmtDay(r.entrouEmMs) : "",
    r.entrouEmMs ? fmtTime(r.entrouEmMs) : "",
    r.nome,
    fmtPhone(r.telefone),
    r.participationNumber,
    `${r.giros}/${MAX_ROUNDS}`,
    r.premios.map((p) => prizeShort(p).replace(/^\S+ /, "") + (p.cupom ? ` (${p.cupom})` : "")).join(" | "),
    r.ultimoResultado
  ]);
  const csv = [head, ...rows].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `participantes-roleta-${currentDay}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Abas ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      $(t.dataset.tab).classList.toggle("hidden", !on);
    });
  });
});

// ---------- Salvar cotas ----------
$("saveQuota").addEventListener("click", async () => {
  const itens = readItens();
  const total = Object.values(itens).reduce((a, b) => a + b, 0);
  const until = $("repeatUntil").value;
  if (until && until < currentDay) { setMsg($("quotaMsg"), "A data de repetição precisa ser depois do dia escolhido.", "err"); return; }
  const dias = until ? daysBetween(currentDay, until) : [currentDay];
  if (until && until > addDays(currentDay, 92)) {
    setMsg($("quotaMsg"), "Programe no máximo 93 dias de uma vez.", "err"); return;
  }

  const delivered = summary?.cota?.entregues || {};
  const below = QUOTAS.filter((q) => itens[q.key] < Number(delivered[q.key] || 0));
  if (below.length && !confirm(`Algumas quantidades ficaram menores do que já foi entregue hoje (${below.map((q) => q.label).join(", ")}). Salvar mesmo assim?`)) return;
  if (!total && !confirm("Todas as quantidades estão em 0. Neste dia ninguém ganhará prêmio. Continuar?")) return;
  if (dias.length > 1 && !confirm(`Aplicar esta cota em ${dias.length} dias (${shortDate(dias[0])} até ${shortDate(dias[dias.length - 1])})? Dias que já tinham cota serão substituídos.`)) return;

  $("saveQuota").disabled = true;
  setMsg($("quotaMsg"), "Salvando…");
  try {
    const updates = {};
    const ordem = $("quotaOrder").value;
    const ativo = $("quotaActive").checked;
    for (const dia of dias) {
      updates[`roleta_cotas/${dia}/itens`] = itens;
      updates[`roleta_cotas/${dia}/ordem`] = ordem;
      updates[`roleta_cotas/${dia}/ativo`] = ativo;
      updates[`roleta_cotas/${dia}/atualizadoEm`] = firebase.database.ServerValue.TIMESTAMP;
      updates[`roleta_cotas/${dia}/atualizadoPor`] = auth.currentUser?.email || "";
    }
    await rtdb.ref().update(updates);
    setMsg($("quotaMsg"), dias.length > 1 ? `Cota salva em ${dias.length} dias.` : "Cota salva.", "ok");
    toast("Cotas salvas");
    $("repeatUntil").value = "";
  } catch (e) {
    console.error(e);
    setMsg($("quotaMsg"), errText(e, "Não foi possível salvar."), "err");
  } finally {
    $("saveQuota").disabled = currentDay < todayKey;
  }
});

$("clearQuota").addEventListener("click", () => {
  document.querySelectorAll("#quotaTable .qrow[data-key] input").forEach((i) => (i.value = 0));
  updateQuotaRows();
});

// ---------- Programação (ao vivo) ----------
function watchSchedule() {
  const box = $("scheduleList");
  const from = dayKey();
  if (scheduleRef) scheduleRef.off();
  scheduleRef = rtdb.ref("roleta_cotas").orderByKey().startAt(from).endAt(addDays(from, 60));
  scheduleRef.on("value", (snap) => {
    const dias = [];
    snap.forEach((child) => {
      const v = child.val() || {};
      if (v.itens) dias.push({ dia: child.key, itens: v.itens || {}, entregues: v.entregues || {}, ativo: v.ativo !== false });
    });
    if (!dias.length) {
      box.innerHTML = `<p class="empty">Nenhum dia programado. Escolha uma data acima e preencha as cotas.</p>`;
      return;
    }
    box.innerHTML = dias.map((d) => {
      const parts = QUOTAS.filter((q) => Number(d.itens[q.key] || 0) > 0)
        .map((q) => `${d.itens[q.key]}× ${q.label.replace(/^(🎁|💳) /, "")}`);
      const planned = QUOTAS.reduce((s, q) => s + Number(d.itens[q.key] || 0), 0);
      const done = QUOTAS.reduce((s, q) => s + Number(d.entregues[q.key] || 0), 0);
      return `<button class="sched-item ${d.dia === currentDay ? "current" : ""}" type="button" data-day="${d.dia}">
        <strong>${shortDate(d.dia)}</strong>
        <span>${d.ativo ? `${done}/${planned}` : `<span class="off">Desativada</span>`}</span>
        <span class="sub">${parts.length ? escapeHtml(parts.join(" · ")) : "Nenhum prêmio"}</span>
      </button>`;
    }).join("");
  }, (err) => {
    console.error(err);
    box.innerHTML = `<p class="empty">${escapeHtml(errText(err, "Não foi possível carregar a programação."))}</p>`;
  });
}

function watchConfig() {
  rtdb.ref("roleta_config/semCotaModo").once("value")
    .then((snap) => { if ($("noQuotaMode")) $("noQuotaMode").value = snap.val() || "nenhum"; })
    .catch((err) => setMsg($("configMsg"), errText(err, "Não foi possível ler a opção."), "err"));
}

$("scheduleList").addEventListener("click", (e) => {
  const item = e.target.closest(".sched-item");
  if (item) { goToDay(item.dataset.day); window.scrollTo({ top: 0, behavior: "smooth" }); }
});

// ---------- Dias sem cota ----------
if ($("saveConfig")) $("saveConfig").addEventListener("click", async () => {
  $("saveConfig").disabled = true;
  try {
    await rtdb.ref("roleta_config").update({
      semCotaModo: $("noQuotaMode").value,
      atualizadoEm: firebase.database.ServerValue.TIMESTAMP,
      atualizadoPor: auth.currentUser?.email || ""
    });
    setMsg($("configMsg"), "Opção salva.", "ok");
    toast("Opção salva");
  } catch (e) {
    setMsg($("configMsg"), errText(e, "Não foi possível salvar."), "err");
  } finally {
    $("saveConfig").disabled = false;
  }
});

// ---------- Navegação ----------
$("dayInput").addEventListener("change", () => { if ($("dayInput").value) goToDay($("dayInput").value); });
$("prevDay").addEventListener("click", () => goToDay(addDays(currentDay, -1)));
$("nextDay").addEventListener("click", () => goToDay(addDays(currentDay, 1)));
$("todayBtn").addEventListener("click", () => goToDay(todayKey || dayKey()));

buildQuotaRows();
