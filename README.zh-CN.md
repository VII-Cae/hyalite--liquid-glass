# hyalite

网页上的真折射液态玻璃。一个文件，不用 WebGL，不用构建。

把元素当成一块边缘带圆倒角的玻璃：按它的尺寸和四个圆角算一张透镜贴图，塞进一个 SVG 滤镜，再用 `backdrop-filter: url(#…)` 让浏览器把元素**背后**的画面弯过去。中心清透，边缘像厚玻璃那样把外面的世界往里拉。直线是弯的，不是糊的。

> 名字来自 hyalite，一种水一样透明、有玻璃光泽的蛋白石。念起来像 highlight，边上那道光正是这个引擎最讲究的东西。

![网格底上的透镜：位移场在四角收成扇形，不折叠、不出棱。](demo/shots/playground-grid.jpg)

- **演示：** [`demo/index.html`](demo/index.html) 试验台：普通模糊 vs hyalite，滑杆、拖动、网格底或你自己的照片。
- **演示：** [`demo/island.html`](demo/island.html) 一个不依赖任何东西的灵动岛：从唱片长成卡片，落定的那一刻折射「凝」出来。

只有 Chromium 会折射；Firefox、Safari 退回普通模糊，见下文。

## 用法

```html
<script src="hyalite.js"></script>
```

```css
.glass {
  /* 引擎往每个挂上的元素写 --hyalite；别的浏览器用括号里的兜底 */
  backdrop-filter: var(--hyalite, blur(6px));
  -webkit-backdrop-filter: var(--hyalite, blur(6px));
  /* 玻璃自己的颜色画在折射之上，不参与采样 */
  background: rgba(0, 0, 0, .13);
  border-radius: 24px;
}
```

```js
// 盯着容器：现在有的和以后加进来的 .glass 都挂上，被删的自动撤掉，尺寸变了自动重算
Hyalite.watch(document.getElementById('app'), '.glass', { bevel: 16, thickness: 10, blur: 3 });

// 或者一个一个来
Hyalite.attach(card, { bevel: 24, thickness: 10, blur: 0.5, materialize: 220 });
Hyalite.detach(card);
```

## API

| 调用 | 作用 |
|---|---|
| `Hyalite.watch(container, selector, opts)` | 现有的和后来出现的匹配元素都挂上，移除时撤掉 |
| `Hyalite.unwatch()` | 停止盯着，撤掉 watch 挂的（手动 attach 的不动） |
| `Hyalite.attach(el, opts)` / `Hyalite.detach(el)` | 手动控制单个元素 |
| `Hyalite.setOpts(opts)` | 改参数，所有已挂元素分帧重算；返回 Promise |
| `Hyalite.info()` | 最近一次建图的 `{ maxDisplacement, bevel, mapSize }` |
| `Hyalite.supported()` | 只有 SVG backdrop 滤镜真能渲染的地方（Chromium）才是 true |
| `Hyalite.DEFAULTS` | 默认参数 |

### 参数

| 参数 | 默认 | 含义 |
|---|---|---|
| `bevel` | 16 | 边缘弯折带的宽度，px。会被封到圆角半径以内（规矩二） |
| `thickness` | 10 | 玻璃厚度，px。决定边缘把背景往里拉多远 |
| `blur` | 3 | 中心的磨砂，px |
| `dispersion` | 0.05 | 色散，0–0.16。设 0 只做一次位移，GPU 省一半 |
| `rim` | 0.45 | 随几何走的边缘光，0–1.6。0 关掉 |
| `materialize` | 0 | 毫秒。首次建图时位移和边缘光从零推到目标值。Apple 的玻璃不是淡入，是弯光渐强 |
| `self` | false | 元素用 `filter: var(--hyalite)` 滤自己而不是滤背后。只做位移，见下文 |
| `onBuild(info)` | — | 每次建图后回调 |

滤镜按「尺寸＋四个圆角＋参数」缓存，几何相同的元素共用一张贴图。大元素的贴图会降采样（位移场是平滑的，`feImage` 拉伸回去看不出）。尺寸取排版盒，transform 不会把贴图弄歪。圆角支持百分比。

## 原理

1. **距离场。** 圆角矩形（四角各自半径）的有符号距离函数，告诉每个像素它离边缘多深。
2. **斯涅尔定律。** 玻璃是厚 `thickness` 的平板加宽 `bevel` 的四分之一圆倒角。视线在倒角表面折向法线（n = 1.5），再穿过剩余厚度落到背景上，横向偏移就是位移：贴边最大，到倒角内沿归零。
3. **不许折叠。** 位移的衰减斜率封顶 0.85 px/px。到 1 采样点就不动了（无限拉伸），超过 1 画面镜像，边上出现叠线。
4. **方向。** 位移沿着一个稍大的圆角矩形（半径＋倒角）的法线**向内**，「竖直往里拉」到「水平往里拉」的转向铺在更长的弧上。按真圆角取方向的话，每个角都像一道棱。
5. **编码。** 红＝横向偏移，绿＝纵向偏移，128＝不动，蓝＝边缘光（倒角朝光的程度）。贴图是一张 PNG data URL。
6. **滤镜。** `feImage`（贴图）→ `feGaussianBlur`（磨砂）→ `feDisplacementMap`（一次，或色散时每个颜色通道一次再用 `feComposite arithmetic` 相加）→ 边缘光叠在上面。`filterUnits="userSpaceOnUse"` 用元素的精确尺寸，`color-interpolation-filters="sRGB"` 让 128 真的等于零。
7. **`backdrop-filter: url(#id)`** 负责剩下的事：实时，对元素背后的一切。

三条规矩，违反哪条都会留下肉眼可见的痕迹：位移不许折叠；倒角不超过圆角（超过会走到距离场的中轴线，四角长出对角折痕）；方向要从大圆取。

## 浏览器支持

| | `backdrop-filter: url()` | 你看到的 |
|---|---|---|
| Chrome、Edge、Arc、Brave、Electron（Chromium） | 渲染 | 折射 |
| Safari / WebKit | 接受属性，丢掉 SVG 部分（[bug 245510](https://bugs.webkit.org/show_bug.cgi?id=245510)） | CSS 里的兜底模糊 |
| Firefox | 声称支持，实际**整块不画**（[bug 1787623](https://bugzilla.mozilla.org/show_bug.cgi?id=1787623)） | 兜底模糊——Hyalite 在那里不会写 `--hyalite` |

`CSS.supports('backdrop-filter', 'url(#x)')` 在三家都返回 true，所以 `Hyalite.supported()` 还会认一下是不是 Chromium 引擎。W3C 有一个[开放的提案](https://github.com/w3c/svgwg/issues/1142)在推动背景位移的标准化。

## 坑

- 放滤镜的隐藏 `<svg>` 不能 `display:none`（Blink 会忽略里面的滤镜）。Hyalite 用 0×0 的盒子。
- `--hyalite` 是会继承的自定义属性。只在被挂上的元素自己身上消费它；子元素再读一次会套上按父元素算的滤镜。
- 三通道色散相加只对不透明源成立。半透明层的 alpha 会被加三遍再截到 1，颜色按预乘值压暗——`self: true` 就是为了避开它（只做位移）。
- 每个带 backdrop 滤镜的元素都是一个独立的渲染面。一屏几十个没问题，几百个不行。页面忙的时候把 `dispersion` 设成 0。
- 贴图是 `data:` URL，严格的 CSP 需要 `img-src data:`。
- 尺寸一直在变的元素（流式长高的气泡）每 90ms 最多重算一次，最后一次变化必定补算。形状变形的元素照岛的做法：变形期间显示普通模糊，落定后带 `materialize` 挂上。

## 致谢

Apple 的 Liquid Glass（WWDC25）给了「玻璃该弯光而不是散射光」这个想法。SVG 位移这条路很多人探过，[kube.io](https://kube.io/blog/liquid-glass-css-svg/) 的物理推导最清楚。Hyalite 自己的部分是：不折叠约束、大圆方向场、四角各自半径、materialize 渐入，以及一套能在真实页面上活下来的 watch/attach API。

MIT © 2026 VII-Cae
