/* =========================================================
   INDIQUE E GANHE — Cartão PAD Saúde+
   Carregado DEPOIS do app.min.js (usa o mesmo Firebase: auth e rtdb).

   Fluxo:
   1) Quem indica (ex.: Luiz) clica em "Indique e Ganhe", informa nome,
      WhatsApp, CPF, data de nascimento e chave PIX → recebe um cupom IND-XXXXXX.
   2) Luiz compartilha o cupom com o amigo (José) pelo WhatsApp.
   3) José abre o link (…?indicacao=IND-XXXXXX), vê a indicação e fala com
      o Cartão PAD Saúde+ para fazer o cartão usando o cupom.
   4) No painel do administrador a equipe acompanha: cartão feito →
      1ª parcela paga → PIX enviado para o Luiz.
   ========================================================= */
(() => {
  "use strict";

  // WhatsApp do Cartão PAD Saúde+ (mesmo número da roleta)
  const PAD_WHATSAPP = "5581921434317";
  const POLICY_URL = "https://sites.google.com/view/politicapadcartao/in%C3%ADcio";
  const STORE_KEY = "pad_indique_cupom";

  const el = (id) => document.getElementById(id);
  const onlyDigits = (v) => String(v || "").replace(/\D/g, "");
  const track = (name, params = {}) => { try { if (typeof window.gtag === "function") window.gtag("event", name, params); } catch (_) {} };

  // ---------- Utilidades ----------
  function cpfValido(cpf) {
    const d = onlyDigits(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const calc = (len) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  const fmtCpf = (v) => {
    const d = onlyDigits(v).slice(0, 11);
    return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  };
  const fmtPhone = (v) => {
    const d = onlyDigits(v).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };
  function normPhone(v) {
    let d = onlyDigits(v);
    if (d.startsWith("55") && d.length > 11) d = d.substring(2);
    if (d.length === 10) d = d.substring(0, 2) + "9" + d.substring(2);
    return "55" + d;
  }
  const phoneValido = (v) => { const d = onlyDigits(v).replace(/^55(?=\d{10,11}$)/, ""); return d.length === 10 || d.length === 11; };
  function idade(iso) {
    const n = new Date(iso + "T12:00:00");
    if (isNaN(n)) return -1;
    const h = new Date();
    let a = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
    return a;
  }
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const cpfHash = (cpf) => sha256("indique-pad|" + onlyDigits(cpf));
  function novoCupom() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const arr = new Uint32Array(6);
    crypto.getRandomValues(arr);
    return "IND-" + Array.from(arr, (n) => chars[n % chars.length]).join("");
  }
  const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const linkIndicacao = (cupom) => `${location.origin}${location.pathname}?indicacao=${encodeURIComponent(cupom)}`;
  function abrirWhatsApp(numero, texto) {
    const base = numero ? `https://wa.me/${onlyDigits(numero)}` : "https://wa.me/";
    window.open(`${base}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  }
  function somaStat(cupom, campo) {
    // Contadores só para o painel (não bloqueiam nada se falharem)
    try { rtdb.ref(`indique_stats/${cupom}/${campo}`).set(firebase.database.ServerValue.increment(1)).catch(() => {}); } catch (_) {}
  }

  // Garante login anônimo (o app.min.js também faz, mas pode ainda não ter terminado)
  function garantirLogin() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise((resolve, reject) => {
      const off = auth.onAuthStateChanged((u) => { if (u) { off(); resolve(u); } });
      setTimeout(() => {
        if (!auth.currentUser) auth.signInAnonymously().then((c) => { off(); resolve(c.user); }).catch((e) => { off(); reject(e); });
      }, 2500);
    });
  }

  // ---------- HTML dos modais ----------
  const html = `
  <div id="indModal" class="modal ind-modal hidden" role="dialog" aria-modal="true" aria-labelledby="indTitle">
    <div class="modal-card ind-card">
      <button class="modal-close" type="button" data-ind-close aria-label="Fechar">×</button>

      <div id="indFormBox">
        <div class="result-emoji" aria-hidden="true">🤝</div>
        <h2 id="indTitle">Indique e Ganhe</h2>
        <p>Indique um amigo para o <b>Cartão PAD Saúde+</b>. Quando ele pagar a <b>1ª parcela</b>, o valor dela vai para o <b>seu PIX</b>.</p>

        <form id="indForm" class="ind-form" novalidate>
          <label for="indNome">Seu nome completo</label>
          <input id="indNome" maxlength="80" autocomplete="name" placeholder="Digite seu nome">

          <label for="indWhats">Seu WhatsApp</label>
          <input id="indWhats" type="tel" inputmode="tel" maxlength="16" autocomplete="tel-national" placeholder="(81) 99999-9999">

          <div class="ind-row">
            <div>
              <label for="indCpf">Seu CPF</label>
              <input id="indCpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00">
            </div>
            <div>
              <label for="indNasc">Data de nascimento</label>
              <input id="indNasc" type="date">
            </div>
          </div>

          <label for="indPixTipo">Sua chave PIX (para receber)</label>
          <div class="ind-row">
            <select id="indPixTipo" aria-label="Tipo da chave PIX">
              <option value="cpf">CPF</option>
              <option value="celular">Celular</option>
              <option value="email">E-mail</option>
              <option value="aleatoria">Chave aleatória</option>
            </select>
            <input id="indPix" maxlength="100" placeholder="Mesmo CPF informado acima" aria-label="Chave PIX">
          </div>

          <label class="ind-check">
            <input id="indConsent" type="checkbox">
            <span>Concordo com as regras do Indique e Ganhe e com o uso dos meus dados para pagamento da recompensa, conforme a <a href="${POLICY_URL}" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>.</span>
          </label>

          <button id="indSubmit" class="primary" type="submit">Gerar meu cupom 🎟️</button>
          <div id="indMsg" class="status status-dark" role="alert"></div>
        </form>

        <details class="ind-rules">
          <summary>Regras do Indique e Ganhe</summary>
          <ul>
            <li>Cada CPF tem <b>um cupom de indicação</b>. Se já tiver cadastro, é só informar o CPF de novo para ver o seu cupom.</li>
            <li>Seu amigo precisa informar o cupom ao fazer o Cartão PAD Saúde+.</li>
            <li>A recompensa é o <b>valor da 1ª parcela</b> paga pelo indicado, enviada por PIX para a chave cadastrada <b>depois da confirmação do pagamento</b>.</li>
            <li>Não vale indicar a si mesmo.</li>
          </ul>
        </details>
      </div>

      <div id="indOkBox" class="hidden">
        <div class="result-emoji" aria-hidden="true">🎉</div>
        <h2 id="indOkTitle">Seu cupom está pronto!</h2>
        <p id="indOkText">Compartilhe com quem você quer indicar.</p>
        <div class="ind-coupon">
          <span>Seu cupom de indicação</span>
          <div class="ind-coupon-row">
            <strong id="indCupom">IND-XXXXXX</strong>
            <button id="indCopy" class="copy-btn" type="button">Copiar</button>
          </div>
        </div>
        <button id="indShare" class="whatsapp" type="button">📲 Compartilhar no WhatsApp</button>
        <button id="indNew" class="ind-link" type="button">Cadastrar outro CPF</button>
        <p class="ind-small">Quando seu amigo fizer o cartão e pagar a 1ª parcela, a equipe do Cartão PAD Saúde+ envia o PIX para você.</p>
      </div>
    </div>
  </div>

  <div id="indGuestModal" class="modal ind-modal hidden" role="dialog" aria-modal="true" aria-labelledby="indGuestTitle">
    <div class="modal-card ind-card">
      <button class="modal-close" type="button" data-ind-close aria-label="Fechar">×</button>
      <div class="result-emoji" aria-hidden="true">💳</div>
      <h2 id="indGuestTitle">Você foi indicado!</h2>
      <p id="indGuestText">Um amigo indicou o Cartão PAD Saúde+ para você.</p>
      <div class="ind-coupon">
        <span>Cupom de indicação</span>
        <div class="ind-coupon-row"><strong id="indGuestCupom">IND-XXXXXX</strong></div>
      </div>
      <p class="ind-small">Informe este cupom ao fazer o seu Cartão PAD Saúde+, o cartão de descontos em consultas e exames para você e sua família.</p>
      <button id="indGuestBtn" class="whatsapp" type="button">💳 Quero meu Cartão PAD Saúde+</button>
      <div class="ind-or"><span>ou</span></div>
      <button id="indGuestSwitch" class="ind-switch" type="button">🤝 Quero gerar meu próprio cupom e indicar</button>
      <button class="ind-link" type="button" data-ind-close>Aproveitar e girar a roleta 🎡</button>
    </div>
  </div>`;

  const cta = `
  <section class="ind-cta" aria-labelledby="indCtaTitle">
    <div class="ind-cta-icon" aria-hidden="true">🤝</div>
    <div class="ind-cta-text">
      <h2 id="indCtaTitle">Indique e Ganhe</h2>
      <p>Indique um amigo para o Cartão PAD Saúde+. Quando ele pagar a 1ª parcela, <b>o valor vai para o seu PIX</b>.</p>
    </div>
    <button class="ind-cta-btn" type="button" data-ind-open>Quero indicar</button>
  </section>`;

  document.body.insertAdjacentHTML("beforeend", html);
  const how = document.querySelector("section.how");
  if (how) how.insertAdjacentHTML("beforebegin", cta);
  const tools = document.querySelector(".wheel-column .tools");
  if (tools) tools.insertAdjacentHTML("beforeend", `<button class="tool-btn ind-tool" type="button" data-ind-open>🤝 Indique e Ganhe</button>`);

  // ---------- Abrir / fechar ----------
  const modal = el("indModal");
  const guest = el("indGuestModal");
  let ultimoFoco = null;

  function abrir(m) {
    ultimoFoco = document.activeElement;
    m.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    setTimeout(() => m.querySelector("input, button:not(.modal-close)")?.focus({ preventScroll: true }), 50);
  }
  function fechar(m) {
    m.classList.add("hidden");
    if (modal.classList.contains("hidden") && guest.classList.contains("hidden")) document.body.style.overflow = "";
    ultimoFoco?.focus?.({ preventScroll: true });
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-ind-open]")) { abrirIndique(); }
    const c = e.target.closest("[data-ind-close]");
    if (c) fechar(c.closest(".modal"));
  });
  [modal, guest].forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) fechar(m); }));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal.classList.contains("hidden")) fechar(modal);
    else if (!guest.classList.contains("hidden")) fechar(guest);
  });

  // ---------- Formulário ----------
  const f = {
    nome: el("indNome"), whats: el("indWhats"), cpf: el("indCpf"), nasc: el("indNasc"),
    pixTipo: el("indPixTipo"), pix: el("indPix"), consent: el("indConsent"),
    submit: el("indSubmit"), msg: el("indMsg")
  };
  f.nasc.max = new Date().toISOString().slice(0, 10);

  f.whats.addEventListener("input", () => { f.whats.value = fmtPhone(f.whats.value); });
  f.cpf.addEventListener("input", () => {
    f.cpf.value = fmtCpf(f.cpf.value);
    if (f.pixTipo.value === "cpf") f.pix.value = f.cpf.value;
  });
  const pixPlaceholders = { cpf: "Mesmo CPF informado acima", celular: "(81) 99999-9999", email: "seuemail@exemplo.com", aleatoria: "Cole a chave aleatória" };
  f.pixTipo.addEventListener("change", () => {
    f.pix.placeholder = pixPlaceholders[f.pixTipo.value];
    f.pix.inputMode = f.pixTipo.value === "email" ? "email" : f.pixTipo.value === "aleatoria" ? "text" : "numeric";
    f.pix.value = f.pixTipo.value === "cpf" ? f.cpf.value : "";
  });
  f.pix.addEventListener("input", () => {
    if (f.pixTipo.value === "cpf") f.pix.value = fmtCpf(f.pix.value);
    if (f.pixTipo.value === "celular") f.pix.value = fmtPhone(f.pix.value);
  });

  function erro(input, texto) {
    f.msg.className = "status status-dark error";
    f.msg.textContent = texto;
    if (input) { input.classList.add("invalid"); input.focus(); }
    return false;
  }
  function validar() {
    Object.values(f).forEach((i) => i?.classList?.remove("invalid"));
    const nome = f.nome.value.trim().replace(/\s+/g, " ");
    if (nome.split(" ").length < 2 || nome.length < 5) return erro(f.nome, "Informe seu nome completo.");
    if (!phoneValido(f.whats.value)) return erro(f.whats, "Informe um WhatsApp válido com DDD.");
    if (!cpfValido(f.cpf.value)) return erro(f.cpf, "CPF inválido. Confira os números.");
    const anos = idade(f.nasc.value);
    if (!f.nasc.value || anos < 0 || anos > 120) return erro(f.nasc, "Informe sua data de nascimento.");
    if (anos < 18) return erro(f.nasc, "O Indique e Ganhe é só para maiores de 18 anos.");
    const tipo = f.pixTipo.value, pix = f.pix.value.trim();
    if (tipo === "cpf" && !cpfValido(pix)) return erro(f.pix, "A chave PIX (CPF) não é válida.");
    if (tipo === "celular" && !phoneValido(pix)) return erro(f.pix, "A chave PIX (celular) não é válida.");
    if (tipo === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pix)) return erro(f.pix, "A chave PIX (e-mail) não é válida.");
    if (tipo === "aleatoria" && pix.replace(/[^0-9a-f]/gi, "").length !== 32) return erro(f.pix, "A chave aleatória tem 32 letras e números (com hífens).");
    if (!f.consent.checked) return erro(null, "Marque que concorda com as regras para continuar.");
    return true;
  }

  function mostrarForm() {
    el("indFormBox").classList.remove("hidden");
    el("indOkBox").classList.add("hidden");
    f.msg.textContent = "";
    f.msg.className = "status status-dark";
  }
  function mostrarCupom(cupom, nome, jaExistia) {
    el("indCupom").textContent = cupom;
    el("indOkTitle").textContent = jaExistia ? "Você já tem um cupom!" : "Seu cupom está pronto!";
    el("indOkText").textContent = jaExistia
      ? "Este CPF já estava cadastrado. É só compartilhar o seu cupom de novo."
      : `Pronto, ${primeiroNome(nome)}! Agora compartilhe com quem você quer indicar.`;
    el("indFormBox").classList.add("hidden");
    el("indOkBox").classList.remove("hidden");
    modal.dataset.cupom = cupom;
    modal.dataset.nome = nome || "";
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ cupom, nome: nome || "" })); } catch (_) {}
  }

  el("indForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validar()) return;
    f.submit.disabled = true;
    f.msg.className = "status status-dark";
    f.msg.textContent = "Gerando seu cupom…";
    let etapa = "login";
    try {
      const user = await garantirLogin();
      const cpf = onlyDigits(f.cpf.value);
      const hash = await cpfHash(cpf);

      // CPF já cadastrado? Mostra o cupom que ele já tem.
      etapa = "leitura";
      const existente = (await rtdb.ref(`indique_cpfs/${hash}`).once("value")).val();
      etapa = "gravação";
      if (existente && existente.cupom) {
        mostrarCupom(existente.cupom, f.nome.value.trim(), true);
        track("indique_existing");
        return;
      }

      const nome = f.nome.value.trim().replace(/\s+/g, " ");
      const tipo = f.pixTipo.value;
      const pixChave = tipo === "cpf" ? onlyDigits(f.pix.value)
        : tipo === "celular" ? "+" + normPhone(f.pix.value)
        : f.pix.value.trim();

      let cupom = null, ultimoErro = null;
      for (let t = 0; t < 4 && !cupom; t++) {
        const tentativa = novoCupom();
        const updates = {};
        updates[`indicacoes/${tentativa}`] = {
          cupom: tentativa, nome, whatsapp: normPhone(f.whats.value),
          cpf, cpfHash: hash, nascimento: f.nasc.value,
          pixTipo: tipo, pixChave,
          uid: user.uid, status: "cupom_gerado",
          criadoEmMs: firebase.database.ServerValue.TIMESTAMP,
          consentimento: true
        };
        updates[`indique_cpfs/${hash}`] = { cupom: tentativa, uid: user.uid };
        updates[`indique_cupons/${tentativa}`] = { nome: primeiroNome(nome), ativo: true };
        try {
          await rtdb.ref().update(updates);
          cupom = tentativa;
        } catch (err) {
          ultimoErro = err;
          if (!/permission/i.test(String(err.code || err.message))) throw err;
          // Pode ser cupom repetido (raro) ou o mesmo CPF cadastrado agora em outra aba
          const again = (await rtdb.ref(`indique_cpfs/${hash}`).once("value")).val();
          if (again && again.cupom) { mostrarCupom(again.cupom, nome, true); return; }
        }
      }
      if (!cupom) throw ultimoErro || new Error("Não foi possível gerar o cupom.");
      mostrarCupom(cupom, nome, false);
      track("indique_registered");
    } catch (err) {
      console.error(err);
      const codigo = String(err.code || err.message || "erro");
      console.error(`[Indique e Ganhe] falhou na etapa: ${etapa} (${codigo})`);
      erro(null, /permission/i.test(codigo)
        ? `Não foi possível salvar agora. Tente de novo em instantes. (código: sem permissão na ${etapa})`
        : etapa === "login"
          ? "Não foi possível conectar. Recarregue a página e tente de novo."
          : `Sem conexão. Confira sua internet e tente de novo. (código: ${codigo})`);
    } finally {
      f.submit.disabled = false;
    }
  });

  el("indCopy").addEventListener("click", async () => {
    const cupom = modal.dataset.cupom || "";
    try { await navigator.clipboard.writeText(cupom); el("indCopy").textContent = "Copiado!"; }
    catch (_) { el("indCopy").textContent = "Selecione e copie"; }
    setTimeout(() => (el("indCopy").textContent = "Copiar"), 1800);
  });

  el("indShare").addEventListener("click", () => {
    const cupom = modal.dataset.cupom;
    if (!cupom) return;
    const texto = [
      "Oi! 😊 Estou te indicando o *Cartão PAD Saúde+*, o cartão de descontos em consultas e exames para você e sua família.",
      "",
      `🎟️ Use meu cupom de indicação: *${cupom}*`,
      "",
      `Veja aqui e peça o seu: ${linkIndicacao(cupom)}`
    ].join("\n");
    somaStat(cupom, "compartilhamentos");
    track("indique_share");
    abrirWhatsApp("", texto); // abre o WhatsApp para escolher o contato
  });

  el("indNew").addEventListener("click", () => {
    el("indForm").reset();
    f.pix.placeholder = pixPlaceholders.cpf;
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
    mostrarForm();
    f.nome.focus();
  });

  // Quem já gerou cupom neste aparelho abre direto no cupom
  function abrirIndique() {
    mostrarForm();
    try {
      const salvo = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (salvo && salvo.cupom) mostrarCupom(salvo.cupom, salvo.nome, true);
    } catch (_) {}
    abrir(modal);
    track("indique_open");
  }

  // ---------- Quem recebeu a indicação (link ?indicacao=) ----------
  async function abrirIndicado() {
    const params = new URLSearchParams(location.search);
    const cupom = String(params.get("indicacao") || "").trim().toUpperCase();
    if (!/^IND-[A-Z0-9]{6}$/.test(cupom)) return;
    try {
      await garantirLogin();
      const info = (await rtdb.ref(`indique_cupons/${cupom}`).once("value")).val();
      if (!info || info.ativo === false) return;
      const quem = info.nome || "Um amigo";
      el("indGuestTitle").textContent = `${quem} indicou você!`;
      el("indGuestText").textContent = `${quem} indicou o Cartão PAD Saúde+ para você.`;
      el("indGuestCupom").textContent = cupom;
      guest.dataset.cupom = cupom;
      guest.dataset.nome = quem;
      abrir(guest);
      somaStat(cupom, "visitas");
      track("indique_guest_view");
    } catch (err) { console.error(err); }
  }
  el("indGuestBtn").addEventListener("click", () => {
    const cupom = guest.dataset.cupom;
    const texto = `Olá! Fui indicado(a) por ${guest.dataset.nome} e quero fazer o meu Cartão PAD Saúde+.\n🎟️ Cupom de indicação: ${cupom}`;
    somaStat(cupom, "cliques");
    track("indique_guest_whatsapp");
    abrirWhatsApp(PAD_WHATSAPP, texto);
  });

  // Quem recebeu um cupom mas prefere gerar o próprio para indicar outras pessoas
  el("indGuestSwitch").addEventListener("click", () => {
    guest.classList.add("hidden");
    abrirIndique();
    track("indique_guest_switch");
  });

  abrirIndicado();
})();
