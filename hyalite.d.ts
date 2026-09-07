export interface HyaliteInfo { maxDisplacement: number; bevel: number; mapSize: [number, number]; }
export interface HyaliteOptions {
  /** width of the bent zone along the edge, px (clamped to the largest corner radius) */ bevel?: number;
  /** glass thickness, px */ thickness?: number;
  /** frost in the centre, px */ blur?: number;
  /** chromatic aberration 0–0.5 (0 = single pass) */ dispersion?: number;
  /** geometry-aware edge light 0–4 (0 = off) */ rim?: number;
  /** ms: ramp displacement and rim from 0 on attach */ materialize?: number;
  /** ms of size stability before a rebuild (0 = live throttled rebuilds) */ settle?: number;
  /** the element filters itself (`filter:`) instead of its backdrop */ self?: boolean;
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
  DEFAULTS: Readonly<Required<Omit<HyaliteOptions, 'onBuild'>>>;
  version: string;
}
declare const Hyalite: HyaliteAPI;
export default Hyalite;
declare global { interface Window { Hyalite: HyaliteAPI; } }
