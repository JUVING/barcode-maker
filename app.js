'use strict';
const $ = id => document.getElementById(id);
const NATIVE = !!(window.AndroidBridge && AndroidBridge.hasNative && AndroidBridge.hasNative());   // 안드로이드 앱(구글 ML Kit 사용)일 때만 true
// 웹(브라우저) 버전에서만 쓰는 보조 라이브러리: 안드로이드 앱에서는 구글 엔진을 쓰므로 불러오지 않음
const LIBS = { tess: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', zx: 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js' };
function loadLib(url){
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url; s.onload = res;
    s.onerror = () => rej(new Error('필요한 구성요소를 불러오지 못했어요. 인터넷을 확인해 주세요'));
    document.head.append(s);
  });
}
const TYPES = [['QR', 'QR'], ['CODE128', 'Code128'], ['CODE39', 'Code39'], ['DATAMATRIX', 'Data Matrix'], ['PDF417', 'PDF417']];
// 스캔으로 알아낸 코드 종류 → [만들 때 쓸 종류, 표시 이름]
const FMT = {
  qr_code: ['QR', 'QR 코드'], code_128: ['CODE128', 'Code 128'], code_39: ['CODE39', 'Code 39'],
  ean_13: ['EAN13', 'EAN-13'], ean_8: ['EAN8', 'EAN-8'], upc_a: ['UPC', 'UPC-A'], upc_e: ['UPCE', 'UPC-E'],
  itf: ['ITF', 'ITF'], codabar: ['codabar', 'Codabar'], code_93: [null, 'Code 93'],
  data_matrix: ['DATAMATRIX', 'Data Matrix'], pdf417: ['PDF417', 'PDF417'], aztec: [null, 'Aztec']
};
const fmtKey = f => String(f || '').toLowerCase();
const KEY = 'bc_history_v1', MAXHIST = 100;

/* ===== 공통 도구 ===== */
function h(tag, props, ...kids){
  const e = document.createElement(tag);
  for (const k in (props || {})) {
    const v = props[k];
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); });
  return e;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let toastTimer;
function toast(msg, ms = 2400){ const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms); }
function ask(msg){
  return new Promise(res => {
    $('dlgMsg').textContent = msg; $('dlg').classList.add('on');
    const done = v => { $('dlg').classList.remove('on'); res(v); };
    $('dlgYes').onclick = () => done(true); $('dlgNo').onclick = () => done(false);
  });
}
function haptic(){ try { if (navigator.vibrate) navigator.vibrate(60); } catch(e){} }
window.addEventListener('error', e => { console.error(e.error || e.message); toast('문제가 생겼습니다. 다시 시도해 주세요.'); });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); });

/* ===== 저장소 ===== */
function loadHist(){ try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch(e){ return []; } }
function saveHist(list){
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAXHIST))); return true; }
  catch(e){ try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30))); } catch(e2){} return false; }
}
function persist(batch){
  const list = loadHist(), i = list.findIndex(x => x.id === batch.id);
  const clean = { id: batch.id, time: batch.time, src: batch.src || '', title: batch.title || '', pin: !!batch.pin, items: batch.items.filter(x => x.text).map(({ text, type, fmt, ok }) => ({ text, type, fmt, ok })) };
  if (i >= 0) list[i] = clean; else list.unshift(clean);
  saveHist(list);
}
const persistSoon = debounce(b => persist(b), 300);

/* ===== 코드 그리기 (QR / 바코드) ===== */
function drawCode(host, it, big){
  host.replaceChildren();
  if (!it.text) return true;
  try {
    if (it.type === 'DATAMATRIX' || it.type === 'PDF417') {                       // 앱(구글/ZXing)에서만 만들 수 있음
      if (!(NATIVE && AndroidBridge.encode)) return false;
      const b64 = AndroidBridge.encode(it.type, it.text, big ? 640 : 220);
      if (!b64) return false;
      host.append(h('img', { src: 'data:image/png;base64,' + b64, alt: it.type, style: big ? 'width:min(80vw,340px);image-rendering:pixelated' : '' }));
      return true;
    }
    if (it.type === 'QR') {
      const q = qrcode(0, 'M'); q.addData(it.text); q.make();
      host.append(h('img', { src: q.createDataURL(big ? 10 : 4, big ? 2 : 1), alt: 'QR', style: big ? 'width:min(72vw,320px);image-rendering:pixelated' : '' }));
    } else {
      const c = document.createElement('canvas');
      JsBarcode(c, it.type === 'CODE39' ? it.text.toUpperCase() : it.text, {
        format: it.type, width: big ? 3 : 2, height: big ? 120 : 50, displayValue: !!big, fontSize: 20, margin: big ? 8 : 2
      });
      host.append(c);
    }
    return true;
  } catch(e){ return false; }
}

/* ===== 세그먼트(종류 선택) ===== */
function makeSeg(el, value, onChange){
  const api = { value };
  el.replaceChildren(...TYPES.map(([v, label]) => h('button', { 'data-v': v, type: 'button' }, label)));
  api.set = v => { api.value = v; el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); };
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; api.set(b.dataset.v); onChange && onChange(b.dataset.v); };
  api.set(value);
  return api;
}

/* 읽은/입력한 글자를 보여 주는 도우미 (보이지 않는 제어 문자는 작은 배지로 표시) */
const CTL_TXT = t => {
  const f = document.createDocumentFragment();
  for (const ch of String(t)) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) f.append(h('span', { class: 'ctl' }, String.fromCharCode(c === 127 ? 0x2421 : 0x2400 + c)));
    else f.append(ch);
  }
  return f;
};
/* 읽은/입력한 결과는 각 탭에 남기지 않고, 바로 상세 보기로 열면서 히스토리에만 저장한다 (src: 스캔 / 텍스트 인식 / 만들기) */
function showResults(items, src){
  items = items.filter(i => i && i.text).map(i => ({ text: String(i.text), type: i.type || 'QR', warn: !!i.warn, fmt: fmtKey(i.fmt), ok: i.ok }));
  if (!items.length) return false;
  if (window.applyRef) items = window.applyRef(items, src);          // 기준값과 비교(설정한 경우)
  $('toast').classList.remove('on');
  const batch = { id: Date.now(), time: new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), src, items };
  V.onClose = null; openViewer(batch, 0);
  return true;
}

/* ===== 탭 / 오버레이 ===== */
const SRC_ALIAS = { '입력': '만들기', '사진 인식': '텍스트 인식' };         // 옛 기록의 라벨도 새 이름으로 보여 줌
const srcLabel = s => SRC_ALIAS[s] || s || '';
const SUBS = { live: '바코드·QR을 비추면 자동으로 읽어요', manual: '글자를 넣으면 바로 코드로 만들어요', hist: '지금까지 본 코드', settings: '버전 · 스캔 · 보안' };
function show(v, dir){
  if (v !== 'live') { stopScan(true); if (window.liveOff) liveOff(false); }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  $('sub').textContent = v === 'live' ? liveSub() : (SUBS[v] || '');
  if (v === 'hist') renderHist();
  if (v === 'settings') renderSettings();
  renderRecent();
  if (dir) { const el = $('v-' + v); el.classList.remove('in-l', 'in-r'); void el.offsetWidth; el.classList.add(dir > 0 ? 'in-r' : 'in-l'); }
  $('v-' + v).scrollTop = 0; document.querySelector('main').scrollTop = 0;
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.v));

let overlayOpen = null;
function openOverlay(id){ overlayOpen = id; $(id).classList.add('on'); try { history.pushState({ o: id }, ''); } catch(e){} }
function closeOverlay(){ if (history.state && history.state.o) history.back(); else hideOverlays(); }
function hideOverlays(){
  setTimeout(() => { try { renderRecent(); } catch(e){} }, 0);
  if ($('viewer').classList.contains('on') && V.onClose) { const f = V.onClose; V.onClose = null; try { f(); } catch(e){} }
  document.querySelectorAll('.overlay.on').forEach(o => o.classList.remove('on')); overlayOpen = null;
}
window.addEventListener('popstate', hideOverlays);
function closeOverlayThen(fn){                                      // 창을 닫고(히스토리 정리 후) 다음 동작 실행
  if (history.state && history.state.o) { window.addEventListener('popstate', () => setTimeout(fn, 0), { once: true }); history.back(); }
  else { hideOverlays(); fn(); }
}
// 안드로이드 뒤로가기: 열린 화면(상세/영역 지정)이 있으면 그것만 닫고, 없으면 앱 종료
window.__back = () => {
  if (document.querySelector('.overlay.on')) { if (!ocrBusy) closeOverlay(); return true; }
  if (typeof liveActive !== 'undefined' && liveActive) { liveOff(false); return true; }          // 스캔 중 뒤로가기: 앱이 아니라 스캔만 끔
  return false;
};

/* ===== 상세 보기 ===== */
const V = { batch: null, idx: 0, onClose: null };
const vSeg = makeSeg($('vSeg'), 'QR', t => { cur().type = t; redrawSlide(V.idx); syncViewer(); persistSoon(V.batch); });
const cur = () => V.batch.items[V.idx];
const KIND = { DATAMATRIX: 'Data Matrix', PDF417: 'PDF417', QR: 'QR 코드', CODE128: '바코드 (Code 128)', CODE39: '바코드 (Code 39)', EAN13: '바코드 (EAN-13)', EAN8: '바코드 (EAN-8)', UPC: '바코드 (UPC-A)', UPCE: '바코드 (UPC-E)', ITF: '바코드 (ITF)', codabar: '바코드 (Codabar)' };
/* ----- 제목(선택): 히스토리에서 구분하기 쉽게 ----- */
function recentTitles(){
  const seen = new Set(), out = [];
  for (const b of loadHist()) {
    const t = (b.title || '').trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); if (out.length >= 6) break; }
  }
  return out;
}
function setTitleUi(){
  const curTitle = (V.batch.title || '').trim();
  $('vNameIn').value = V.batch.title || '';
  $('vNameChips').replaceChildren(...recentTitles().filter(t => t !== curTitle).map(t =>
    h('button', { class: 'tchip', type: 'button', onclick: () => { V.batch.title = t; persistSoon(V.batch); setTitleUi(); } }, t)));
}
$('vNameIn').addEventListener('input', () => { V.batch.title = $('vNameIn').value.trim().slice(0, 60); persistSoon(V.batch); });
function openViewer(batch, idx){
  V.batch = batch; V.idx = idx || 0; persist(batch);
  setTitleUi();
  buildSlides(); openOverlay('viewer');
  requestAnimationFrame(() => { const S = $('vSlides'); S.scrollLeft = V.idx * S.clientWidth; });
}
function buildSlides(){
  const S = $('vSlides'); S.replaceChildren();
  V.batch.items.forEach(() => S.append(h('div', { class: 'vslide' }, h('div', { class: 'vcode' }))));
  V.batch.items.forEach((_, i) => redrawSlide(i));
  S.scrollLeft = V.idx * S.clientWidth; syncViewer();
}
function redrawSlide(i){
  const s = $('vSlides').children[i]; if (!s) return;
  const it = V.batch.items[i], ok = drawCode(s.firstChild, it, true);
  if (!ok) s.firstChild.replaceChildren(h('div', { class: 'err', style: 'max-width:240px;text-align:center' }, '이 종류로 만들 수 없는 글자가 있어요. 종류를 바꿔 보세요.'));
}
function syncViewer(){
  const n = V.batch.items.length, it = cur();
  $('vTitle').textContent = n > 1 ? `상세 보기  ${V.idx + 1} / ${n}` : '상세 보기';
  $('vKind').textContent = KIND[it.type] || it.type;
  renderRaw(it.text);
  const src = it.fmt && FMT[it.fmt] ? '읽은 종류 ' + FMT[it.fmt][1] : '직접 만든 코드';
  $('vMeta').textContent = `${V.batch.src ? srcLabel(V.batch.src) + ' · ' : ''}${src} · 길이 ${[...it.text].length}자`;
  if (document.activeElement !== $('vText')) $('vText').value = it.text;
  vSeg.set(it.type);
  if (window.renderExtras) window.renderExtras();
  $('vDots').replaceChildren(...(n > 1 && n <= 12 ? V.batch.items.map((_, i) => h('i', { class: i === V.idx ? 'on' : '' })) : []));
}
/* ----- 글자 선택: 위치/길이 보기 (Mid 함수용, 1부터 시작) ----- */
const SEL = { chars: [], a: -1, b: -1, drag: false, anchor: -1, last: 0, lastIdx: -1 };
function getBase(){ try { return localStorage.getItem('bc_base') === '1' ? 1 : 0; } catch(e){ return 0; } }   // 기본: 0부터
function setBase(v){ try { localStorage.setItem('bc_base', String(v)); } catch(e){} }
function updTicks(){                                           // 5자리마다 번호 눈금 (기준에 맞게)
  const base = getBase();
  [...$('vRaw').children].forEach((el, i) => {
    const n = i + base;
    if (n % 5 === 0 && n > 0 || (base === 0 && i === 0)) el.setAttribute('data-n', n); else el.removeAttribute('data-n');
  });
}
function renderRaw(text){
  const box = $('vRaw'); SEL.chars = Array.from(text || ''); SEL.a = SEL.b = -1;
  if (!SEL.chars.length) { box.replaceChildren('(비어 있음)'); showSel(); return; }
  box.replaceChildren(...SEL.chars.map((ch, i) => {
    const c = ch.codePointAt(0), isCtl = c < 32 || c === 127;
    const el = h('span', { class: 'ch', 'data-i': i }, isCtl ? h('span', { class: 'ctl' }, String.fromCharCode(c === 127 ? 0x2421 : 0x2400 + c)) : ch);
    return el;
  }));
  updTicks(); showSel();
}
function selToken(i){                       // 구분 문자(제어문자/공백) 사이의 한 덩어리
  const sep = k => { const c = SEL.chars[k].codePointAt(0); return c < 32 || c === 127 || SEL.chars[k] === ' '; };
  if (sep(i)) return [i, i];
  let a = i, b = i;
  while (a > 0 && !sep(a - 1)) a--;
  while (b < SEL.chars.length - 1 && !sep(b + 1)) b++;
  return [a, b];
}
function baseBar(){
  const base = getBase();
  const mk = (v, label) => h('button', { type: 'button', class: base === v ? 'on' : '', onclick: () => { setBase(v); updTicks(); showSel(); if (window.renderFields) window.renderFields(); } }, label);
  return h('div', { class: 'basebar' }, h('span', {}, '위치 기준'), h('div', { class: 'seg' }, mk(0, '0부터'), mk(1, '1부터')));
}
function showSel(){
  const box = $('vSel'), n = SEL.chars.length, base = getBase();
  box.replaceChildren();
  document.querySelectorAll('#vRaw .ch.sel').forEach(e => e.classList.remove('sel'));
  if (SEL.a < 0) {
    box.append(baseBar(), h('div', { class: 't', style: 'margin-top:8px' }, n ? `전체 ${n}자 · 글자를 누르거나 드래그하면 위치와 길이를 알려 줘요 (두 번 누르면 한 덩어리 선택)` : ''));
    return;
  }
  const lo = Math.min(SEL.a, SEL.b), hi = Math.max(SEL.a, SEL.b), len = hi - lo + 1;
  const start = lo + base, end = hi + base;                      // 화면에 보이는 위치 (기준에 따라 0부터 또는 1부터)
  const kids = $('vRaw').children;
  for (let i = lo; i <= hi; i++) if (kids[i]) kids[i].classList.add('sel');
  const picked = SEL.chars.slice(lo, hi + 1).join('');
  box.append(
    baseBar(),
    h('div', { class: 't', style: 'margin-top:10px' }, '선택한 글자'),
    h('div', { class: 'v' }, CTL_TXT(picked)),
    h('div', { class: 'nums' }, h('span', {}, `시작 위치 ${start}`), h('span', {}, `끝 위치 ${end}`), h('span', {}, `길이 ${len}`), h('span', {}, `전체 ${n}자`)),
    h('div', { class: 'btns' },
      h('button', { class: 'chipbtn', onclick: () => copyText(SEL.chars.join('')) }, '전체 복사'),
      h('button', { class: 'chipbtn', onclick: () => copyText(picked) }, '선택 글자 복사'),
      h('button', { class: 'chipbtn', onclick: () => { SEL.a = SEL.b = -1; showSel(); } }, '선택 해제')));
}
(function(){
  const box = $('vRaw');
  const idxAt = (x, y) => { const t = document.elementFromPoint(x, y), el = t && t.closest ? t.closest('#vRaw .ch') : null; return el ? +el.dataset.i : -1; };
  box.addEventListener('pointerdown', e => {
    const i = idxAt(e.clientX, e.clientY); if (i < 0) return;
    const now = Date.now();
    if (now - SEL.last < 380 && SEL.lastIdx === i) {                       // 두 번 누르기: 한 덩어리 선택
      const [a, b] = selToken(i); SEL.a = a; SEL.b = b; showSel(); SEL.last = 0; return;
    }
    SEL.last = now; SEL.lastIdx = i; SEL.drag = true; SEL.anchor = i; SEL.a = SEL.b = i;
    try { box.setPointerCapture(e.pointerId); } catch(_){}
    showSel();
  });
  box.addEventListener('pointermove', e => {
    if (!SEL.drag) return;
    const i = idxAt(e.clientX, e.clientY); if (i < 0 || i === SEL.b) return;
    SEL.b = i; showSel();
  });
  const end = () => { SEL.drag = false; };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
})();

// 글자/선택 정보 밖의 빈 곳을 누르면 선택 해제
$('viewer').addEventListener('pointerdown', e => {
  if (SEL.a < 0) return;
  if (e.target.closest('#vRaw .ch') || e.target.closest('#vSel')) return;
  SEL.a = SEL.b = -1; showSel();
});
$('vSlides').addEventListener('scroll', debounce(() => {
  if (!V.batch) return;
  const i = Math.max(0, Math.min(V.batch.items.length - 1, Math.round($('vSlides').scrollLeft / $('vSlides').clientWidth)));
  if (i !== V.idx) { V.idx = i; $('vText').value = cur().text; syncViewer(); }
}, 60));
$('vText').oninput = () => { cur().text = $('vText').value.trim(); cur().warn = false; redrawSlide(V.idx); syncViewer(); persistSoon(V.batch); };
$('vX').onclick = closeOverlay;
$('vDel').onclick = async () => {
  if (!(await ask('이 코드를 삭제할까요?'))) return;
  V.batch.items.splice(V.idx, 1);
  if (!V.batch.items.length) { removeBatch(V.batch.id); closeOverlay(); renderHist(); return; }
  V.idx = Math.min(V.idx, V.batch.items.length - 1); persist(V.batch); buildSlides(); $('vText').value = cur().text; syncViewer();
};
async function copyText(t){
  try { if (window.AndroidBridge && AndroidBridge.copy) AndroidBridge.copy(t); else await navigator.clipboard.writeText(t); toast('복사했어요'); }
  catch(e){ toast('복사하지 못했어요'); }
}
$('vCopy').onclick = () => copyText(cur().text);
$('vPng').onclick = async () => {
  const slide = $('vSlides').children[V.idx]; if (!slide) return;
  const el = slide.firstChild.querySelector('canvas,img'); if (!el) return toast('저장할 코드가 없어요');
  try {
    const w = el.naturalWidth || el.width, hh = el.naturalHeight || el.height, sc = Math.max(1, Math.min(3, 800 / w));
    const c = document.createElement('canvas'); c.width = Math.round(w * sc) + 80; c.height = Math.round(hh * sc) + 80;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false; g.drawImage(el, 40, 40, Math.round(w * sc), Math.round(hh * sc));
    const name = 'code_' + Date.now() + '.png';
    if (window.AndroidBridge && AndroidBridge.shareImage) { AndroidBridge.shareImage(c.toDataURL('image/png').split(',')[1], name); return; }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch(e){ if (e.name === 'AbortError') return; } }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: file.name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); toast('저장했어요');
  } catch(e){ toast('이미지를 만들지 못했어요'); }
};

/* ===== 히스토리 ===== */
function removeBatch(id){ saveHist(loadHist().filter(b => b.id !== id)); }
const HS = { sel: false, set: new Set() };
function dayLabel(ts){
  const d = new Date(ts), t = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(t) - day(d)) / 86400000);
  return diff === 0 ? '오늘' : diff === 1 ? '어제' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function pinToggle(id){ const list = loadHist(), x = list.find(b => b.id === id); if (x) { x.pin = !x.pin; saveHist(list); } renderHist(); }
function renderHist(){
  const all = loadHist(), L = $('histList'), q = ($('histQ').value || '').trim().toLowerCase(), has = all.length > 0;
  ['histQ', 'histSel', 'histExp'].forEach(id => $(id).classList.toggle('hidden', !has));
  $('histFoot').classList.toggle('hidden', !has || HS.sel);
  $('histSelBar').classList.toggle('hidden', !(has && HS.sel));
  $('histSel').textContent = HS.sel ? '완료' : '선택';
  if (!has) {
    HS.sel = false; HS.set.clear();
    L.replaceChildren(h('div', { class: 'card empty' }, h('div', { class: 'ico', html: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>' }),
      h('h3', {}, '아직 기록이 없어요'), h('p', { style: 'margin:0' }, '코드를 스캔하거나 만들면 여기에 저장돼요.')));
    return;
  }
  const list = q ? all.filter(b => ((b.title || '') + ' ' + srcLabel(b.src) + ' ' + b.items.map(x => x.text).join(' ')).toLowerCase().includes(q)) : all;
  if (!list.length) { L.replaceChildren(h('div', { class: 'hint', style: 'text-align:center;padding:24px 0' }, '검색 결과가 없어요')); return; }
  const card = b => {
    const thumb = h('div', { class: 'thumb' });
    if (b.items[0]) drawCode(thumb, b.items[0], false);
    const n = b.items.length, okN = b.items.filter(i => i.ok === true).length, badN = b.items.filter(i => i.ok === false).length;
    const meta = h('div', { class: 'meta' },
      h('b', {}, b.title || `${n}개`),
      b.src ? h('span', { class: 'chip', style: 'margin-left:8px' }, srcLabel(b.src)) : null,
      badN ? h('span', { class: 'sumchip ng' }, `불일치 ${badN}`) : (okN ? h('span', { class: 'sumchip ok' }, `일치 ${okN}`) : null),
      h('small', {}, `${b.title ? n + '개 · ' : ''}${b.time}`),
      h('div', { class: 'pv' }, b.items.map(x => x.text).join('  ·  ')));
    let lead = null, tail;
    if (HS.sel) {
      lead = h('span', { class: 'chk' + (HS.set.has(b.id) ? ' on' : '') }, HS.set.has(b.id) ? '✓' : '');
      tail = null;
    } else {
      tail = [h('button', { class: 'star' + (b.pin ? ' on' : ''), 'aria-label': '고정', onclick: ev => { ev.stopPropagation(); pinToggle(b.id); } },
          h('span', { html: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>' })),
        h('button', { class: 'iconbtn', 'aria-label': '삭제', onclick: async ev => { ev.stopPropagation(); if (await ask('이 기록을 삭제할까요?')) { removeBatch(b.id); renderHist(); } } },
          h('span', { html: '<svg class="i" viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>' }))];
    }
    const el = h('div', { class: 'hist' }, lead, thumb, meta, ...(tail || []));
    el.onclick = () => {
      if (HS.sel) { HS.set.has(b.id) ? HS.set.delete(b.id) : HS.set.add(b.id); renderHist(); return; }
      V.onClose = () => renderHist(); openViewer(b, 0);
    };
    return el;
  };
  const frag = [], pinned = list.filter(b => b.pin), rest = list.filter(b => !b.pin);
  if (pinned.length) { frag.push(h('div', { class: 'grp' }, '고정')); pinned.forEach(b => frag.push(card(b))); }
  let last = '';
  rest.forEach(b => { const d = dayLabel(b.id); if (d !== last) { frag.push(h('div', { class: 'grp' }, d)); last = d; } frag.push(card(b)); });
  L.replaceChildren(...frag);
  $('hsDel').textContent = `삭제 ${HS.set.size}`; $('hsExp').textContent = `내보내기 ${HS.set.size}`;
  $('hsDel').disabled = $('hsExp').disabled = HS.set.size === 0;
}
$('histSel').onclick = () => { HS.sel = !HS.sel; HS.set.clear(); renderHist(); };
$('hsCancel').onclick = () => { HS.sel = false; HS.set.clear(); renderHist(); };
$('hsAll').onclick = () => {
  const ids = loadHist().map(b => b.id);
  if (HS.set.size === ids.length) HS.set.clear(); else ids.forEach(i => HS.set.add(i));
  renderHist();
};
$('hsDel').onclick = async () => {
  if (!HS.set.size) return;
  if (!(await ask(`선택한 ${HS.set.size}건을 삭제할까요?`))) return;
  saveHist(loadHist().filter(b => !HS.set.has(b.id))); HS.sel = false; HS.set.clear(); renderHist(); toast('삭제했어요');
};
$('hsExp').onclick = () => { if (HS.set.size) openExport([...HS.set]); };
$('histExp').onclick = () => openExport(null);
$('histClear').onclick = async () => { if (await ask('히스토리를 모두 삭제할까요?')) { saveHist([]); renderHist(); } };

/* ===== ① 스캔 (카메라로 바코드/QR 읽기) ===== */
const HQ = { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } };   // 작은 QR도 읽도록 고해상도
let scStream = null, scTimer = null, scReader = null, scBusy = false;
$('scBtn').onclick = () => { if (NATIVE) return startNativeScan(); if (scBusy) return; (scStream || scReader) ? stopScan(true) : startScan(); };
const SCAN_DELAYS = [[0, '없음'], [500, '0.5초'], [1000, '1초'], [2000, '2초'], [3000, '3초']];
function scanOpts(){
  try { const o = JSON.parse(localStorage.getItem('bc_scan_opts') || '{}'); return { delay: SCAN_DELAYS.some(d => d[0] === o.delay) ? o.delay : 1000, rearm: !!o.rearm, vibrate: o.vibrate !== false, sound: !!o.sound, autoClose: !!o.autoClose }; }
  catch(e){ return { delay: 1000, rearm: false }; }
}
function saveScanOpts(o){ try { localStorage.setItem('bc_scan_opts', JSON.stringify(o)); } catch(e){} }
function startNativeScan(){
  const oo = scanOpts(); oo.ref = window.refForNative ? window.refForNative() : null;     // 기준값 비교 정보도 함께 전달
  if (AndroidBridge.liveStart) return liveOn(oo);                                         // 탭 안에서 바로 카메라 (ROI)
  const o = JSON.stringify(oo);
  if (AndroidBridge.scanLive2) AndroidBridge.scanLive2(o); else AndroidBridge.scanLive();     // 옛 앱 호환
}
/* --- 탭 안의 실시간 카메라: 네이티브 카메라 화면을 camwrap 위치에 겹쳐 보여 줌 --- */
let liveActive = false, liveCodes = [], liveCollectOn = false, liveTorchOn = false, liveTimer = null;
let liveKind = 'code';
function liveRectPx(){ const r = $(liveKind === 'text' ? 'camwrapT' : 'camwrap').getBoundingClientRect(), d = window.devicePixelRatio || 1; return [Math.round(r.left * d), Math.round(r.top * d), Math.round(r.width * d), Math.round(r.height * d)]; }
function liveUi(on){
  $('camwrap').classList.toggle('on', on); $('camwrap').classList.toggle('nlive', on);
  $('livePanel').classList.toggle('hidden', !on);
  document.querySelectorAll('#paneCode .tips,#refCard,#pairCard').forEach(e => e.classList.toggle('hide', on));
  $('liveMode').classList.toggle('hide', on); $('recentLive').classList.toggle('hide', on);
  $('scBtn').classList.toggle('hidden', on); $('pScan').parentElement.classList.toggle('hidden', on);
}
function liveOn(oo){
  liveKind = 'code';
  liveCodes = []; liveTorchOn = false; $('liveZoom').value = 0; renderLive({ n: 0, ok: -1, codes: [] });
  $('liveMode2').textContent = liveCollectOn ? '여러 개 모으기' : '마지막 것만';
  liveUi(true);
  requestAnimationFrame(() => {
    oo.collect = liveCollectOn;
    if (!AndroidBridge.liveStart(JSON.stringify(oo), ...liveRectPx())) { liveUi(false); return toast('카메라를 켤 수 없어요. 카메라 권한을 확인하세요', 3200); }
    liveActive = true;
    clearInterval(liveTimer); let last = '';
    liveTimer = setInterval(() => { if (!liveActive) return; const r = liveRectPx().join(','); if (r !== last) { last = r; AndroidBridge.liveRect(...liveRectPx()); } }, 400);
  });
}
function liveOff(finish){
  if (!liveActive) return;
  liveActive = false; clearInterval(liveTimer);
  try { AndroidBridge.liveStop(); } catch(e){}
  liveUi(false); liveTextUi(false);
  if (finish && liveCodes.length) { haptic(); showResults(liveCodes.map(c => ({ text: c.text, fmt: c.format })), '스캔'); }
}
function renderLive(o){
  liveCodes = o.codes || [];
  const n = o.n || 0, el = $('liveCount');
  el.className = 'livecount';
  if (!n) el.textContent = '코드를 네모 안에 맞추세요';
  else if (o.ok >= 0) { const bad = n - o.ok; el.textContent = bad ? '일치 ' + o.ok + ' · 불일치 ' + bad : '일치 ' + o.ok + '개'; el.classList.add(bad ? 'bad' : 'ok'); }
  else el.textContent = (liveCollectOn ? '누적 ' : '') + n + '개 읽음';
  if (n && o.live === false) { el.className = 'livecount'; el.textContent = n + '개 읽음 · 지금은 코드가 안 보여요'; }          // 아무것도 안 비칠 때 이전 판정이 그대로 남아 보이지 않게
  const l = $('liveList'); l.textContent = '';
  liveCodes.slice(-6).forEach(c => { const d = document.createElement('div'); d.textContent = (c.format || '').toUpperCase().replace(/_/g, ' ') + '  ' + String(c.text).replace(/\x1d/g, '<GS>').replace(/\x1e/g, '<RS>').replace(/\x04/g, '<EOT>').slice(0, 60); l.appendChild(d); });
  $('liveDone').textContent = n ? '완료 (' + n + '개)' : '완료';
}
window.__liveUpdate = json => {
  try { const o = JSON.parse(json); if (o.stopped) { liveActive = false; clearInterval(liveTimer); liveUi(false); liveTextUi(false); return; }
    if (o.shot !== undefined || o.shotError !== undefined) return liveShotDone(o);
    if (liveKind === 'text') return; if (!liveActive) return; renderLive(o); if (o.done) liveOff(true); } catch(e){}
};
$('liveDone').onclick = () => liveOff(true);
$('liveOff').onclick = () => liveOff(false);
$('liveClear').onclick = () => { AndroidBridge.liveClear(); };
$('liveTorch').onclick = () => { liveTorchOn = !liveTorchOn; AndroidBridge.liveTorch(liveTorchOn); };
$('liveZoom').oninput = e => AndroidBridge.liveZoom(+e.target.value / 100);
$('liveMode2').onclick = () => { liveCollectOn = !liveCollectOn; $('liveMode2').textContent = liveCollectOn ? '여러 개 모으기' : '마지막 것만'; AndroidBridge.liveCollect(liveCollectOn); };

/* --- 텍스트 읽기: 탭 안 카메라 + ROI 틀 → 촬영해서 틀 안쪽 글자 읽기 --- */
function liveTextUi(on){
  $('textCam').classList.toggle('hidden', !on); $('camwrapT').classList.toggle('on', on); $('camwrapT').classList.toggle('nlive', on);
  $('textHero').classList.toggle('hide', on); $('liveMode').classList.toggle('hide', on);
  document.querySelectorAll('#paneText .tips').forEach(e => e.classList.toggle('hide', on));
}
function liveTextOn(){
  liveKind = 'text'; liveTorchOn = false; $('liveZoomT').value = 0; $('liveShotT').disabled = false; $('liveShotT').textContent = '촬영해서 읽기';
  liveTextUi(true);
  requestAnimationFrame(() => {
    if (!AndroidBridge.liveStart(JSON.stringify({ mode: 'text' }), ...liveRectPx())) { liveTextUi(false); return toast('카메라를 켤 수 없어요. 카메라 권한을 확인하세요', 3200); }
    liveActive = true;
    clearInterval(liveTimer); let last = '';
    liveTimer = setInterval(() => { if (!liveActive) return; const r = liveRectPx().join(','); if (r !== last) { last = r; AndroidBridge.liveRect(...liveRectPx()); } }, 400);
  });
}
async function liveShotDone(o){
  const btn = $('liveShotT');
  if (o.shotError) { btn.disabled = false; btn.textContent = '촬영해서 읽기'; return toast('촬영하지 못했어요. 다시 눌러 주세요', 2800); }
  try {
    const lines = await nativeOcr(o.shot), found = [];
    lines.forEach(l => { const t = String(l.text || '').replace(/[^A-Za-z0-9\-_.\/]/g, ''); if (t.length >= 4) found.push({ text: t, warn: !validCode(t) }); });
    btn.disabled = false; btn.textContent = '촬영해서 읽기';
    if (!found.length) return toast('글자를 찾지 못했어요. 틀을 글자에 맞추고 다시 찍어 보세요', 3200);
    haptic(); liveOff(false); showResults(found.map(f => ({ text: f.text, warn: f.warn })), '텍스트 인식');
  } catch(err){ btn.disabled = false; btn.textContent = '촬영해서 읽기'; toast('인식 실패: ' + (err && err.message || err), 3200); }
}
$('liveShotT').onclick = () => { $('liveShotT').disabled = true; $('liveShotT').textContent = '읽는 중…'; AndroidBridge.liveShot(); };
$('liveCloseT').onclick = () => liveOff(false);
$('liveTorchT').onclick = () => { liveTorchOn = !liveTorchOn; AndroidBridge.liveTorch(liveTorchOn); };
$('liveZoomT').oninput = e => AndroidBridge.liveZoom(+e.target.value / 100);
const webScan = new Map();                                       // 웹 버전 실시간 스캔: 끄면 한꺼번에 결과로 보여 줌
function onScan(t, f){ if (t && !webScan.has(t)) { webScan.clear(); webScan.set(t, f); haptic(); $('scBtn').textContent = '실시간 스캔 끄기 (읽음)'; } }
function finishWebScan(){ const items = [...webScan].map(([text, fmt]) => ({ text, fmt })); webScan.clear(); if (items.length) showResults(items, '스캔'); }
async function startScan(){
  scBusy = true; $('scBtn').disabled = true;
  const v = $('vid');
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('이 환경에서는 카메라를 쓸 수 없어요');
    let det = null;
    if ('BarcodeDetector' in window) { try { det = new BarcodeDetector(); } catch(e){} }
    if (!det && !window.ZXing) { try { await loadLib(LIBS.zx); } catch(e){} }
    if (det) {
      scStream = await navigator.mediaDevices.getUserMedia({ video: HQ });
      v.srcObject = scStream; await v.play();
      scTimer = setInterval(async () => { try { (await det.detect(v)).forEach(b => onScan(b.rawValue, b.format)); } catch(e){} }, 200);
    } else if (window.ZXing) {
      scReader = new ZXing.BrowserMultiFormatReader();
      await scReader.decodeFromConstraints({ video: HQ }, v, r => { if (r) onScan(r.getText(), (ZXing.BarcodeFormat[r.getBarcodeFormat()] || '').toString()); });
    } else throw new Error('스캔 엔진을 불러오지 못했어요. 인터넷을 확인해 주세요');
    $('camwrap').classList.add('on'); $('scBtn').textContent = '실시간 스캔 끄기';
    setTimeout(tuneCam, 600);
  } catch (e) {
    stopScan();
    toast('카메라를 켤 수 없어요: ' + (e.message || e) + ' (권한을 확인해 주세요)', 3800);
  } finally { scBusy = false; $('scBtn').disabled = false; }
}
async function tuneCam(){
  try {
    const tr = $('vid').srcObject && $('vid').srcObject.getVideoTracks()[0]; if (!tr || !tr.getCapabilities) return;
    const caps = tr.getCapabilities(), apply = c => tr.applyConstraints({ advanced: [c] }).catch(() => {});
    apply({ focusMode: 'continuous' });
    const tools = [];
    if (caps.torch) {
      let on = false; const tb = $('torchBtn'); tb.classList.remove('hidden'); tb.textContent = '조명 켜기';
      tb.onclick = () => { on = !on; apply({ torch: on }); tb.textContent = on ? '조명 끄기' : '조명 켜기'; }; tools.push(1);
    } else $('torchBtn').classList.add('hidden');
    const f = $('focus');
    if (caps.focusDistance) {
      f.min = caps.focusDistance.min; f.max = caps.focusDistance.max; f.step = caps.focusDistance.step || 0.01;
      f.value = (tr.getSettings().focusDistance) || caps.focusDistance.min;
      f.classList.remove('hidden');
      f.oninput = () => apply({ focusMode: 'manual', focusDistance: parseFloat(f.value) });
      $('afBtn').classList.remove('hidden'); $('afBtn').onclick = () => { apply({ focusMode: 'continuous' }); toast('자동 초점으로 되돌렸어요'); }; tools.push(1);
    } else { f.classList.add('hidden'); $('afBtn').classList.add('hidden'); }
    $('camTools').classList.toggle('hidden', !tools.length);
    const z = $('zoom');
    if (caps.zoom) {
      z.min = caps.zoom.min; z.max = caps.zoom.max; z.step = caps.zoom.step || 0.1; z.value = caps.zoom.min; z.classList.remove('hidden');
      z.oninput = () => apply({ zoom: parseFloat(z.value) });
    }
  } catch(e){}
}
function stopScan(fin){
  clearInterval(scTimer); scTimer = null;
  if (scStream) { scStream.getTracks().forEach(t => t.stop()); scStream = null; }
  if (scReader) { try { scReader.reset(); } catch(e){} scReader = null; }
  $('zoom').classList.add('hidden'); $('focus').classList.add('hidden'); $('camTools').classList.add('hidden'); $('camwrap').classList.remove('on');
  const v = $('vid'); try { v.pause(); } catch(e){} v.srcObject = null; $('scBtn').textContent = '실시간 스캔';
  if (fin) finishWebScan();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(true); });

/* --- 안드로이드 앱: 네이티브 스캔 결과 받기 --- */
window.__nativeScan = (json, source) => {
  try {
    const o = JSON.parse(json);
    if (o.error) return toast('읽지 못했어요: ' + o.error, 3600);
    const codes = o.codes || [];
    if (codes.length) { haptic(); showResults(codes.map(c => ({ text: c.text, fmt: c.format })), '스캔'); }
    else if (source === 'photo') toast('코드를 찾지 못했어요. 코드가 크게 나오게 정면에서 다시 찍어 보세요', 3600);
  } catch(e){}
};
/* --- 이미지 스캔: 사진 한 장에서 코드를 전부 찾기 (전체 → 2×2 → 3×3 조각 순서로 시도) --- */
async function detectAll(canvas){
  const found = new Map();
  const det = ('BarcodeDetector' in window) ? (() => { try { return new BarcodeDetector(); } catch(e){ return null; } })() : null;
  if (!det && !window.ZXing) { try { await loadLib(LIBS.zx); } catch(e){} }
  const zx = window.ZXing ? new ZXing.BrowserMultiFormatReader() : null;
  const add = (v, f) => { if (v && !found.has(v)) found.set(v, f); };
  async function run(c){
    if (det) { try { (await det.detect(c)).forEach(b => add(b.rawValue, b.format)); } catch(e){} }
    else if (zx) {
      try { const r = await zx.decodeFromImageUrl(c.toDataURL('image/png')); add(r.getText(), (ZXing.BarcodeFormat[r.getBarcodeFormat()] || '').toString()); } catch(e){}
    }
  }
  await run(canvas);
  for (const n of [2, 3]) {
    const tw = canvas.width / n, th = canvas.height / n, ox = tw * 0.25, oy = th * 0.25;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = Math.max(0, i * tw - ox), y = Math.max(0, j * th - oy), w = Math.min(canvas.width - x, tw + 2 * ox), hh = Math.min(canvas.height - y, th + 2 * oy);
      const t = document.createElement('canvas'); t.width = Math.round(w); t.height = Math.round(hh);
      t.getContext('2d').drawImage(canvas, x, y, w, hh, 0, 0, t.width, t.height);
      await run(t);
    }
    if (det && found.size >= 1 && n === 2) break;          // 네이티브 인식기는 한 번에 여러 개를 찾으므로 3×3 생략(속도)
  }
  return [...found.entries()];
}
let photoBusy = false;
$('pScan').onclick = () => { if (NATIVE) return AndroidBridge.scanPhoto(true); if (!photoBusy) $('cam3').click(); };
$('pGal').onclick = () => { if (NATIVE) return AndroidBridge.scanPhoto(false); if (!photoBusy) $('gal3').click(); };
$('cam3').onchange = $('gal3').onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f || photoBusy) return;
  photoBusy = true; stopScan(); toast('사진에서 코드를 찾는 중…', 30000);
  try {
    const img = await loadImage(f), sc = Math.min(1, 3200 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const res = await detectAll(c);
    if (res.length) { haptic(); showResults(res.map(([text, fmt]) => ({ text, fmt })), '스캔'); }
    else toast('코드를 찾지 못했어요. 코드가 크게 나오게 정면에서 다시 찍어 보세요', 3600);
  } catch(err){ toast('사진을 읽지 못했어요'); }
  finally { photoBusy = false; }
};

/* ===== ② 사진 인식 (영역 지정 → 글자 읽기) ===== */
$('ocrCam').onclick = () => { if (NATIVE && AndroidBridge.liveStart) return liveTextOn(); $('cam').click(); };
$('ocrGal').onclick = () => $('gal').click();
$('ocrNew').onclick = () => $('cam').click();
$('ocrRe').onclick = () => openSel();
$('cam').onchange = $('gal').onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const img = await loadImage(f);
    const sc = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    srcCanvas = c; $('photo').src = c.toDataURL('image/jpeg', .92);
    $('ocrAgain').classList.remove('hidden');
    openSel();
  } catch(err){ toast('사진을 불러오지 못했어요'); }
};
function loadImage(file){
  return new Promise((res, rej) => { const url = URL.createObjectURL(file), i = new Image(); i.onload = () => { URL.revokeObjectURL(url); res(i); }; i.onerror = () => { URL.revokeObjectURL(url); rej(); }; i.src = url; });
}
let srcCanvas = null, selRect = null, worker = null, ocrBusy = false;
function selStatus(t){ $('selMsg').textContent = t; }
function openSel(){
  if (!srcCanvas) return;
  getWorker().catch(() => {});                                   // 드래그하는 동안 엔진 미리 준비
  document.querySelectorAll('#imgwrap .box').forEach(b => b.remove());
  selRect = null; $('selRead').disabled = true;
  selStatus('읽을 부분을 손가락으로 드래그해 네모로 지정하세요');
  if (overlayOpen !== 'sel') openOverlay('sel');
}
$('selX').onclick = $('selCancel').onclick = () => { if (!ocrBusy) closeOverlay(); };
$('selRead').onclick = () => { if (selRect && !ocrBusy) ocrRegion(...selRect); };
async function getWorker(){
  if (typeof Tesseract === 'undefined') await loadLib(LIBS.tess);
  if (!worker) {
    const w = await Tesseract.createWorker('eng', 1, { logger: m => { if (ocrBusy && m.status) selStatus('인식 중… ' + m.status + ' ' + Math.round((m.progress || 0) * 100) + '%'); } });
    await w.setParameters({ user_defined_dpi: '300', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/.', tessedit_pageseg_mode: '7' });
    worker = w;
  }
  return worker;
}
// 드래그로 영역 지정
(function(){
  const wrap = $('imgwrap'); let x0, y0, rect = null, drag = false;
  const pos = e => { const r = wrap.getBoundingClientRect(); return [Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, Math.min(r.height, e.clientY - r.top)), r]; };
  wrap.addEventListener('pointerdown', e => {
    if (!srcCanvas || ocrBusy) return;
    [x0, y0] = pos(e); drag = true; wrap.setPointerCapture(e.pointerId);
    if (rect) rect.remove(); selRect = null; $('selRead').disabled = true;
    rect = h('div', { class: 'box' }); wrap.append(rect);
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return; const [x, y] = pos(e);
    Object.assign(rect.style, { left: Math.min(x, x0) + 'px', top: Math.min(y, y0) + 'px', width: Math.abs(x - x0) + 'px', height: Math.abs(y - y0) + 'px' });
  });
  const end = e => {
    if (!drag) return; drag = false;
    const [x, y, r] = pos(e), w = Math.abs(x - x0), hh = Math.abs(y - y0);
    if (w < 15 || hh < 10) { rect.remove(); selStatus('조금 더 크게 드래그해 주세요'); return; }
    const k = srcCanvas.width / r.width;
    selRect = [Math.min(x, x0) * k, Math.min(y, y0) * k, w * k, hh * k];
    $('selRead').disabled = false; selStatus('맞으면 "이 영역 읽기"를 누르세요. 다시 드래그하면 영역이 바뀝니다');
  };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
})();

const validCode = t => /^[A-Za-z0-9\-_.\/]{6,}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t);
function otsuTh(gr){
  const hist = new Array(256).fill(0), n = gr.length; let sum = 0;
  for (let i = 0; i < n; i++) { hist[gr[i]]++; sum += gr[i]; }
  let wB = 0, sB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}
function mkVariant(gr, W, x0, y0, x1, y1, th){            // th=null 이면 대비 확장 회색
  const pad = 16, w = x1 - x0 + 1, hh = y1 - y0 + 1;
  const c = document.createElement('canvas'); c.width = w + pad * 2; c.height = hh + pad * 2;
  const g = c.getContext('2d'), im = g.createImageData(c.width, c.height), d = im.data;
  let lo = 255, hi = 0;
  if (th === null) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = gr[y * W + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < d.length; i++) d[i] = 255;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const v = gr[(y0 + y) * W + x0 + x], o = ((y + pad) * c.width + x + pad) * 4;
    d[o] = d[o + 1] = d[o + 2] = th === null ? Math.max(0, Math.min(255, (v - lo) * 255 / Math.max(1, hi - lo))) : (v > th ? 255 : 0);
  }
  g.putImageData(im, 0, 0);
  const sc = Math.max(0.5, Math.min(3, 70 / hh));
  const o2 = document.createElement('canvas'); o2.width = Math.round(c.width * sc); o2.height = Math.round(c.height * sc);
  const g2 = o2.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(c, 0, 0, o2.width, o2.height);
  return o2;
}
function mkVariant2(gr, W, x0, y0, x1, y1, blur, delta){   // 줄을 잘라 블러(모아레 제거) 후 줄 단위 이진화
  const w = x1 - x0 + 1, hh = y1 - y0 + 1;
  let a = new Uint8Array(w * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) a[y * w + x] = gr[(y0 + y) * W + x0 + x];
  for (let k = 0; k < blur; k++) {
    const b = new Uint8Array(w * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < hh && xx >= 0 && xx < w) { s += a[yy * w + xx]; n++; } }
      b[y * w + x] = s / n;
    }
    a = b;
  }
  return mkVariant(a, w, 0, 0, w - 1, hh - 1, delta === null ? null : otsuTh(a) + delta);
}
function nativeOcr(b64){
  return new Promise((res, rej) => {
    window.__nativeOcr = j => { try { const o = JSON.parse(j); o.error ? rej(new Error(o.error)) : res(o.lines || []); } catch(e){ rej(e); } };
    AndroidBridge.ocr(b64);
  });
}
async function ocrNative(sx, sy, sw, sh){                       // 안드로이드 앱: 구글 ML Kit 글자 인식
  ocrBusy = true; $('selRead').disabled = true; selStatus('글자 인식 중…');
  try {
    const k = Math.max(1, Math.min(3, 1600 / Math.max(sw, sh)));
    const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    c.getContext('2d').drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const lines = await nativeOcr(c.toDataURL('image/jpeg', .92).split(',')[1]);
    const found = [];
    lines.forEach(l => { const t = String(l.text || '').replace(/[^A-Za-z0-9\-_.\/]/g, ''); if (t.length >= 4) found.push({ text: t, warn: !validCode(t) }); });
    if (!found.length) { selStatus('글자를 찾지 못했어요. 영역을 다시 지정해 주세요'); $('selRead').disabled = false; return; }
    ocrBusy = false; closeOverlayThen(() => showResults(found.map(f => ({ text: f.text, warn: f.warn })), '텍스트 인식'));
  } catch (err) { selStatus('인식 실패: ' + (err && err.message || err)); $('selRead').disabled = false; }
  finally { ocrBusy = false; }
}
async function ocrRegion(sx, sy, sw, sh){
  if (NATIVE) return ocrNative(sx, sy, sw, sh);
  ocrBusy = true; $('selRead').disabled = true; selStatus('인식 준비 중… (처음에는 데이터를 받느라 조금 걸려요)');
  try {
    const up = Math.max(1, Math.min(4, 1200 / sw));
    const base = document.createElement('canvas'); base.width = Math.round(sw * up); base.height = Math.round(sh * up);
    const bg = base.getContext('2d'); bg.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, base.width, base.height);
    const W = base.width, H = base.height, im = bg.getImageData(0, 0, W, H).data;
    const gr = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) gr[i] = (im[i*4] * .299 + im[i*4+1] * .587 + im[i*4+2] * .114) | 0;
    const th = otsuTh(gr);
    // 줄 분리 (가로로 꽉 찬 선은 무시)
    const rowDark = new Array(H).fill(0);
    for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (gr[y * W + x] <= th) n++; rowDark[y] = n > W * 0.7 ? 0 : n; }
    const minDark = Math.max(3, W * 0.008), maxGap = Math.max(4, H * 0.01); let bands = [], s = -1, gap = 0;
    for (let y = 0; y < H; y++) {
      if (rowDark[y] >= minDark) { if (s < 0) s = y; gap = 0; }
      else if (s >= 0 && ++gap > maxGap) { bands.push([s, y - gap]); s = -1; }
    }
    if (s >= 0) bands.push([s, H - 1]);
    bands = bands.filter(b => b[1] - b[0] >= Math.max(12, H * 0.03));
    if (!bands.length) bands = [[0, H - 1]];                     // 줄을 못 나누면 영역 전체를 한 줄로
    const w = await getWorker();
    const found = [];
    for (const [by0, by1] of bands) {
      let bx0 = W, bx1 = 0;
      for (let x = 0; x < W; x++) { let n = 0; for (let y = by0; y <= by1; y++) if (gr[y * W + x] <= th) n++; if (n >= 2) { if (x < bx0) bx0 = x; bx1 = x; } }
      if (bx1 - bx0 < 40) continue;
      const votes = {}, raws = {};
      for (const [bl, dl] of [[0, 0], [1, 0], [0, null], [1, -15], [1, 15], [2, 0]]) {
        const r = await w.recognize(mkVariant2(gr, W, bx0, by0, bx1, by1, bl, dl));
        const txt = r.data.text.replace(/[^A-Za-z0-9\-_.\/]/g, '').toUpperCase();
        if (!validCode(txt)) { if (txt.length >= 4) raws[txt] = (raws[txt] || 0) + 1; continue; }
        const v = votes[txt] || (votes[txt] = { n: 0, c: 0 }); v.n++; v.c += r.data.confidence;
        if (v.n >= 2) break;                                       // 같은 결과가 2번 나오면 종료(속도)
      }
      const ents = Object.entries(votes);
      if (ents.length) {                                           // 같은 길이끼리 글자 위치별 다수결
        const byLen = {}; ents.forEach(([t, v]) => (byLen[t.length] = byLen[t.length] || []).push([t, v]));
        const cnt = g => g.reduce((a, [, v]) => a + v.n, 0);
        const grp = Object.values(byLen).sort((a, b) => cnt(b) - cnt(a))[0];
        let text = '', agree = true;
        for (let i = 0; i < grp[0][0].length; i++) {
          const m = {}; grp.forEach(([t, v]) => m[t[i]] = (m[t[i]] || 0) + v.n * (1 + v.c / 100));
          const keys = Object.keys(m); if (keys.length > 1) agree = false;
          text += keys.sort((a, b) => m[b] - m[a])[0];
        }
        if (validCode(text)) found.push({ text, warn: !agree || cnt(grp) < 2 });
      } else {
        const rk = Object.keys(raws).sort((a, b) => raws[b] - raws[a])[0];
        if (rk) found.push({ text: rk, warn: true });              // 형식이 안 맞아도 원문을 보여주고 직접 고치게 함
      }
    }
    if (!found.length) { selStatus('글자를 찾지 못했어요. 영역을 다시 지정해 주세요'); $('selRead').disabled = false; return; }
    ocrBusy = false; closeOverlayThen(() => showResults(found.map(f => ({ text: f.text, warn: f.warn })), '텍스트 인식'));
  } catch (err) {
    selStatus('인식 실패: ' + (err && err.message || err)); $('selRead').disabled = false;
  } finally { ocrBusy = false; }
}

/* ===== ③ 직접 입력 ===== */
function addManual(t){                                           // 붙여넣기: 띄어쓰기/줄바꿈 기준으로 나눠 한 묶음으로 보여 줌
  const toks = String(t).split(/[\s,;]+/).map(s => s.trim()).filter(s => s.length >= 3);
  if (!toks.length) return toast('붙여넣을 글자가 없어요');
  showResults(toks.map(text => ({ text })), '만들기');
}
$('manAdd').onclick = () => {
  const v = $('manIn').value.trim(); if (!v) return;
  $('manIn').value = ''; updPreview(); showResults([{ text: v }], '만들기');
};
$('manIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('manAdd').click(); });
$('manIn').addEventListener('paste', e => { const t = (e.clipboardData || window.clipboardData).getData('text'); if (t && /[\s,;]/.test(t.trim())) { e.preventDefault(); addManual(t); } });
$('mPaste').onclick = async () => {
  try {
    const t = window.AndroidBridge ? AndroidBridge.getClipboard() : await navigator.clipboard.readText();
    if (!t) return toast('복사된 글자가 없어요');
    addManual(t);
  } catch(e){ $('manIn').focus(); toast('자동 붙여넣기가 막혀 있어요. 입력칸을 길게 눌러 붙여넣어 주세요', 3600); }
};
$('mCam').onclick = () => $('cam2').click();
$('cam2').onchange = e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  const old = $('shotImg').src; if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
  $('shotImg').src = URL.createObjectURL(f); $('shot').classList.remove('hidden'); $('shot').scrollIntoView({ behavior: 'smooth' });
};
$('shotClose').onclick = () => $('shot').classList.add('hidden');

/* ===== 스캔 탭: 코드 읽기 / 텍스트 읽기 전환 ===== */
function getMode(){ try { const m = localStorage.getItem('bc_scan_mode'); return m === 'text' || m === 'pair' ? m : 'code'; } catch(e){ return 'code'; } }
function liveSub(){ const m = getMode(); return m === 'text' ? '사진 속 글자를 읽어요' : m === 'pair' ? '코드 안에 정해진 글자가 모두 있어야 정상이에요' : SUBS.live; }
function setMode(m){
  try { localStorage.setItem('bc_scan_mode', m); } catch(e){}
  $('paneCode').classList.toggle('hidden', m === 'text'); $('pairCard').classList.toggle('hidden', m !== 'pair');
  $('paneText').classList.toggle('hidden', m !== 'text');
  $('liveMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('recentLive').dataset.recent = m === 'text' ? '텍스트 인식' : '스캔';
  if (m === 'text') { stopScan(true); liveOff(false); }
  $('sub').textContent = liveSub();
  renderRecent();
}
$('liveMode').onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); };

/* ===== 최근 기록 (각 탭 아래에 바로 열 수 있게 3개) ===== */
function renderRecent(){
  document.querySelectorAll('[data-recent]').forEach(box => {
    const want = box.dataset.recent;
    const list = loadHist().filter(b => srcLabel(b.src) === want).slice(0, 3);
    box.replaceChildren();
    if (!list.length) return;
    box.append(h('div', { class: 'sec-title' }, '최근 ' + want, h('span', { class: 'sp' }), h('button', { class: 'link', onclick: () => show('hist') }, '전체 보기')),
      ...list.map(b => {
        const thumb = h('div', { class: 'thumb' });
        if (b.items[0]) drawCode(thumb, b.items[0], false);
        const n = b.items.length;
        const card = h('div', { class: 'hist' }, thumb,
          h('div', { class: 'meta' }, h('b', {}, b.title || b.items[0].text.slice(0, 24) || `${n}개`), h('small', {}, `${n}개 · ${b.time}`)));
        card.onclick = () => { V.onClose = null; openViewer(b, 0); };
        return card;
      }));
  });
}

/* ===== 만들기 탭: 제어 문자 넣기 + 미리보기 ===== */
const RS = String.fromCharCode(30), GS = String.fromCharCode(29), EOT = String.fromCharCode(4);
const CTLS = [['헤더 [)>06', '[)>' + RS + '06'], ['GS', GS], ['RS', RS], ['EOT', EOT]];
function insertAtCaret(txt){
  const el = $('manIn'), s = el.selectionStart == null ? el.value.length : el.selectionStart, e = el.selectionEnd == null ? s : el.selectionEnd;
  el.value = el.value.slice(0, s) + txt + el.value.slice(e);
  const p = s + txt.length; try { el.setSelectionRange(p, p); } catch(err){}
  el.focus(); updPreview();
}
function updPreview(){
  const v = $('manIn').value, pv = $('manPrev');
  if (!v) { pv.classList.add('hidden'); return; }
  pv.classList.remove('hidden');
  pv.replaceChildren(h('span', { class: 't' }, `미리보기 · ${[...v].length}자  `), CTL_TXT(v));
}
$('ctlRow').replaceChildren(...CTLS.map(([label, txt]) => h('button', { type: 'button', class: 'tchip', onclick: () => insertAtCaret(txt) }, label)));
$('manIn').addEventListener('input', updPreview);

/* ===== 시작 ===== */
if (NATIVE) {                                                  // 앱에서는 전용 카메라 화면을 쓰므로 웹 카메라 영역은 숨김
  $('scBtn').textContent = '실시간 스캔'; $('scBtn').className = 'btn primary block'; $('pScan').className = 'btn';
}
/* ===== 좌/우로 넘겨서 탭 이동 ===== */
(function(){
  const ORDER = ['live', 'manual', 'hist', 'settings'];
  let x0 = 0, y0 = 0, t0 = 0, ok = false;
  const blocked = t => !!(t.closest && t.closest('input,textarea,select,[role=switch],.camwrap,#imgwrap,.vraw'));     // 좌우 드래그를 쓰는 곳은 제외
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { ok = false; return; }
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    ok = !document.querySelector('.overlay.on, #dlg.on, #dlgT.on, #expM.on') && !blocked(e.target);
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!ok) return; ok = false;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - t0 > 700) return;
    const cur = document.querySelector('#tabs button.on'), i = cur ? ORDER.indexOf(cur.dataset.v) : -1;
    const n = i + (dx < 0 ? 1 : -1);
    if (i < 0 || n < 0 || n >= ORDER.length) return;
    show(ORDER[n], dx < 0 ? 1 : -1);
  }, { passive: true });
})();
document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => show(b.dataset.goto));
show('live'); setMode(getMode());
try { if (NATIVE && AndroidBridge.uiReady) AndroidBridge.uiReady(); } catch(e){}
/* ===== 설정 (버전 / 업데이트 확인 / 개인정보) ===== */
function nativeInfo(){ try { return NATIVE && AndroidBridge.versionInfo ? JSON.parse(AndroidBridge.versionInfo()) : null; } catch(e){ return null; } }
function renderSettings(){
  const info = nativeInfo();
  $('setVer').textContent = info ? `앱 ${info.apk} · 화면 v${info.ui} (${info.source})` : '웹 버전';
  $('updBox').classList.toggle('hidden', !info);
  $('setResetUi').classList.toggle('hidden', !info);
  $('scanSetBox').classList.toggle('hidden', !info);
  const o = scanOpts();
  $('setDelay').replaceChildren(...SCAN_DELAYS.map(([ms, label]) => h('button', { type: 'button', 'data-ms': ms, class: ms === o.delay ? 'on' : '' }, label)));
  $('setRearm').setAttribute('aria-checked', o.rearm ? 'true' : 'false');
  if (window.renderSettingsExtras) window.renderSettingsExtras();
  $('updMsg').textContent = '필요할 때만 확인해요. 서명이 확인된 업데이트만 적용돼요.';
  $('updApply').classList.add('hidden'); $('updCheck').disabled = false;
}
const UPD = { busy: false };
window.__updateStatus = json => {
  let o; try { o = JSON.parse(json); } catch(e){ return; }
  const msg = $('updMsg'); UPD.busy = false; $('updCheck').disabled = false; $('updApply').classList.add('hidden');
  if (o.state === 'checking') { msg.textContent = '업데이트를 확인하는 중…'; $('updCheck').disabled = true; UPD.busy = true; }
  else if (o.state === 'latest') msg.textContent = `최신 버전이에요 (화면 v${o.version}).`;
  else if (o.state === 'available') { msg.textContent = `새 버전 v${o.version}이 있어요. 서명이 올바른 것을 확인했어요.`; $('updApply').classList.remove('hidden'); }
  else if (o.state === 'applying') { msg.textContent = '업데이트를 받는 중…'; $('updCheck').disabled = true; UPD.busy = true; }
  else if (o.state === 'applied') { msg.textContent = `v${o.version} 적용 완료. 화면을 다시 불러와요…`; setTimeout(() => location.reload(), 900); }
  else if (o.state === 'needApk') msg.textContent = '이 업데이트는 앱 설치 파일(APK)을 새로 설치해야 해요.';
  else msg.textContent = '업데이트하지 못했어요: ' + (o.error || '알 수 없는 오류');
};
$('setDelay').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const o = scanOpts(); o.delay = +b.dataset.ms; saveScanOpts(o);
  $('setDelay').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
};
$('setRearm').onclick = () => { const o = scanOpts(); o.rearm = !o.rearm; saveScanOpts(o); $('setRearm').setAttribute('aria-checked', o.rearm ? 'true' : 'false'); };
$('updCheck').onclick = () => { if (!UPD.busy) { window.__updateStatus('{"state":"checking"}'); AndroidBridge.checkUpdate(); } };
$('updApply').onclick = () => { if (!UPD.busy) { window.__updateStatus('{"state":"applying"}'); AndroidBridge.applyUpdate(); } };
$('setResetUi').onclick = async () => { if (await ask('업데이트로 받은 화면을 지우고 앱에 들어 있는 기본 화면으로 되돌릴까요?')) AndroidBridge.resetUi(); };
$('setClearHist').onclick = async () => { if (await ask('히스토리를 모두 삭제할까요?')) { saveHist([]); toast('삭제했어요'); } };

if ('serviceWorker' in navigator && !NATIVE && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(() => {});
