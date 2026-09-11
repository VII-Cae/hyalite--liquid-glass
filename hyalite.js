/*!
 * hyalite v0.5.0 — real refraction "liquid glass" for the web.
 * https://github.com/VII-Cae/hyalite--liquid-glass · MIT © 2026 VII-Cae
 *
 * How it works
 *   The element is treated as a slab of glass with a bevelled edge. For its exact size and corner
 *   radii we compute a displacement map (R = x offset, G = y offset, B = a signed edge profile),
 *   feed it to an SVG filter, and let the browser bend whatever is *behind* the element through
 *   `backdrop-filter: url(#…)`. The centre stays clear; the edge pulls the world inward, darkens
 *   where it magnifies, and catches a line of light along the rim. Only Chromium runs SVG backdrop
 *   filters; everywhere else the CSS fallback in `var(--hyalite, blur(6px))` takes over — and the
 *   rim, which is CSS, still shows up.
 *
 * Usage
 *   CSS:  .glass {
 *           backdrop-filter: var(--hyalite, blur(6px));
 *           -webkit-backdrop-filter: var(--hyalite, blur(6px));
 *           box-shadow: var(--hyalite-edge, none);      ← the sharp rim, see `edge`
 *         }
 *   JS:   const w = Hyalite.watch(document.body, '.glass', { bevel: 24, thickness: 40 });  w.stop()
 *         Hyalite.attach(el, opts) / Hyalite.detach(el) / Hyalite.refresh(el)
 *         Hyalite.setOpts({ blur: 1 })      // retune everything, returns a Promise (a newer call cancels an older one)
 *         Hyalite.info()                    // geometry, both map URLs, and the sampled edge profile of the last build
 *         Hyalite.supported()               // true only where SVG backdrop filters really render (Chromium)
 *         Hyalite.force(true|false|null)    // override that verdict; null goes back to sniffing
 *
 * Options (all clamped to sane ranges)
 *   bevel        width of the bent zone along the edge, px. Clamped to half the short side — *not*
 *                to the corner radius any more, so a circle can bend all the way to its centre
 *   thickness    glass thickness, px — drives how far the edge pulls the backdrop inward
 *   slope        cap on how fast the displacement decays, px/px. At 1 the sampling point stands
 *                still (infinite stretch); above it the field *folds* — the same backdrop shows up
 *                twice and the rim fills with the liquid swirls Apple's glass has. Folding also
 *                rules out the two-pass anti-staircase (see `smooth`), so it wants blur and
 *                dispersion to cover for it, and a bevel narrow enough to keep the mess contained
 *   shape        'circle' | 'squircle' | 'lip' — the bevel's cross-section. squircle meets the slab
 *                more gently than a quarter circle; lip is raised at the rim and dipped behind it,
 *                which reverses the tilt in the middle and adds a second pair of light/dark bands
 *   blur         frost in the centre, px (feGaussianBlur stdDeviation)
 *   dispersion   chromatic aberration in *pixels* of channel separation — a material constant of the
 *                glass, unrelated to how strong the lens is. `0` is a single pass and cheaper
 *   shade        how much the edge darkens, 0–2. Two things at once, in the ratio they were tuned:
 *                the caustic (the edge magnifies the backdrop, so its energy is spread thin) and
 *                the Fresnel transmission loss. `0` leaves the refraction unshaded
 *   rim          how much light the edge sends back, 0–4. A wide Fresnel sheen plus a tight
 *                specular line, again in a fixed ratio. This is *inside* the filter — for the
 *                pixel-sharp outer line see `edge`
 *   edgeW        px — how far in the shading and the sheen reach. Absolute on purpose: the bright
 *                line and the dark hairline under it are a pixel or two of real glass whatever the
 *                bevel is, and scaling them with the bevel turns a wide rim into a grey band
 *   sat          saturation inside the bevel ring, 0–3. Folding plus dispersion muddies the colour
 *                along the rim; below 1 cleans it up. The centre is never touched. 1 = off (and the
 *                seven filter nodes it costs are skipped)
 *   edge         strength of the CSS rim written to `--hyalite-edge`, 0–2. Inset shadows on the
 *                element itself, so they stay crisp where a filter-drawn line would not — and they
 *                work in browsers that get no refraction at all. `0` writes `none`
 *   light        light direction in degrees: 0 = straight above, positive = clockwise
 *   smooth       px — blur that hides Chromium's nearest-neighbour staircase along the rim (rule 4).
 *                Only the bevel ring sees it, never the centre. Ignored when the field folds
 *                (`slope` > 1), where no two-pass split exists. `0` = one pass, no hiding
 *   materialize  ms — on attach, ramp displacement, shade and rim from 0 (Apple's "materialize")
 *   settle       ms — coalesce resizes: rebuild once, `settle` ms after the last size change. Until
 *                then the browser stretches the current map over the new box (the filter region
 *                follows the element), so the glass never drops out. 0 = live: the first change of a
 *                burst rebuilds before that frame paints, then at most one rebuild per 90 ms while
 *                the size keeps moving, and a last one once it stops. Live is right for anything that
 *                grows in steps (a chat bubble); `settle` is for a box someone is dragging
 *   self         true when the element uses `filter:` on itself instead of `backdrop-filter`
 *                (displacement only: no blur, no dispersion, no shading — see notes)
 *   onBuild(info) called after every *map* build (a filter rebuilt from a cached map does not build one)
 *
 * Rules learned the hard way (each one leaves a visible artifact if broken)
 *   1. Past a decay slope of 1 the displacement folds. Until 0.4.0 that was forbidden; it is now an
 *      option, because folding is where the liquid look comes from. It is still a cliff: the folded
 *      zone has infinite stretch, so keep it inside a narrow bevel and cover it.
 *   2. Direction is taken from a larger rounded rect (radius + bevel), so the turn from "pull down"
 *      to "pull right" is spread along a longer arc — otherwise corners look like a ridge. That
 *      widened radius is capped at *half the short side*: past it makeSDF's rounded-rect formula
 *      stops holding (W/2 − R goes negative) and the gradient flips sign across the axes. A circle
 *      sits exactly at the limit — before 0.3.1 it rendered with a cross-shaped seam.
 *   3. Geometry scales, optics does not. The bevel and the displacement are proportions of the
 *      element; the dispersion, the bright line and the dark band under it are fixed pixel counts.
 *      Mixing the two is what turns a thick lens into a radial rainbow and a wide rim into grey mud.
 *   4. Chromium samples the bent picture nearest-neighbour: Skia's displacement effect is pinned to
 *      kNearest (skbug.com/40045448), so a 6.7× stretch at the rim copies every source pixel into a
 *      6.7px block and any hard edge behind the glass turns into stairs. Where the field does not
 *      fold it is split into two displacement passes of equal stretch that compose *exactly* to the
 *      one-pass field (the inner table is the inverse of the outer one, not a halving), with a
 *      `smooth`-px blur between them masked to the bevel ring. The centre is untouched.
 *   5. The filter chain interpolates in sRGB, so a linear-light ratio has to be re-encoded before it
 *      is multiplied in. Skipping that (^1/2.2) turns a caustic gain of 0.15 into a near-black
 *      outline instead of a shade.
 *   6. Never leave the glass on a resize. Until 0.4.0 the filter region was pinned to the size the
 *      map was built for, so the moment a chat bubble grew a line Chromium painted it unfiltered,
 *      and the "settle" mode papered over that with a plain blur plus a ramp back — which is a
 *      lens → frost → lens flicker at every pause in a streaming reply. The region is now the
 *      element's own box (objectBoundingBox), so between rebuilds the old map is merely stretched,
 *      and the rebuild itself is a single-frame swap: a freshly built filter renders correctly on
 *      its first frame, verified frame by frame.
 *   7. Pin the blurred backdrop opaque before the dispersion sum. The backdrop a reference filter
 *      receives ends at the element's box, so the blur fades the outermost rows to partial alpha,
 *      and summing three premultiplied channel passes there clamps the alpha while tripling the
 *      colour — a white hairline along the rim on the frames where the rim still samples its own
 *      boundary (the start of a materialize ramp). One feColorMatrix that sets alpha to 1 keeps the
 *      blurred colour and drops the fade; not applied in `self` mode, where the source is meant to
 *      be translucent.
 *
 * Caching, in two levels
 *   A *map* depends on geometry + bevel + thickness + slope + shape + shade + rim + edgeW + light;
 *   a *filter* adds blur, dispersion, smooth and self. A map build always produces both PNGs (outer
 *   and inner), so `smooth` can be toggled without a rebuild. So `setOpts({ blur })` rebuilds a
 *   handful of DOM nodes and reuses every map. Map sizes are bucketed (≤ 2 % per side; elements up
 *   to QZ_MIN px stay exact) so a column of chat bubbles a few pixels apart shares one map. The
 *   radii are deliberately *not* rescaled to match — that would put the element's own width back
 *   into the key and defeat the bucket; feImage squeezes the map by up to 2 % instead, which pulls
 *   the outline in by under half a pixel at ordinary radii. Maps whose last user went away stay
 *   warm (MAX_IDLE_MAPS of them), then go oldest-first.
 *
 * Notes
 *   · The materialize ramp runs on a private clone of the shared filter, so animating one element
 *     never touches another.
 *   · `self` mode exists because the 3-pass dispersion sum is only valid for opaque sources.
 *     On a translucent layer alpha is added three times and clamped, which darkens the colour.
 *   · `--hyalite` and `--hyalite-edge` are inherited custom properties: consume them only on the
 *     attached element.
 *   · Maps for large elements are downsampled (MAX_MAP_PX); the field is smooth, feImage stretches
 *     it back without visible loss. With four equal corners only one quadrant is computed and the
 *     other three are mirrored — the lit half of the edge profile is not symmetric, but recovering
 *     it costs one dot product.
 *   · Sizes come from offsetWidth/Height (layout box, transform-proof). Corner radii follow the CSS
 *     overlap rule — one shared shrink factor, not a per-corner clamp — so a 320×40 card with
 *     `border-radius: 24px 24px 0 0` really gets 24px corners. Elliptical radii use their horizontal
 *     value; % radii resolve against the shorter side.
 *   · Nothing is written to `--hyalite` when unsupported, so the CSS fallback wins. Firefox renders
 *     the element unfiltered for SVG backdrop filters; Safari keeps the blur only (a WebKit
 *     implementation is in review). When it ships, `Hyalite.force(true)` or
 *     `<html data-hyalite="force">` turns the engine on without editing this file.
 *   · Respects prefers-reduced-motion (no ramps).
 *   · feImage uses a data: URL — a strict CSP needs `img-src data:`.
 */
(function (root) {
  'use strict';
  if (root.Hyalite) return;

  const VAR = '--hyalite', VAR_EDGE = '--hyalite-edge';
  const N_GLASS = 1.5;             // refractive index of ordinary glass
  /* Defaults are the set VII-Cae tuned by eye on 2026-09-10: a narrow bevel over a very thick slab,
     with a folding slope. The centre stays clear while the edge concentrates the backdrop into a
     coloured band; the folding is confined to that narrow rim, where blur and dispersion cover the
     staircase Chromium's nearest-neighbour sampler leaves behind. */
  const DEFAULTS = { bevel: 37, thickness: 59, slope: 2.7, shape: 'squircle', blur: 1, dispersion: 1.6,
                     shade: 0.46, rim: 1.76, edgeW: 8, sat: 0.86, edge: 0.32, light: -140, smooth: 1,
                     materialize: 0, settle: 0, self: false };
  const LIMITS = { bevel: [1, 400], thickness: [0, 400], slope: [0.2, 4], blur: [0, 64], dispersion: [0, 8],
                   shade: [0, 2], rim: [0, 4], edgeW: [0.5, 64], sat: [0, 3], edge: [0, 2], light: [-180, 180],
                   smooth: [0, 4], materialize: [0, 10000], settle: [0, 10000] };
  const SHAPES = ['circle', 'squircle', 'lip'];
  /* Ratios inside `shade` and `rim`, and the three constants that came out of the same tuning pass.
     They are deliberately not options: the *balance* between them is what took the tuning, and two
     knobs that have to move together are worse than one. Change them here if you disagree.
     `sat` is an option rather than a constant because it fights a different thing — folding plus
     dispersion muddies the colour along the rim, and how much depends on what is behind the glass. */
  const ABSORB = 0.50 / 0.46;      // Fresnel transmission loss, as a share of `shade`
  const GLOW = 0.40 / 1.76;        // the wide Fresnel glow, as a share of `rim`
  const SHARP = 44;                // exponent of the tight specular line
  const LIP = 0.3;                 // how far the lip profile dips in the middle
  const AA_SLOPE = 0.3;            // rule 4: the ring blur is fully on where the inner pass still stretches ≥ ~1.4×
  const LIVE_MIN_MS = 90;          // live mode: at most one rebuild per this many ms while the size keeps moving
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
    if ('shape' in s && SHAPES.indexOf(s.shape) < 0) s.shape = DEFAULTS.shape;
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

  /* Bevel surface height H(x): x = 0 at the outer rim (lowest), 1 at the inner edge where it meets
     the slab. Only H' matters for the tilt; H itself gives the glass left above the ray. */
  const Hc = (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));            // quarter circle
  const Hs = (t) => Math.pow(Math.max(0, 1 - Math.pow(1 - t, 4)), 0.25);      // squircle — Apple's
  function heightFn(shape) {
    if (shape !== 'lip') return shape === 'squircle' ? Hs : Hc;
    /* A raised rim over a shallow dip. The perturbation has to reach zero in *both* value and
       slope at each end, or the bevel does not meet the slab and the join shows as a crease:
       sin²(πt)·cos(πt) is 0 with 0 derivative at t = 0 and 1, and changes sign in the middle —
       which is what tips the surface back the other way and gives the second pair of bands. */
    return (t) => Hc(t) + LIP * Math.pow(Math.sin(Math.PI * t), 2) * Math.cos(Math.PI * t);
  }
  /* Fresnel reflectance, unpolarised average: → 1 at grazing incidence, 0.04 head-on. */
  function fresnel(a) {
    a = Math.abs(a);
    const st = Math.sin(a) / N_GLASS;
    if (st >= 1) return 1;
    if (a < 1e-4) return 0.04;
    const b = Math.asin(st);
    const rs = Math.sin(a - b) / Math.sin(a + b), rp = Math.tan(a - b) / Math.tan(a + b);
    return Math.min(1, (rs * rs + rp * rp) / 2);
  }
  /* Refraction profile (Snell's law): a slab of thickness T0 under a bevel of width and height B.
     A vertical view ray refracts toward the surface normal, then crosses the glass left above it:
     offset = remaining thickness × tan(α − β). With `lip` the tilt goes negative in the middle and
     the offset pushes outward instead — the height used for the thickness stays the monotone
     quarter-circle envelope, since only the tilt reverses, not the amount of glass. */
  function profile(d, B, T0, H) {
    const x = Math.min(1, Math.max(0, d / B)), e = 1e-3;
    const x1 = Math.min(1, x + e), x0 = Math.max(0, x - e);
    const alpha = Math.atan((H(x1) - H(x0)) / (x1 - x0));
    const beta = Math.sign(alpha) * Math.asin(Math.min(1, Math.sin(Math.abs(alpha)) / N_GLASS));
    return { disp: (T0 + B * Hc(x)) * Math.tan(alpha - beta), alpha };
  }

  /* Build the maps. Returns { url, maxd, inner: { url, maxd }, split, twoPass }
     `url` is the one-pass field: R/G = offset ÷ maxd, B = the signed edge profile (128 = neutral,
     above = additive light, below = multiplicative shade). `inner` is the first pass of rule 4. */
  function buildMap(W, H, radii, o) {
    /* Rule 2 used to clamp the bevel to the largest corner radius. It no longer does: Apple's glass
       is a lens across the whole element — a circular key bends all the way to its centre — and a
       bevel locked to the radius can never get there. The clamp is the short side's half; near a
       corner tighter than the bevel the depth field still kinks on the medial axis, but the
       direction field below is taken from a larger rectangle, so the crease stays faint. */
    const B = Math.max(1, Math.min(o.bevel, Math.floor(Math.min(W, H) / 2) - 1));
    const Hf = heightFn(o.shape);
    // Displacement table with the slope constraint, built from the inner edge outward. Above 1 the
    // field folds: the same backdrop appears twice, which is where the liquid swirls come from.
    const STEP = 0.25, N = Math.ceil(B / STEP);
    const tab = new Float64Array(N + 1); tab[N] = 0;
    for (let i = N - 1; i >= 0; i--) tab[i] = Math.min(profile(i * STEP, B, o.thickness, Hf).disp, tab[i + 1] + o.slope * STEP);
    const MAXD = Math.max(...Array.from(tab, Math.abs), 1e-6);
    const lerp = (t, d) => { const f = Math.min(N - 1e-6, Math.max(0, d) / STEP), i = Math.floor(f), u = f - i; return t[i] * (1 - u) + t[i + 1] * u; };
    const mAt = (d) => lerp(tab, d);

    /* The signed edge profile. Positive is added as light, negative multiplies the backdrop down.
       · caustic — the screen point at depth d samples d + m(d), so ds/dd = 1 + m′ < 1: the backdrop
         is magnified and its energy spread thin. Derived from the field, not a taste knob. The
         filter chain interpolates in sRGB, so the linear-light ratio has to be re-encoded (^1/2.2)
         or a gain of 0.15 comes out as a near-black outline instead of a shade.
       · loss — the share Fresnel reflects away instead of transmitting.
       · glow + line — what comes back: a wide Fresnel sheen and a tight specular line at the rim.
       All four are windowed to `edgeW` px. That window is in absolute pixels on purpose: a white
       line and the dark hairline under it are one or two pixels of real glass whatever the bevel
       is, and scaling them with the bevel is what turns a 41px rim into a grey band. */
    const edge = new Float64Array(N + 1), gains = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const d = i * STEP, p = profile(d, B, o.thickness, Hf);
      const gain = Math.max(0.02, 1 + (tab[Math.min(N, i + 1)] - tab[i]) / STEP);
      const gainS = Math.pow(gain, 1 / 2.2); gains[i] = gainS;
      const win = Math.exp(-2.5 * d / o.edgeW);
      const t = Math.max(0, Math.sin(p.alpha));            // only an outward-facing slope catches the light
      edge[i] = ((fresnel(p.alpha) * o.rim * GLOW + Math.pow(t, SHARP) * o.rim)
               - ((1 - gainS) * o.shade + fresnel(p.alpha) * o.shade * ABSORB)) * win;
    }
    const eAt = (d) => lerp(edge, d);

    // Rule 4 (two passes that melt the nearest-neighbour staircase) needs the field to be
    // invertible; once it folds there is no split that composes back. Fold ⇒ single pass.
    const twoPass = o.slope <= 1;
    let sMax = 0;
    for (let i = 0; i < N; i++) sMax = Math.max(sMax, (tab[i] - tab[i + 1]) / STEP);
    const split = twoPass && sMax > 1e-6 ? (1 - Math.sqrt(1 - sMax)) / sMax : 0.5;
    const tab1 = new Float64Array(N + 1);
    if (twoPass) for (let j = 0; j <= N; j++) {
      const y = j * STEP;
      let lo = 0, hi = y <= split * MAXD ? 0 : B;
      for (let it = 0; it < 24 && hi > lo; it++) { const mid = (lo + hi) / 2; if (mid + split * mAt(mid) < y) lo = mid; else hi = mid; }
      tab1[j] = (1 - split) * mAt(hi);
    }
    const MAXD1 = Math.max(tab1[0], 1e-6);
    const m1At = (d) => lerp(tab1, d);
    const wAt = (d) => { const i = Math.floor(Math.min(N - 1e-6, Math.max(0, d) / STEP)); return Math.min(1, (tab1[i] - tab1[i + 1]) / STEP / AA_SLOPE); };

    const sdf = makeSDF(W, H, radii);
    /* Rule 3 widens the radii to smooth the direction field, capped at half the short side: past
       that makeSDF's rounded-rect formula stops holding (W/2 − R goes negative) and the gradient
       turns discontinuous on the axes — a circle showed it as a cross-shaped seam. */
    const cap = Math.min(W, H) / 2 - 0.5;
    const sdfDir = makeSDF(W, H, radii.map((R) => Math.min(R + B, cap)));
    const k = Math.min(1, Math.sqrt(MAX_MAP_PX / (W * H)));
    const MW = Math.max(2, Math.round(W * k)), MH = Math.max(2, Math.round(H * k));
    const c = document.createElement('canvas'); c.width = MW; c.height = MH;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(MW, MH), d = img.data;
    const img1 = ctx.createImageData(MW, MH), d1 = img1.data;
    const e = 0.5, L = lightOf(o.light);
    let m = 0, m1 = 0, w = 0, ee = 0;
    const put = (x, y, ux, uy, lit) => {
      const i = (y * MW + x) * 4;
      d[i] = Math.round(128 + ux * m / MAXD * 127);
      d[i + 1] = Math.round(128 + uy * m / MAXD * 127);
      d[i + 2] = Math.round(Math.max(0, Math.min(255, 128 + lit * 127)));   // signed: 128 = neutral
      d[i + 3] = 255;
      d1[i] = Math.round(128 + ux * m1 / MAXD1 * 127);
      d1[i + 1] = Math.round(128 + uy * m1 / MAXD1 * 127);
      d1[i + 2] = Math.round(255 * w);
      d1[i + 3] = 255;
    };
    /* Only the lit half is steered by the light — a shade is what the geometry took away and is the
       same all round. Not mirror-symmetric, but recovering it costs one dot product per quadrant. */
    const litOf = (gx, gy) => { if (ee <= 0) return ee; const f = gx * L[0] + gy * L[1]; return ee * (Math.max(0, f) * 0.78 + Math.max(0, -f) * 0.30); };
    const sym = radii[0] === radii[1] && radii[1] === radii[2] && radii[2] === radii[3];
    const XN = sym ? Math.ceil(MW / 2) : MW, YN = sym ? Math.ceil(MH / 2) : MH;
    for (let y = 0; y < YN; y++) for (let x = 0; x < XN; x++) {
      const px = (x + .5) / k, py = (y + .5) / k;
      const depth = -sdf(px, py);
      let gx = 0, gy = 0;
      m = 0; m1 = 0; w = 0; ee = 0;
      if (depth < B) {
        const dd = Math.max(0, depth);
        m = mAt(dd); m1 = twoPass ? m1At(dd) : 0; w = twoPass ? wAt(dd) : 0; ee = eAt(dd);
        gx = (sdfDir(px + e, py) - sdfDir(px - e, py)) / (2 * e);
        gy = (sdfDir(px, py + e) - sdfDir(px, py - e)) / (2 * e);
        const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;   // outward normal
      }
      put(x, y, -gx, -gy, litOf(gx, gy));                          // sample inward → the rim magnifies
      if (sym) {
        const mx = MW - 1 - x, my = MH - 1 - y;
        if (mx !== x) put(mx, y, gx, -gy, litOf(-gx, gy));
        if (my !== y) put(x, my, -gx, gy, litOf(gx, -gy));
        if (mx !== x && my !== y) put(mx, my, gx, gy, litOf(-gx, -gy));
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    let url1 = '';
    if (twoPass) { ctx.putImageData(img1, 0, 0); url1 = c.toDataURL('image/png'); }
    lastInfo = { maxDisplacement: MAXD, bevel: B, mapSize: [MW, MH], radii: radii.slice(),
                 map: url, mapInner: url1, split, twoPass, folds: o.slope > 1,
                 // sampled every STEP px from the outer rim inward — enough to plot the edge
                 profile: { step: STEP, m: Array.from(tab), edge: Array.from(edge), gain: Array.from(gains) } };
    return { url, maxd: MAXD, inner: { url: url1, maxd: MAXD1 }, split, twoPass };
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
     (one pass per channel when dispersion > 0) → the edge profile, shade first then light.
     `self` mode is displacement only (see notes).
     The region is the element's own box (objectBoundingBox 0 0 1 1), not the pixel size the map was
     built for: a feImage with no subregion of its own fills the region, and `preserveAspectRatio:
     none` stretches the map to it — so an element that grows keeps its glass, stretched, until the
     next rebuild (rule 6). The primitives stay in user space: blur radii and displacement scales
     are pixels. */
  function buildFilter(id, map, o) {
    const f = prim('filter', { id, filterUnits: 'objectBoundingBox', primitiveUnits: 'userSpaceOnUse',
                               x: 0, y: 0, width: 1, height: 1, 'color-interpolation-filters': 'sRGB' });
    const image = (url, result) => {
      const img = prim('feImage', { preserveAspectRatio: 'none', result });
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
    f.appendChild(prim('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: o.blur, result: 'softA' }));
    /* Rule 7: the backdrop handed to a reference filter stops dead at the element's box, so the blur
       fades its outermost rows into transparency. The dispersion pass sums three premultiplied
       images, which is only exact for opaque pixels — on those rows the alpha is clamped and the
       colour comes out up to three times too bright: a white hairline along the rim whenever the
       rim samples its own boundary, i.e. while the displacement is still near zero at the start of
       a materialize ramp (one or two frames, caught on a frame-by-frame recording of the island).
       feColorMatrix works on unpremultiplied colour, so pinning alpha to 1 here keeps the blurred
       colour and simply drops the fade — the rows are extended, not darkened. */
    f.appendChild(prim('feColorMatrix', { in: 'softA', type: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1', result: 'soft' }));
    let src = 'soft', scale = S;
    if (map.twoPass && o.smooth > 0) {                             // rule 4: inner pass, ring blur, then the outer pass
      f.appendChild(image(map.inner.url, 'inner'));
      f.appendChild(prim('feDisplacementMap', { in: 'soft', in2: 'inner', scale: (2 * map.inner.maxd).toFixed(2),
                                                xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }));
      f.appendChild(prim('feGaussianBlur', { in: 'bent', stdDeviation: o.smooth, result: 'bentSoft' }));
      f.appendChild(prim('feColorMatrix', { in: 'inner', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0', result: 'ring' }));
      const inv = prim('feComponentTransfer', { in: 'ring', result: 'ringInv' });
      inv.appendChild(prim('feFuncA', { type: 'table', tableValues: '1 0' }));
      f.appendChild(inv);
      f.appendChild(prim('feComposite', { in: 'bentSoft', in2: 'ring', operator: 'in', result: 'ringIn' }));
      f.appendChild(prim('feComposite', { in: 'bent', in2: 'ringInv', operator: 'in', result: 'ringOut' }));
      f.appendChild(prim('feComposite', { in: 'ringIn', in2: 'ringOut', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'mid' }));
      src = 'mid'; scale = S * map.split;
    }
    /* Dispersion is a fixed number of pixels, not a share of the displacement: the refractive index
       of glass differs between red and blue by a material constant, which has nothing to do with how
       strong the lens is. A scale difference of 2·sep moves the sample by sep. */
    if (o.dispersion > 0) {
      const d2 = 2 * o.dispersion;
      const scales = { R: scale - d2, G: scale, B: scale + d2 };
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
    /* The edge profile lives in the map's blue channel, signed around 128. Below neutral it darkens,
       and it has to darken by *multiplying*: subtracting would drive an already dark backdrop
       negative. feBlend multiply is used rather than feComposite arithmetic because arithmetic
       multiplies alpha too, and dimming the backdrop's alpha punches a hole in it. */
    f.appendChild(prim('feColorMatrix', { in: 'map', type: 'matrix',
      values: '0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 0 1', result: 'edgeRGB' }));   // RGB ← B, A ← 1
    const sh = prim('feComponentTransfer', { in: 'edgeRGB', result: 'shadeLayer' });
    for (const ch of ['R', 'G', 'B']) sh.appendChild(prim('feFunc' + ch, { type: 'table', tableValues: '0 1 1' }));
    f.appendChild(sh);
    f.appendChild(prim('feBlend', { in: 'glass', in2: 'shadeLayer', mode: 'multiply', result: 'shaded' }));
    /* Saturation, inside the bevel ring only. Folding shows the same backdrop twice and dispersion
       pulls the channels apart, which together muddy the colour along the rim; pulling saturation
       down there cleans it without touching the centre (rule 1 of the recipe: never restyle what is
       behind the glass). The ring mask needs no extra channel — the centre has zero displacement,
       so |R − ½| + |G − ½| *is* the ring. */
    let base = 'shaded';
    if (o.sat !== 1) {
      for (const [ch, row] of [['R', '1 0 0 0 0'], ['G', '0 1 0 0 0']]) {
        f.appendChild(prim('feColorMatrix', { in: 'map', type: 'matrix',
          values: `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${row}`, result: 'rg' + ch }));   // RGB ← white, A ← that channel
        const tf = prim('feComponentTransfer', { in: 'rg' + ch, result: 'ring' + ch });
        tf.appendChild(prim('feFuncA', { type: 'table', tableValues: '1 0 1' }));      // |v − ½| × 2
        f.appendChild(tf);
      }
      f.appendChild(prim('feComposite', { in: 'ringR', in2: 'ringG', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'ring' }));
      f.appendChild(prim('feColorMatrix', { in: 'shaded', type: 'saturate', values: o.sat, result: 'satd' }));
      const inv = prim('feComponentTransfer', { in: 'ring', result: 'ringInv' });
      inv.appendChild(prim('feFuncA', { type: 'table', tableValues: '1 0' }));
      f.appendChild(inv);
      f.appendChild(prim('feComposite', { in: 'satd', in2: 'ring', operator: 'in', result: 'satIn' }));
      f.appendChild(prim('feComposite', { in: 'shaded', in2: 'ringInv', operator: 'in', result: 'satOut' }));
      f.appendChild(prim('feComposite', { in: 'satIn', in2: 'satOut', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'glassSat' }));
      base = 'glassSat';
    }
    // Above neutral it is light the glass sends back, so it adds. The table takes the upper half;
    // the linear pass after it is what `materialize` ramps.
    f.appendChild(prim('feColorMatrix', { in: 'map', type: 'matrix',
      values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0', result: 'litA' }));      // RGB ← white, A ← B
    const lt = prim('feComponentTransfer', { in: 'litA', result: 'litHalf' });
    lt.appendChild(prim('feFuncA', { type: 'table', tableValues: '0 0 1' }));
    f.appendChild(lt);
    const lg = prim('feComponentTransfer', { in: 'litHalf', result: 'litLayer' });
    lg.appendChild(prim('feFuncA', { type: 'linear', slope: 1, intercept: 0 }));
    f.appendChild(lg);
    f.appendChild(prim('feComposite', { in: 'litLayer', in2: base, operator: 'over' }));
    return f;
  }

  /* The sharp outer line is CSS, not filter: feImage downsamples large maps and Chromium samples the
     bent picture nearest-neighbour, and a half-pixel line survives neither. Inset shadows are drawn
     on the element itself, so they stay crisp and follow border-radius for free — and they show up
     in Safari and Firefox too, which get no refraction at all. */
  function edgeShadow(o) {
    const a = o.edge;
    if (a <= 0) return 'none';
    const rad = o.light * Math.PI / 180, dx = Math.sin(rad).toFixed(2), dy = (-Math.cos(rad)).toFixed(2);
    return [
      `inset 0 0 0 .5px rgba(255,255,255,${(0.72 * a).toFixed(3)})`,                  // the line itself
      `inset ${dx}px ${dy}px 0 .5px rgba(255,255,255,${(0.55 * a).toFixed(3)})`,      // brighter into the light
      `inset 0 0 0 1.5px rgba(0,0,0,${(0.16 * a).toFixed(3)})`,                       // the hairline of dark under it
      `inset 0 0 6px 2px rgba(255,255,255,${(0.07 * a).toFixed(3)})`,                 // one faint band further in
    ].join(',');
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
    const key = `${BW}x${BH}|${br.join(',')}|${o.bevel}|${o.thickness}|${o.slope}|${o.shape}|${o.shade}|${o.rim}|${o.edgeW}|${o.light}`;
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
      rec = { id, refs: 0, el: buildFilter(id, map, o), mapKey: map.key };
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
    const key = `${W}x${H}|${radii.join(',')}|${o.bevel}|${o.thickness}|${o.slope}|${o.shape}|${o.shade}|${o.rim}|${o.edgeW}|${o.sat}|${o.blur}|${o.dispersion}|${o.light}|${o.smooth}|${o.self ? 'self' : 'back'}`;
    st.w = W; st.h = H;
    let rec;
    if (key === st.key) rec = filters.get(key);       // same geometry (e.g. back from a settle): just re-point
    else { rec = acquire(key, W, H, radii, o); if (st.key) release(st.key); st.key = key; }
    if (!rec) return;
    el.style.setProperty(VAR_EDGE, o.self ? 'none' : edgeShadow(o));
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
    // the light is the linear pass after the half-table; the shade is the three tables that multiply
    const litN = tmp.querySelector('[result="litLayer"] feFuncA');
    const shadeN = Array.from(tmp.querySelectorAll('[result="shadeLayer"] > *'));
    dms.forEach(({ n }) => n.setAttribute('scale', '0'));
    if (litN) litN.setAttribute('slope', '0');
    shadeN.forEach((n) => n.setAttribute('tableValues', '1 1 1'));   // 1 = multiply by one = no shade
    ensureHost().appendChild(tmp);
    el.style.setProperty(VAR, `url(#${tmp.id})`);
    const key = st.key;
    let t0 = -1;      // taken from the first frame's own clock: a rAF timestamp can trail performance.now(), and a negative t would flip the displacement outward for a frame
    const step = (now) => {
      // rebuilt or detached meanwhile: whoever did that owns the variable now
      if (bound.get(el) !== st || st.key !== key) { tmp.remove(); return; }
      if (t0 < 0) t0 = now;
      const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3);
      dms.forEach(({ n, s }) => n.setAttribute('scale', (s * k).toFixed(2)));
      if (litN) litN.setAttribute('slope', k.toFixed(3));
      shadeN.forEach((n) => n.setAttribute('tableValues', `${(1 - k).toFixed(3)} 1 1`));
      if (t < 1) requestAnimationFrame(step);
      else { el.style.setProperty(VAR, `url(#${rec.id})`); tmp.remove(); }
    };
    requestAnimationFrame(step);
  }

  /* Size changes (rule 6: the glass stays on throughout — the region follows the element, so the
     current map is stretched until the rebuild). settle > 0 coalesces: one rebuild, `settle` ms
     after the last change. settle = 0 is live: the first change of a burst rebuilds right here,
     inside the ResizeObserver callback — that runs after layout and before paint, so the frame that
     shows the new size already shows the new map; while changes keep coming they are throttled to
     one rebuild per LIVE_MIN_MS, and a trailing one lands after the last of them. */
  function onResize(el) {
    const st = bound.get(el);
    if (!st) return;
    const [W, H] = sizeOf(el);
    if (W === st.w && H === st.h) return;            // the observer's initial notification, or no real change
    if (st.opts.settle > 0) {
      clearTimeout(st.timer);
      st.timer = setTimeout(() => { st.timer = 0; apply(el, 0); }, st.opts.settle);
    } else schedule(el);
  }
  function schedule(el) {
    const st = bound.get(el);
    if (!st) return;
    if (st.timer) { st.pending = true; return; }
    const wait = Math.max(0, LIVE_MIN_MS - (performance.now() - (st.last || 0)));
    const run = () => {
      st.timer = 0; st.last = performance.now();
      apply(el, 0);
      if (st.pending) { st.pending = false; schedule(el); }
    };
    if (wait === 0) return run();                    // synchronous: before this frame paints
    st.timer = setTimeout(run, wait);
  }

  function attach(el, opts, watcher) {
    if (bound.has(el) || !supported()) return;      // unsupported: write nothing, the CSS fallback wins
    const st = { key: '', opts: sanitize(Object.assign({}, DEFAULTS, opts || {})), ro: null, timer: 0, pending: false,
                 last: 0, w: 0, h: 0, watcher: watcher || null };
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
    el.style.removeProperty(VAR_EDGE);
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

  /* Which watcher owns an element *right now*: the first one whose container still contains it and
     whose selector it still matches. Insertion order breaks ties, which is what "whoever attached
     first keeps it" already meant. */
  function ownerOf(el) {
    if (!el.isConnected) return null;
    for (const w of watchers) if (w.container.contains(el) && el.matches(w.selector)) return w;
    return null;
  }
  /* Reconcile one element against that answer. A move between two observed containers produces two
     records in the same microtask — an addition in the new container, a removal from the old — and
     they arrive in observer-creation order, which has nothing to do with what happened. Acting on
     each record on its own loses the element whenever the addition lands first: the new watcher's
     attach is skipped because it is still bound to the old one, and then the old watcher's detach
     unbinds it for good, with nothing left watching it. Deciding from where the element *is* makes
     the order irrelevant — which matters for drag and drop, remounts and reordered lists. */
  function reconcile(el) {
    const st = bound.get(el);
    if (st && !st.watcher) return;                  // attached by hand: watchers never touch it
    const owner = ownerOf(el);
    if (!owner) { if (st) detach(el); return; }
    if (!st) { attach(el, owner.opts, owner); return; }
    if (st.watcher !== owner) { detach(el); attach(el, owner.opts, owner); }   // handover
  }

  /* Watch a container: matching elements present now, added later, or gaining the class later are
     attached; removed ones or ones losing the class are detached. Returns { stop }. Several watchers
     can coexist, and an element can move between them. */
  function watch(container, selector, opts) {
    const w = { container, selector, opts: sanitize(Object.assign({}, DEFAULTS, opts || {})), mo: null };
    const matches = (node) => {
      const out = [];
      if (node.nodeType !== 1) return out;
      if (node.matches(selector)) out.push(node);
      out.push(...node.querySelectorAll(selector));
      return out;
    };
    w.mo = new MutationObserver((muts) => {
      const touched = new Set();
      for (const m of muts) {
        if (m.type === 'attributes') { touched.add(m.target); continue; }
        m.addedNodes.forEach((n) => matches(n).forEach((el) => touched.add(el)));
        m.removedNodes.forEach((n) => matches(n).forEach((el) => touched.add(el)));
      }
      touched.forEach(reconcile);
    });
    w.mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    watchers.add(w);
    container.querySelectorAll(selector).forEach((el) => { if (!bound.has(el)) attach(el, w.opts, w); });
    return { stop: () => stopWatcher(w) };
  }
  function stopWatcher(w) {
    if (!watchers.has(w)) return;
    w.mo.disconnect();
    watchers.delete(w);
    // Hand anything it owned to a watcher that still covers it, rather than stripping the glass off
    // an element some other watcher is also watching.
    Array.from(bound.entries()).filter(([, st]) => st.watcher === w).forEach(([el]) => { detach(el); reconcile(el); });
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

  const API = { watch, unwatch, attach, detach, refresh, setOpts, info, supported, force, DEFAULTS, version: '0.5.0' };
  root.Hyalite = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
