/* =========================================================
   ROLETA DO CARTÃO PAD SAÚDE+ — dados direto no Realtime Database
   (sem servidor: funciona no plano gratuito Spark + GitHub Pages)

   As REGRAS do Realtime Database conferem cada gravação:
   - só ganha quem pega uma vaga das cotas do painel;
   - cada WhatsApp leva no máximo 1 prêmio de cota por dia;
   - não dá para passar da quantidade da cota;
   - não dá para criar prêmio sem vaga.
   ========================================================= */
const RoletaDB = (() => {
  const TZ = "America/Recife";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX = 10;
  // ⚠️ Tempo para o MESMO WhatsApp participar de novo.
  // Se mudar aqui, mude também nas regras (120000 = 2 minutos).
  const COOLDOWN_MS = 2 * 60 * 1000;
  const COUPON_DAYS = 7;
  const GIFT_DAYS = 5;

  const PRIZE_BY_KEY = {
    "50": { label: "50% OFF", type: "discount", value: 50 },
    "adesao": { label: "ADESÃO GRÁTIS", type: "adesao", value: 0 },
    "30": { label: "30% OFF", type: "discount", value: 30 },
    "20": { label: "20% OFF", type: "discount", value: 20 },
    "15": { label: "15% OFF", type: "discount", value: 15 },
    "10": { label: "10% OFF", type: "discount", value: 10 },
    "brinde": { label: "BRINDE ESPECIAL!", type: "gift", value: 0 }
  };
  const QUOTA_KEYS = ["50", "adesao", "30", "20", "15", "10", "brinde"];
  const NON_WIN = [
    { label: "TENTE NOVAMENTE!", type: "retry", value: 0, weight: 2000 },
    { label: "NÃO FOI DESTA VEZ!", type: "lose", value: 0, weight: 3000 },
    { label: "QUASE LÁ!", type: "retry", value: 0, weight: 1800 }
  ];

  class RoletaError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // Relógio do servidor (evita erro se o relógio do celular estiver errado)
  let serverOffset = 0;
  rtdb.ref(".info/serverTimeOffset").on("value", (s) => { serverOffset = Number(s.val() || 0); });
  const serverNow = () => Date.now() + serverOffset;
  const TS = firebase.database.ServerValue.TIMESTAMP;

  function dayKey(ms) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  }
  const fmtDate = (ms) => new Date(ms).toLocaleDateString("pt-BR", { timeZone: TZ });
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function normPhone(value) {
    let d = String(value || "").replace(/\D/g, "");
    if (d.startsWith("55") && d.length > 11) d = d.substring(2);
    if (d.length === 10) d = d.substring(0, 2) + "9" + d.substring(2);
    return "55" + d;
  }

  async function phoneHash(phone) {
    const bytes = new TextEncoder().encode("roleta-pad|" + normPhone(phone));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function randInt(max) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  }

  function makeCoupon(prefix) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 5; i++) s += chars[randInt(chars.length)];
    return `PAD${prefix}-${s}`;
  }

  function formatWait(ms) {
    const total = Math.max(1, Math.ceil(ms / 1000));
    const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60), s = total % 60;
    const p = (n, a, b) => `${n} ${n === 1 ? a : b}`;
    if (d) return h ? `${p(d, "dia", "dias")} e ${p(h, "hora", "horas")}` : p(d, "dia", "dias");
    if (h) return m ? `${p(h, "hora", "horas")} e ${p(m, "minuto", "minutos")}` : p(h, "hora", "horas");
    if (m) return s ? `${p(m, "minuto", "minutos")} e ${p(s, "segundo", "segundos")}` : p(m, "minuto", "minutos");
    return p(s, "segundo", "segundos");
  }

  function currentUid() {
    const u = auth.currentUser;
    if (!u) throw new RoletaError("auth", "Ainda conectando… tente novamente em alguns segundos.");
    return u.uid;
  }

  // ---------- Cadastro ----------
  async function register(name, phoneRaw) {
    const uid = currentUid();
    const phone = normPhone(phoneRaw);
    const H = await phoneHash(phone);

    const tel = (await rtdb.ref(`roleta_telefones/${H}`).once("value")).val() || {};
    const now = serverNow();
    if (tel.ultimaMs && now - Number(tel.ultimaMs) < COOLDOWN_MS) {
      const wait = COOLDOWN_MS - (now - Number(tel.ultimaMs));
      throw new RoletaError("cooldown", `Este WhatsApp já participou. Você poderá participar novamente em ${formatWait(wait)}.`);
    }

    const pn = Number(tel.participationNumber || 0) + 1;
    const pid = `${uid}-${H.slice(0, 8)}`;
    const chave = `${pid}_${pn}`;
    const entryKey = rtdb.ref("entradas").push().key;

    const updates = {};
    updates[`roleta_telefones/${H}/uid`] = uid;
    updates[`roleta_telefones/${H}/participationNumber`] = pn;
    updates[`roleta_telefones/${H}/ultimaMs`] = TS;
    updates[`roleta_participantes/${uid}`] = {
      phoneHash: H, participationNumber: pn, pid, chave, name, phone, criadoMs: TS
    };
    updates[`entradas/${entryKey}`] = {
      uid, name, phone, participantId: pid, participationNumber: pn,
      enteredAt: TS, date: fmtDate(now), time: fmtTime(now)
    };

    try {
      await rtdb.ref().update(updates);
    } catch (err) {
      if (/permission/i.test(String(err.code || err.message))) {
        throw new RoletaError("cooldown", "Este WhatsApp participou há pouco tempo. Aguarde alguns minutos e tente de novo.");
      }
      throw err;
    }
    return { id: pid, pid, chave, hash: H, participationNumber: pn, roundsUsed: 0 };
  }

  // ---------- Sorteio ----------
  function pickQuotaKey(itens, entregues, ordem, ganhos) {
    const available = QUOTA_KEYS
      .map((key) => ({ key, left: Math.max(0, Number(itens?.[key] || 0) - Number(entregues?.[key] || 0)) }))
      .filter((i) => i.left > 0 && (i.key === "brinde" || !ganhos?.[i.key]));
    if (!available.length) return null;
    if (ordem === "maior_primeiro") return available[0].key;
    if (ordem === "menor_primeiro") {
      const disc = available.filter((i) => i.key !== "brinde" && i.key !== "adesao");
      return (disc.length ? disc[disc.length - 1] : available[0]).key;
    }
    const total = available.reduce((s, i) => s + i.left, 0);
    let r = randInt(total);
    for (const i of available) { r -= i.left; if (r < 0) return i.key; }
    return available[available.length - 1].key;
  }

  function pickNonWin() {
    const total = NON_WIN.reduce((s, p) => s + p.weight, 0);
    let r = randInt(total);
    for (const p of NON_WIN) { r -= p.weight; if (r < 0) return p; }
    return NON_WIN[0];
  }

  async function readQuota(dia, H) {
    const base = `roleta_cotas/${dia}`;
    const [itens, entregues, ativo, ordem, ganhador] = await Promise.all([
      rtdb.ref(`${base}/itens`).once("value"),
      rtdb.ref(`${base}/entregues`).once("value"),
      rtdb.ref(`${base}/ativo`).once("value"),
      rtdb.ref(`${base}/ordem`).once("value"),
      rtdb.ref(`${base}/ganhadores/${H}`).once("value")
    ]);
    return {
      itens: itens.val(),
      entregues: entregues.val() || {},
      ativo: ativo.val() !== false,
      ordem: ordem.val() || "aleatorio",
      jaGanhou: ganhador.exists()
    };
  }

  async function claim(p, dia, key, entregueAtual, rodada) {
    const uid = currentUid();
    const prize = PRIZE_BY_KEY[key];
    const premioId = rtdb.ref("premios").push().key;
    const now = serverNow();
    const coupon = prize.type === "discount" ? makeCoupon(prize.value)
      : prize.type === "adesao" ? makeCoupon("ADS")
      : makeCoupon("BRD"); // brinde também tem cupom
    const days = prize.type === "gift" ? GIFT_DAYS : COUPON_DAYS;

    const premio = {
      uid, quotaKey: key, type: prize.type, prize: prize.label,
      name: p.name || "", phone: p.phone || "",
      codigoCupom: coupon, rodada, participantId: p.pid, participationNumber: p.participationNumber,
      origem: "cota", dia, createdAtMs: TS, validadeAteMs: now + days * DAY_MS, validadeDias: days,
      date: fmtDate(now), time: fmtTime(now), utilizado: false
    };
    if (prize.type === "discount") premio.desconto = prize.value;

    const updates = {};
    updates[`roleta_cotas/${dia}/ganhadores/${p.hash}`] = { uid, premio: key, premioId, em: TS };
    updates[`roleta_cotas/${dia}/entregues/${key}`] = Number(entregueAtual || 0) + 1;
    updates[`premios/${premioId}`] = premio;
    updates[`roleta_meus_premios/${p.hash}/${premioId}`] = dia;
    updates[`roleta_telefones/${p.hash}/ganhos/${key}`] = true;
    await rtdb.ref().update(updates);
    return { prize, coupon };
  }

  async function spin(p) {
    currentUid();
    const dia = dayKey(serverNow());

    // 1) Conta o giro (as regras não deixam passar de 10)
    const girosRef = rtdb.ref(`roleta_giros/${p.chave}`);
    const tr = await girosRef.transaction((cur) => {
      if (cur === null) return { giros: 1, dia, participantId: p.pid, participationNumber: p.participationNumber };
      const g = Number(cur.giros || 0);
      if (g >= MAX) return; // aborta
      return { ...cur, giros: g + 1, dia };
    }, undefined, false);
    if (!tr.committed) throw new RoletaError("exhausted", "Você já utilizou as 10 rodadas.");
    const rodada = Number(tr.snapshot.val().giros);

    // 2) Tenta pegar uma vaga da cota do dia
    let result = null;
    const q = await readQuota(dia, p.hash);
    if (q.itens && q.ativo && !q.jaGanhou) {
      const ganhos = (await rtdb.ref(`roleta_telefones/${p.hash}/ganhos`).once("value")).val() || {};
      let entregues = q.entregues;
      for (let tentativa = 0; tentativa < 3 && !result; tentativa++) {
        const key = pickQuotaKey(q.itens, entregues, q.ordem, ganhos);
        if (!key) break;
        try {
          const won = await claim(p, dia, key, entregues[key], rodada);
          result = { label: won.prize.label, type: won.prize.type, value: won.prize.value, coupon: won.coupon };
        } catch (err) {
          // Outra pessoa pegou a vaga no mesmo instante: lê de novo e tenta outra
          if (!/permission/i.test(String(err.code || err.message))) throw err;
          const again = await readQuota(dia, p.hash);
          if (again.jaGanhou || !again.ativo) break;
          entregues = again.entregues;
        }
      }
    }
    if (!result) {
      const nw = pickNonWin();
      result = { label: nw.label, type: nw.type, value: 0, coupon: null };
    }

    // 3) Registro para o painel (não bloqueia o resultado se falhar)
    await Promise.allSettled([
      girosRef.update({
        ultimoGiroMs: TS,
        ultimoResultado: result.label,
        [`resultados/r${String(rodada).padStart(2, "0")}`]: result.label
      }),
      rtdb.ref(`roleta_stats/${dia}/giros`).set(firebase.database.ServerValue.increment(1))
    ]);

    return { ...result, roundsUsed: rodada };
  }

  // ---------- Meus prêmios ----------
  async function myPrizes(phoneRaw) {
    currentUid();
    const H = await phoneHash(phoneRaw);
    const ids = (await rtdb.ref(`roleta_meus_premios/${H}`).once("value")).val() || {};
    const snaps = await Promise.all(Object.keys(ids).map((id) => rtdb.ref(`premios/${id}`).once("value")));
    return snaps
      .filter((s) => s.exists() && s.val().cancelado !== true)
      .map((s) => {
        const d = s.val();
        const created = Number(d.createdAtMs || 0);
        return {
          id: s.key,
          type: d.type,
          value: Number(d.desconto || 0),
          coupon: d.codigoCupom || null,
          roundNumber: Number(d.rodada || 0),
          date: d.date || (created ? fmtDate(created) : ""),
          time: d.time ? String(d.time).slice(0, 5) : "",
          createdAtMs: created,
          validUntilMs: Number(d.validadeAteMs || 0),
          utilizado: d.utilizado === true
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  return { register, spin, myPrizes, RoletaError };
})();
