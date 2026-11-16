// Leitura de receita: transforma o texto (OCR) em itens da lista da UBS com a quantidade calculada.
// Regras da Kely (ver REGRAS-RECEITA.md). Roda no próprio aparelho; nada vai para servidor.
var ReceitaCore = (function () {
  const N = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[“”"]/g, ' ').replace(/\s+/g, ' ').trim();
  const SAIS = new Set(['CLORIDRATO', 'SODICA', 'SODICO', 'BESILATO', 'MALEATO', 'FOSFATO', 'NITRATO', 'ACETATO', 'MONOIDRATADA', 'MONOIDRATADO', 'DIPROPIONATO', 'SULFATO', 'BUTILBROMETO', 'ENANTATO', 'VALERATO', 'DE', 'DO', 'DA', 'E', 'POTASSIO', 'HUMANA', 'ELENCO', 'ESTADUAL', 'MONONITRATO', 'CALCIO']);
  const PARE = /ASSINATURA|IDENTIFICACAO DO COMPRADOR|IDENTIFICACAO DO FORNECEDOR|CARIMBO|^DATA[: ]|CRM\b|CRO\b|CREMESP|IMPRESSO EM/;

  function forma(nome) {
    const n = N(nome);
    if (/INJETAVEL/.test(n)) return 'injetavel';
    if (/XAROPE|SUSPENSAO|SOLUCAO ORAL|SOLUCAO NASAL|PO PARA SUSPENSAO|GOTAS/.test(n)) return 'liquido';
    if (/OFTALMICA/.test(n)) return 'colirio';
    if (/AEROSSOL|DOSES/.test(n)) return 'spray';
    if (/CREME|POMADA|BISNAGA|LOCAO|GEL\b/.test(n)) return 'topico';
    if (/COMPRIMIDO|CAPSULA/.test(n)) return 'solido';
    return 'outro';
  }
  function forca(txt) {
    const m = N(txt).match(/(\d+(?:[.,]\d+)?)\s*(MCG|MG|G|UI|%)(\s*\/\s*(\d+(?:[.,]\d+)?)?\s*ML)?/);
    if (!m) return null;
    let v = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    let por = m[3] ? parseFloat((m[4] || '1').replace(',', '.')) : 0;
    return { v: por ? v / por : v, un: m[2], ml: !!m[3] };
  }
  function tokens(nome) {
    let n = N(nome).replace(/\(.*?\)/g, ' ');
    const cut = n.search(/\d/); if (cut > 0) n = n.slice(0, cut);
    return n.split(/[^A-Z]+/).filter(w => w.length > 2 && !SAIS.has(w));
  }

  function montarIndice(lista, tabela) {
    const ap = (tabela && tabela.apres) || {};
    const grupos = new Map();
    for (const [code, nome] of lista) {
      const tk = tokens(nome); if (!tk.length) continue;
      const key = tk.join(' + ');
      if (!grupos.has(key)) grupos.set(key, { key, tk, itens: [] });
      const t = ap[code] || {};
      grupos.get(key).itens.push({ code, nome, forma: forma(nome), forca: forca(nome), t, disp: !/^N/i.test(N(t.disp || 'SIM')) });
    }
    const marcas = ((tabela && tabela.marcas) || []).filter(m => m.nome).map(m => ({ ...m, nn: N(m.nome).split('/').map(s => s.trim()).filter(Boolean) }));
    return { grupos: Array.from(grupos.values()), marcas };
  }

  const palavra = (linha, w) => new RegExp('(^|[^A-Z])' + w + '([^A-Z]|$)').test(linha);
  function acharGrupo(linha, idx) {
    let best = null;
    for (const g of idx.grupos) {
      if (g.tk.every(w => palavra(linha, w))) { if (!best || g.tk.length > best.tk.length) best = g; }
    }
    if (best) return { grupo: best };
    for (const m of idx.marcas) {
      for (const nm of m.nn) {
        const base = nm.replace(/\s+(GOTAS|COMPOSTO|SIMPLES|XR|MR|500|D)$/, '');
        if (nm && palavra(linha, nm.replace(/[^A-Z0-9 ]/g, ''))) {
          if (/NAO TEMOS/.test(N(m.temos))) return { marca: m, naoTemos: true };
          const g = idx.grupos.find(g => g.itens.some(i => i.code === m.code));
          if (g) return { grupo: g, marca: m };
        }
      }
    }
    return null;
  }

  const NUM = { UM: 1, UMA: 1, DOIS: 2, DUAS: 2, TRES: 3, MEIO: 0.5, MEIA: 0.5 };
  function posologia(txt) {
    const t = N(txt).replace(/½/g, ' 1/2 ').replace(/(\d)([A-Z])/g, '$1 $2').replace(/([A-Z])(\d)/g, '$1 $2');
    const p = { dose: null, un: '', freq: null, dias: null, continuo: false, sos: false, unica: false };
    const nd = s => s == null ? null : (s === '1/2' ? 0.5 : NUM[s] != null ? NUM[s] : parseFloat(String(s).replace(',', '.')));
    const UNID = '(COMPRIMIDOS?|COMP\\.?|CPRS?|CPS?|CAPSULAS?|CAPS\\.?|ML|GOTAS?|MEDIDAS?|JATOS?|APLICACOES|TUBOS?|BISNAGAS?)';
    const QTD = '(\\d+(?:[.,]\\d+)?|1\\/2|MEIO|MEIA|UMA?|DOIS|DUAS|TRES)';
    const unOf = u => /ML|MEDIDA/.test(u || '') ? 'ML' : /GOTA/.test(u || '') ? 'GOTAS' : /JATO/.test(u || '') ? 'JATOS' : 'UN';
    let m = t.match(new RegExp('(TOMAR|INGERIR|DAR|USAR|APLICAR|PINGAR)\\s+' + QTD + '\\s*' + UNID + '?'));
    if (m) { p.dose = nd(m[2]); p.un = unOf(m[3]); }
    else { m = t.replace(/(CX|CAIXA)\.?\s*(C\/|COM)?\s*\d+\s*\w+/g, ' ').match(new RegExp('(^|\\s)' + QTD + '\\s*' + UNID + '\\b')); if (m) { p.dose = nd(m[2]); p.un = unOf(m[3]); } }
    m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*H/) || t.match(/(\d{1,2})\s*EM\w?\s*(\d{1,2})\s*H/) || t.match(/A CADA\s*()(\d{1,2})\s*H/);
    if (m) p.freq = 24 / parseInt(m[2], 10);
    if (!p.freq) { m = t.match(/(\d)\s*(X|VEZES)\s*(AO|POR)\s*DIA/); if (m) p.freq = parseInt(m[1], 10); }
    if (!p.freq) { m = t.match(/(\d)\s*(X|VEZES)\s*(AO|POR|NA)\s*SEMANA/); if (m) p.freq = parseInt(m[1], 10) / 7; }
    if (!p.freq && /(1|UMA)\s*(X|VEZ)\s*(AO|POR)\s*DIA|AO DIA|DIARIAMENTE|PELA MANHA|A NOITE|AO DEITAR|EM JEJUM|NO ALMOCO/.test(t)) p.freq = 1;
    m = t.match(/(POR|DURANTE)\s*(\d{1,3})\s*DIAS?/) || t.match(/(\b)(\d{1,3})\s*DIAS?\b/);
    if (m) p.dias = parseInt(m[2], 10);
    if (/USO CONTINUO|CONTINUO/.test(t)) p.continuo = true;
    if (/SE (DOR|FEBRE|NECESSARIO|PRECISAR)|S\.?\s?O\.?\s?S\b|EM CASO DE (DOR|FEBRE)|SE FEB/.test(t)) p.sos = true;
    if (/DOSE UNICA/.test(t)) p.unica = true;
    return p;
  }

  // escolhe item(s) da UBS para a força pedida
  function escolher(g, bloco, prim) {
    const rf = forca(prim);
    const hint = /SUSPENSAO|XAROPE|SOLUCAO|GOTAS|\/\s*\d*\s*ML|FRASCO/.test(prim) ? 'liquido' : /CREME|POMADA|LOCAO|GEL\b|BISNAGA/.test(prim) ? 'topico' : /COMPRIMIDO|\bCP|\bCOMP|CAPSULA|\bCAPS|CPRS?\b/.test(bloco) ? 'solido' : '';
    let its = g.itens.filter(i => i.disp);
    if (!its.length) return { erro: 'não disponível na UBS (tabela)' };
    if (hint) { const f = its.filter(i => i.forma === hint); if (f.length) its = f; }
    else if (rf && !rf.ml && its.some(i => i.forma === 'solido')) its = its.filter(i => i.forma === 'solido');
    if (!rf || its.length === 1 && !rf) return { partes: [{ item: its[0], mult: 1 }], duvida: its.length > 1 };
    const comForca = its.filter(i => i.forca && i.forca.un === rf.un && !!i.forca.ml === !!rf.ml);
    if (!comForca.length) return { partes: [{ item: its[0], mult: 1 }], duvida: true };
    const S = rf.v;
    const exato = comForca.find(i => Math.abs(i.forca.v - S) < 1e-6);
    if (exato) return { partes: [{ item: exato, mult: 1 }] };
    if (rf.ml) return { partes: [{ item: comForca[0], mult: 1 }], duvida: true, aviso: 'concentração diferente da receita' };
    const fs = comForca.slice().sort((a, b) => b.forca.v - a.forca.v);
    if (S < fs[fs.length - 1].forca.v) return { bloqueio: 'dose menor que a disponível (' + fs[fs.length - 1].forca.v + ' ' + rf.un + ') — não dispensar' };
    // multiplicar um só (ex.: 10 mg = 2 × 5) ou combinar (ex.: 75 = 50 + 25): usa o que dá menos comprimidos
    let mult = null;
    for (const i of fs) { const k = S / i.forca.v; if (Math.abs(k - Math.round(k)) < 1e-6 && k <= 4) { mult = { partes: [{ item: i, mult: Math.round(k) }], n: Math.round(k) }; break; } }
    let rest = S; const partes = [];
    for (const i of fs) { const k = Math.floor((rest + 1e-6) / i.forca.v); if (k > 0) { partes.push({ item: i, mult: k }); rest -= k * i.forca.v; } }
    const comb = Math.abs(rest) < 1e-6 ? { partes, n: partes.reduce((a, p) => a + p.mult, 0) } : null;
    const melhor = mult && (!comb || mult.n <= comb.n) ? mult : comb;
    if (melhor) return { partes: melhor.partes, aviso: 'receita ' + S + ' ' + rf.un + ' = ' + melhor.partes.map(p => p.mult + ' × ' + p.item.forca.v).join(' + ') };
    return { partes: [{ item: fs[0], mult: 1 }], duvida: true, aviso: 'não achei combinação para ' + S + ' ' + rf.un };
  }

  const num = v => { const x = parseFloat(String(v || '').replace(',', '.')); return isNaN(x) ? 0 : x; };
  function calcular(item, mult, p0, avisos) {
    let p = p0;
    const t = item.t || {};
    const cart = num(t.cartela), mlF = num(t.ml) || (item.forma === 'liquido' && item.forca ? 0 : 0);
    const nome = N(item.nome);
    if (item.forma === 'solido') {
      if (p.sos && !p.continuo) return { qtd: num(t.sos) || 20, conta: 'se dor/febre → ' + (num(t.sos) || 20) };
      if (p.unica) { const q = (p.dose || 1) * mult; return { qtd: q, conta: 'dose única = ' + q }; }
      // Sem posologia completa: considera 1 por dia e 60 dias (regra da Kely) e pede conferência
      let dias = p.continuo ? 60 : p.dias, freq = p.freq;
      if (!freq) { freq = 1; avisos.push('sem posologia na receita: considerei 1 vez ao dia'); }
      if (!dias) { dias = 60; avisos.push('sem tempo de uso: considerei 60 dias'); }
      p = { ...p, freq };
      const dose = (p.dose || 1) * mult;
      let q = Math.ceil(dose * p.freq * dias - 1e-9);
      let conta = (dose) + ' × ' + (+p.freq.toFixed(2)) + '/dia × ' + dias + ' dias' + (p.continuo ? ' (uso contínuo)' : '') + ' = ' + q;
      const cx = num(t.caixa), emb = cart > 0 ? cart : cx;
      if (emb > 0 && q % emb) { const q2 = Math.ceil(q / emb) * emb; conta += ' → ' + (cart > 0 ? 'cartela' : 'caixa') + ' de ' + emb + ' → ' + q2; q = q2; }
      if (p.continuo && /DIPIRONA|PARACETAMOL/.test(nome)) avisos.push('uso contínuo: conferir (às vezes 120 / 40)');
      return { qtd: q, conta };
    }
    if (item.forma === 'liquido') {
      if (p.sos && !p.continuo) return { qtd: 1, conta: 'se dor/febre → 1 frasco' };
      const dias = p.continuo ? 60 : p.dias;
      if (p.un === 'ML' && p.freq && dias && mlF) {
        const tot = (p.dose || 0) * p.freq * dias; const q = Math.max(1, Math.ceil(tot / mlF - 1e-9));
        return { qtd: q, conta: p.dose + ' mL × ' + (+p.freq.toFixed(2)) + '/dia × ' + dias + ' dias = ' + (+tot.toFixed(1)) + ' mL → frasco ' + mlF + ' mL → ' + q };
      }
      avisos.push('conferir nº de frascos'); return { qtd: 1, conta: '1 frasco (sem dados para calcular)' };
    }
    avisos.push('conferir quantidade'); return { qtd: 1, conta: '1 unidade' };
  }

  function analisar(texto, lista, tabela) {
    const idx = montarIndice(lista, tabela);
    const linhas = String(texto || '').split(/\r?\n/).map(l => l.trim().replace(/\b([0-9OoSIl]{2,5})(?=\s*(MG|MCG|ML|mg|mcg|ml|UI|%))/g, m => /\d/.test(m) ? m.replace(/[Oo]/g, '0').replace(/S/g, '5').replace(/[Il]/g, '1') : m)).filter(Boolean);
    const blocos = []; let cur = null;
    for (const l of linhas) {
      const n = N(l);
      if (PARE.test(n)) { cur = null; continue; }
      const g = acharGrupo(n, idx);
      if (g) { cur = { prim: n, orig: l, achado: g, resto: [] }; blocos.push(cur); continue; }
      // linha com nome + dosagem que não está na lista (ex.: estriol): vira item 'fora da lista'
      if (/^[^0-9]*[A-Z]{4,}.*\d+(?:[.,]\d+)?\s*(MG|MCG|G\b|UI|%)/.test(n) && !/^(TOMAR|APLICAR|USAR|INGERIR|DAR|PINGAR|1\b|OBS)/.test(n.replace(/^\W+/, ''))) { cur = { prim: n, orig: l, achado: { fora: true }, resto: [] }; blocos.push(cur); continue; }
      if (cur && cur.resto.length < 4) cur.resto.push(n);
    }
    const out = [];
    for (const b of blocos) {
      const corpo = b.resto.join(' ');
      const obs = b.resto.filter(r => /^OBS/.test(r)).join(' ');
      let p = posologia(b.prim + ' ' + corpo);
      if (obs) { const po = posologia(obs); for (const k of Object.keys(po)) if (po[k] && k !== 'un') p[k] = po[k]; if (po.dose) p.un = po.un; }
      const r = { receita: b.orig + (b.resto.length ? ' / ' + b.resto.join(' / ') : ''), itens: [], status: 'ok', avisos: [], conta: '' };
      if (b.achado.fora) { r.status = 'fora_lista'; r.avisos.push('não está na lista da UBS'); out.push(r); continue; }
      if (b.achado.naoTemos) { r.status = 'nao_temos'; r.avisos.push((b.achado.marca.nome) + ': ' + b.achado.marca.temos); out.push(r); continue; }
      if (b.achado.marca) r.avisos.push('nome comercial ' + b.achado.marca.nome + ' → ' + b.achado.marca.generico);
      const e = escolher(b.achado.grupo, b.prim + ' ' + corpo, b.prim);
      if (e.erro || e.bloqueio) { r.status = 'bloqueado'; r.avisos.push(e.erro || e.bloqueio); r.alternativas = b.achado.grupo.itens.map(i => i.code); out.push(r); continue; }
      if (e.aviso) r.avisos.push(e.aviso);
      if (e.duvida) r.avisos.push('conferir apresentação');
      const contas = [];
      for (const pt of e.partes) {
        const c = calcular(pt.item, pt.mult, p, r.avisos);
        r.itens.push({ code: pt.item.code, nome: pt.item.nome, qtd: c.qtd });
        contas.push(c.conta);
      }
      r.conta = contas.join(' | ');
      r.alternativas = b.achado.grupo.itens.map(i => i.code);
      if (r.avisos.length || r.itens.some(i => !i.qtd)) r.status = 'conferir';
      out.push(r);
    }
    return out;
  }
  // junta itens repetidos (o e-SUS não aceita 2 linhas do mesmo remédio)
  function juntar(res) {
    const m = new Map();
    for (const r of res) for (const i of (r.status === 'nao_temos' || r.status === 'bloqueado') ? [] : r.itens) {
      if (!i.qtd) continue;
      if (m.has(i.code)) m.get(i.code).qtd += i.qtd; else m.set(i.code, { ...i });
    }
    return Array.from(m.values());
  }
  return { analisar, juntar, posologia, forma, N };
})();
if (typeof module !== 'undefined') module.exports = ReceitaCore;
