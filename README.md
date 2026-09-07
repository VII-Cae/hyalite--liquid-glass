# hyalite

Real refraction “liquid glass” for the web. One file, no WebGL, no build step.

Hyalite treats an element as a slab of glass with a rounded bevel. For the element’s exact size and corner radii it computes a lens map, feeds it to an SVG filter, and lets the browser bend whatever is *behind* the element through `backdrop-filter: url(#…)`. The centre stays clear; the edge pulls the world inward the way a thick piece of glass does. Straight lines curve, not smear.

> Named after hyalite, the water-clear glassy opal. It also sounds like *highlight*, which is what the edge is about.

**Live:** [playground](https://vii-cae.github.io/hyalite--liquid-glass/demo/index.html) · [regression cases](https://vii-cae.github.io/hyalite--liquid-glass/demo/cases.html) — open them in a Chromium browser.

![The lens on a grid: the field fans into the corners, nothing folds, nothing creases.](demo/shots/playground-grid.jpg)

- [`demo/index.html`](https://vii-cae.github.io/hyalite--liquid-glass/demo/index.html) — plain blur vs hyalite on the same background: drag, swap, tune bevel / thickness / blur / dispersion / rim, switch to a grid or load your own photo.
- [`demo/cases.html`](https://vii-cae.github.io/hyalite--liquid-glass/demo/cases.html) — self-checking page: asymmetric, elliptical and overlap-rule radii, twins sharing a filter, size buckets, quarter-symmetry read back out of the map, a streaming bubble, clamps read back rather than assumed.
- [`demo/run-cases.mjs`](https://github.com/VII-Cae/hyalite--liquid-glass/blob/main/demo/run-cases.mjs) — not a page to open: a command-line script that runs `cases.html` in a real headless Chromium and prints red/green with an exit code. `npm test`, or `node demo/run-cases.mjs` (Node 22+, no dependencies). Real time on purpose — `--virtual-time-budget` fast-forwards timers without promising frames, and two cases wait on a `requestAnimationFrame` ramp and a `ResizeObserver`, so under virtual time they report false failures.

## Use

```html
<script src="hyalite.js"></script>
```

```css
.glass {
  /* Hyalite writes --hyalite on each attached element; every other browser keeps the fallback */
  backdrop-filter: var(--hyalite, blur(6px));
  -webkit-backdrop-filter: var(--hyalite, blur(6px));
  /* colour the glass *above* the refraction, never inside it */
  background: rgba(0, 0, 0, .13);
  border-radius: 24px;
}
```

```js
// every .glass inside #app, now and later; resized ones are rebuilt; several watchers can coexist
const chat = Hyalite.watch(document.getElementById('app'), '.glass', { bevel: 16, thickness: 10, blur: 3 });
chat.stop();

// or one element at a time
Hyalite.attach(card, { bevel: 24, thickness: 10, blur: 0.5, materialize: 220 });
Hyalite.refresh(card);   // after a border-radius change that did not change the size
Hyalite.detach(card);
```

## API

| call | what it does |
|---|---|
| `Hyalite.watch(container, selector, opts)` → `{ stop }` | attach every match now, when it is added, or when it gains the class; detach on removal. Several watchers can coexist |
| `Hyalite.unwatch()` | stop every watcher (manual attaches survive) |
| `Hyalite.attach(el, opts)` / `Hyalite.detach(el)` | manual control of one element |
| `Hyalite.refresh(el)` | force a rebuild for the current geometry |
| `Hyalite.setOpts(opts)` | retune every attached element, a few per frame; returns a Promise. A newer call supersedes an older one |
| `Hyalite.info()` | `{ maxDisplacement, bevel, mapSize, radii, map }` of the last *map* build |
| `Hyalite.supported()` | `true` only where SVG backdrop filters actually render (Chromium) |
| `Hyalite.force(true \| false \| null)` | override that verdict; `null` goes back to sniffing. Returns the new verdict |
| `Hyalite.DEFAULTS` | the option defaults |

### Options

All numeric options are clamped to sane ranges.

| option | default | meaning |
|---|---|---|
| `bevel` | 16 | width of the bent zone along the edge, px. Clamped to the largest corner radius (see [Corners](#corners)) |
| `thickness` | 10 | glass thickness, px. Drives how far the edge pulls the backdrop inward |
| `blur` | 3 | frost in the centre, px |
| `dispersion` | 0.05 | chromatic aberration, 0–0.5. `0` is a single displacement pass and noticeably cheaper |
| `rim` | 0.45 | geometry-aware edge light, 0–4. `0` turns it off |
| `light` | −20 | direction the rim light comes from, degrees. `0` is straight above, positive turns clockwise |
| `materialize` | 0 | ms. On attach, ramp displacement and rim light from zero. Apple’s glass does not fade in; its lensing ramps up |
| `settle` | 120 | ms. While an element keeps resizing it shows a plain blur of the same radius; `settle` ms after the last change the map is rebuilt once and the refraction ramps back in. `0` = live mode: throttled rebuilds with the old map stretched meanwhile |
| `self` | false | the element filters *itself* (`filter: var(--hyalite)`) instead of its backdrop. Displacement only — see [Gotchas](#gotchas) |
| `onBuild(info)` | — | called after every *map* build — a filter rebuilt from a cached map does not build one |

### Caching, in two levels

A **map** depends only on geometry + `bevel` + `thickness` + `light`. A **filter** adds `blur`, `dispersion`, `rim` and `self`. So `setOpts({ blur })` rebuilds a handful of DOM nodes and reuses every map that is already in memory.

Map sizes go into buckets (at most 2 % per side; elements up to 64px stay exact), so a column of chat bubbles a few pixels apart shares one map instead of one map each — which is the difference between one canvas and fifty. The radii are deliberately *not* rescaled to match the bucket: pre-scaling them would put the element’s own width back into the cache key and defeat the whole thing. `feImage` squeezes the bucketed map onto the real box instead, pulling the outline in by under half a pixel at ordinary radii. Maps whose last user went away stay warm for a while, then go oldest-first.

The materialize ramp runs on a private clone of the shared filter, so animating one element never touches another. Large elements get a downsampled map (the field is smooth; `feImage` stretches it back without visible loss). Sizes are read from the layout box, so transforms don’t break the map.

### Corners

Per-corner *circular* radii are exact: each corner uses its own radius in the distance field. The bevel is clamped to the **largest** corner, on purpose — a chat bubble with a 6px tail would otherwise lose its refraction along every edge. Near a corner smaller than the bevel the depth field kinks on the medial axis, but the direction field is taken from a larger rectangle, so the kink is faint. Radii follow the CSS overlap rule: they are shrunk by one *shared* factor, and only when two radii sharing an edge do not fit on it — never clamped corner by corner. That distinction is visible: a 320×40 card with `border-radius: 24px 24px 0 0` really gets 24px corners, and a per-corner clamp to half the short side would draw the refraction at 20 while the browser drew the glass at 24. A radius past half the short side is honoured near the edge, where the bevel lives; deeper in, the quadrant SDF is an approximation. Elliptical radii (`40px / 16px`) are approximated by their horizontal value; percentage radii resolve against the shorter side.

## How it works

1. **Distance field.** A signed distance function of the rounded rectangle (per-corner radii) gives, for every pixel, how deep inside the edge it sits.
2. **Snell’s law.** The glass is a slab of `thickness` with a quarter-circle bevel of width `bevel`. A view ray refracts toward the surface normal at the bevel (n = 1.5) and travels through the remaining glass to the backdrop. The lateral offset is the displacement; it is largest at the rim and decays to zero at the inner edge of the bevel.
3. **No folding.** The decay slope is capped at 0.85 px/px. At 1 the sampling point stands still (infinite stretch); above 1 the image mirrors and you get doubled lines along the rim. This is a constraint on the mapping, not a taste parameter.
4. **Direction.** Offsets point *inward* along the normal of a slightly larger rounded rect (radius + bevel), so the turn from “pull down” to “pull right” is spread along a longer arc. Taking the direction from the true radius makes every corner look like a ridge.
5. **Encoding.** Red = x offset, green = y offset, 128 = no move, blue = rim light (how much the bevel faces the light). The map is a PNG data URL.
6. **The filter.** `feImage` (the map) → `feGaussianBlur` (frost) → `feDisplacementMap` (one pass, or one per colour channel when `dispersion > 0`, summed with `feComposite arithmetic`) → the rim light composited over. `filterUnits="userSpaceOnUse"` with the element’s exact size, `color-interpolation-filters="sRGB"` so that 128 really means zero.
7. **`backdrop-filter: url(#id)`** does the rest, live, for whatever is behind the element.

## Browser support

Tested September 2026.

| engine | `backdrop-filter: url(#svg)` | what you get |
|---|---|---|
| Chromium — Chrome, Edge, Arc, Brave, Electron | renders | refraction |
| WebKit — Safari | accepts the property, drops the SVG part ([bug 245510](https://bugs.webkit.org/show_bug.cgi?id=245510), an implementation is in review as of Sep 2026) | your CSS fallback |
| Gecko — Firefox | does not implement SVG filter graphs in `backdrop-filter`; since Firefox 106 the element renders unfiltered instead of disappearing ([bug 1787623](https://bugzilla.mozilla.org/show_bug.cgi?id=1787623)) | your CSS fallback |

`CSS.supports('backdrop-filter', 'url(#x)')` is true on all three, which is why `Hyalite.supported()` also checks for a Chromium engine and writes nothing elsewhere. There is an open [W3C issue](https://github.com/w3c/svgwg/issues/1142) about making backdrop displacement interoperable; when WebKit ships, the engine check is the one line to revisit — but you should not have to wait for us. That sniff is a snapshot of September 2026 and there is no way to read back what a backdrop filter actually painted, so it comes with an escape hatch: `Hyalite.force(true)`, or `<html data-hyalite="force">`, turns the engine on without editing the file; `force(false)` / `data-hyalite="off"` turns it off; `force(null)` goes back to sniffing.

## Performance

- Every element with a backdrop filter is its own render surface. A modest number of glass surfaces on screen is fine; hundreds are not. `dispersion: 0` drops two displacement passes and two composites per surface.
- Maps are built on the main thread (a per-pixel loop plus a PNG encode). With the default `settle`, a continuously resizing element costs one build after it stops, not one per frame. Maps are capped at ≈ 320k pixels.
- Two things keep that loop off the critical path: with four equal corners only one quadrant is computed and the other three are mirrored (≈ 75 % less per-pixel work — the rim light is not mirror-symmetric, but recovering it from a mirrored normal costs one dot product), and near-identical sizes share one map, so a long chat list does not build one map per bubble.
- No numbers are claimed here on purpose; measure on your own targets.

## Gotchas

- The hidden `<svg>` that holds the filters must not be `display:none` (Blink ignores those filters). Hyalite uses a 0×0 box.
- `--hyalite` is an inherited custom property. Consume it only on the attached element; a child that also reads it would apply a filter built for its parent.
- The 3-pass dispersion sum is only valid for opaque sources. On a translucent layer alpha is summed three times and clamped, which darkens the colour — that is what `self: true` avoids (displacement only).
- For a shape morph (a pill growing into a card): set `--hyalite: blur(<your blur>px)` yourself while the shape moves, then `attach` with `materialize` once it lands. The map is built for a size; do not attach to an element that is still changing shape.
- The map is a `data:` URL: a strict CSP needs `img-src data:`.

## Credits and prior art

Apple’s Liquid Glass (WWDC25) for the idea that glass should *bend* light rather than scatter it. Rounded-rect SDF → refraction → displacement map → `feDisplacementMap` is a route several projects have taken; [kube.io](https://kube.io/blog/liquid-glass-css-svg/) has the clearest physics write-up. Hyalite’s implementation-specific choices are the no-fold constraint, the larger-radius direction field, per-corner radii, maps built for the real element size, the settle/materialize behaviour, the private ramp clone, and a small watch/attach API that survives real pages.

Engineering by Claude Fable 5.1 (0.1.0) and Claude Opus 5 (0.2.0: the two-level cache and size buckets, the CSS overlap rule for radii, quarter-symmetry, `light`, `force`, and a self-check page that reads values back instead of trusting that nothing threw) — both Anthropic, both pair-programmed with VII-Cae, who set the direction, tested every build by eye and tuned every parameter.

MIT © 2026 VII-Cae
