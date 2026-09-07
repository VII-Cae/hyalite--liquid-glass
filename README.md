# hyalite

Real refraction “liquid glass” for the web. One file, no WebGL, no build step.

Hyalite treats an element as a slab of glass with a rounded bevel. For the element’s exact size and corner radii it computes a lens map, feeds it to an SVG filter, and lets the browser bend whatever is *behind* the element through `backdrop-filter: url(#…)`. The centre stays clear; the edge pulls the world inward the way a thick piece of glass does. Straight lines curve, not smear.

> Named after hyalite, the water-clear glassy opal. It also sounds like *highlight*, which is what the edge is about.

![The lens on a grid: the field fans into the corners, nothing folds, nothing creases.](demo/shots/playground-grid.jpg)

- **Demo:** [`demo/index.html`](demo/index.html) — playground: plain blur vs hyalite, sliders, drag, a grid background or your own photo.
- **Demo:** [`demo/island.html`](demo/island.html) — a dependency-free dynamic island that morphs from a record to a card and *materializes* its refraction when it lands.

Chromium only. Firefox and Safari fall back to a plain blur (see [Browser support](#browser-support)).

## Use

```html
<link rel="stylesheet" href="your.css">
<script src="hyalite.js"></script>
```

```css
.glass {
  /* the engine writes --hyalite on each attached element; every other browser keeps the fallback */
  backdrop-filter: var(--hyalite, blur(6px));
  -webkit-backdrop-filter: var(--hyalite, blur(6px));
  /* colour the glass *above* the refraction, never inside it */
  background: rgba(0, 0, 0, .13);
  border-radius: 24px;
}
```

```js
// every .glass inside #app, now and later (MutationObserver); resized ones are rebuilt (ResizeObserver)
Hyalite.watch(document.getElementById('app'), '.glass', { bevel: 16, thickness: 10, blur: 3 });

// or one element at a time
Hyalite.attach(card, { bevel: 24, thickness: 10, blur: 0.5, materialize: 220 });
Hyalite.detach(card);
```

## API

| call | what it does |
|---|---|
| `Hyalite.watch(container, selector, opts)` | attach every match now and as it appears; detach on removal |
| `Hyalite.unwatch()` | stop watching and detach what `watch` attached (manual attaches survive) |
| `Hyalite.attach(el, opts)` / `Hyalite.detach(el)` | manual control of one element |
| `Hyalite.setOpts(opts)` | retune every attached element, a few per frame; returns a Promise |
| `Hyalite.info()` | `{ maxDisplacement, bevel, mapSize }` of the last build |
| `Hyalite.supported()` | `true` only where SVG backdrop filters actually render (Chromium) |
| `Hyalite.DEFAULTS` | the option defaults |

### Options

| option | default | meaning |
|---|---|---|
| `bevel` | 16 | width of the bent zone along the edge, px. Clamped to the corner radius (rule 2) |
| `thickness` | 10 | glass thickness, px. Drives how far the edge pulls the backdrop inward |
| `blur` | 3 | frost in the centre, px |
| `dispersion` | 0.05 | chromatic aberration, 0–0.16. `0` is a single displacement pass and half the GPU cost |
| `rim` | 0.45 | geometry-aware edge light, 0–1.6. `0` turns it off |
| `materialize` | 0 | ms. On the first build, ramp displacement and rim light from zero. Apple’s glass does not fade in; its lensing ramps up |
| `self` | false | the element filters *itself* (`filter: var(--hyalite)`) instead of its backdrop. Displacement only — see notes |
| `onBuild(info)` | — | called after every map build |

Filters are cached by size + corner radii + options, so elements with the same geometry share one map. Large elements get a downsampled map (the field is smooth; `feImage` stretches it back without visible loss). Sizes are read from the layout box, so transforms don’t break the map. Percentage radii work.

## How it works

1. **Distance field.** A signed distance function of the rounded rectangle (per-corner radii) gives, for every pixel, how deep inside the edge it sits.
2. **Snell’s law.** The glass is a slab of `thickness` with a quarter-circle bevel of width `bevel`. A view ray refracts toward the surface normal at the bevel (n = 1.5) and travels through the remaining glass to the backdrop. The lateral offset is the displacement; it is largest at the rim and decays to zero at the inner edge of the bevel.
3. **No folding.** The decay slope is capped at 0.85 px/px. At 1 the sampling point stands still (infinite stretch); above 1 the image mirrors and you get doubled lines along the rim.
4. **Direction.** Offsets point *inward* along the normal of a slightly larger rounded rect (radius + bevel), so the turn from “pull down” to “pull right” is spread along a longer arc. Taking the direction from the true radius makes every corner look like a ridge.
5. **Encoding.** Red = x offset, green = y offset, 128 = no move, blue = rim light (how much the bevel faces the light). The map is a PNG data URL.
6. **The filter.** `feImage` (the map) → `feGaussianBlur` (frost) → `feDisplacementMap` (one pass, or one per colour channel when `dispersion > 0`, summed with `feComposite arithmetic`) → the rim light composited over. `filterUnits="userSpaceOnUse"` with the element’s exact size, `color-interpolation-filters="sRGB"` so that 128 really means zero.
7. **`backdrop-filter: url(#id)`** does the rest, live, for whatever is behind the element.

Three rules that each leave a visible artifact when broken: displacement must not fold; bevel must not exceed the corner radius (past that the field reaches the distance field’s medial axis and every corner grows a diagonal crease); direction must come from the larger rect.

## Browser support

| | `backdrop-filter: url()` | what you get |
|---|---|---|
| Chrome, Edge, Arc, Brave, Electron (Chromium) | renders | refraction |
| Safari / WebKit | accepts the property, drops the SVG part ([bug 245510](https://bugs.webkit.org/show_bug.cgi?id=245510)) | the CSS fallback blur |
| Firefox | reports support, paints **nothing** ([bug 1787623](https://bugzilla.mozilla.org/show_bug.cgi?id=1787623)) | the CSS fallback blur — Hyalite never writes `--hyalite` there |

`CSS.supports('backdrop-filter', 'url(#x)')` is true on all three, which is why `Hyalite.supported()` also checks for a Chromium engine. There is an open [W3C issue](https://github.com/w3c/svgwg/issues/1142) about making backdrop displacement interoperable.

## Gotchas

- The hidden `<svg>` that holds the filters must not be `display:none` (Blink ignores those filters). Hyalite uses a 0×0 box.
- `--hyalite` is an inherited custom property. Consume it only on the attached element; a child that also reads it would apply a filter built for its parent.
- The 3-pass dispersion sum is only valid for opaque sources. On a translucent layer alpha is summed three times and clamped, which darkens the colour — that is what `self: true` avoids (displacement only).
- Every element with a backdrop filter is its own render surface. Dozens on screen are fine; hundreds are not. Keep `dispersion` at 0 on busy pages.
- The map is a `data:` URL: a strict CSP needs `img-src data:`.
- If an element is animated in size (a growing bubble), builds are throttled to one per 90 ms and the final size always gets a build. For a shape morph, do what the island demo does: show a plain blur while the shape moves, attach with `materialize` once it lands.

## Credits

Apple’s Liquid Glass (WWDC25) for the idea that glass should *bend* light rather than scatter it. The SVG-displacement approach has been explored by many; [kube.io](https://kube.io/blog/liquid-glass-css-svg/) has the clearest physics write-up. Hyalite’s contributions are the no-fold constraint, the larger-radius direction field, per-corner radii, the materialize ramp, and a small watch/attach API that survives real pages.

MIT © 2026 VII-Cae
