// Fit – store side.
// Sign in with Hugging Face → photo → TRELLIS.2 makes a 3D model → real dimensions → save to catalog.

import { parseGlb, scaleToGlb } from './lib/scale.js';
import { showSize } from './lib/scale-ui.js';
import { toPng } from './lib/image.js';
import { photoTo3D } from './lib/trellis.js';
import { isConfigured, signIn, restoreSession, signOut } from './lib/hf-auth.js';
import { listItems, saveItem, deleteItem } from './lib/catalog.js';

const $ = (id) => document.getElementById(id);
const mv = $('mv');

const state = {
  session: null,
  png: null,          // the photo, converted to PNG
  photoUrl: null,
  source: null,       // loaded 3D scene (never modified)
  baseName: 'model',
  quarterTurns: 0,
  blob: null, blobUrl: null, size: null,
  abort: null,
};

// ---------- sign-in ----------
function renderAccount() {
  const s = state.session;
  $('acctOut').hidden = !!s;
  $('acctIn').hidden = !s;
  $('signIn').disabled = !isConfigured();
  $('notConfigured').hidden = isConfigured();
  if (s) {
    $('userName').textContent = s.user.name || s.user.username;
    $('avatar').src = s.user.picture || '';
    $('avatar').hidden = !s.user.picture;
  }
}

$('signIn').addEventListener('click', () => signIn());
$('signOut').addEventListener('click', () => { signOut(); state.session = null; renderAccount(); });

// ---------- photo → 3D ----------
const ERRORS = {
  quota: (e) => {
    const t = e.retryIn ? ` אפשר לנסות שוב בעוד ${formatWait(e.retryIn)}.` : ' המכסה מתחדשת 24 שעות אחרי השימוש הראשון.';
    return (state.session
      ? 'נגמרה המכסה היומית החינמית של זמן מחשב בחשבון שלך.'
      : 'נגמרה המכסה החינמית למשתמשים לא מחוברים. כדאי להתחבר עם Hugging Face למעלה.') + t;
  },
  busy: () => 'השרת החינמי עמוס כרגע (התור מלא). כדאי לנסות שוב בעוד כמה דקות.',
  down: () => 'לא הצלחנו להתחבר לשרת התלת־ממד. ייתכן שהוא בהפעלה מחדש או שאין חיבור לאינטרנט. נסו שוב בעוד דקה.',
  auth: () => 'ההתחברות פגה. צריך להתחבר שוב עם Hugging Face ולנסות שוב.',
  photo: () => 'לא הצלחנו לפתוח את התמונה. נסי לצלם שוב או לבחור תמונה אחרת (JPG, PNG, HEIC, WebP).',
  model: () => 'הדגם שהתקבל לא נפתח. נסו שוב, או עם תמונה אחרת.',
  other: () => 'משהו השתבש ביצירת הדגם. נסו שוב.',
};

function formatWait(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h >= 1) return `כ־${h} ${h === 1 ? 'שעה' : 'שעות'}`;
  return `כ־${Math.max(1, m)} דקות`;
}

let clock;
function startClock() {
  const t0 = Date.now();
  clearInterval(clock);
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('elapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  clock = setInterval(tick, 1000);
}

function setProgress({ text, fraction }) {
  $('progText').textContent = text;
  const pct = Math.round(fraction * 100);
  $('barFill').style.width = pct + '%';
  document.querySelector('.bar').setAttribute('aria-valuenow', pct);
}

function showError(kind, err) {
  clearInterval(clock);
  $('progress').classList.add('has-error');
  $('errorText').textContent = (ERRORS[kind] || ERRORS.other)(err || {});
  $('errorBox').hidden = false;
  $('cancel').hidden = true;
  $('progText').textContent = 'הדגם לא נוצר';
  $('progSub').hidden = true;
}

function resetProgress() {
  $('progress').classList.remove('has-error');
  $('errorBox').hidden = true;
  $('cancel').hidden = false;
  $('progSub').hidden = false;
  setProgress({ text: 'מתחילים…', fraction: 0.01 });
}

async function onPhoto(file) {
  $('saved').hidden = true;
  $('editStep').hidden = true;
  $('progress').hidden = false;
  resetProgress();
  setProgress({ text: 'מכינים את התמונה', fraction: 0.01 });
  try {
    state.png = await toPng(file);
  } catch (err) {
    console.error(err);
    $('photoThumb').removeAttribute('src');
    showError('photo');
    return;
  }
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = URL.createObjectURL(state.png);
  $('photoThumb').src = state.photoUrl;
  state.baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
  $('guide').open = false;
  await generate();
}

async function generate() {
  if (!state.png) return;
  resetProgress();
  $('progress').hidden = false;
  $('progress').scrollIntoView({ behavior: 'smooth', block: 'start' });
  startClock();
  state.abort = new AbortController();
  let buffer;
  try {
    buffer = await photoTo3D(state.png, {
      token: state.session?.token,
      onProgress: setProgress,
      signal: state.abort.signal,
    });
  } catch (err) {
    if (err.kind === 'aborted') { $('progress').hidden = true; clearInterval(clock); return; }
    if (err.kind === 'auth') { signOut(); state.session = null; renderAccount(); }
    showError(err.kind, err);
    return;
  }
  setProgress({ text: 'הדגם מוכן', fraction: 1 });
  clearInterval(clock);
  const ok = await loadModel(buffer, state.baseName);
  if (ok) $('progress').hidden = true;
  else showError('model');
}

$('photo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) onPhoto(f);
});
$('retry').addEventListener('click', () => (state.png ? generate() : $('photo').click()));
$('newPhoto').addEventListener('click', () => { $('progress').hidden = true; $('guide').open = true; $('photo').click(); });
$('cancel').addEventListener('click', () => state.abort?.abort());

// Manual GLB upload (secondary path).
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  $('saved').hidden = true;
  $('progress').hidden = true;
  state.photoUrl = null;
  const ok = await loadModel(await f.arrayBuffer(), f.name.replace(/\.glb$/i, ''));
  if (!ok) setStatus('הקובץ לא נפתח. ודאי שזה קובץ GLB תקין.', true);
});

// ---------- size, preview, save ----------
function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}
const setLoading = (on) => { $('loading').hidden = !on; };
const readDims = () => ({ w: +$('w').value, d: +$('d').value, h: +$('h').value });
const mode = () => document.querySelector('input[name="mode"]:checked').value;

async function loadModel(buffer, baseName) {
  $('editStep').hidden = false;
  setLoading(true);
  try {
    state.source = await parseGlb(buffer);
  } catch (err) {
    console.error(err);
    setLoading(false);
    $('editStep').hidden = !state.source;
    return false;
  }
  state.baseName = baseName || 'model';
  state.quarterTurns = 0;
  if (!$('name').value) $('name').value = state.baseName;
  await rebuild();
  $('editStep').scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

let busy = false, again = false;
async function rebuild() {
  if (!state.source) return;
  if (busy) { again = true; return; }
  const dims = readDims();
  const needed = mode() === 'stretch' ? [dims.w, dims.d, dims.h] : [dims.w];
  if (needed.some((n) => !(n > 0))) { setStatus('נא להזין מידות גדולות מ־0', true); return; }
  busy = true;
  setLoading(true);
  try {
    const out = await scaleToGlb(state.source, dims, mode(), state.quarterTurns, state.baseName);
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blob = out.blob;
    state.blobUrl = URL.createObjectURL(out.blob);
    state.size = out.size;
    mv.src = state.blobUrl;
    if (mode() === 'fit') { $('d').value = out.size.d; $('h').value = out.size.h; }
    showSize($('sizeChip'), out.size);
    $('download').disabled = false;
    $('arTest').disabled = false;
    $('save').disabled = false;
    setStatus('');
  } catch (err) {
    console.error(err);
    setLoading(false);
    setStatus('לא הצלחנו לעבד את הדגם.', true);
  } finally {
    busy = false;
    if (again) { again = false; rebuild(); }
  }
}
let timer;
const rebuildSoon = () => { clearTimeout(timer); timer = setTimeout(rebuild, 350); };

for (const id of ['w', 'd', 'h']) $(id).addEventListener('input', rebuildSoon);
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
  const fit = mode() === 'fit';
  $('d').disabled = fit; $('h').disabled = fit;
  $('modeHint').textContent = fit ? 'הדגם נשמר בפרופורציות שלו ומותאם לפי הרוחב' : 'כל ציר מותאם בדיוק למידה שהזנת';
  rebuild();
}));
$('rotate').addEventListener('click', () => { state.quarterTurns = (state.quarterTurns + 1) % 4; rebuild(); });
$('arTest').addEventListener('click', () => (mv.canActivateAR ? mv.activateAR() : ($('arHint').hidden = false)));
$('download').addEventListener('click', () => {
  if (!state.blob) return;
  const { w, d, h } = state.size;
  const a = document.createElement('a');
  a.href = state.blobUrl;
  a.download = `${state.baseName}-${w}x${d}x${h}cm.glb`;
  document.body.append(a); a.click(); a.remove();
});

mv.addEventListener('load', () => setLoading(false));
mv.addEventListener('error', () => { setLoading(false); setStatus('התצוגה לא נטענה.', true); });

$('save').addEventListener('click', async () => {
  if (!state.blob || busy) return;
  const name = $('name').value.trim();
  if (!name) { setStatus('נא לתת שם למוצר', true); $('name').focus(); return; }
  $('save').disabled = true;
  try {
    let thumb = null;
    try { thumb = await mv.toBlob({ mimeType: 'image/png', idealAspect: true }); } catch {}
    const item = await saveItem({ name, ...state.size, glb: state.blob, photo: thumb });
    $('savedLink').href = `product.html?id=${encodeURIComponent(item.id)}`;
    $('saved').hidden = false;
    $('saved').scrollIntoView({ behavior: 'smooth', block: 'center' });
    renderMine();
  } catch (err) {
    console.error(err);
    setStatus('השמירה נכשלה. ייתכן שהדפדפן במצב פרטי או שאין מספיק מקום.', true);
  } finally {
    $('save').disabled = false;
  }
});

$('another').addEventListener('click', () => {
  $('saved').hidden = true;
  $('editStep').hidden = true;
  $('name').value = '';
  $('guide').open = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- the store's items ----------
async function renderMine() {
  const ul = $('myItems');
  ul.innerHTML = '';
  for (const item of await listItems()) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `product.html?id=${encodeURIComponent(item.id)}`;
    a.textContent = item.name;
    const size = document.createElement('bdi');
    size.dir = 'ltr';
    size.className = 'hint-inline';
    size.textContent = `${item.w} × ${item.d} × ${item.h}`;
    li.append(a, size);
    if (!item.builtin) {
      const del = document.createElement('button');
      del.className = 'link danger';
      del.type = 'button';
      del.textContent = 'מחיקה';
      del.addEventListener('click', async () => {
        if (!confirm(`למחוק את "${item.name}" מהקטלוג?`)) return;
        await deleteItem(item.id);
        renderMine();
      });
      li.append(del);
    }
    ul.append(li);
  }
}

// ---------- start ----------
(async () => {
  try {
    state.session = await restoreSession();
  } catch (err) {
    console.error(err);
    setStatus('');
    alert('ההתחברות ל־Hugging Face לא הצליחה. נסי שוב.');
  }
  renderAccount();
  renderMine();
})();

window.fit = { state, loadModel, generate };
