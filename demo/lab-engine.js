/*!
 * lab-engine — hyalite 0.4.0 的试验场引擎。跟 hyalite.js 并存、互不干扰，
 * 由 demo/edge-lab.html（调参）和 demo/card.html（出图）共用。
 *
 * 跟 0.3.1 的差别：
 *   · 贴图 B 通道从「单峰加性白光」改成「带符号的明暗剖面」（128 中性，>128 加性提亮、
 *     <128 乘性压暗），滤镜链末端多一次 feBlend multiply，再加一段环内饱和。
 *   · 倒角剖面可选 circle / squircle / lip；位移斜率上限可调，>1 即允许折叠。
 *   · 材料光学（色散、白边、暗带）一律按绝对像素；只有几何（倒角、位移）按比例。
 *   · 最外那道锐白边不进滤镜，走 CSS 的多层 inset box-shadow（写到 `--edge`）。
 *
 * 用法：
 *   LabGlass.attach(el, opts, withEdge)   写 el 的 --gl（backdrop-filter）和 --edge（box-shadow）
 *   LabGlass.DEFAULTS                     默认档
 *   LabGlass.lastMap()                    最后一次建的贴图，带剖面数组（示波器用）
 */
(function (root) {
  'use strict';

    /* 默认档 —— 安琪 26-09-10 手调定下来的那组：窄倒角（被圆角锁住）＋ 超大厚度 ＋ 允许折叠。
       中心保持干净，边缘把背景浓缩成一条带颜色的延伸；折叠只发生在窄边里，
       最近邻采样的毛刺被 blur ＋ 色散正好盖住。 */
    const DEFAULTS = {
      bevel: 41, thickness: 96, slope: 2.7, fill: 1, shape: 'squircle', lip: 0.3,
      caustic: 0.62, edgeW: 6.5, sat: 1.1, absorb: 0.46, env: 0.4, spec: 1.76, sharp: 44,
      blur: 1, dispersion: 1.6, light: -140, cssEdge: 0.32,
    };

  const SVGNS='http://www.w3.org/2000/svg', N_GLASS=1.5;

  /* 倒角的表面高度 H(x)：x=0 在外沿（低），x=1 在内沿（接平面，高=1） */
  const Hc = t => Math.sqrt(Math.max(0,1-(1-t)*(1-t)));                 // 凸圆
  const Hs = t => Math.pow(Math.max(0,1-Math.pow(1-t,4)),0.25);         // squircle
  function heightFn(shape, lipAmt){
    const base = shape==='squircle' ? Hs : Hc;
    if (shape!=='lip') return base;
    // 唇形：在凸圆上叠一个起伏 —— 外沿抬高（唇），中段压低（浅碟）。
    // 中段的 H′ 因此变号，表面反向倾斜，位移跟着反向，这就是第二组明暗带。
    // 扰动必须两端「值和导数」都归零，否则内沿接不上平面，会留一道折痕：
    // sin²(πt)·cos(πt) 在 t=0,1 处 D=0 且 D′=0，中段先正后负。
    return t => base(t) + lipAmt*Math.sin(Math.PI*t)**2*Math.cos(Math.PI*t);
  }
  /* 菲涅尔反射率（非偏振平均）。掠射角 → 1，正射 → 0.04 */
  function fresnel(a){
    a = Math.abs(a);
    const st = Math.sin(a)/N_GLASS;
    if (st>=1) return 1;
    if (a<1e-4) return 0.04;
    const b = Math.asin(st);
    const rs = Math.sin(a-b)/Math.sin(a+b), rp = Math.tan(a-b)/Math.tan(a+b);
    return Math.min(1,(rs*rs+rp*rp)/2);
  }
  /* 一条剖面：给定深度 d（0 = 外沿），返回位移、倾角、厚度 */
  function profile(d, B, T0, H){
    const x = Math.min(1,Math.max(0,d/B)), e = 1e-3;
    const dh = (H(Math.min(1,x+e)) - H(Math.max(0,x-e))) / (Math.min(1,x+e)-Math.max(0,x-e));
    const alpha = Math.atan(dh);                       // 表面倾角（lip 中段为负）
    const beta  = Math.sign(alpha)*Math.asin(Math.min(1,Math.sin(Math.abs(alpha))/N_GLASS));
    const z     = T0 + B*Math.max(0,Math.min(1,Hc(x))); // 剩余厚度：走单调的凸圆包络，lip 只改倾角
    return { disp: z*Math.tan(alpha-beta), alpha };
  }

  /* 建贴图。R/G = 位移方向×大小，B = 带符号的明暗剖面，A = 255 */
  function buildMap(W,H,radii,o){
    // 铁律 2 说倒角 ≤ 最大圆角，超了四角会出对角折痕。可 iOS 的倒角就是铺满半个元素的
    // —— 圆形按钮整个圆都在弯。fill 打开就无视圆角，只封在短边的一半。
    const rMax = Math.max(1,...radii);
    const lim = o.fill ? Math.floor(Math.min(W,H)/2)-1 : Math.min(rMax, Math.floor(Math.min(W,H)/2)-1);
    const B = Math.max(1, Math.min(o.bevel, lim));
    const MAX_SLOPE = o.slope;
    const Hf = heightFn(o.shape, o.lip);
    const STEP=.25, N=Math.ceil(B/STEP);

    // 位移表：从内沿往外建，斜率封顶（铁律 1：不许折叠）
    const tab=new Float64Array(N+1); tab[N]=0;
    for(let i=N-1;i>=0;i--) tab[i]=Math.min(profile(i*STEP,B,o.thickness,Hf).disp, tab[i+1]+MAX_SLOPE*STEP);
    const MAXD=Math.max(...Array.from(tab,Math.abs),1e-6);
    const at=(t,d)=>{const f=Math.min(N-1e-6,Math.max(0,d)/STEP),i=Math.floor(f),u=f-i;return t[i]*(1-u)+t[i+1]*u;};

    // ── 明暗剖面 E(d)：正 = 加性提亮，负 = 乘性压暗 ────────────────
    // 1) 焦散：屏幕上的 d 采样到 d+m(d)，ds/dd = 1+m′ < 1 ⇒ 背景被放大 ⇒ 能量摊薄 ⇒ 变暗。
    //    这一项完全由位移场导出，不用额外参数：厚度越大位移越陡，边缘就越暗。
    // 2) 透射损失：菲涅尔反射拿走的那部分光。
    // 3) 环境反光 + 白边：反射回来的环境光，掠射角处最强；白边再叠一次高次幂的锐高光。
    const edge=new Float64Array(N+1), gainArr=new Float64Array(N+1);
    for(let i=0;i<=N;i++){
      const d=i*STEP, p=profile(d,B,o.thickness,Hf);
      const mp=(tab[Math.min(N,i+1)]-tab[i])/STEP;
      const gain=Math.max(0.02,1+mp);
      // 能量摊薄是线性光下的比例，可这条滤镜链跑在 sRGB 里（color-interpolation-filters="sRGB"），
      // 乘的是编码值 —— 得先换算过去，否则 gain 0.15 会压成一圈近黑的描边。
      const gainS=Math.pow(gain,1/2.2); gainArr[i]=gainS;   // 示波器画的也是这条（实际生效的那条）
      // 边缘的明暗带是「材料」不是「几何」：白边和紧贴它的暗线在真玻璃上就是固定的
      // 一两个像素，不该随倒角变宽而变宽。edgeW 直接给绝对像素宽度，倒角从 16 涨到 65
      // 也不会把这条带一起拉长 —— 跟色散必须是固定像素是同一个道理。
      const win = Math.exp(-2.5*d/Math.max(.5,o.edgeW));
      const dark = ((1-gainS)*o.caustic + fresnel(p.alpha)*o.absorb) * win;
      // 掠射高光只属于向外倾斜的那段坡：lip 中段是向内凹的，那里对着的是另一侧的环境，不该发光
      const t=Math.max(0,Math.sin(p.alpha));
      const lit = (fresnel(p.alpha)*o.env + Math.pow(t,o.sharp)*o.spec) * win;
      edge[i]=lit-dark;
    }
    const eAt=d=>at(edge,d);

    const sdf=makeSDF(W,H,radii);
    // 铁律 3：方向取更大的圆角。但圆角一旦超过短边的一半，makeSDF 的圆角矩形公式就不成立
    // （W/2−R 变负，min(max(qx,qy),0) 恒为 0），梯度方向错乱 —— 圆形上会裂出一个十字接缝。
    const cap=Math.min(W,H)/2-.5;
    const sdfDir=makeSDF(W,H,radii.map(R=>Math.min(R+B,cap)));
    const k=Math.min(1,Math.sqrt(320000/(W*H)));
    const MW=Math.max(2,Math.round(W*k)), MH=Math.max(2,Math.round(H*k));
    const c=document.createElement('canvas'); c.width=MW; c.height=MH;
    const ctx=c.getContext('2d'), img=ctx.createImageData(MW,MH), px=img.data;
    const e=.5, L=[Math.sin(o.light*Math.PI/180), -Math.cos(o.light*Math.PI/180)];

    for(let y=0;y<MH;y++) for(let x=0;x<MW;x++){
      const cxp=(x+.5)/k, cyp=(y+.5)/k, depth=-sdf(cxp,cyp);
      let m=0,ee=0,gx=0,gy=0;
      if(depth<B){
        const dd=Math.max(0,depth);
        m=at(tab,dd); ee=eAt(dd);
        gx=(sdfDir(cxp+e,cyp)-sdfDir(cxp-e,cyp))/(2*e);
        gy=(sdfDir(cxp,cyp+e)-sdfDir(cxp,cyp-e))/(2*e);
        const gl=Math.hypot(gx,gy)||1; gx/=gl; gy/=gl;
        // 方向性只调「亮」的那一半：迎光更亮，背光留一点点。压暗是各向同性的。
        if(ee>0){ const f=gx*L[0]+gy*L[1]; ee*= (Math.max(0,f)*0.78 + Math.max(0,-f)*0.30); }
      }
      const i=(y*MW+x)*4;
      px[i  ]=Math.round(128 + (-gx)*m/MAXD*127);
      px[i+1]=Math.round(128 + (-gy)*m/MAXD*127);
      px[i+2]=Math.round(Math.max(0,Math.min(255, 128 + ee*127)));   // 带符号：128 = 中性
      px[i+3]=255;
    }
    ctx.putImageData(img,0,0);
    return { url:c.toDataURL('image/png'), maxd:MAXD, B, tab, edge, gainArr, STEP, N };
  }
  function makeSDF(W,H,r){
    const cx=W/2, cy=H/2;
    return (x,y)=>{
      const dx=x-cx, dy=y-cy;
      const R = dx<0 ? (dy<0?r[0]:r[3]) : (dy<0?r[1]:r[2]);
      const qx=Math.abs(dx)-(W/2-R), qy=Math.abs(dy)-(H/2-R);
      return Math.min(Math.max(qx,qy),0)+Math.hypot(Math.max(qx,0),Math.max(qy,0))-R;
    };
  }

  const prim=(n,a)=>{const el=document.createElementNS(SVGNS,n);for(const k in a)el.setAttribute(k,a[k]);return el;};
  const ONLY={R:'1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
              G:'0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
              B:'0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'};

  function buildFilter(id,W,H,map,o){
    const f=prim('filter',{id,filterUnits:'userSpaceOnUse',primitiveUnits:'userSpaceOnUse',
                           x:0,y:0,width:W,height:H,'color-interpolation-filters':'sRGB'});
    const im=prim('feImage',{x:0,y:0,width:W,height:H,preserveAspectRatio:'none',result:'map'});
    im.setAttribute('href',map.url);
    im.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href',map.url);
    f.appendChild(im);
    f.appendChild(prim('feGaussianBlur',{in:'SourceGraphic',stdDeviation:o.blur,result:'soft'}));

    const S=2*map.maxd;
    if(o.dispersion>0){
      // 色散是玻璃的材料常数 —— 三个通道的折射率差是固定的，通道分离量该是固定像素，
      // 不是位移的百分比。按比例写的话，位移一大（整块透镜）就炸成红黄蓝。
      // scale = 2·maxd 对应最大位移 maxd，所以差 2·px 就是差 px 个像素。
      const d2=2*o.dispersion;
      const sc={R:S-d2,G:S,B:S+d2};
      for(const ch of ['R','G','B']){
        f.appendChild(prim('feDisplacementMap',{in:'soft',in2:'map',scale:sc[ch].toFixed(2),
                                                xChannelSelector:'R',yChannelSelector:'G',result:'d'+ch}));
        f.appendChild(prim('feColorMatrix',{in:'d'+ch,type:'matrix',values:ONLY[ch],result:'c'+ch}));
      }
      f.appendChild(prim('feComposite',{in:'cR',in2:'cG',operator:'arithmetic',k1:0,k2:1,k3:1,k4:0,result:'cRG'}));
      f.appendChild(prim('feComposite',{in:'cRG',in2:'cB',operator:'arithmetic',k1:0,k2:1,k3:1,k4:0,result:'glass'}));
    } else {
      f.appendChild(prim('feDisplacementMap',{in:'soft',in2:'map',scale:S.toFixed(2),
                                              xChannelSelector:'R',yChannelSelector:'G',result:'glass'}));
    }

    /* ── 明暗剖面：B<128 走乘性压暗，B>128 走加性提亮 ─────────────
       压暗必须是乘法（背景本来就暗的地方不该被减出负值），用 feBlend multiply；
       alpha 走 Porter-Duff，不会像 feComposite arithmetic 那样把 backdrop 的 alpha 一起压掉。 */
    f.appendChild(prim('feColorMatrix',{in:'map',type:'matrix',
      values:'0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 0 1',result:'edgeRGB'}));   // RGB←B, A←1
    const ct=prim('feComponentTransfer',{in:'edgeRGB',result:'darkLayer'});
    for(const ch of ['R','G','B'])                                               // 0→1-dark, .5→1, 1→1
      ct.appendChild(prim('feFunc'+ch,{type:'table',tableValues:'0 1 1'}));
    f.appendChild(ct);
    f.appendChild(prim('feBlend',{in:'glass',in2:'darkLayer',mode:'multiply',result:'glassDark'}));

    /* ── 环内饱和 ────────────────────────────────────────────────
       中性压暗（乘一个灰）保色相，但会把「背景被放大拉长的那条彩带」洗淡 —— iOS 边缘
       恰恰是有颜色的。这里在倒角环内单独调饱和，中心不碰（铁律 1 只管中心那片）。
       环遮罩不用再存一个通道：中心的位移是 0（R=G=128），|R−½|+|G−½| 天然就是环。 */
    let base='glassDark';
    if(o.sat!==1){
      for(const [ch,row] of [['R','1 0 0 0 0'],['G','0 1 0 0 0']]){
        f.appendChild(prim('feColorMatrix',{in:'map',type:'matrix',
          values:`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${row}`,result:'rg'+ch}));   // RGB←白, A←该通道
        const tf=prim('feComponentTransfer',{in:'rg'+ch,result:'ring'+ch});
        tf.appendChild(prim('feFuncA',{type:'table',tableValues:'1 0 1'}));      // |v−½|×2
        f.appendChild(tf);
      }
      f.appendChild(prim('feComposite',{in:'ringR',in2:'ringG',operator:'arithmetic',k1:0,k2:1,k3:1,k4:0,result:'ring'}));
      f.appendChild(prim('feColorMatrix',{in:'glassDark',type:'saturate',values:o.sat,result:'satd'}));
      const inv=prim('feComponentTransfer',{in:'ring',result:'ringInv'});
      inv.appendChild(prim('feFuncA',{type:'table',tableValues:'1 0'}));
      f.appendChild(inv);
      f.appendChild(prim('feComposite',{in:'satd',in2:'ring',operator:'in',result:'satIn'}));
      f.appendChild(prim('feComposite',{in:'glassDark',in2:'ringInv',operator:'in',result:'satOut'}));
      f.appendChild(prim('feComposite',{in:'satIn',in2:'satOut',operator:'arithmetic',k1:0,k2:1,k3:1,k4:0,result:'glassSat'}));
      base='glassSat';
    }

    f.appendChild(prim('feColorMatrix',{in:'map',type:'matrix',
      values:'0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0',result:'litA'}));      // RGB←白, A←B
    const lt=prim('feComponentTransfer',{in:'litA',result:'litLayer'});
    lt.appendChild(prim('feFuncA',{type:'table',tableValues:'0 0 1'}));          // 只留 >128 的一半
    f.appendChild(lt);
    f.appendChild(prim('feComposite',{in:'litLayer',in2:base,operator:'over'}));
    return f;
  }


  let host=null;
  function ensureHost(){
    if(host) return host;
    host=document.createElementNS(SVGNS,'svg');
    host.style.cssText='position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(host); return host;
  }

  let seq=0, lastMap=null;
  function applyV2(node,o,withEdge){
    const W=node.offsetWidth, H=node.offsetHeight;
    const cs=getComputedStyle(node);
    const one=v=>{const t=String(v).trim().split(/\s+/)[0]||'0', n=parseFloat(t);
      return !Number.isFinite(n)?0:Math.max(0, t.endsWith('%') ? n/100*Math.min(W,H) : n);};
    const r=one(cs.borderTopLeftRadius);
    const map=buildMap(W,H,[r,r,r,r],o);
    lastMap=map;
    const id='lab-'+(++seq);
    const old=node.dataset.fid && ensureHost().querySelector('#'+node.dataset.fid);
    ensureHost().appendChild(buildFilter(id,W,H,map,o));
    if(old) old.remove();
    node.dataset.fid=id;
    node.style.setProperty('--gl',`url(#${id})`);
    node.style.setProperty('--edge', withEdge ? cssEdge(o) : 'none');
  }
  /* 最外那道白线交给 CSS：滤镜里画 1px 会被 feImage 的降采样和 Chromium 的最近邻采样
     一起吃掉，box-shadow 则是在元素上画的，天然锐利，还自动跟着 border-radius 走。 */
  function cssEdge(o){
    const a=o.cssEdge, rad=o.light*Math.PI/180, dx=(Math.sin(rad)*1).toFixed(2), dy=(-Math.cos(rad)*1).toFixed(2);
    return [
      `inset 0 0 0 .5px rgba(255,255,255,${(.72*a).toFixed(3)})`,          // 白边
      `inset ${dx}px ${dy}px 0 .5px rgba(255,255,255,${(.55*a).toFixed(3)})`, // 迎光那侧再亮一点
      `inset 0 0 0 1.5px rgba(0,0,0,${(.16*a).toFixed(3)})`,               // 紧贴白边内侧的暗
      `inset 0 0 6px 2px rgba(255,255,255,${(.07*a).toFixed(3)})`          // 再往内的一层淡亮
    ].join(',');
  }


  root.LabGlass = { DEFAULTS, attach: applyV2, lastMap: () => lastMap, cssEdge, ensureHost };
})(typeof window !== 'undefined' ? window : globalThis);
