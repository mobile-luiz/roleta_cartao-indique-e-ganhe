/* =========================================================
   PAINEL — INDIQUE E GANHE (Cartão PAD Saúde+)
   Usa as funções do admin.js: $, escapeHtml, fmtPhone, fmtDay, fmtTime,
   toast, errText, setMsg, pageSlice, renderPager.

   Situações:
   cupom_gerado → cartao_feito → parcela_paga (PIX a pagar) → pix_pago
   (ou cancelado)
   ========================================================= */
(() => {
  "use strict";

  const STATUS = {
    cupom_gerado: { label: "Cupom gerado", css: "ind-st-gerado" },
    cartao_feito: { label: "Cartão feito", css: "ind-st-cartao" },
    parcela_paga: { label: "PIX a pagar", css: "ind-st-pagar" },
    pix_pago: { label: "PIX pago", css: "ind-st-pago" },
    cancelado: { label: "Cancelado", css: "cancel" }
  };
  const ORDEM = ["cupom_gerado", "cartao_feito", "parcela_paga", "pix_pago"];
  const PIX_TIPO = { cpf: "CPF", celular: "Celular", email: "E-mail", aleatoria: "Aleatória" };
  const TS = firebase.database.ServerValue.TIMESTAMP;

  let lista = [];
  let stats = {};
  let refs = [];
  let aberto = null; // indicação aberta no modal
  const pg = { page: 1, size: 20 };

  const digits = (v) => String(v || "").replace(/\D/g, "");
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtCpf = (c) => { const d = digits(c); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c || ""; };
  const maskCpf = (c) => { const d = digits(c); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "—"; };
  const fmtNasc = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso || "");
  const fmtPix = (tipo, chave) => (tipo === "cpf" ? fmtCpf(chave) : tipo === "celular" ? fmtPhone(digits(chave)) : chave || "");
  function normPhone(v) {
    let d = digits(v);
    if (!d) return "";
    if (d.startsWith("55") && d.length > 11) d = d.substring(2);
    if (d.length === 10) d = d.substring(0, 2) + "9" + d.substring(2);
    return "55" + d;
  }
  const maskInputPhone = (v) => {
    const d = digits(v).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };
  const parseValor = (v) => {
    const t = String(v || "").trim().replace(/[R$\s]/g, "");
    if (!t) return 0;
    const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };
  const waLink = (p) => { const d = digits(p); return d ? `<a href="https://wa.me/${d}" target="_blank" rel="noopener">${escapeHtml(fmtPhone(d))}</a>` : "—"; };

  // ---------- Carregar (ao vivo) ----------
  function parar() { refs.forEach((r) => r.off()); refs = []; }

  function carregar() {
    parar();
    const aviso = $("indAviso");
    const r1 = rtdb.ref("indicacoes").orderByChild("criadoEmMs").limitToLast(3000);
    r1.on("value", (snap) => {
      const out = [];
      snap.forEach((c) => { const v = c.val() || {}; out.push({ ...v, cupom: c.key, status: v.status || "cupom_gerado" }); });
      lista = out.sort((a, b) => Number(b.criadoEmMs || 0) - Number(a.criadoEmMs || 0));
      aviso.classList.add("hidden");
      render();
    }, (err) => {
      console.error(err);
      aviso.innerHTML = `⚠️ <b>Não foi possível ler as indicações.</b> ${escapeHtml(errText(err, ""))} Publique as regras novas do arquivo <b>regras-realtime-database.json</b>.`;
      aviso.classList.remove("hidden");
      $("indBody").innerHTML = `<tr><td colspan="8" class="empty">Sem acesso às indicações.</td></tr>`;
    });
    const r2 = rtdb.ref("indique_stats");
    r2.on("value", (snap) => { stats = snap.val() || {}; render(); }, () => {});
    refs.push(r1, r2);
  }

  auth.onAuthStateChanged((user) => {
    if (user && !user.isAnonymous && user.email) carregar();
    else { parar(); lista = []; }
  });

  // Na aba do Indique e Ganhe, esconde a barra do dia e os números do dia (não se aplicam)
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    const on = t.dataset.tab === "tabIndique";
    document.querySelector(".daybar")?.classList.toggle("hidden", on);
    document.querySelector(".kpis:not(.ind-kpis)")?.classList.toggle("hidden", on);
  }));

  // ---------- Lista ----------
  function filtrada() {
    const termo = $("indSearch").value.trim().toLowerCase();
    const d = digits(termo);
    const filtro = $("indFilter").value;
    return lista.filter((i) => {
      if (filtro && i.status !== filtro) return false;
      if (!termo) return true;
      return String(i.nome || "").toLowerCase().includes(termo)
        || String(i.indicadoNome || "").toLowerCase().includes(termo)
        || String(i.cupom || "").toLowerCase().includes(termo)
        || (d.length >= 3 && (digits(i.cpf).includes(d) || digits(i.whatsapp).includes(d) || digits(i.indicadoWhatsapp).includes(d)));
    });
  }

  function renderKpis() {
    const ativos = lista.filter((i) => i.status !== "cancelado");
    const pagar = ativos.filter((i) => i.status === "parcela_paga");
    const pagos = ativos.filter((i) => i.status === "pix_pago");
    $("indKpiCad").textContent = ativos.length;
    $("indKpiCartao").textContent = ativos.filter((i) => ORDEM.indexOf(i.status) >= 1).length;
    $("indKpiPagar").textContent = pagar.length;
    $("indKpiPagarValor").textContent = pagar.length ? brl(pagar.reduce((s, i) => s + Number(i.valorParcela || 0), 0)) : "";
    $("indKpiPagos").textContent = pagos.length;
    $("indKpiPagosValor").textContent = pagos.length ? brl(pagos.reduce((s, i) => s + Number(i.valorParcela || 0), 0)) : "";
    $("indTabCount").textContent = pagar.length ? `${pagar.length} a pagar` : (ativos.length || "");
  }

  function render() {
    renderKpis();
    const l = filtrada();
    $("indCount").textContent = lista.length ? `(${l.length}${l.length !== lista.length ? ` de ${lista.length}` : ""})` : "";
    if (!l.length) {
      $("indBody").innerHTML = `<tr><td colspan="8" class="empty">${lista.length ? "Nenhuma indicação com esse filtro." : "Ninguém se cadastrou no Indique e Ganhe ainda."}</td></tr>`;
      $("indPager").innerHTML = "";
      return;
    }
    const p = pageSlice(l, pg);
    renderPager("indPager", pg, l.length, p.totalPages, p.start, render);
    $("indBody").innerHTML = p.items.map((i) => {
      const st = STATUS[i.status] || STATUS.cupom_gerado;
      const s = stats[i.cupom] || {};
      const eng = [
        s.compartilhamentos ? `📤 ${s.compartilhamentos}` : "",
        s.visitas ? `👀 ${s.visitas}` : "",
        s.cliques ? `💬 ${s.cliques}` : ""
      ].filter(Boolean).join(" · ");
      const quando = Number(i.criadoEmMs || 0);
      const statusData = i.statusEm?.[i.status];
      return `<tr>
        <td class="nowrap" data-label="Cadastro">${quando ? `${fmtDay(quando)}<div class="empty nowrap">${fmtTime(quando)}</div>` : "—"}</td>
        <td class="c-name" data-label="Quem indica">${escapeHtml(i.nome || "")}<div class="ind-sub">${waLink(i.whatsapp)}</div></td>
        <td class="nowrap" data-label="CPF">${escapeHtml(maskCpf(i.cpf))}<div class="ind-sub">Nasc. ${escapeHtml(fmtNasc(i.nascimento))}</div></td>
        <td data-label="Chave PIX"><span class="ind-pix">${escapeHtml(PIX_TIPO[i.pixTipo] || "PIX")}: <b>${escapeHtml(fmtPix(i.pixTipo, i.pixChave))}</b></span>
          <button class="btn btn-small btn-light ind-copy" type="button" data-copy="${escapeHtml(i.pixTipo === "celular" ? "+" + digits(i.pixChave) : i.pixChave || "")}">Copiar</button></td>
        <td class="code" data-label="Cupom">${escapeHtml(i.cupom)}${eng ? `<div class="ind-sub" title="Compartilhamentos · visitas do link · cliques em Quero meu Cartão">${eng}</div>` : ""}</td>
        <td data-label="Indicado">${i.indicadoNome ? `${escapeHtml(i.indicadoNome)}<div class="ind-sub">${waLink(i.indicadoWhatsapp)}</div>` : `<span class="muted">—</span>`}</td>
        <td data-label="Situação"><span class="tag ${st.css}">${st.label}</span>
          ${i.valorParcela ? `<div class="ind-sub">${brl(i.valorParcela)}</div>` : ""}
          ${statusData ? `<div class="ind-sub">${fmtDay(statusData)}</div>` : ""}</td>
        <td class="c-action nowrap"><button class="btn btn-small btn-used" type="button" data-ind="${escapeHtml(i.cupom)}">Atualizar</button></td>
      </tr>`;
    }).join("");
  }

  $("indSearch").addEventListener("input", () => { pg.page = 1; render(); });
  $("indFilter").addEventListener("change", () => { pg.page = 1; render(); });

  $("indBody").addEventListener("click", async (e) => {
    const cp = e.target.closest("button[data-copy]");
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); toast("Chave PIX copiada"); }
      catch (_) { prompt("Copie a chave PIX:", cp.dataset.copy); }
      return;
    }
    const b = e.target.closest("button[data-ind]");
    if (b) abrirDialog(b.dataset.ind);
  });

  // ---------- Modal ----------
  const dlg = $("indDialog");
  const d = {
    status: $("indDlgStatus"), nome: $("indDlgNome"), whats: $("indDlgWhats"),
    valor: $("indDlgValor"), obs: $("indDlgObs"), msg: $("indDlgMsg"), save: $("indDlgSave")
  };
  d.whats.addEventListener("input", () => { d.whats.value = maskInputPhone(d.whats.value); });

  function abrirDialog(cupom) {
    const i = lista.find((x) => x.cupom === cupom);
    if (!i) return;
    aberto = i;
    $("indDlgTitle").textContent = `Indicação ${i.cupom}`;
    $("indDlgInfo").innerHTML = `
      <div><span>Quem indica</span><b>${escapeHtml(i.nome || "")}</b></div>
      <div><span>WhatsApp</span><b>${waLink(i.whatsapp)}</b></div>
      <div><span>CPF</span><b>${escapeHtml(fmtCpf(i.cpf))}</b></div>
      <div><span>Nascimento</span><b>${escapeHtml(fmtNasc(i.nascimento))}</b></div>
      <div class="ind-info-wide"><span>Chave PIX (${escapeHtml(PIX_TIPO[i.pixTipo] || "PIX")})</span><b>${escapeHtml(fmtPix(i.pixTipo, i.pixChave))}</b></div>`;
    d.status.value = i.status || "cupom_gerado";
    d.nome.value = i.indicadoNome || "";
    d.whats.value = i.indicadoWhatsapp ? maskInputPhone(digits(i.indicadoWhatsapp).replace(/^55/, "")) : "";
    d.valor.value = i.valorParcela ? String(Number(i.valorParcela).toFixed(2)).replace(".", ",") : "";
    d.obs.value = i.obs || "";
    setMsg(d.msg, "");
    dlg.classList.remove("hidden");
    setTimeout(() => d.status.focus(), 30);
  }
  function fecharDialog() { dlg.classList.add("hidden"); aberto = null; }
  $("indDlgClose").addEventListener("click", fecharDialog);
  $("indDlgCancel").addEventListener("click", fecharDialog);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) fecharDialog(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !dlg.classList.contains("hidden")) fecharDialog(); });

  $("indDlgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!aberto) return;
    const status = d.status.value;
    const nome = d.nome.value.trim().replace(/\s+/g, " ");
    const whats = normPhone(d.whats.value);
    const valor = parseValor(d.valor.value);
    const passo = ORDEM.indexOf(status);

    if (passo >= 1 && !nome) { setMsg(d.msg, "Informe o nome de quem fez o cartão (indicado).", "err"); d.nome.focus(); return; }
    if (d.whats.value && digits(d.whats.value).length < 10) { setMsg(d.msg, "WhatsApp do indicado incompleto.", "err"); d.whats.focus(); return; }
    if (isNaN(valor) || valor < 0) { setMsg(d.msg, "Valor da parcela inválido. Use, por exemplo, 39,90.", "err"); d.valor.focus(); return; }
    if (passo >= 2 && !valor) { setMsg(d.msg, "Informe o valor da 1ª parcela (é o valor do PIX).", "err"); d.valor.focus(); return; }
    if (whats && whats === normPhone(aberto.whatsapp)
      && !confirm("O WhatsApp do indicado é o mesmo de quem indicou. Não vale indicar a si mesmo. Salvar mesmo assim?")) return;
    if (status === "pix_pago" && aberto.status !== "pix_pago"
      && !confirm(`Confirmar que o PIX de ${brl(valor)} foi enviado para ${aberto.nome}?`)) return;

    const updates = {
      status,
      indicadoNome: nome || null,
      indicadoWhatsapp: whats || null,
      valorParcela: valor || null,
      obs: d.obs.value.trim() || null,
      atualizadoEmMs: TS,
      atualizadoPor: auth.currentUser?.email || ""
    };
    if (status !== aberto.status) updates[`statusEm/${status}`] = TS;

    d.save.disabled = true;
    setMsg(d.msg, "Salvando…");
    try {
      const multi = {};
      Object.entries(updates).forEach(([k, v]) => { multi[`indicacoes/${aberto.cupom}/${k}`] = v; });
      multi[`indique_cupons/${aberto.cupom}/ativo`] = status !== "cancelado";
      await rtdb.ref().update(multi);
      toast(`Indicação ${aberto.cupom}: ${STATUS[status].label}`);
      fecharDialog();
    } catch (err) {
      console.error(err);
      setMsg(d.msg, errText(err, "Não foi possível salvar."), "err");
    } finally {
      d.save.disabled = false;
    }
  });

  $("indDlgDelete").addEventListener("click", async () => {
    if (!aberto) return;
    if (!confirm(`Excluir o cadastro ${aberto.cupom} de ${aberto.nome}?\n\nO cupom deixa de existir e o CPF poderá se cadastrar de novo. Use só para cadastros de teste ou pedidos de exclusão de dados.`)) return;
    const multi = {};
    multi[`indicacoes/${aberto.cupom}`] = null;
    multi[`indique_cupons/${aberto.cupom}`] = null;
    multi[`indique_stats/${aberto.cupom}`] = null;
    if (aberto.cpfHash) multi[`indique_cpfs/${aberto.cpfHash}`] = null;
    try {
      await rtdb.ref().update(multi);
      toast("Cadastro excluído");
      fecharDialog();
    } catch (err) {
      console.error(err);
      setMsg(d.msg, errText(err, "Não foi possível excluir."), "err");
    }
  });

  // ---------- CSV ----------
  $("indExport").addEventListener("click", () => {
    const l = filtrada();
    if (!l.length) { toast("Nada para exportar."); return; }
    const head = ["Cadastro", "Cupom", "Quem indica", "WhatsApp", "CPF", "Nascimento", "Tipo PIX", "Chave PIX",
      "Indicado", "WhatsApp indicado", "Valor 1ª parcela", "Situação", "Data da situação", "Compartilhamentos", "Visitas do link", "Cliques Quero meu Cartão", "Observação"];
    const rows = l.map((i) => {
      const s = stats[i.cupom] || {};
      const sd = i.statusEm?.[i.status];
      return [
        i.criadoEmMs ? `${fmtDay(i.criadoEmMs)} ${fmtTime(i.criadoEmMs)}` : "",
        i.cupom, i.nome, fmtPhone(digits(i.whatsapp)), fmtCpf(i.cpf), fmtNasc(i.nascimento),
        PIX_TIPO[i.pixTipo] || "", fmtPix(i.pixTipo, i.pixChave),
        i.indicadoNome || "", i.indicadoWhatsapp ? fmtPhone(digits(i.indicadoWhatsapp)) : "",
        i.valorParcela ? String(Number(i.valorParcela).toFixed(2)).replace(".", ",") : "",
        (STATUS[i.status] || STATUS.cupom_gerado).label, sd ? fmtDay(sd) : "",
        s.compartilhamentos || 0, s.visitas || 0, s.cliques || 0, i.obs || ""
      ];
    });
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `indique-e-ganhe-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
})();
