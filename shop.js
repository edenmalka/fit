// Fit – customer catalog. No sign-in, no GPU.
import { listItems, modelUrl } from './lib/catalog.js';

const grid = document.getElementById('grid');

function card(item) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `product.html?id=${encodeURIComponent(item.id)}`;

  const media = document.createElement('div');
  media.className = 'card-media';
  if (item.photo) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(item.photo);
    img.alt = '';
    media.append(img);
  } else {
    // No picture saved: show a still 3D view instead.
    const mv = document.createElement('model-viewer');
    mv.src = modelUrl(item);
    mv.setAttribute('camera-orbit', '-28deg 76deg auto');
    mv.setAttribute('environment-image', 'neutral');
    mv.setAttribute('tone-mapping', 'commerce');
    mv.setAttribute('shadow-intensity', '1');
    mv.setAttribute('interaction-prompt', 'none');
    mv.setAttribute('loading', 'eager');
    mv.alt = item.name;
    media.append(mv);
  }

  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('strong');
  name.textContent = item.name;
  const size = document.createElement('span');
  size.className = 'card-size';
  const nums = document.createElement('bdi');
  nums.dir = 'ltr';
  nums.textContent = `${item.w} × ${item.d} × ${item.h}`;
  size.append(nums, ' ס״מ');
  body.append(name, size);

  a.append(media, body);
  li.append(a);
  return li;
}

listItems().then((items) => grid.replaceChildren(...items.map(card)));
