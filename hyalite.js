/*!
 * hyalite v0.1.0 — real refraction "liquid glass" for the web.
 * https://github.com/VII-Cae/hyalite--liquid-glass · MIT © 2026 VII-Cae
 *
 * How it works
 *   The element is treated as a slab of glass with a rounded bevel along its edge.
 *   For its exact size and corner radii we compute a displacement map (R = x offset,
 *   G = y offset, B = rim light), feed it to an SVG filter (feImage → feGaussianBlur →
 *   feDisplacementMap → rim light), and let the browser bend whatever is *behind* the
 *   element through `backdrop-filter: url(#…)`. Only Chromium runs SVG backdrop filters;
 *   everywhere else the CSS fallback in `var(--hyalite, blur(6px))` takes over.
 *
 * Usage
 *   CSS:  .glass { backdrop-filter: var(--hyalite, blur(6px)); -webkit-backdrop-filter: var(--hyalite, blur(6px)); }
 *   JS:   Hyalite.watch(document.body, '.glass', { bevel: 16, thickness: 10, blur: 3 });
 *         Hyalite.attach(el, opts) / Hyalite.detach(el)     // manual
 *         Hyalite.setOpts({ blur: 1 })                        // retune everything, returns a Promise
 *         Hyalite.info()                                      // { maxDisplacement, bevel, mapSize } of the last build
 *         Hyalite.supported()                                 // true only on Chromium
 *
 * Options
 *   bevel        width of the bent zone along the edge, px (clamped to the corner radius)
 *   thickness    glass thickness, px — drives how far the edge pulls the backdrop inward
 *   blur         frost in the centre, px (feGaussianBlur stdDeviation)
 *   dispersion   chromatic aberration, 0–0.16 (0 = single pass, cheaper)
 *   rim          geometry-aware edge light, 0–1.6 (0 = off)
 *   materialize  ms — on first build, ramp displacement + rim from 0 (Apple's "materialize")
 *   self         true when the element uses `filter:` on itself instead of `backdrop-filter`
 *                (displacement only: no blur, no dispersion, no rim — see notes below)
 *   onBuild(info) called after every map build
 *
 * Three rules learned the hard way (each one leaves a visible artifact if broken)
 *   1. Displacement must not fold: the decay slope is capped at MAX_SLOPE px/px. At 1 the
 *      sampling point stands still (infinite stretch); above 1 the image mirrors and you get
 *      doubled lines along the rim.
 *   2. Bevel ≤ corner radius: past that the field reaches the SDF's medial axis, where the
 *      direction flips and every corner grows a diagonal crease.
 *   3. Direction is taken from a larger rounded rect (radius + bevel), so the turn from
 *      "pull down" to "pull right" is spread along a longer arc — otherwise corners look like a ridge.
 *
 * Notes
 *   · `self` mode exists because the 3-pass dispersion sum is only valid for opaque sources.
 *     On a translucent layer alpha is added three times and clamped, which darkens the colour.
 *   · `--hyalite` is an inherited custom property: consume it only on the attached element.
 *   · Maps for large elements are downsampled (MAX_MAP_PX); the field is smooth, feImage
 *     stretches it back without visible loss.
 *   · Sizes come from offsetWidth/Height (layout box, transform-proof); % radii are supported.
 *   · Nothing is written when unsupported (Firefox reports support but paints nothing for
 *     backdrop-filter:url(), Safari silently drops the SVG part), so the CSS fallback wins.
 *   · Respects prefers-reduced-motion (no materialize).
 *   · feImage uses a data: URL — a strict CSP needs `img-src data:`.
 */
(function (root) {
  'use strict';
  if (root.Hyalite) return;

  const N_GLASS = 1.5;             // refractive index of ordinary glass
  const MAX_SLOPE = 0.85;          // max decay slope of the displacement (see rule 1)
  const LIGHT = norm(-0.35, -1);   // light from the upper left (screen y points down)
  const DEFAULTS = { bevel: 16, thickness: 10, blur: 3, dispersion: 0.05, rim: 0.45, materialize: 0, self: false };
  const REBUILD_MIN_MS = 90;       // throttle for elements that keep resizing (streaming text)
  const MAX_MAP_PX = 320000;       // ≈ 565×565: larger elements get a downsampled map

  let host = null;                 // hidden <svg> holding every <filter>
  let seq = 0;
  const filters = new Map();       // key → { id, refs, el, dms, rim }
  const bound = new Map();         // element → { key, opts, ro, timer, pending, last, byWatcher }
  let watcher = null;
  let lastInfo = null;

  function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

  function ensureHost() {
    if (host) return host;
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.setAttribute('aria-hidden', 'true');
    // must not be display:none — Blink ignores <filter>s inside a display:none <svg>
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);
    return host;
  }

  /* Signed distance to a rounded rect with per-corner radii (negative inside). r = [tl, tr, br, bl] */
  function makeSDF(W, H, r) {
    const cx = W / 2, cy = H / 2;
    return (x, y) => {
      const dx = x - cx, dy = y - cy;
      const R = dx < 0 ? (dy < 0 ? r[0] : r[3]) : (dy < 0 ? r[1] : r[2]);
      const qx = Math.abs(dx) - (W / 2 - R), qy = Math.abs(dy) - (H / 2 - R);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - R;
    };
  }

  /* Refraction profile (Snell's law): a slab of thickness T0 with a quarter-circle bevel of
     width and height B. A vertical view ray refracts toward the surface normal at the bevel,
     then travels through the remaining glass to the backdrop: offset = thickness × tan(α − β). */
  function profile(depth, B, T0) {
    const u = Math.min(1, Math.max(0, 1 - depth / B));
    const s = Math.sqrt(Math.max(1e-6, 1 - u * u));
    const alpha = Math.min(Math.atan(u / s), 1.40);          // surface tilt, capped near 80°
    const beta = Math.asin(Math.sin(alpha) / N_GLASS);
    return { disp: (T0 + B * s) * Math.tan(alpha - beta), tilt: Math.sin(alpha) };
  }

  /* Build the map. Returns { url, maxd, size } */
  function buildMap(W, H, radii, o) {
    // Clamp the bevel to the *largest* corner: a small corner (e.g. a 6px "tail" on a chat
    // bubble) must not flatten the refraction along the whole edge.
    const rMax = Math.max(1, ...radii);
    const B = Math.max(1, Math.min(o.bevel, rMax, Math.floor(Math.min(W, H) / 2) - 1));
    // Displacement table with the no-fold constraint, built from the inner edge outward
    const STEP = 0.25, N = Math.ceil(B / STEP);
    const tab = new Float64Array(N + 1); tab[N] = 0;
    for (let i = N - 1; i >= 0; i--) tab[i] = Math.min(profile(i * STEP, B, o.thickness).disp, tab[i + 1] + MAX_SLOPE * STEP);
    const MAXD = Math.max(tab[0], 1e-6);
    const mAt = (d) => { const f = Math.min(N - 1e-6, d / STEP), i = Math.floor(f), u = f - i; return tab[i] * (1 - u) + tab[i + 1] * u; };
    const sdf = makeSDF(W, H, radii);
    const cap = Math.min(W, H) / 2 - 0.5;
    const sdfDir = makeSDF(W, H, radii.map((R) => Math.min(R + B, cap)));   // rule 3
    // Downsampling: map pixel (x, y) ↔ CSS pixel ((x+.5)/k, (y+.5)/k); offsets stay in CSS px
    const k = Math.min(1, Math.sqrt(MAX_MAP_PX / (W * H)));
    const MW = Math.max(2, Math.round(W * k)), MH = Math.max(2, Math.round(H * k));
    const c = document.createElement('canvas'); c.width = MW; c.height = MH;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(MW, MH), d = img.data;
    const e = 0.5;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const px = (x + .5) / k, py = (y + .5) / k;
      const depth = -sdf(px, py);
      let dx = 0, dy = 0, lit = 0;
      if (depth < B) {
        const dd = Math.max(0, depth);
        const m = mAt(dd);
        let gx = (sdfDir(px + e, py) - sdfDir(px - e, py)) / (2 * e);
        let gy = (sdfDir(px, py + e) - sdfDir(px, py - e)) / (2 * e);
        const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;   // outward normal
        dx = -gx * m; dy = -gy * m;                                // sample inward → the rim magnifies
        const facing = gx * LIGHT[0] + gy * LIGHT[1];
        lit = profile(dd, B, o.thickness).tilt * (Math.max(0, facing) * 0.62 + Math.max(0, -facing) * 0.20);
      }
      const i = (y * MW + x) * 4;
      d[i] = Math.round(128 + dx / MAXD * 127);
      d[i + 1] = Math.round(128 + dy / MAXD * 127);
      d[i + 2] = Math.round(255 * Math.min(1, lit));
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    lastInfo = { maxDisplacement: MAXD, bevel: B, mapSize: [MW, MH] };
    return { url: c.toDataURL('image/png'), maxd: MAXD };
  }

  const SVG = 'http://www.w3.org/2000/svg';
  function prim(name, attrs) {
    const el = document.createElementNS(SVG, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  const ONLY = { R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
                 G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
                 B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' };

  /* Assemble a <filter>: map → blur → displacement (one pass per channel when dispersion > 0) → rim light.
     `self` mode is displacement only (see notes). */
  function buildFilter(id, W, H, map, o) {
    const f = prim('filter', { id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
                               x: 0, y: 0, width: W, height: H, 'color-interpolation-filters': 'sRGB' });
    const img = prim('feImage', { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', result: 'map' });
    img.setAttribute('href', map.url);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', map.url);
    f.appendChild(img);
    const S = 2 * map.maxd;
    if (o.self) {
      f.appendChild(prim('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: S.toFixed(2),
                                                xChannelSelector: 'R', yChannelSelector: 'G' }));
      return f;
    }
    f.appendChild(prim('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: o.blur, result: 'soft' }));
    if (o.dispersion > 0) {
      const scales = { R: S * (1 - o.dispersion), G: S, B: S * (1 + o.dispersion) };
      for (const ch of ['R', 'G', 'B']) {
        f.appendChild(prim('feDisplacementMap', { in: 'soft', in2: 'map', scale: scales[ch].toFixed(2),
                                                  xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + ch }));
        f.appendChild(prim('feColorMatrix', { in: 'd' + ch, type: 'matrix', values: ONLY[ch], result: 'c' + ch }));
      }
      f.appendChild(prim('feComposite', { in: 'cR', in2: 'cG', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'cRG' }));
      f.appendChild(prim('feComposite', { in: 'cRG', in2: 'cB', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'glass' }));
    } else {
      f.appendChild(prim('feDisplacementMap', { in: 'soft', in2: 'map', scale: S.toFixed(2),
                                                xChannelSelector: 'R', yChannelSelector: 'G', result: 'glass' }));
    }
    if (o.rim > 0) {
      f.appendChild(prim('feColorMatrix', { in: 'map', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0', result: 'rimA' }));
      const ct = prim('feComponentTransfer', { in: 'rimA', result: 'rimLit' });
      ct.appendChild(prim('feFuncA', { type: 'linear', slope: o.rim, intercept: 0 }));
      f.appendChild(ct);
      f.appendChild(prim('feComposite', { in: 'rimLit', in2: 'glass', operator: 'over' }));
    }
    return f;
  }

  /* Corner radii in px. Computed values may be "16px", "50%" or "16px 20px" (elliptical — the
     horizontal one is used); percentages are taken against the shorter side. */
  function radiiOf(el, W, H) {
    const cs = getComputedStyle(el);
    const one = (v) => {
      const t = String(v).trim().split(/\s+/)[0] || '0';
      const n = parseFloat(t);
      if (!Number.isFinite(n)) return 0;
      return t.endsWith('%') ? n / 100 * Math.min(W, H) : n;
    };
    const r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(one);
    const lim = Math.min(W, H) / 2;
    return r.map((v) => Math.max(0, Math.min(v, lim)));
  }
  function sizeOf(el) {        // layout box (transform-proof); fall back to the rect for inline / SVG elements
    let W = el.offsetWidth, H = el.offsetHeight;
    if (!W || !H) { const r = el.getBoundingClientRect(); W = r.width; H = r.height; }
    return [Math.round(W), Math.round(H)];
  }

  function acquire(key, W, H, radii, o) {
    let rec = filters.get(key);
    if (!rec) {
      const id = 'hyalite-' + (++seq);
      const map = buildMap(W, H, radii, o);
      rec = { id, refs: 0, el: buildFilter(id, W, H, map, o) };
      rec.dms = Array.from(rec.el.querySelectorAll('feDisplacementMap')).map((n) => ({ n, s: +n.getAttribute('scale') }));
      const fa = rec.el.querySelector('feFuncA');
      rec.rim = fa ? { n: fa, s: +fa.getAttribute('slope') } : null;
      ensureHost().appendChild(rec.el);
      filters.set(key, rec);
      if (typeof o.onBuild === 'function') o.onBuild(lastInfo);
    }
    rec.refs++;
    return rec;
  }
  function release(key) {
    const rec = filters.get(key);
    if (!rec) return;
    if (--rec.refs <= 0) { rec.el.remove(); filters.delete(key); }
  }

  function apply(el) {
    const st = bound.get(el);
    if (!st) return;
    const [W, H] = sizeOf(el);
    if (W < 4 || H < 4) return;                       // not laid out yet / hidden
    const radii = radiiOf(el, W, H);
    const o = st.opts;
    const key = `${W}x${H}|${radii.join(',')}|${o.bevel}|${o.thickness}|${o.blur}|${o.rim}|${o.dispersion}|${o.self ? 'self' : 'back'}`;
    if (key === st.key) return;
    const first = !st.key;
    const rec = acquire(key, W, H, radii, o);
    if (st.key) release(st.key);
    st.key = key;
    el.style.setProperty('--hyalite', `url(#${rec.id})`);
    if (first && o.materialize > 0 && !reducedMotion()) materialize(rec, o.materialize);
  }
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  /* Materialize: Apple's glass doesn't fade in, its lensing ramps up. Displacement and rim light
     go from 0 to target together. Blur is left alone — set the pre-attach fallback to the same
     blur value, or the element will "pull focus". */
  function materialize(rec, ms) {
    const t0 = performance.now();
    if (rec.rim) rec.rim.n.setAttribute('slope', '0');
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3);
      rec.dms.forEach(({ n, s }) => n.setAttribute('scale', (s * k).toFixed(2)));
      if (rec.rim) rec.rim.n.setAttribute('slope', (rec.rim.s * k).toFixed(3));
      if (t < 1 && rec.el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* Throttled rebuild on resize; the last change always gets a final build */
  function schedule(el) {
    const st = bound.get(el);
    if (!st) return;
    const now = performance.now();
    if (st.timer) { st.pending = true; return; }
    const wait = Math.max(0, REBUILD_MIN_MS - (now - (st.last || 0)));
    st.timer = setTimeout(() => {
      st.timer = 0; st.last = performance.now();
      apply(el);
      if (st.pending) { st.pending = false; schedule(el); }
    }, wait);
  }

  function attach(el, opts, byWatcher) {
    if (bound.has(el) || !supported()) return;      // unsupported: write nothing, the CSS fallback wins
    const st = { key: '', opts: Object.assign({}, DEFAULTS, opts || {}), ro: null, timer: 0, pending: false, last: 0, byWatcher: !!byWatcher };
    bound.set(el, st);
    apply(el);
    st.ro = new ResizeObserver(() => schedule(el));
    st.ro.observe(el);
  }
  function detach(el) {
    const st = bound.get(el);
    if (!st) return;
    if (st.ro) st.ro.disconnect();
    if (st.timer) clearTimeout(st.timer);
    if (st.key) release(st.key);
    el.style.removeProperty('--hyalite');
    bound.delete(el);
  }

  /* Watch a container: matching elements present now and added later are attached; removed ones detached */
  function watch(container, selector, opts) {
    unwatch();
    const matches = (node) => {
      const out = [];
      if (node.nodeType !== 1) return out;
      if (node.matches(selector)) out.push(node);
      out.push(...node.querySelectorAll(selector));
      return out;
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => matches(n).forEach((el) => attach(el, opts, true)));
        m.removedNodes.forEach((n) => matches(n).forEach(detach));
      }
    });
    mo.observe(container, { childList: true, subtree: true });
    container.querySelectorAll(selector).forEach((el) => attach(el, opts, true));
    watcher = { container, selector, opts, mo };
  }
  function unwatch() {       // only detaches what watch() attached; manual attach() survives
    if (!watcher) return;
    watcher.mo.disconnect();
    Array.from(bound.entries()).filter(([, st]) => st.byWatcher).forEach(([el]) => detach(el));
    watcher = null;
  }

  /* Retune every attached element, a few per frame (≤ 8 ms); resolves when all are rebuilt */
  function setOpts(opts) {
    if (watcher) Object.assign(watcher.opts, opts);
    const els = Array.from(bound.keys());
    els.forEach((el) => Object.assign(bound.get(el).opts, opts));
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        const t0 = performance.now();
        while (i < els.length && performance.now() - t0 < 8) apply(els[i++]);
        if (i < els.length) requestAnimationFrame(step); else resolve();
      };
      step();
    });
  }
  const info = () => lastInfo;

  /* CSS.supports says yes on Firefox too, but Firefox paints nothing for backdrop-filter:url()
     and Safari keeps only the blur. So we also require a Chromium engine (Chrome, Edge, Arc, Brave…). */
  let supportedMemo = null;
  const supported = () => {
    if (supportedMemo !== null) return supportedMemo;
    try {
      const css = CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)');
      const uad = navigator.userAgentData;
      const chromium = uad && uad.brands ? uad.brands.some((b) => /Chromium/i.test(b.brand))
                     : /Chrome\/\d+/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor || '');
      supportedMemo = !!(css && chromium);
    } catch (e) { supportedMemo = false; }
    return supportedMemo;
  };

  const API = { watch, unwatch, attach, detach, setOpts, info, supported, DEFAULTS, version: '0.1.0' };
  root.Hyalite = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
