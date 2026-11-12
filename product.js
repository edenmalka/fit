// Fit – customer product page. Shows a saved, already-scaled model; no processing here.
import { getItem, modelUrl } from './lib/catalog.js';
import { showSize } from './lib/scale-ui.js';

const $ = (id) => document.getElementById(id);
const mv = $('mv');
const id = new URLSearchParams(location.search).get('id') || 'demo';

function missing() {
  $('loading').hidden = true;
  $('missing').hidden = false;
  $('title').textContent = 'מוצר לא נמצא';
}

getItem(id).then((item) => {
  if (!item) return missing();
  document.title = `${item.name} – Fit`;
  $('title').textContent = item.name;
  $('dimsText').innerHTML = '';
  const nums = document.createElement('bdi');
  nums.dir = 'ltr';
  nums.textContent = `${item.w} × ${item.d} × ${item.h}`;
  $('dimsText').append('רוחב × עומק × גובה: ', nums, ' ס״מ');
  showSize($('sizeChip'), item);
  mv.alt = `${item.name} בתלת־ממד`;
  mv.src = modelUrl(item);
}).catch((err) => { console.error(err); missing(); });

mv.addEventListener('load', () => { $('loading').hidden = true; $('arBtn').disabled = false; });
mv.addEventListener('error', () => { $('loading').hidden = true; $('dimsText').textContent = 'התצוגה לא נטענה. נסו לרענן את העמוד.'; });
$('arBtn').addEventListener('click', () => (mv.canActivateAR ? mv.activateAR() : ($('arHint').hidden = false)));
