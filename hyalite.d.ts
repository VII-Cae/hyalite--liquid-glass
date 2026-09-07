export interface HyaliteInfo {
  maxDisplacement: number;
  bevel: number;
  /** pixel size of the map actually built (bucketed, and downsampled past ≈ 320k px) */ mapSize: [number, number];
  /** the element's own corner radii in px, after the CSS overlap rule */ radii: [number, number, number, number];
  /** the map itself (one-pass field: R/G offsets, B rim light), as a PNG data URL */ map: string;
  /** the inner pass of the two-pass split (R/G offsets, B ring mask), as a PNG data URL */ mapInner: string;
  /** share of the field carried by the outer pass, 0–1 */ split: number;
}
export interface HyaliteOptions {
  /** width of the bent zone along the edge, px (clamped to the largest corner radius) */ bevel?: number;
  /** glass thickness, px */ thickness?: number;
  /** frost in the centre, px */ blur?: number;
  /** chromatic aberration 0–0.5 (0 = single pass) */ dispersion?: number;
  /** geometry-aware edge light 0–4 (0 = off) */ rim?: number;
  /** light direction in degrees: 0 = straight above, positive = clockwise */ light?: number;
  /** px: blur that hides Chromium's nearest-neighbour staircase along the rim, applied inside the bevel ring only. 0 = one pass, no hiding */ smooth?: number;
  /** ms: ramp displacement and rim from 0 on attach */ materialize?: number;
  /** ms of size stability before a rebuild (0 = live throttled rebuilds) */ settle?: number;
  /** the element filters itself (`filter:`) instead of its backdrop */ self?: boolean;
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
