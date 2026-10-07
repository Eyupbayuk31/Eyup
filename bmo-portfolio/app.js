/* ====== AYAR ====== */
const CONFIG = {
  username: 'eyupbayuk31', // GitHub kullanıcı adın
  maxRepos: 8,
  // Elle eklemek/ezmek istediğin projeler: { name, desc, lang, stars, url, demo }
  extra: [],
};
const FALLBACK = [
  { name: 'ornek-proje-1', desc: 'GitHub verisi alınamazsa görünen örnek kaset.', lang: 'JavaScript', stars: 12, url: 'https://github.com/eyupbayuk31' },
  { name: 'ornek-proje-2', desc: 'Kendi projelerini buraya veya CONFIG.extra içine ekle.', lang: 'Python', stars: 5, url: 'https://github.com/eyupbayuk31' },
  { name: 'ornek-proje-3', desc: 'BMO bunu da seve seve oynatır!', lang: 'TypeScript', stars: 9, url: 'https://github.com/eyupbayuk31' },
  { name: 'ornek-proje-4', desc: 'Pomodoro, oyun, araç… ne yaptıysan.', lang: 'HTML', stars: 3, url: 'https://github.com/eyupbayuk31' },
];
const LANG_COLORS = { JavaScript:'#e8c82a', TypeScript:'#3a7bd5', Python:'#3f7fb5', HTML:'#e8553a', CSS:'#7a4fd0', Java:'#c9722a', 'C#':'#3f9a3f', 'C++':'#d04f8a', C:'#7a8a99', Go:'#2fb5c9', Rust:'#b5562a', PHP:'#7a7fc9', Kotlin:'#9a5fe0', Swift:'#f0723a', Dart:'#2aa5d0', Shell:'#4fa84f' };
const colorOf = l => LANG_COLORS[l] || '#ee3f55';

/* ====== YARDIMCILAR ====== */
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ====== SES (WebAudio, dosya yok) ====== */
let ac, muted = false;
function beep(f, d = .08, t = 'square', v = .05, at = 0) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(), s = ac.currentTime + at;
    o.type = t; o.frequency.setValueAtTime(f, s);
    g.gain.setValueAtTime(v, s); g.gain.exponentialRampToValueAtTime(.0001, s + d);
    o.connect(g).connect(ac.destination); o.start(s); o.stop(s + d);
  } catch (e) {}
}
const sfx = {
  move: () => beep(660, .05),
  insert: () => [392, 523, 659, 784, 1046].forEach((f, i) => beep(f, .1, 'square', .05, i * .07)),
  eject: () => [784, 523, 392, 262].forEach((f, i) => beep(f, .1, 'square', .05, i * .06)),
  type: () => beep(880 + Math.random() * 200, .03, 'square', .02),
};

/* ====== YÜZ ====== */
const FACE = `<svg class="face" viewBox="0 0 120 70" aria-hidden="true">
  <ellipse class="eye" cx="38" cy="18" rx="5" ry="7" fill="#1e3b3a"/>
  <ellipse class="eye" cx="84" cy="18" rx="5" ry="7" fill="#1e3b3a"/>
  <path d="M42 40 Q61 56 80 40" fill="none" stroke="#1e3b3a" stroke-width="5" stroke-linecap="round"/></svg>`;

/* ====== DURUM ====== */
let projects = [], carts = [], sel = 0, current = -1, busy = false;
const inner = $('#screenInner'), stub = $('#stub'), slot = $('#slot'), flash = $('#flash');

function idleScreen(extra) {
  inner.innerHTML = FACE;
  const h = el('div', 'hint');
  h.innerHTML = extra ? '' : '<b>BİR KASET SEÇ</b>';
  if (extra) h.textContent = extra;
  inner.append(h);
}

async function loadProjects() {
  let list = [];
  try {
    const r = await fetch(`https://api.github.com/users/${CONFIG.username}/repos?per_page=100&sort=pushed`);
    if (!r.ok) throw 0;
    const data = await r.json();
    list = data.filter(x => !x.fork).sort((a, b) => (b.stargazers_count - a.stargazers_count) || (new Date(b.pushed_at) - new Date(a.pushed_at)))
      .slice(0, CONFIG.maxRepos)
      .map(x => ({ name: x.name, desc: x.description || 'Açıklama yok.', lang: x.language, stars: x.stargazers_count, url: x.html_url, demo: x.homepage || '' }));
    $('#status').textContent = list.length ? 'GitHub projelerim kaset oldu. Birini BMO’ya tak!' : '';
  } catch (e) {}
  list = [...CONFIG.extra, ...list];
  if (!list.length) { list = FALLBACK; $('#status').textContent = 'Örnek kasetler (GitHub’a ulaşılamadı). Birini BMO’ya tak!'; }
  return list;
}

function buildCart(p, i) {
  const b = el('button', 'cart'); b.style.setProperty('--c', colorOf(p.lang)); b.style.setProperty('--i', i);
  b.setAttribute('role', 'listitem'); b.setAttribute('aria-label', `${p.name} kasetini tak`);
  const inn = el('div', 'cart-in'), lbl = el('div', 'lbl');
  lbl.append(el('div', 'ico', (p.lang || p.name).slice(0, 2).toUpperCase()), el('div', 'nm', p.name.toUpperCase().slice(0, 18)));
  inn.append(lbl, el('div', 'notch')); b.append(inn);
  b.addEventListener('mouseenter', () => select(i, true));
  b.addEventListener('click', () => { select(i, true); insert(i); });
  return b;
}

function select(i, quiet) {
  if (!projects.length) return;
  sel = (i + projects.length) % projects.length;
  carts.forEach((c, k) => c.classList.toggle('sel', k === sel));
  if (!quiet) sfx.move(); else if (current < 0) sfx.move();
  if (current < 0 && !busy) idleScreen('▶ ' + projects[sel].name);
}

/* kaset uçuş animasyonu (in: slota, out: yerine) */
async function fly(i, dir) {
  const src = carts[i], r = src.getBoundingClientRect(), s = slot.getBoundingClientRect();
  const f = src.cloneNode(true); f.classList.add('fly'); f.classList.remove('sel', 'away');
  Object.assign(f.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  document.body.append(f);
  const tx = s.left + s.width * .32 - (r.left + r.width / 2), ty = s.top - 6 - (r.top + r.height / 2);
  const kf = [
    { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
    { transform: `translate(${tx * .5}px,${ty - 90}px) rotate(-14deg) scale(.8)`, opacity: 1, offset: .5 },
    { transform: `translate(${tx}px,${ty - 24}px) rotate(0) scale(.5)`, opacity: 1, offset: .82 },
    { transform: `translate(${tx}px,${ty}px) rotate(0) scale(.42)`, opacity: 0 },
  ];
  const a = f.animate(kf, { duration: 900, easing: 'ease-in-out', fill: 'forwards', direction: dir === 'out' ? 'reverse' : 'normal' });
  await a.finished; f.remove();
}

async function insert(i) {
  if (busy || i === current) return;
  busy = true;
  if (current >= 0) await doEject(true);
  sfx.insert();
  carts[i].classList.add('away');
  inner.innerHTML = ''; inner.append(el('div', 'loading', 'OKUNUYOR'));
  await fly(i, 'in');
  stub.style.background = colorOf(projects[i].lang); stub.classList.add('in');
  flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  current = i;
  await wait(350);
  showProject(projects[i]);
  busy = false;
}

async function doEject(silent) {
  if (current < 0) return;
  const i = current; current = -1;
  if (!silent) busy = true;
  sfx.eject();
  stub.classList.remove('in');
  inner.innerHTML = ''; inner.append(el('div', 'loading', 'ÇIKARILIYOR'));
  await fly(i, 'out');
  carts[i].classList.remove('away');
  idleScreen('▶ ' + projects[sel].name);
  if (!silent) busy = false;
}
const eject = () => { if (!busy) doEject(false); };

function showProject(p) {
  inner.innerHTML = '';
  const box = el('div', 'proj');
  box.append(el('h2', '', p.name));
  const d = el('p'); box.append(d);
  const meta = el('div', 'meta');
  const lang = el('span'); const dot = el('i', 'dot'); dot.style.background = colorOf(p.lang);
  lang.append(dot, document.createTextNode(p.lang || '—')); meta.append(lang, el('span', '', '★ ' + (p.stars || 0)));
  const links = el('div', 'links');
  const a = el('a', '', 'REPO'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; links.append(a);
  if (p.demo) { const b = el('a', '', 'DEMO'); b.href = /^https?:/.test(p.demo) ? p.demo : 'https://' + p.demo; b.target = '_blank'; b.rel = 'noopener'; links.append(b); }
  box.append(meta, links); inner.append(box);
  // daktilo efekti
  const txt = p.desc.slice(0, 110) + (p.desc.length > 110 ? '…' : ''); let n = 0;
  const t = setInterval(() => { d.textContent = txt.slice(0, ++n); if (n % 2) sfx.type(); if (n >= txt.length) clearInterval(t); }, 28);
}

/* ====== KONTROLLER ====== */
function press(node) { node && (node.classList.add('press'), setTimeout(() => node.classList.remove('press'), 120)); }
$('#bmo').addEventListener('click', e => {
  const dp = e.target.closest('.dp'); if (dp) { press(dp.parentNode); select(sel + (+dp.dataset.dir)); return; }
  const b = e.target.closest('.btn'); if (!b) return; press(b);
  if (b.dataset.action === 'insert') insert(sel);
  if (b.dataset.action === 'eject') eject();
});
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
  else if (e.key === 'Enter' && document.activeElement.tagName !== 'A') { e.preventDefault(); insert(sel); }
  else if (e.key === 'Escape' || e.key.toLowerCase() === 'b') eject();
});
$('#mute').addEventListener('click', e => { muted = !muted; e.currentTarget.classList.toggle('off', muted); });

/* ====== BAŞLAT ====== */
(async function init() {
  $('#ghLink').href = 'https://github.com/' + CONFIG.username; $('#ghLink').textContent = 'github.com/' + CONFIG.username;
  idleScreen();
  projects = await loadProjects();
  const L = $('#sideL'), R = $('#sideR');
  projects.forEach((p, i) => { const c = buildCart(p, i); carts.push(c); (i % 2 ? R : L).append(c); });
  select(0, true);
})();
