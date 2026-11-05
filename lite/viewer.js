'use strict';
const element = id => document.getElementById(id);
const scenes = window.tourScenes || [];
const canvas = element('canvas');
const context = canvas.getContext('2d', {alpha: false});
const still = element('still');
const room = element('room');
const message = element('message');
const caption = element('caption');
const original = element('original');
const view = element('view');
const fingers = new Map();
let mode = 'panorama';
let source, yaw = 0, pitch = 0, zoom = 1, offsetX = 0, offsetY = 0;
let loadRevision = 0;
let scheduled = false;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const imageCache = new Map();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (mode === 'panorama' && source) drawPanorama();
    if (mode !== 'panorama') still.style.transform =
      'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + zoom + ')';
  });
}

function drawPanorama() {
  const width = Math.max(1, Math.min(fingers.size ? 480 : 820, view.clientWidth));
  const height = Math.max(1, Math.round(width * view.clientHeight / view.clientWidth));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const frame = context.createImageData(width, height);
  const pixels = frame.data;
  const {data, width: sourceWidth, height: sourceHeight} = source;
  const scale = Math.tan(Math.PI / 6) / zoom;
  const yawCos = Math.cos(yaw), yawSin = Math.sin(yaw);
  const pitchCos = Math.cos(pitch), pitchSin = Math.sin(pitch);
  for (let row = 0, out = 0; row < height; row++) {
    const y = (1 - 2 * (row + 0.5) / height) * scale;
    const rotatedY = y * pitchCos + pitchSin;
    const rotatedZ = y * pitchSin - pitchCos;
    for (let col = 0; col < width; col++, out += 4) {
      const x = (2 * (col + 0.5) - width) * scale / height;
      const rayX = x * yawCos + rotatedZ * yawSin;
      const rayZ = -x * yawSin + rotatedZ * yawCos;
      const u = Math.atan2(rayX, -rayZ) / (2 * Math.PI) + 0.5;
      const v = 0.5 - Math.asin(clamp(rotatedY / Math.hypot(x, y, 1), -1, 1)) / Math.PI;
      const sx = Math.floor(u * sourceWidth) % sourceWidth;
      const sy = clamp(Math.floor(v * sourceHeight), 0, sourceHeight - 1);
      const pixel = (sy * sourceWidth + sx) * 4;
      pixels[out] = data[pixel];
      pixels[out + 1] = data[pixel + 1];
      pixels[out + 2] = data[pixel + 2];
      pixels[out + 3] = 255;
    }
  }
  context.putImageData(frame, 0, 0);
}

function loadPixels(path) {
  if (imageCache.has(path)) return imageCache.get(path);
  const task = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scratch = document.createElement('canvas');
        scratch.width = image.naturalWidth;
        scratch.height = image.naturalHeight;
        const painter = scratch.getContext('2d');
        painter.drawImage(image, 0, 0);
        resolve(painter.getImageData(0, 0, scratch.width, scratch.height));
      } catch (error) { reject(error); }
    };
    image.onerror = reject;
    image.src = path;
  });
  imageCache.set(path, task);
  task.catch(() => imageCache.delete(path));
  while (imageCache.size > 3) imageCache.delete(imageCache.keys().next().value);
  return task;
}

function reset() {
  yaw = scenes[Number(room.value)]?.initialYaw || 0;
  pitch = 0;
  zoom = 1;
  offsetX = offsetY = 0;
  schedule();
}

async function show(modeName) {
  mode = modeName;
  const revision = ++loadRevision;
  ['panorama', 'top', 'rear'].forEach(id =>
    element(id).setAttribute('aria-pressed', String(mode === id)));
  room.disabled = mode !== 'panorama' || !scenes.length;
  still.style.transform = '';
  canvas.hidden = true;
  source = null;
  reset();
  if (mode !== 'panorama') {
    still.src = 'lite/' + mode + '.jpg';
    caption.textContent = mode === 'top' ? '整屋俯视' : '后院鸟瞰';
    still.alt = caption.textContent;
    original.href = mode + '.jpg';
    original.hidden = false;
    message.textContent = '可以放大图片查看细节。';
    return;
  }
  const index = Number(room.value);
  const scene = scenes[index];
  if (!scene) { show('top'); return; }
  original.href = scene.image;
  original.hidden = true;
  caption.textContent = '全景加载中';
  message.textContent = '正在打开 ' + scene.name + '…';
  try {
    const pixels = await loadPixels(scene.image);
    if (revision !== loadRevision) return;
    source = pixels;
    caption.textContent = scene.name.replaceAll('_', ' · ');
    if (context) {
      canvas.hidden = false;
      schedule();
      message.textContent = '拖动环视，双指缩放。';
    } else {
      still.src = scene.image;
      still.alt = scene.name + '全景展开图';
      original.hidden = false;
      message.textContent = '当前设备可查看全景展开图。';
    }
  } catch {
    if (revision !== loadRevision) return;
    still.src = 'lite/top.jpg';
    caption.textContent = '整屋俯视';
    message.textContent = '当前全景未加载，请点「360° 全景」重试，或查看整屋俯视。';
  }
}

function changeZoom(factor) {
  zoom = clamp(zoom * factor, 1, 3.5);
  if (zoom === 1) offsetX = offsetY = 0;
  schedule();
}

view.addEventListener('pointerdown', event => {
  if (!source && (mode === 'panorama' || zoom === 1)) return;
  view.setPointerCapture(event.pointerId);
  fingers.set(event.pointerId, [event.clientX, event.clientY]);
});
view.addEventListener('pointermove', event => {
  const previous = fingers.get(event.pointerId);
  if (!previous) return;
  const other = [...fingers.entries()].find(([id]) => id !== event.pointerId)?.[1];
  const next = [event.clientX, event.clientY];
  fingers.set(event.pointerId, next);
  if (other) {
    const distance = point => Math.hypot(point[0] - other[0], point[1] - other[1]);
    changeZoom(distance(next) / Math.max(1, distance(previous)));
  } else {
    const dx = next[0] - previous[0], dy = next[1] - previous[1];
    if (mode === 'panorama') {
      yaw += dx * 0.004 / zoom;
      pitch = clamp(pitch + dy * 0.004 / zoom, -Math.PI / 2, Math.PI / 2);
    } else {
      offsetX = clamp(offsetX + dx, -view.clientWidth * (zoom - 1) / 2, view.clientWidth * (zoom - 1) / 2);
      offsetY = clamp(offsetY + dy, -view.clientHeight * (zoom - 1) / 2, view.clientHeight * (zoom - 1) / 2);
    }
    schedule();
  }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  view.addEventListener(name, event => { fingers.delete(event.pointerId); schedule(); });
}
canvas.addEventListener('keydown', event => {
  if (!event.key.startsWith('Arrow')) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft') yaw += 0.1;
  if (event.key === 'ArrowRight') yaw -= 0.1;
  if (event.key === 'ArrowUp') pitch = clamp(pitch + 0.1, -Math.PI / 2, Math.PI / 2);
  if (event.key === 'ArrowDown') pitch = clamp(pitch - 0.1, -Math.PI / 2, Math.PI / 2);
  schedule();
});
for (const name of ['panorama', 'top', 'rear']) element(name).onclick = () => show(name);
element('zoomIn').onclick = () => changeZoom(1.25);
element('zoomOut').onclick = () => changeZoom(0.8);
element('reset').onclick = reset;
room.onchange = () => show('panorama');
window.addEventListener('resize', schedule);
room.replaceChildren(...scenes.map((scene, index) => new Option(
  scene.floor + ' · ' + scene.name.replace(/^室外_|^[一二三]层_/, '').replace(/_门位修正_v32|_v34/g, ''),
  index)));
show(scenes.length ? 'panorama' : 'top');
