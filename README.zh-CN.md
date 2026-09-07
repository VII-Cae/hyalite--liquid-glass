# hyalite

网页上的真折射液态玻璃。一个文件，不用 WebGL，不用构建。

把元素当成一块边缘带圆倒角的玻璃：按它的尺寸和四个圆角算一张透镜贴图，塞进一个 SVG 滤镜，再用 `backdrop-filter: url(#…)` 让浏览器把元素**背后**的画面弯过去。中心清透，边缘像厚玻璃那样把外面的世界往里拉。直线是弯的，不是糊的。

> 名字来自 hyalite，一种水一样透明、有玻璃光泽的蛋白石。念起来像 highlight，边上那道光正是这个引擎最讲究的东西。

**在线：** [试验台](https://vii-cae.github.io/hyalite--liquid-glass/demo/index.html) · [回归用例](https://vii-cae.github.io/hyalite--liquid-glass/demo/cases.html) —— 用 Chromium 系浏览器打开。

![网格底上的透镜：位移场在四角收成扇形，不折叠、不出棱。](demo/shots/playground-grid.jpg)

- [`demo/index.html`](https://vii-cae.github.io/hyalite--liquid-glass/demo/index.html) 试验台：同一背景上普通模糊 vs hyalite，可拖、可交换，调倒角 / 厚度 / 模糊 / 色散 / 边缘光，切网格底或上传自己的照片。
- [`demo/cases.html`](https://vii-cae.github.io/hyalite--liquid-glass/demo/cases.html) 自检页：不对称圆角、椭圆圆角、共用滤镜的双胞胎、流式长高的气泡、参数封顶。

## 用法

```html
<script src="hyalite.js"></script>
```

```css
.glass {
  /* Hyalite 往每个挂上的元素写 --hyalite；别的浏览器用括号里的兜底 */
  backdrop-filter: var(--hyalite, blur(6px));
  -webkit-backdrop-filter: var(--hyalite, blur(6px));
  /* 玻璃自己的颜色画在折射之上，不参与采样 */
  background: rgba(0, 0, 0, .13);
  border-radius: 24px;
}
```

```js
// 盯着容器：现在有的、以后加进来的、以后才获得这个 class 的 .glass 都挂上；移除或失去 class 就撤掉。可以同时有多个
const chat = Hyalite.watch(document.getElementById('app'), '.glass', { bevel: 16, thickness: 10, blur: 3 });
chat.stop();

// 或者一个一个来
Hyalite.attach(card, { bevel: 24, thickness: 10, blur: 0.5, materialize: 220 });
Hyalite.refresh(card);   // 圆角变了但尺寸没变时，强制重算
Hyalite.detach(card);
```

## API

| 调用 | 作用 |
|---|---|
| `Hyalite.watch(container, selector, opts)` → `{ stop }` | 现有的、后来加进来的、后来获得 class 的匹配元素都挂上；移除或失去 class 就撤掉。可以同时有多个 watcher |
| `Hyalite.unwatch()` | 停掉所有 watcher（手动 attach 的不动） |
| `Hyalite.attach(el, opts)` / `Hyalite.detach(el)` | 手动控制单个元素 |
| `Hyalite.refresh(el)` | 按当前几何强制重算 |
| `Hyalite.setOpts(opts)` | 改参数，所有已挂元素分帧重算；返回 Promise。后来的调用会取代先前的 |
| `Hyalite.info()` | 最近一次建图的 `{ maxDisplacement, bevel, mapSize }` |
| `Hyalite.supported()` | 只有 SVG backdrop 滤镜真能渲染的地方（Chromium）才是 true |
| `Hyalite.DEFAULTS` | 默认参数 |

### 参数

数值参数都会被封到合理范围内。

| 参数 | 默认 | 含义 |
|---|---|---|
| `bevel` | 16 | 边缘弯折带的宽度，px。封到最大那个圆角以内（见[圆角](#圆角)） |
| `thickness` | 10 | 玻璃厚度，px。决定边缘把背景往里拉多远 |
| `blur` | 3 | 中心的磨砂，px |
| `dispersion` | 0.05 | 色散，0–0.5。设 0 只做一次位移，明显更省 |
| `rim` | 0.45 | 随几何走的边缘光，0–4。0 关掉 |
| `materialize` | 0 | 毫秒。挂上时位移和边缘光从零推到目标值。Apple 的玻璃不是淡入，是弯光渐强 |
| `settle` | 120 | 毫秒。元素尺寸还在变的时候显示同半径的普通模糊；最后一次变化过去 `settle` 毫秒后重算一次贴图，折射再渐入。设 0 是实时模式：节流重算，中途旧贴图被拉伸 |
| `self` | false | 元素用 `filter: var(--hyalite)` 滤自己而不是滤背后。只做位移，见[坑](#坑) |
| `onBuild(info)` | — | 每次建图后回调 |

滤镜按「尺寸＋四个圆角＋参数」缓存，几何相同的元素共用一张贴图；渐入动画跑在私有的克隆滤镜上，动一个元素不会碰到另一个。大元素的贴图会降采样（位移场是平滑的，`feImage` 拉伸回去看不出）。尺寸取排版盒，transform 不会把贴图弄歪。

### 圆角

四角各自的**圆形**半径是精确的：距离场里每个角用自己的半径。倒角封到**最大**那个角，这是故意的：聊天气泡那种 6px 的小尾角，不能把整条边的折射压扁。比倒角小的角附近，深度场会在中轴线上打个折，但方向场是按更大的矩形算的，折痕很轻。椭圆圆角（`40px / 16px`）按横向那个值近似；百分比按短边算。这不是 CSS 圆角归一化的完整复刻。

## 原理

1. **距离场。** 圆角矩形（四角各自半径）的有符号距离函数，告诉每个像素它离边缘多深。
2. **斯涅尔定律。** 玻璃是厚 `thickness` 的平板加宽 `bevel` 的四分之一圆倒角。视线在倒角表面折向法线（n = 1.5），再穿过剩余厚度落到背景上，横向偏移就是位移：贴边最大，到倒角内沿归零。
3. **不许折叠。** 位移的衰减斜率封顶 0.85 px/px。到 1 采样点就不动了（无限拉伸），超过 1 画面镜像，边上出现叠线。这是对映射的约束，不是口味参数。
4. **方向。** 位移沿着一个稍大的圆角矩形（半径＋倒角）的法线**向内**，「竖直往里拉」到「水平往里拉」的转向铺在更长的弧上。按真圆角取方向的话，每个角都像一道棱。
5. **编码。** 红＝横向偏移，绿＝纵向偏移，128＝不动，蓝＝边缘光（倒角朝光的程度）。贴图是一张 PNG data URL。
6. **滤镜。** `feImage`（贴图）→ `feGaussianBlur`（磨砂）→ `feDisplacementMap`（一次，或色散时每个颜色通道一次再用 `feComposite arithmetic` 相加）→ 边缘光叠在上面。`filterUnits="userSpaceOnUse"` 用元素的精确尺寸，`color-interpolation-filters="sRGB"` 让 128 真的等于零。
7. **`backdrop-filter: url(#id)`** 负责剩下的事：实时，对元素背后的一切。

## 浏览器支持

2026 年 9 月测试。

| 引擎 | `backdrop-filter: url(#svg)` | 你看到的 |
|---|---|---|
| Chromium：Chrome、Edge、Arc、Brave、Electron | 渲染 | 折射 |
| WebKit：Safari | 接受属性，丢掉 SVG 部分（[bug 245510](https://bugs.webkit.org/show_bug.cgi?id=245510)，2026 年 9 月已有实现在评审中） | 你写的兜底 |
| Gecko：Firefox | 没有实现 `backdrop-filter` 里的 SVG 滤镜图；从 Firefox 106 起元素按未过滤渲染，不再消失（[bug 1787623](https://bugzilla.mozilla.org/show_bug.cgi?id=1787623)） | 你写的兜底 |

`CSS.supports('backdrop-filter', 'url(#x)')` 在三家都返回 true，所以 `Hyalite.supported()` 还会认一下是不是 Chromium 引擎，别处什么都不写。W3C 有一个[开放的提案](https://github.com/w3c/svgwg/issues/1142)在推动背景位移的标准化；WebKit 发布之后，要改的就是引擎检查那一行。

## 性能

- 每个带 backdrop 滤镜的元素都是一个独立的渲染面。一屏适量的玻璃没问题，几百个不行。`dispersion: 0` 每个面少两次位移和两次合成。
- 贴图在主线程上算（逐像素循环加一次 PNG 编码）。默认的 `settle` 让持续变尺寸的元素只在停下后算一次，而不是每帧一次。贴图封顶约 32 万像素。
- 这里故意不给数字；在你自己的目标机器上量。

## 坑

- 放滤镜的隐藏 `<svg>` 不能 `display:none`（Blink 会忽略里面的滤镜）。Hyalite 用 0×0 的盒子。
- `--hyalite` 是会继承的自定义属性。只在被挂上的元素自己身上消费它；子元素再读一次会套上按父元素算的滤镜。
- 三通道色散相加只对不透明源成立。半透明层的 alpha 会被加三遍再截到 1，颜色按预乘值压暗——`self: true` 就是为了避开它（只做位移）。
- 形状变形的元素（药丸长成卡片）：变形期间自己把 `--hyalite` 写成 `blur(你的模糊px)`，落定后再带 `materialize` 挂上。贴图是按尺寸算的，别挂到还在变形的元素上。
- 贴图是 `data:` URL，严格的 CSP 需要 `img-src data:`。

## 致谢与先行者

Apple 的 Liquid Glass（WWDC25）给了「玻璃该弯光而不是散射光」这个想法。圆角矩形 SDF → 折射 → 位移贴图 → `feDisplacementMap` 这条路已有不少项目走过，[kube.io](https://kube.io/blog/liquid-glass-css-svg/) 的物理推导最清楚。Hyalite 自己的实现取舍是：不折叠约束、大圆方向场、四角各自半径、按真实元素尺寸建图、settle / materialize 行为、私有的渐入克隆，以及一套能在真实页面上活下来的 watch/attach API。

工程实现：Claude Fable 5.1（Anthropic），与 VII-Cae 结对完成；VII-Cae 负责方向、每一版的目测验收和每一个参数的手调。

MIT © 2026 VII-Cae
