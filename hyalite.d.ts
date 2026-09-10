/** The bevel's cross-section. `squircle` meets the slab more gently than a quarter circle; `lip` is
 *  raised at the rim and dipped behind it, which reverses the tilt in the middle and adds a second
 *  pair of light/dark bands. */
export type HyaliteShape = 'circle' | 'squircle' | 'lip';

/** The edge profile, sampled every `step` px from the outer rim inward. */
export interface HyaliteProfile {
  /** sample spacing in px */ step: number;
  /** displacement at each sample, px (negative pushes outward — only `lip` does that) */ m: number[];
  /** the signed edge profile: > 0 is light added, < 0 multiplies the backdrop down */ edge: number[];
  /** brightness factor the caustic implies, sRGB-encoded (1 = untouched) */ gain: number[];
}

export interface HyaliteInfo {
  maxDisplacement: number;
  bevel: number;
  /** pixel size of the map actually built (bucketed, and downsampled past ≈ 320k px) */ mapSize: [number, number];
  /** the element's own corner radii in px, after the CSS overlap rule */ radii: [number, number, number, number];
  /** the map itself (R/G offsets, B the signed edge profile), as a PNG data URL */ map: string;
  /** the inner pass of the two-pass split, as a PNG data URL; empty when the field folds */ mapInner: string;
  /** share of the field carried by the outer pass, 0–1 */ split: number;
  /** whether the two-pass anti-staircase split is in use */ twoPass: boolean;
  /** whether the displacement folds (slope > 1) — which is what rules the split out */ folds: boolean;
  profile: HyaliteProfile;
}

export interface HyaliteOptions {
  /** width of the bent zone along the edge, px. Clamped to half the short side — not to the corner radius */ bevel?: number;
  /** glass thickness, px: how far the edge pulls the backdrop inward */ thickness?: number;
  /** cap on the displacement's decay slope, px/px. Above 1 the field folds — where the liquid swirls come from, and what rules out `smooth` */ slope?: number;
  /** the bevel's cross-section */ shape?: HyaliteShape;
  /** frost in the centre, px */ blur?: number;
  /** chromatic aberration in *pixels* of channel separation (0 = single pass, cheaper) */ dispersion?: number;
  /** how much the edge darkens, 0–2: the caustic plus the Fresnel transmission loss */ shade?: number;
  /** how much light the edge sends back, 0–4: a wide Fresnel sheen plus a tight specular line */ rim?: number;
  /** px: how far in the shading and the sheen reach. Absolute, not a share of the bevel */ edgeW?: number;
  /** saturation inside the bevel ring, 0–3. Folding plus dispersion muddies the colour there; below 1 cleans it. 1 = off */ sat?: number;
  /** strength of the CSS rim written to `--hyalite-edge`, 0–2 (0 writes `none`) */ edge?: number;
  /** light direction in degrees: 0 = straight above, positive = clockwise */ light?: number;
  /** px: blur that hides Chromium's nearest-neighbour staircase along the rim, inside the bevel ring only. Ignored when the field folds. 0 = one pass */ smooth?: number;
  /** ms: ramp displacement, shade and rim from 0 on attach */ materialize?: number;
  /** ms of size stability before a rebuild (0 = live throttled rebuilds) */ settle?: number;
  /** the element filters itself (`filter:`) instead of its backdrop — displacement only */ self?: boolean;
  /** called after every *map* build; a filter rebuilt from a cached map does not build one */
  onBuild?: (info: HyaliteInfo) => void;
}

export interface HyaliteWatcher { stop(): void; }

export interface HyaliteAPI {
  watch(container: Element, selector: string, opts?: HyaliteOptions): HyaliteWatcher;
  unwatch(): void;
  attach(el: Element, opts?: HyaliteOptions): void;
  detach(el: Element): void;
  refresh(el: Element): void;
  setOpts(opts: HyaliteOptions): Promise<void>;
  info(): HyaliteInfo | null;
  supported(): boolean;
  /** override the engine sniff; `null` goes back to sniffing. Returns the new verdict */
  force(on: boolean | null): boolean;
  DEFAULTS: Readonly<Required<Omit<HyaliteOptions, 'onBuild'>>>;
  version: string;
}

declare const Hyalite: HyaliteAPI;
export default Hyalite;
declare global { interface Window { Hyalite: HyaliteAPI; } }
