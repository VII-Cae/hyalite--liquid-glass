/*!
 * hyalite v0.3.0 — real refraction "liquid glass" for the web.
 * https://github.com/VII-Cae/hyalite--liquid-glass · MIT © 2026 VII-Cae
 *
 * How it works
 *   The element is treated as a slab of glass with a rounded bevel along its edge.
 *   For its exact size and corner radii we compute a displacement map (R = x offset,
 *   G = y offset, B = rim light), feed it to an SVG filter (feImage → feGaussianBlur →
 *   feDisplacementMap, in two passes — see rule 4 → rim light), and let the browser bend whatever
 *   is *behind* the element through `backdrop-filter: url(#…)`. Only Chromium runs SVG backdrop filters;
 *   everywhere else the CSS fallback in `var(--hyalite, blur(6px))` takes over.
 *
 * Usage
 *   CSS:  .glass { backdrop-filter: var(--hyalite, blur(6px)); -webkit-backdrop-filter: var(--hyalite, blur(6px)); }
 *   JS:   const w = Hyalite.watch(document.body, '.glass', { bevel: 16, thickness: 10, blur: 3 });  w.stop()
 *         Hyalite.attach(el, opts) / Hyalite.detach(el) / Hyalite.refresh(el)
 *         Hyalite.setOpts({ blur: 1 })      // retune everything, returns a Promise (a newer call cancels an older one)
 *         Hyalite.info()                    // { maxDisplacement, bevel, mapSize, radii, map, mapInner, split } of the last build
 *         Hyalite.supported()               // true only where SVG backdrop filters really render (Chromium)
 *         Hyalite.force(true|false|null)    // override that verdict; null goes back to sniffing
 *
 * Options (all clamped to sane ranges)
 *   bevel        width of the bent zone along the edge, px. Clamped to the largest corner radius
 *   thickness    glass thickness, px — drives how far the edge pulls the backdrop inward
 *   blur         frost in the centre, px (feGaussianBlur stdDeviation)
 *   dispersion   chromatic aberration, 0–0.5 (0 = single pass, cheaper)
 *   rim          geometry-aware edge light, 0–4 (0 = off)
 *   smooth       px — blur that hides the browser's nearest-neighbour staircase along the rim (rule 4).
 *                Only the bevel ring sees it, never the centre. 0 = one displacement pass, no hiding
 *   light        light direction in degrees: 0 = straight above, positive = clockwise. The default
 *                −145° puts it low on the left, against the drop shadow, so the glass reads as
 *                floating rather than lit from a ceiling. Chosen by eye, not derived.
 *   materialize  ms — on attach, ramp displacement + rim from 0 (Apple's "materialize")
 *   settle       ms — while an element keeps resizing it shows a plain blur; `settle` ms after the
 *                last change the map is rebuilt once and the refraction ramps back in.
 *                0 = live mode: throttled rebuilds (≤ 1 per 90 ms) with the old map stretched meanwhile.
 *   self         true when the element uses `filter:` on itself instead of `backdrop-filter`
 *                (displacement only: no blur, no dispersion, no rim — see notes)
 *   onBuild(info) called after every *map* build (a filter rebuilt from a cached map does not build one)
 *
 * Three rules learned the hard way (each one leaves a visible artifact if broken)
 *   1. Displacement must not fold: the decay slope is capped at MAX_SLOPE px/px. At 1 the
 *      sampling point stands still (infinite stretch); above 1 the image mirrors and you get
 *      doubled lines along the rim.
 *   2. Bevel ≤ corner radius: past that the field reaches the SDF's medial axis, where the
 *      direction flips and every corner grows a diagonal crease.
 *   3. Direction is taken from a larger rounded rect (radius + bevel), so the turn from
 *      "pull down" to "pull right" is spread along a longer arc — otherwise corners look like a ridge.
 *   4. Chromium samples the bent picture nearest-neighbour: Skia's displacement effect is pinned to
 *      kNearest (skbug.com/40045448), so a 6.7× stretch at the rim (slope 0.85) copies every source
 *      pixel into a 6.7px block and any hard edge behind the glass turns into stairs. The field is
 *      therefore split into two passes of equal stretch (≈ 2.6× each): an *inner* pass first, then a
 *      blur of `smooth` px masked to the bevel ring to melt its staircase, then the *outer* pass. The
 *      composition equals the one-pass field (the inner table is the exact inverse, not a halving).
 *      Stairs of 6.7px at full contrast become ≈ 2.6px at a fraction of it, and the centre is untouched.
 *
 * Caching, in two levels
 *   A *map* depends only on geometry + bevel + thickness + light; a *filter* adds blur, dispersion,
 *   rim, smooth and self. A map build always produces both PNGs (outer + inner), so `smooth` can be
 *   toggled without a rebuild. So `setOpts({ blur })` rebuilds a handful of DOM nodes and reuses every map.
 *   Map sizes are bucketed (≤ 2 % per side; elements up to QZ_MIN px stay exact) so a column of chat
 *   bubbles a few pixels apart shares one map. The radii are deliberately *not* rescaled to match —
 *   that would put the element's own width back into the key and defeat the bucket; feImage squeezes
 *   the map by up to 2 % instead, which pulls the outline in by under half a pixel at ordinary radii.
 *   Maps whose last user went away stay warm (MAX_IDLE_MAPS of them), then go oldest-first.
 *
 * Notes
 *   · The materialize ramp runs on a private clone of the shared filter, so animating one element
 *     never touches another.
 *   · `self` mode exists because the 3-pass dispersion sum is only valid for opaque sources.
 *     On a translucent layer alpha is added three times and clamped, which darkens the colour.
 *   · `--hyalite` is an inherited custom property: consume it only on the attached element.
 *   · Maps for large elements are downsampled (MAX_MAP_PX); the field is smooth, feImage stretches
 *     it back without visible loss. With four equal corners only one quadrant is computed and the
 *     other three are mirrored — the rim light is not symmetric, but redoing it costs one dot product.
 *   · Sizes come from offsetWidth/Height (layout box, transform-proof). Corner radii follow the CSS
 *     overlap rule — one shared shrink factor, not a per-corner clamp — so a 320×40 card with
 *     `border-radius: 24px 24px 0 0` really gets 24px corners. A radius past half the short side is
 *     honoured near the edge, where the bevel lives; deeper in, the quadrant SDF is approximate.
 *     Elliptical radii use their horizontal value; % radii resolve against the shorter side.
 *   · Nothing is written when unsupported, so the CSS fallback wins. Firefox renders the element
 *     unfiltered for SVG backdrop filters; Safari keeps the blur only (a WebKit implementation is in
 *     review). When it ships, `Hyalite.force(true)` or `<html data-hyalite="force">` turns the engine
 *     on without editing this file.
 *   · Respects prefers-reduced-motion (no ramps).
 *   · feImage uses a data: URL — a strict CSP needs `img-src data:`.
 */
(function (root) {
  'use strict';
  if (root.Hyalite) return;

  const VAR = '--hyalite';
  const N_GLASS = 1.5;             // refractive index of ordinary glass
  const MAX_SLOPE = 0.85;          // max decay slope of the displacement (rule 1)
  const DEFAULTS = { bevel: 16, thickness: 10, blur: 3, dispersion: 0.05, rim: 0.45, light: -145, smooth: 1, materialize: 0, settle: 120, self: false };
  const LIMITS = { bevel: [1, 400], thickness: [0, 400], blur: [0, 64], dispersion: [0, 0.5], rim: [0, 4], light: [-180, 180], smooth: [0, 4], materialize: [0, 10000], settle: [0, 10000] };
  const AA_SLOPE = 0.3;            // rule 4: the ring blur is fully on where the inner pass still stretches ≥ ~1.4× (slope ≥ 0.3), fading out below
  const LIVE_MIN_MS = 90;          // live mode: throttle for continuous resizes
  const SETTLE_RAMP_MS = 160;      // after a settle rebuild the refraction ramps back in
  const MAX_MAP_PX = 320000;       // ≈ 565×565: larger elements get a downsampled map
  const QZ = 1.02, QZ_MIN = 64;    // map size buckets: ≤ 2 % per side; elements this small stay exact
  const LOG_QZ = Math.log(QZ);
  const MAX_IDLE_MAPS = 24;        // maps nobody uses stay warm this many deep, then go oldest-first

  let host = null;                 // hidden <svg> holding every <filter>
  let seq = 0, optsGen = 0, lastInfo = null;
  const filters = new Map();       // filterKey → { id, refs, el, mapKey }
  const maps = new Map();          // mapKey → { url, maxd, refs, key }
  const idleMaps = new Map();      // the subset of `maps` with refs === 0, in eviction order
  const bound = new Map();         // element → state
  const watchers = new Set();

  /* Light direction from an angle: 0° = straight above, positive = clockwise (screen y points down) */
  const lightOf = (deg) => { const a = deg * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; };
  /* Size bucket: monotone, never below v, within QZ of it. Small elements are returned untouched. */
  const qz = (v) => v <= QZ_MIN ? v : Math.max(v, Math.ceil(Math.pow(QZ, Math.ceil(Math.log(v) / LOG_QZ - 1e-9))));

  function sanitize(o) {
    const s = Object.assign({}, o);
    for (const k in LIMITS) if (k in s) {
      const v = +s[k], lim = LIMITS[k];
      s[k] = Number.isFinite(v) ? Math.min(lim[1], Math.max(lim[0], v)) : DEFAULTS[k];
    }
    if ('self' in s) s.self = !!s.self;
    return s;
  }

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

  /* Build the maps. Returns { url, maxd, inner: { url, maxd }, split }
     `url` is the one-pass field (R/G = offset ÷ maxd, B = rim light); the outer pass reuses it with
     scale × split. `inner` is the first pass of rule 4 (R/G = offset ÷ inner.maxd, B = ring mask). */
  function buildMap(W, H, radii, o) {
    // The bevel is clamped to the *largest* corner: a small corner (a 6px "tail" on a chat bubble)
    // must not flatten the refraction along the whole edge. Near such a corner the depth field
    // kinks on the SDF's medial axis, but the direction field below is smooth, so the crease is faint.
    const rMax = Math.max(1, ...radii);
    const B = Math.max(1, Math.min(o.bevel, rMax, Math.floor(Math.min(W, H) / 2) - 1));
    // Displacement table with the no-fold constraint, built from the inner edge outward
    const STEP = 0.25, N = Math.ceil(B / STEP);
    const tab = new Float64Array(N + 1); tab[N] = 0;
    for (let i = N - 1; i >= 0; i--) tab[i] = Math.min(profile(i * STEP, B, o.thickness).disp, tab[i + 1] + MAX_SLOPE * STEP);
    const MAXD = Math.max(tab[0], 1e-6);
    const lerp = (t, d) => { const f = Math.min(N - 1e-6, Math.max(0, d) / STEP), i = Math.floor(f), u = f - i; return t[i] * (1 - u) + t[i + 1] * u; };
    const mAt = (d) => lerp(tab, d);
    // Rule 4: split the field into an inner and an outer pass of equal stretch. The outer pass moves
    // the sample by split·m(x) first, so the inner table is indexed by *that* depth: inner(x + split·m(x))
    // = (1 − split)·m(x), solved by bisection (the left side is monotone while split·slope < 1).
    let sMax = 0;
    for (let i = 0; i < N; i++) sMax = Math.max(sMax, (tab[i] - tab[i + 1]) / STEP);
    const split = sMax > 1e-6 ? (1 - Math.sqrt(1 - sMax)) / sMax : 0.5;
    const tab1 = new Float64Array(N + 1);
    for (let j = 0; j <= N; j++) {
      const y = j * STEP;
      let lo = 0, hi = y <= split * MAXD ? 0 : B;           // shallower than split·maxd nobody samples: hold the edge value
      for (let it = 0; it < 24 && hi > lo; it++) { const mid = (lo + hi) / 2; if (mid + split * mAt(mid) < y) lo = mid; else hi = mid; }
      tab1[j] = (1 - split) * mAt(hi);
    }
    const MAXD1 = Math.max(tab1[0], 1e-6);
    const m1At = (d) => lerp(tab1, d);
    // Ring mask for the in-between blur: 1 where the inner pass still stretches noticeably, 0 where it does not
    const wAt = (d) => { const i = Math.floor(Math.min(N - 1e-6, Math.max(0, d) / STEP)); return Math.min(1, (tab1[i] - tab1[i + 1]) / STEP / AA_SLOPE); };
    const sdf = makeSDF(W, H, radii);
    // A radius may legitimately pass half the short side (CSS only shrinks radii that share an edge),
    // so the direction field is capped at the short side itself rather than at half of it.
    const cap = Math.min(W, H) - 0.5;
    const sdfDir = makeSDF(W, H, radii.map((R) => Math.min(R + B, cap)));   // rule 3
    // Downsampling: map pixel (x, y) ↔ CSS pixel ((x+.5)/k, (y+.5)/k); offsets stay in CSS px
    const k = Math.min(1, Math.sqrt(MAX_MAP_PX / (W * H)));
    const MW = Math.max(2, Math.round(W * k)), MH = Math.max(2, Math.round(H * k));
    const c = document.createElement('canvas'); c.width = MW; c.height = MH;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(MW, MH), d = img.data;
    const img1 = ctx.createImageData(MW, MH), d1 = img1.data;
    const e = 0.5, L = lightOf(o.light);
    let m = 0, m1 = 0, w = 0;                                    // shared by the four mirrored writes below
    const put = (x, y, ux, uy, lit) => {                         // (ux, uy): signed sampling direction
      const i = (y * MW + x) * 4;
      d[i] = Math.round(128 + ux * m / MAXD * 127);
      d[i + 1] = Math.round(128 + uy * m / MAXD * 127);
      d[i + 2] = Math.round(255 * Math.min(1, lit));
      d[i + 3] = 255;
      d1[i] = Math.round(128 + ux * m1 / MAXD1 * 127);
      d1[i + 1] = Math.round(128 + uy * m1 / MAXD1 * 127);
      d1[i + 2] = Math.round(255 * w);
      d1[i + 3] = 255;
    };
    // The rim light is *not* mirror-symmetric — the light arrives at an angle — but recovering it
    // from a mirrored normal is one dot product, so everything expensive is still done once.
    const litOf = (tilt, gx, gy) => { const f = gx * L[0] + gy * L[1]; return tilt * (Math.max(0, f) * 0.62 + Math.max(0, -f) * 0.20); };
    const sym = radii[0] === radii[1] && radii[1] === radii[2] && radii[2] === radii[3];
    const XN = sym ? Math.ceil(MW / 2) : MW, YN = sym ? Math.ceil(MH / 2) : MH;
    for (let y = 0; y < YN; y++) for (let x = 0; x < XN; x++) {
      const px = (x + .5) / k, py = (y + .5) / k;
      const depth = -sdf(px, py);
      let gx = 0, gy = 0, tilt = 0;
      m = 0; m1 = 0; w = 0;
      if (depth < B) {
        const dd = Math.max(0, depth);
        m = mAt(dd); m1 = m1At(dd); w = wAt(dd);
        gx = (sdfDir(px + e, py) - sdfDir(px - e, py)) / (2 * e);
        gy = (sdfDir(px, py + e) - sdfDir(px, py - e)) / (2 * e);
        const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;   // outward normal
        tilt = profile(dd, B, o.thickness).tilt;
      }
      put(x, y, -gx, -gy, litOf(tilt, gx, gy));                   // sample inward → the rim magnifies
      if (sym) {                                                   // equal corners ⇒ mirror the other three quadrants
        const mx = MW - 1 - x, my = MH - 1 - y;
        if (mx !== x) put(mx, y, gx, -gy, litOf(tilt, -gx, gy));
        if (my !== y) put(x, my, -gx, gy, litOf(tilt, gx, -gy));
        if (mx !== x && my !== y) put(mx, my, gx, gy, litOf(tilt, -gx, -gy));
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    ctx.putImageData(img1, 0, 0);
    const url1 = c.toDataURL('image/png');
    lastInfo = { maxDisplacement: MAXD, bevel: B, mapSize: [MW, MH], radii: radii.slice(), map: url, mapInner: url1, split };
    return { url, maxd: MAXD, inner: { url: url1, maxd: MAXD1 }, split };
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

  /* Assemble a <filter>: map → blur → [inner displacement → ring blur (rule 4)] → outer displacement
     (one pass per channel when dispersion > 0) → rim light. `self` mode is displacement only (see notes). */
  function buildFilter(id, W, H, map, o) {
    const f = prim('filter', { id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
                               x: 0, y: 0, width: W, height: H, 'color-interpolation-filters': 'sRGB' });
    const image = (url, result) => {
      const img = prim('feImage', { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', result });
      img.setAttribute('href', url);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
      return img;
    };
    f.appendChild(image(map.url, 'map'));
    const S = 2 * map.maxd;
    if (o.self) {
      f.appendChild(prim('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: S.toFixed(2),
                                                xChannelSelector: 'R', yChannelSelector: 'G' }));
      return f;
    }
    f.appendChild(prim('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: o.blur, result: 'soft' }));
    let src = 'soft', scale = S, disp = o.dispersion;
    if (o.smooth > 0) {                                            // rule 4: inner pass, ring blur, then the outer pass below
      f.appendChild(image(map.inner.url, 'inner'));
      f.appendChild(prim('feDisplacementMap', { in: 'soft', in2: 'inner', scale: (2 * map.inner.maxd).toFixed(2),
                                                xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }));
      f.appendChild(prim('feGaussianBlur', { in: 'bent', stdDeviation: o.smooth, result: 'bentSoft' }));
      // the inner map's blue channel is the ring mask: blurred inside the ring, untouched elsewhere
      f.appendChild(prim('feColorMatrix', { in: 'inner', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0', result: 'ring' }));
      const inv = prim('feComponentTransfer', { in: 'ring', result: 'ringInv' });
      inv.appendChild(prim('feFuncA', { type: 'table', tableValues: '1 0' }));
      f.appendChild(inv);
      f.appendChild(prim('feComposite', { in: 'bentSoft', in2: 'ring', operator: 'in', result: 'ringIn' }));
      f.appendChild(prim('feComposite', { in: 'bent', in2: 'ringInv', operator: 'in', result: 'ringOut' }));
      f.appendChild(prim('feComposite', { in: 'ringIn', in2: 'ringOut', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'mid' }));
      src = 'mid'; scale = S * map.split;
      // the outer pass carries all of the aberration, scaled up so the colour offset stays what `dispersion` says
      disp = Math.min(0.95, o.dispersion / map.split);
    }
    if (disp > 0) {
      const scales = { R: scale * (1 - disp), G: scale, B: scale * (1 + disp) };
      for (const ch of ['R', 'G', 'B']) {
        f.appendChild(prim('feDisplacementMap', { in: src, in2: 'map', scale: scales[ch].toFixed(2),
                                                  xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + ch }));
        f.appendChild(prim('feColorMatrix', { in: 'd' + ch, type: 'matrix', values: ONLY[ch], result: 'c' + ch }));
      }
      f.appendChild(prim('feComposite', { in: 'cR', in2: 'cG', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'cRG' }));
      f.appendChild(prim('feComposite', { in: 'cRG', in2: 'cB', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'glass' }));
    } else {
      f.appendChild(prim('feDisplacementMap', { in: src, in2: 'map', scale: scale.toFixed(2),
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
     horizontal one is used); percentages resolve against the shorter side.
     CSS shrinks radii by one *shared* factor when two of them do not fit on the edge they share; it
     does not clamp each corner on its own. Clamping each to half the short side gets a 320×40 card
     with `border-radius: 24px 24px 0 0` wrong — those corners really are 24px. */
  function radiiOf(el, W, H) {
    const cs = getComputedStyle(el);
    const one = (v) => {
      const t = String(v).trim().split(/\s+/)[0] || '0';
      const n = parseFloat(t);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, t.endsWith('%') ? n / 100 * Math.min(W, H) : n);
    };
    const r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(one);
    let f = 1;
    for (const [len, sum] of [[W, r[0] + r[1]], [H, r[1] + r[2]], [W, r[2] + r[3]], [H, r[3] + r[0]]])
      if (sum > len) f = Math.min(f, len / sum);
    return f < 1 ? r.map((v) => v * f) : r;
  }
  function sizeOf(el) {        // layout box (transform-proof); fall back to the rect for inline / SVG elements
    let W = el.offsetWidth, H = el.offsetHeight;
    if (!W || !H) { const r = el.getBoundingClientRect(); W = r.width; H = r.height; }
    return [Math.round(W), Math.round(H)];
  }

  /* A map depends only on geometry + bevel + thickness + light, so a filter rebuilt for a new blur
     or rim reuses it. Sizes go into buckets so that near-identical elements — a column of chat
     bubbles, say — share one map. The radii are *not* rescaled to match: pre-scaling them would put
     the element's own width back into the key and defeat the whole thing. feImage squeezes the map
     by up to QZ instead, which shrinks the outline by under half a pixel at ordinary radii. */
  function acquireMap(W, H, radii, o) {
    const BW = qz(W), BH = qz(H);
    const br = radii.map((r) => +r.toFixed(2));                    // quantised so the key and the map agree
    const key = `${BW}x${BH}|${br.join(',')}|${o.bevel}|${o.thickness}|${o.light}`;
    let rec = maps.get(key);
    if (rec) idleMaps.delete(key);
    else {
      rec = buildMap(BW, BH, br, o);
      rec.refs = 0; rec.key = key;
      maps.set(key, rec);
      lastInfo.radii = radii.slice();          // report the element's own radii, not the bucketed ones
      if (typeof o.onBuild === 'function') o.onBuild(lastInfo);
    }
    rec.refs++;
    return rec;
  }
  function releaseMap(key) {
    const rec = maps.get(key);
    if (!rec || --rec.refs > 0) return;
    idleMaps.set(key, rec);                    // keep it warm: a retune or a resize back usually wants it again
    for (const k of idleMaps.keys()) {
      if (idleMaps.size <= MAX_IDLE_MAPS) break;
      idleMaps.delete(k); maps.delete(k);
    }
  }

  function acquire(key, W, H, radii, o) {
    let rec = filters.get(key);
    if (!rec) {
      const id = 'hyalite-' + (++seq);
      const map = acquireMap(W, H, radii, o);
      rec = { id, refs: 0, el: buildFilter(id, W, H, map, o), mapKey: map.key };
      ensureHost().appendChild(rec.el);
      filters.set(key, rec);
    }
    rec.refs++;
    return rec;
  }
  function release(key) {
    const rec = filters.get(key);
    if (!rec) return;
    if (--rec.refs <= 0) { rec.el.remove(); filters.delete(key); releaseMap(rec.mapKey); }
  }

  const setFallback = (el, st) => el.style.setProperty(VAR, st.opts.self ? 'none' : `blur(${st.opts.blur}px)`);
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  /* (Re)build for the current geometry and point the element at its filter. `ramp` > 0 animates in. */
  function apply(el, ramp) {
    const st = bound.get(el);
    if (!st) return;
    const [W, H] = sizeOf(el);
    if (W < 4 || H < 4) return;                       // not laid out yet / hidden
    const radii = radiiOf(el, W, H);
    const o = st.opts;
    const key = `${W}x${H}|${radii.join(',')}|${o.bevel}|${o.thickness}|${o.blur}|${o.rim}|${o.dispersion}|${o.light}|${o.smooth}|${o.self ? 'self' : 'back'}`;
    st.w = W; st.h = H;
    let rec;
    if (key === st.key) rec = filters.get(key);       // same geometry (e.g. back from a settle): just re-point
    else { rec = acquire(key, W, H, radii, o); if (st.key) release(st.key); st.key = key; }
    if (!rec) return;
    if (ramp > 0 && !reducedMotion()) materialize(el, st, rec, ramp);
    else el.style.setProperty(VAR, `url(#${rec.id})`);
  }

  /* Materialize: Apple's glass doesn't fade in, its lensing ramps up. Displacement and rim light go
     from 0 to target together on a private clone of the shared filter, then the element switches to
     the shared one. Blur is left alone — keep the pre-attach fallback at the same blur, or the
     element will "pull focus". */
  function materialize(el, st, rec, ms) {
    const tmp = rec.el.cloneNode(true);
    tmp.id = `${rec.id}-m${++seq}`;
    const dms = Array.from(tmp.querySelectorAll('feDisplacementMap')).map((n) => ({ n, s: +n.getAttribute('scale') }));
    const fa = tmp.querySelector('feFuncA');
    const rim = fa ? { n: fa, s: +fa.getAttribute('slope') } : null;
    dms.forEach(({ n }) => n.setAttribute('scale', '0'));
    if (rim) rim.n.setAttribute('slope', '0');
    ensureHost().appendChild(tmp);
    el.style.setProperty(VAR, `url(#${tmp.id})`);
    const key = st.key, t0 = performance.now();
    const step = (now) => {
      // rebuilt, detached or resizing meanwhile: whoever did that owns the variable now
      if (bound.get(el) !== st || st.key !== key || st.settling) { tmp.remove(); return; }
      const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3);
      dms.forEach(({ n, s }) => n.setAttribute('scale', (s * k).toFixed(2)));
      if (rim) rim.n.setAttribute('slope', (rim.s * k).toFixed(3));
      if (t < 1) requestAnimationFrame(step);
      else { el.style.setProperty(VAR, `url(#${rec.id})`); tmp.remove(); }
    };
    requestAnimationFrame(step);
  }

  /* Size changes. settle > 0: drop to a plain blur at once, rebuild once the size has been stable
     for `settle` ms, ramp back in. settle = 0: throttled live rebuilds. */
  function onResize(el) {
    const st = bound.get(el);
    if (!st) return;
    const [W, H] = sizeOf(el);
    if (W === st.w && H === st.h) return;            // the observer's initial notification, or no real change
    if (st.opts.settle > 0) {
      if (!st.settling) { st.settling = true; setFallback(el, st); }
      clearTimeout(st.timer);
      st.timer = setTimeout(() => { st.timer = 0; st.settling = false; apply(el, SETTLE_RAMP_MS); }, st.opts.settle);
    } else schedule(el);
  }
  function schedule(el) {
    const st = bound.get(el);
    if (!st) return;
    if (st.timer) { st.pending = true; return; }
    const wait = Math.max(0, LIVE_MIN_MS - (performance.now() - (st.last || 0)));
    st.timer = setTimeout(() => {
      st.timer = 0; st.last = performance.now();
      apply(el, 0);
      if (st.pending) { st.pending = false; schedule(el); }
    }, wait);
  }

  function attach(el, opts, watcher) {
    if (bound.has(el) || !supported()) return;      // unsupported: write nothing, the CSS fallback wins
    const st = { key: '', opts: sanitize(Object.assign({}, DEFAULTS, opts || {})), ro: null, timer: 0, pending: false,
                 last: 0, settling: false, w: 0, h: 0, watcher: watcher || null };
    bound.set(el, st);
    apply(el, st.opts.materialize);
    st.ro = new ResizeObserver(() => onResize(el));
    st.ro.observe(el);
  }
  function detach(el) {
    const st = bound.get(el);
    if (!st) return;
    if (st.ro) st.ro.disconnect();
    if (st.timer) clearTimeout(st.timer);
    if (st.key) release(st.key);
    el.style.removeProperty(VAR);
    bound.delete(el);
  }
  /* Force a rebuild (e.g. after a border-radius change that did not change the size) */
  function refresh(el) {
    const st = bound.get(el);
    if (!st) return;
    const old = st.key;
    st.key = ''; st.w = st.h = 0;
    apply(el, 0);
    if (old) release(old);
    if (!st.key) setFallback(el, st);
  }

  /* Watch a container: matching elements present now, added later, or gaining the class later are
     attached; removed ones or ones losing the class are detached. Returns { stop }. Several watchers
     can coexist. */
  function watch(container, selector, opts) {
    const w = { container, selector, opts: sanitize(Object.assign({}, DEFAULTS, opts || {})), mo: null };
    const matches = (node) => {
      const out = [];
      if (node.nodeType !== 1) return out;
      if (node.matches(selector)) out.push(node);
      out.push(...node.querySelectorAll(selector));
      return out;
    };
    const consider = (node) => {
      if (node.nodeType !== 1) return;
      if (node.matches(selector)) { if (!bound.has(node)) attach(node, w.opts, w); }
      else { const st = bound.get(node); if (st && st.watcher === w) detach(node); }
    };
    w.mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { consider(m.target); continue; }
        m.addedNodes.forEach((n) => matches(n).forEach((el) => attach(el, w.opts, w)));
        m.removedNodes.forEach((n) => matches(n).forEach((el) => { const st = bound.get(el); if (st && st.watcher === w) detach(el); }));
      }
    });
    w.mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    container.querySelectorAll(selector).forEach((el) => attach(el, w.opts, w));
    watchers.add(w);
    return { stop: () => stopWatcher(w) };
  }
  function stopWatcher(w) {
    if (!watchers.has(w)) return;
    w.mo.disconnect();
    watchers.delete(w);
    Array.from(bound.entries()).filter(([, st]) => st.watcher === w).forEach(([el]) => detach(el));
  }
  function unwatch() { Array.from(watchers).forEach(stopWatcher); }   // stop every watcher; manual attaches survive

  /* Retune every attached element, a few per frame (≤ 8 ms). A newer call supersedes an older one. */
  function setOpts(opts) {
    const s = sanitize(opts || {});
    watchers.forEach((w) => Object.assign(w.opts, s));
    const els = Array.from(bound.keys());
    els.forEach((el) => Object.assign(bound.get(el).opts, s));
    const gen = ++optsGen;
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (gen !== optsGen) return resolve();
        const t0 = performance.now();
        while (i < els.length && performance.now() - t0 < 8) apply(els[i++], 0);
        if (i < els.length) requestAnimationFrame(step); else resolve();
      };
      step();
    });
  }
  const info = () => lastInfo;

  /* CSS.supports says yes on Firefox too, but Firefox paints the element unfiltered for
     backdrop-filter:url() and Safari keeps only the blur. So we also require a Chromium engine
     (Chrome, Edge, Arc, Brave, Electron…). That sniff is a snapshot of September 2026 and there is
     no way to read back what a backdrop filter painted, so it needs an escape hatch: WebKit has an
     implementation in review, and the day it ships `Hyalite.force(true)` or `<html data-hyalite="force">`
     turns the engine on without editing this file. `force(null)` goes back to sniffing. */
  let supportedMemo = null, forced = null;
  const supported = () => {
    if (forced !== null) return forced;
    if (supportedMemo !== null) return supportedMemo;
    try {
      const flag = document.documentElement.getAttribute('data-hyalite');
      if (flag === 'force' || flag === 'off') return (supportedMemo = flag === 'force');
      const css = CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)');
      const uad = navigator.userAgentData;
      const chromium = uad && uad.brands ? uad.brands.some((b) => /Chromium/i.test(b.brand))
                     : /Chrome\/\d+/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor || '');
      supportedMemo = !!(css && chromium);
    } catch (e) { supportedMemo = false; }
    return supportedMemo;
  };
  function force(v) { forced = (v === null || v === undefined) ? null : !!v; supportedMemo = null; return supported(); }

  const API = { watch, unwatch, attach, detach, refresh, setOpts, info, supported, force, DEFAULTS, version: '0.3.0' };
  root.Hyalite = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
