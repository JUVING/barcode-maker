'use strict';
/* =====================================================================
 * 추가 기능 모음 (app.js 뒤에 불러옴)
 *  1) 글자 입력 창        2) 기준값 비교        3) 필드 분해 + 형식 검사
 *  4) 내보내기 / 백업 / 복원   5) 만들기 템플릿    6) 설정(진동·소리·자동 열기)
 * ===================================================================== */

/* ---------- 1) 글자 입력 창 ---------- */
function askText(msg, value){
  return new Promise(res => {
    $('dlgTMsg').textContent = msg;
    const inp = $('dlgTIn'); inp.value = value || '';
    $('dlgT').classList.add('on'); setTimeout(() => inp.focus(), 60);
    const done = v => { $('dlgT').classList.remove('on'); res(v); };
    $('dlgTYes').onclick = () => done(inp.value.trim());
    $('dlgTNo').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim()); };
  });
}
const store = {
  get(k, d){ try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
function setSwitch(el, on){ el.setAttribute('aria-checked', on ? 'true' : 'false'); }
function isOn(el){ return el.getAttribute('aria-checked') === 'true'; }

/* ---------- 2) 기준값 비교 ---------- */
const REF_MODES = [['equals', '전체 일치'], ['contains', '포함'], ['starts', '시작 일치']];
const ctlNorm = s => String(s).replace(/\x1d/g, '<GS>').replace(/\x1e/g, '<RS>').replace(/\x04/g, '<EOT>');
function getRef(){
  const o = store.get('bc_ref', {});
  return { on: !!o.on, list: String(o.list || ''), mode: REF_MODES.some(m => m[0] === o.mode) ? o.mode : 'equals' };
}
const refLines = r => r.list.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
function matchRef(text, r){
  const lines = refLines(r); if (!lines.length) return null;
  const n = ctlNorm(text);
  return lines.some(l => r.mode === 'contains' ? n.includes(l) : r.mode === 'starts' ? n.startsWith(l) : n === l);
}
/* 이종 검사: 한 줄에 한 규칙, '+' 로 연결 (예: A100 + A101). 코드 한 개 안에 규칙의 글자가 모두 들어 있어야 정상 (규칙이 여럿이면 하나만 맞아도 정상) */
function getPair(){ const o = store.get('bc_pair', {}); return { on: getMode() === 'pair', text: String(o.text || '') }; }       // '이종 검사' 탭일 때만 적용
const pairGroups = p => p.text.split(/\r?\n/).map(l => l.split('+').map(s => s.trim()).filter(Boolean)).filter(g => g.length >= 2);
window.applyRef = (items, src) => {                         // 읽은 결과에 일치 여부(ok)를 붙임 (만들기는 제외)
  const r = getRef(), p = getPair(), lines = r.on ? refLines(r) : [], groups = p.on ? pairGroups(p) : [];
  if ((!lines.length && !groups.length) || src === '만들기') return items;
  const all = items.map(i => ctlNorm(i.text));
  return items.map(i => {
    const n = ctlNorm(i.text), miss = [];
    const base = lines.length ? matchRef(i.text, r) === true : true;
    const hit = groups.filter(g => g.some(t => n.includes(t))), unk = groups.length > 0 && !hit.length;       // 규칙에 없는 코드는 불일치
    const lack = g => g.filter(t => !n.includes(t));                                                      // 코드 한 개 안에 규칙의 글자가 모두 있어야 정상
    if (hit.length && !hit.some(g => !lack(g).length)) lack(hit.slice().sort((x, y) => lack(x).length - lack(y).length)[0]).forEach(t => miss.push(t));
    return Object.assign({}, i, { ok: base && !miss.length && !unk }, miss.length ? { miss } : {}, unk ? { unk: true } : {});
  });
};
window.refForNative = () => {
  const r = getRef(), p = getPair(), lines = r.on ? refLines(r) : [], groups = p.on ? pairGroups(p) : [];
  return (lines.length || groups.length) ? { mode: r.mode, list: lines, pairs: groups } : null;
};

function pairSummary(){
  const p = getPair(), n = pairGroups(p).length;
  $('pairSum').textContent = n ? '규칙 ' + n + '개: ' + pairGroups(p).slice(0, 2).map(g => g.join(' + ')).join(' / ') + (n > 2 ? ' …' : '') : '규칙이 없어요. 규칙 설정을 눌러 추가하세요';
}
function initRef(){
  const r = getRef();
  setSwitch($('refOn'), r.on); $('refBody').classList.toggle('hidden', !r.on); $('refList').value = r.list;
  $('refMode').replaceChildren(...REF_MODES.map(([v, l]) => h('button', { type: 'button', 'data-v': v, class: r.mode === v ? 'on' : '' }, l)));
  $('refOn').onclick = () => { const o = getRef(); o.on = !o.on; store.set('bc_ref', o); setSwitch($('refOn'), o.on); $('refBody').classList.toggle('hidden', !o.on); };
  $('refList').addEventListener('input', () => { const o = getRef(); o.list = $('refList').value; store.set('bc_ref', o); });
  $('refMode').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const o = getRef(); o.mode = b.dataset.v; store.set('bc_ref', o);
    $('refMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  };
  pairSummary();
  $('pairSet').onclick = () => { $('pairIn').value = getPair().text; $('pairM').classList.add('on'); setTimeout(() => $('pairIn').focus(), 60); };
  $('pairNo').onclick = () => $('pairM').classList.remove('on');
  $('pairClear').onclick = () => { $('pairIn').value = ''; };
  $('pairFileBtn').onclick = () => $('pairFile').click();
  $('pairFile').onchange = e => {                                  // CSV/텍스트 파일의 규칙을 읽어 목록에 추가 (저장을 눌러야 적용)
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('파일이 너무 커요 (2MB 이하)');
    const rd = new FileReader();
    rd.onload = () => {
      const txt = String(rd.result || '').replace(/^\uFEFF/, '');
      const rows = txt.split(/\r?\n/).map(l => l.split(/[,;\t+]/).map(c => c.replace(/^"+|"+$/g, '').trim()).filter(Boolean)).filter(c => c.length >= 2);
      if (rows.length && /^(규칙|조건|rule|rules|code|코드)$/i.test(rows[0][0])) rows.shift();         // 제목 줄은 건너뜀
      const have = new Set($('pairIn').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean)), add = [];
      rows.slice(0, 3000).forEach(c => { const line = c.join(' + '); if (!have.has(line)) { have.add(line); add.push(line); } });
      if (!add.length) return toast('불러올 규칙이 없어요. 한 줄에 글자 2개 이상이 필요해요', 3200);
      const cur = $('pairIn').value.trim(); $('pairIn').value = (cur ? cur + '\n' : '') + add.join('\n');
      toast(add.length + '개 규칙을 불러왔어요. 저장을 눌러야 적용돼요', 3200);
    };
    rd.onerror = () => toast('파일을 읽지 못했어요');
    rd.readAsText(f, 'utf-8');
  };
  $('pairYes').onclick = () => {
    const o = getPair(); o.text = $('pairIn').value.trim(); store.set('bc_pair', { text: o.text });
    pairSummary(); $('pairM').classList.remove('on');
  };
}
initRef();

function renderCheck(){
  const box = $('vCheck'), it = cur();
  if (it.ok === undefined) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden'); box.classList.toggle('bad', it.ok === false);
  const r = getRef(), lines = refLines(r);
  const kids = [h('b', {}, it.ok ? '검사 통과' : (it.miss && it.miss.length || it.unk ? '이종 검사 불일치' : '기준값과 불일치'))];
  if (it.unk) kids.push(h('div', { class: 'cs' }, '이종 검사 규칙에 없는 코드'));
  if (it.miss && it.miss.length) kids.push(h('div', { class: 'cs' }, '코드 안에 없는 글자: ' + it.miss.join(', ')));
  if (it.ok === false && lines.length) kids.push(h('div', { class: 'cs' }, '기준: ' + lines.slice(0, 3).join(' / ') + (lines.length > 3 ? ' …' : '')));
  box.replaceChildren(...kids);
}

/* ---------- 3) 필드 분해 + 형식 검사 (GS/RS 기준) ---------- */
const DI_NAMES = { P: '품번', '1P': '공급사 품번', V: '공급업체', '1V': '제조업체', S: '일련번호', '3S': '포장 일련번호', T: '추적/로트', '1T': '로트 번호',
  Q: '수량', K: '구매오더', '1K': '주문 번호', C: '국가', '4L': '원산지 국가', '20L': '내부 관리', '9D': '제조일자(YYWW)', D: '일자', L: '위치', '7Q': '무게', '2P': '개정 번호' };
const getNames = () => store.get('bc_fieldnames', {});
function parseSegs(text){
  const chars = Array.from(text), segs = []; let start = 0;
  for (let i = 0; i <= chars.length; i++) {
    const c = chars[i];
    if (i === chars.length || c === '\x1d' || c === '\x1e' || c === '\x04') {
      if (i > start) segs.push({ start, end: i - 1, text: chars.slice(start, i).join('') });
      start = i + 1;
    }
  }
  return segs;
}
function renderFields(){
  const box = $('vFields'), it = cur(), text = it.text || '';
  const segs = parseSegs(text);
  if (!/[\x1d\x1e]/.test(text) || segs.length < 2) { box.classList.add('hidden'); box.replaceChildren(); return; }
  const iso = /^\[\)>\x1e\d\d\x1d/.test(text), base = getBase(), names = getNames();
  const chips = [];
  if (text.startsWith('[)>')) {
    const headOk = iso, tailOk = text.endsWith('\x1e\x04');
    chips.push(h('span', { class: 'fchip ' + (headOk ? 'ok' : 'ng') }, (headOk ? '✓ ' : '✗ ') + '헤더 [)>RS 06 GS'));
    chips.push(h('span', { class: 'fchip ' + (tailOk ? 'ok' : 'ng') }, (tailOk ? '✓ ' : '✗ ') + '종료 RS EOT'));
  }
  chips.push(h('span', { class: 'fchip' }, `구분 ${segs.length}칸`));
  const rows = segs.map((s, idx) => {
    let di = '', data = s.text, label = '';
    if (iso && idx === 0) label = '헤더';
    else if (iso && idx === 1) label = '형식 코드';
    else { const m = /^(\d{0,2}[A-Z])([\s\S]*)$/.exec(s.text); if (m) { di = m[1]; data = m[2]; } }
    const name = label || (di && (names[di] || DI_NAMES[di])) || '';
    const len = Array.from(s.text).length;
    const nameBtn = h('button', { type: 'button', class: 'fname' + (name ? '' : ' empty'), onclick: async ev => {
      ev.stopPropagation();
      if (!di) return;
      const v = await askText(`'${di}' 필드 이름`, names[di] || DI_NAMES[di] || '');
      if (v === null) return;
      const n = getNames(); if (v) n[di] = v; else delete n[di]; store.set('bc_fieldnames', n); renderFields();
    } }, name || (di ? '이름 붙이기' : ''));
    const row = h('div', { class: 'frow', onclick: () => { SEL.a = s.start; SEL.b = s.end; showSel(); $('vRaw').scrollIntoView({ block: 'nearest' }); } },
      h('div', { class: 'ftop' }, di ? h('span', { class: 'fdi' }, di) : null, nameBtn,
        h('span', { class: 'fpos' }, `위치 ${s.start + base}~${s.end + base} · 길이 ${len}`)),
      h('div', { class: 'fval' }, data ? CTL_TXT(data) : h('i', {}, '(비어 있음)')));
    return row;
  });
  box.classList.remove('hidden');
  box.replaceChildren(h('div', { class: 't' }, '필드 분해 (GS·RS 기준) — 누르면 해당 글자가 선택돼요'), h('div', { class: 'fchips' }, ...chips), ...rows);
}
window.renderFields = renderFields;
window.renderExtras = () => { renderCheck(); renderFields(); };

/* ---------- 4) 내보내기 / 백업 / 복원 ---------- */
const ctlVisible = s => String(s).replace(/[\x00-\x1f\x7f]/g, c => ({ '\x1d': '<GS>', '\x1e': '<RS>', '\x04': '<EOT>', '\x1c': '<FS>', '\x1f': '<US>' }[c] || '<0x' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0') + '>'));
// CSV 수식 주입 방어: 엑셀이 수식으로 실행할 수 있는 시작 글자(= + @ 탭 줄바꿈, 숫자가 아닌 -)는 앞에 ' 를 붙여 글자로 취급되게 함
const csvSafe = v => (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\d+(\.\d+)?$/.test(v))) ? "'" + v : v;
const csvCell = v => { v = csvSafe(String(v)); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const TYPE_NAME = { QR: 'QR', CODE128: 'Code128', CODE39: 'Code39', DATAMATRIX: 'DataMatrix', PDF417: 'PDF417' };
const okText = ok => ok === true ? '일치' : ok === false ? '불일치' : '';
function cleanBatch(b){
  return { id: b.id, time: b.time, src: srcLabel(b.src), title: b.title || '', pin: !!b.pin,
    items: b.items.map(i => ({ text: i.text, type: i.type, fmt: i.fmt || '', ok: i.ok })) };
}
function buildExport(list, fmt, ctl){
  const T = s => ctl ? ctlVisible(s) : String(s);
  if (fmt === 'json') return JSON.stringify({ app: 'barcode-reader', version: 1, exported: new Date().toISOString(), history: list.map(cleanBatch) }, null, 1);
  if (fmt === 'csv') {
    const rows = [['제목', '출처', '시간', '종류', '일치', '길이', '값']];
    list.forEach(b => b.items.forEach(i => rows.push([b.title || '', srcLabel(b.src), b.time, TYPE_NAME[i.type] || i.type, okText(i.ok), Array.from(i.text).length, T(i.text)])));
    return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  return list.map(b => `[${b.title || '제목 없음'}] ${srcLabel(b.src)} · ${b.time}\n` + b.items.map(i => `${TYPE_NAME[i.type] || i.type}\t${okText(i.ok) ? okText(i.ok) + '\t' : ''}${T(i.text)}`).join('\n')).join('\n\n') + '\n';
}
function shareFile(name, content, mime){
  if (window.AndroidBridge && AndroidBridge.shareText) { AndroidBridge.shareText(content, name, mime); return; }
  const url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); toast('파일로 저장했어요');
}
const EXP = { ids: null, fmt: 'csv', scope: 'all' };
const EXP_FMT = [['csv', 'CSV (엑셀)'], ['txt', '텍스트'], ['json', '백업 파일']];
function openExport(ids, fmt){
  EXP.ids = ids && ids.length ? ids : null; EXP.fmt = fmt || EXP.fmt; EXP.scope = EXP.ids ? 'sel' : 'all';
  const draw = () => {
    $('expFmt').replaceChildren(...EXP_FMT.map(([v, l]) => h('button', { type: 'button', 'data-v': v, class: EXP.fmt === v ? 'on' : '' }, l)));
    const n = loadHist().length;
    $('expScope').replaceChildren(
      h('button', { type: 'button', 'data-v': 'all', class: EXP.scope === 'all' ? 'on' : '' }, `전체 ${n}건`),
      ...(EXP.ids ? [h('button', { type: 'button', 'data-v': 'sel', class: EXP.scope === 'sel' ? 'on' : '' }, `선택 ${EXP.ids.length}건`)] : []));
    $('expCtlRow').classList.toggle('hidden', EXP.fmt === 'json');
  };
  draw();
  $('expFmt').onclick = e => { const b = e.target.closest('button'); if (b) { EXP.fmt = b.dataset.v; draw(); } };
  $('expScope').onclick = e => { const b = e.target.closest('button'); if (b) { EXP.scope = b.dataset.v; draw(); } };
  $('expM').classList.add('on');
}
$('expNo').onclick = () => $('expM').classList.remove('on');
$('expGo').onclick = () => {
  let list = loadHist();
  if (EXP.scope === 'sel' && EXP.ids) { const s = new Set(EXP.ids); list = list.filter(b => s.has(b.id)); }
  if (!list.length) return toast('내보낼 기록이 없어요');
  const p = n => String(n).padStart(2, '0'), d = new Date();
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const ext = { csv: 'csv', txt: 'txt', json: 'json' }[EXP.fmt], mime = { csv: 'text/csv', txt: 'text/plain', json: 'application/json' }[EXP.fmt];
  const name = (EXP.fmt === 'json' ? 'barcode-backup-' : 'barcode-history-') + stamp + '.' + ext;
  shareFile(name, buildExport(list, EXP.fmt, isOn($('expCtl'))), mime);
  $('expM').classList.remove('on');
};
$('expCtl').onclick = () => setSwitch($('expCtl'), !isOn($('expCtl')));

const TYPES_OK = new Set(['QR', 'CODE128', 'CODE39', 'DATAMATRIX', 'PDF417', 'EAN13', 'EAN8', 'UPC', 'UPCE', 'ITF', 'codabar']);
function validateBackup(o){                                      // 복원 파일 검사: 형식·크기를 엄격히 확인하고 안전한 값만 남김
  if (!o || o.app !== 'barcode-reader' || !Array.isArray(o.history)) throw new Error('이 앱의 백업 파일이 아니에요');
  if (o.history.length > 3000) throw new Error('기록이 너무 많아요');
  const out = [];
  for (const b of o.history) {
    if (!b || typeof b !== 'object' || !Number.isFinite(b.id) || !Array.isArray(b.items) || b.items.length > 500) continue;
    const items = b.items.filter(i => i && typeof i.text === 'string' && i.text.length > 0 && i.text.length <= 4000)
      .map(i => ({ text: i.text, type: TYPES_OK.has(i.type) ? i.type : 'QR', fmt: typeof i.fmt === 'string' ? i.fmt.slice(0, 20) : '', ok: typeof i.ok === 'boolean' ? i.ok : undefined }));
    if (!items.length) continue;
    out.push({ id: b.id, time: String(b.time || '').slice(0, 40), src: String(b.src || '').slice(0, 20), title: String(b.title || '').slice(0, 60), pin: !!b.pin, items });
  }
  return out;
}
$('bkExport').onclick = () => openExport(null, 'json');
$('bkImport').onclick = () => $('bkFile').click();
$('bkFile').onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    if (f.size > 8 * 1024 * 1024) throw new Error('파일이 너무 커요');
    const incoming = validateBackup(JSON.parse(await f.text()));
    if (!incoming.length) throw new Error('불러올 기록이 없어요');
    if (!(await ask(`백업에서 ${incoming.length}건을 불러올까요? (이미 있는 기록은 그대로 두고, 없는 것만 추가해요)`))) return;
    const cur = loadHist(), have = new Set(cur.map(b => b.id)), add = incoming.filter(b => !have.has(b.id));
    saveHist(cur.concat(add).sort((a, b) => b.id - a.id));
    toast(`${add.length}건을 추가했어요`); renderHist();
  } catch (err) { toast('불러오지 못했어요: ' + (err && err.message || err), 3600); }
};

/* ---------- 5) 만들기 템플릿 ---------- */
const getTpls = () => store.get('bc_templates', []).filter(t => t && typeof t.name === 'string' && typeof t.text === 'string');
function renderTpls(){
  const list = getTpls(), row = $('tplRow');
  if (!list.length) { row.replaceChildren(h('span', { class: 'hint', style: 'margin:0' }, '자주 쓰는 형식을 저장해 두면 한 번에 불러올 수 있어요')); return; }
  row.replaceChildren(...list.map(t => {
    let timer = null, long = false;
    const chip = h('button', { type: 'button', class: 'tchip' }, t.name);
    const start = () => { long = false; timer = setTimeout(async () => { long = true; if (await ask(`'${t.name}' 템플릿을 삭제할까요?`)) { store.set('bc_templates', getTpls().filter(x => x.name !== t.name)); renderTpls(); } }, 650); };
    const stop = () => clearTimeout(timer);
    chip.addEventListener('pointerdown', start); chip.addEventListener('pointerup', stop); chip.addEventListener('pointerleave', stop); chip.addEventListener('pointercancel', stop);
    chip.addEventListener('click', () => { if (long) return; $('manIn').value = t.text; updPreview(); $('manIn').focus(); });
    return chip;
  }));
}
$('tplSave').onclick = async () => {
  const v = $('manIn').value; if (!v) return toast('저장할 내용을 먼저 입력해 주세요');
  const name = await askText('템플릿 이름', ''); if (!name) return;
  const list = getTpls().filter(t => t.name !== name); list.unshift({ name: name.slice(0, 30), text: v.slice(0, 2000) });
  store.set('bc_templates', list.slice(0, 30)); renderTpls(); toast('템플릿을 저장했어요');
};
renderTpls();

/* ---------- 6) 설정: 진동 / 소리 / 바로 열기 ---------- */
function loadScanExtra(){ const o = store.get('bc_scan_opts', {}); return { vibrate: o.vibrate !== false, sound: !!o.sound, autoClose: !!o.autoClose }; }
window.renderSettingsExtras = () => { const x = loadScanExtra(); setSwitch($('setVib'), x.vibrate); setSwitch($('setSound'), x.sound); setSwitch($('setAuto'), x.autoClose); };
[['setVib', 'vibrate'], ['setSound', 'sound'], ['setAuto', 'autoClose']].forEach(([id, key]) => {
  $(id).onclick = () => { const o = store.get('bc_scan_opts', {}); const cur = key === 'vibrate' ? o.vibrate !== false : !!o[key]; o[key] = !cur; store.set('bc_scan_opts', o); setSwitch($(id), !cur); };
});


/* ---------- 7) 라이선스 잠금 + 최신 버전 강제 ---------- */
let licMode = '';
function licCopy(){ const id = $('licId').textContent; if (!id) return; try { AndroidBridge.copyDeviceId(); toast('기기 ID를 복사했어요'); } catch(e){} }
$('licCopy').onclick = licCopy; $('licCopy2').onclick = licCopy;
function licApply(st){
  if (!st || st.ok === undefined) return;
  $('licId').textContent = st.id || ''; $('licId2').textContent = st.id || '';
  const lastTxt = st.lastCheck ? new Date(st.lastCheck).toLocaleString('ko-KR') : '아직 없음';
  $('licState').textContent = (st.configured ? (st.ok ? '인증됨' : '인증 필요') : '라이선스 없음(개발용)') + ' · 마지막 업데이트 확인: ' + lastTxt;
  const lock = $('lockScr');
  if (st.ok) { lock.classList.remove('on'); licMode = ''; return; }
  const r = st.reason; licMode = r;
  const T = {
    license: ['라이선스 인증', '이 앱을 사용하려면 개발자 비밀번호로 인증해 주세요.'],
    revoked: ['사용이 중지된 기기', '이 기기는 라이선스가 회수되었어요. 관리자에게 문의하세요.'],
    update: ['업데이트가 필요해요', '최신 버전이 아니면 사용할 수 없어요. 업데이트를 받는 중이에요.'],
    apk: ['새 앱 설치가 필요해요', '앱 설치 파일(APK)을 새 버전으로 다시 설치해 주세요. 관리자에게 문의하세요.'],
    offline: ['업데이트 확인이 필요해요', '오랫동안 최신 버전 확인을 하지 못했어요. 인터넷에 연결한 뒤 확인해 주세요.']
  }[r] || ['사용할 수 없어요', '관리자에게 문의하세요.'];
  $('lockTitle').textContent = T[0]; $('lockMsg').textContent = T[1];
  $('lockPw').classList.toggle('hidden', r !== 'license');
  $('lockUp').classList.toggle('hidden', !(r === 'update' || r === 'offline'));
  $('lockSt').textContent = st.wait ? st.wait + '초 뒤에 다시 시도할 수 있어요' : '';
  lock.classList.add('on');
  if (r === 'update') licUpdate();
}
function licRefresh(){
  if (!NATIVE) {
    $('licState').textContent = '웹(브라우저) 버전이에요. 라이선스 확인은 안드로이드 앱에서만 해요'; const r = document.querySelector('#licBox .lockid'); if (r) r.classList.add('hidden');
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;                  // 개발용(내 PC)만 예외
    licMode = 'web'; $('lockTitle').textContent = '안드로이드 앱에서만 사용할 수 있어요';
    $('lockMsg').textContent = '이 프로그램은 설치한 앱에서만 쓸 수 있어요. 앱 설치 파일은 관리자에게 받으세요.';
    $('lockPw').classList.add('hidden'); $('lockUp').classList.add('hidden'); const li = document.querySelector('#lockScr .lockid'); if (li) li.classList.add('hidden');
    $('lockScr').classList.add('on'); return;
  }
  if (!AndroidBridge.licenseState) {                       // 라이선스 기능이 없는 옛 앱: 업데이트로 받은 화면이 사용을 막음
    $('licState').textContent = '이 앱 버전은 라이선스 확인을 지원하지 않아요. 최신 앱(APK)을 새로 설치해 주세요';
    licMode = 'oldapp'; $('lockTitle').textContent = '새 앱 설치가 필요해요';
    $('lockMsg').textContent = '이 앱은 예전 버전이라 더 사용할 수 없어요. 기존 앱 위에 최신 설치 파일(APK)을 덮어 설치해 주세요. 관리자에게 받으세요.';
    $('lockPw').classList.add('hidden'); $('lockUp').classList.add('hidden'); const li = document.querySelector('#lockScr .lockid'); if (li) li.classList.add('hidden');
    $('lockScr').classList.add('on'); return;
  }
  try { licApply(JSON.parse(AndroidBridge.licenseState())); } catch(e){}
}
let licUpBusy = false;
function licUpdate(){ if (licUpBusy) return; licUpBusy = true; $('lockSt').textContent = '업데이트 확인 중…'; try { AndroidBridge.checkUpdate(); } catch(e){ licUpBusy = false; } }
$('lockUpBtn').onclick = () => { licUpBusy = false; licUpdate(); };
$('lockGo').onclick = () => {
  const pw = $('lockIn').value; if (!pw) return;
  $('lockGo').disabled = true; $('lockSt').textContent = '확인 중…';
  setTimeout(() => {
    let r = {}; try { r = JSON.parse(AndroidBridge.licenseActivate(pw)); } catch(e){}
    $('lockGo').disabled = false;
    if (r.ok) { $('lockIn').value = ''; $('lockSt').textContent = ''; licRefresh(); toast('인증되었어요'); }
    else { $('lockIn').value = ''; $('lockSt').textContent = (r.msg || '인증하지 못했어요'); }
  }, 30);
};
$('lockIn').onkeydown = e => { if (e.key === 'Enter') $('lockGo').click(); };
// 업데이트 상태가 올 때마다(자동 확인 포함) 잠금 상태를 다시 확인하고, 잠금 화면에서는 업데이트를 자동으로 받아 적용
(function(){
  const orig = window.__updateStatus;
  window.__updateStatus = json => {
    if (orig) orig(json);
    let o = {}; try { o = JSON.parse(json); } catch(e){}
    if (licMode === 'update' || licMode === 'offline') {
      if (o.state === 'available') { try { AndroidBridge.applyUpdate(); } catch(e){} $('lockSt').textContent = '업데이트를 받는 중…'; return; }
      if (o.state === 'applied') { setTimeout(() => location.reload(), 300); return; }
      if (o.state === 'needApk') { licUpBusy = false; licRefresh(); return; }
      if (o.state === 'error') { licUpBusy = false; $('lockSt').textContent = '업데이트에 실패했어요: ' + (o.error || '') ; return; }
      licUpBusy = false;
    }
    licRefresh();
  };
})();
licRefresh();
