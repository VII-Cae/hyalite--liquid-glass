/*!
 * The maker's mark for the demo pages: one pill at the bottom, linking back to the repository.
 * Glassmakers sign their pieces; a recording of these pages should carry the signature too, since
 * a clip with no link is a clip nobody can trace. The text lives here once, the version is read
 * from the engine, and each page adds a single script tag after hyalite.js.
 */
(() => {
  const REPO = 'github.com/VII-Cae/hyalite--liquid-glass';
  const version = (window.Hyalite && Hyalite.version) ? 'v' + Hyalite.version : '';
  const css = `
    #hyalite-mark{position:fixed;z-index:30;left:50%;bottom:12px;transform:translateX(-50%);
      display:flex;flex-wrap:wrap;justify-content:center;gap:0 1em;box-sizing:border-box;max-width:calc(100vw - 24px);
      padding:5px 12px;border-radius:999px;background:rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.12);
      font:11px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.02em;color:rgba(255,255,255,.72);
      text-decoration:none;white-space:nowrap}
    #hyalite-mark:hover{color:#fff;border-color:rgba(255,255,255,.32)}
    #hyalite-mark b{font-weight:600;color:#dfc174}
    #hyalite-mark i{font-style:normal;opacity:.75}
    /* phones scroll, so the pill joins the flow at the end of the page instead of floating over it */
    @media (max-width:760px){#hyalite-mark{position:static;transform:none;width:max-content;margin:0 auto 18px;border-radius:14px}}`;
  const mount = () => {
    const style = document.createElement('style');
    style.textContent = css;
    const a = document.createElement('a');
    a.id = 'hyalite-mark';
    a.href = 'https://' + REPO;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span><b>hyalite</b> ${version}</span><span>${REPO}</span><i>MIT © 2026 VII-Cae (VII)</i>`;
    document.head.appendChild(style);
    document.body.appendChild(a);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
