/* lean-refactor: снимок вычисленных стилей и геометрии блока + сравнение.
   Выполняется в браузере через javascript_tool: содержимое файла + вызов, например
     __lean.snap('#faq', 'base-1440')
     __lean.diff('base-1440', 'after-1440', 'base2-1440')
   Снимки лежат в localStorage (переживают перезагрузку). Удалить: __lean.clear(). */
(() => {
  const KEY = 'lean-snap:';
  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear',
    'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-bottom-style', 'border-top-color', 'border-bottom-color',
    'border-left-color', 'border-right-color', 'border-radius', 'outline-style', 'outline-width', 'outline-color', 'outline-offset',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
    'justify-content', 'align-items', 'align-self', 'align-content', 'justify-items', 'justify-self',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-column-start', 'grid-column-end',
    'grid-row-start', 'grid-row-end', 'grid-auto-flow', 'row-gap', 'column-gap',
    'overflow-x', 'overflow-y', 'visibility', 'opacity', 'pointer-events', 'cursor', 'content',
    'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip',
    'box-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation',
    'transform', 'transform-origin', 'translate', 'scale', 'rotate', 'perspective', 'will-change', 'contain',
    'clip-path', 'mask-image', '-webkit-mask-image',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-transform', 'text-decoration-line', 'text-indent', 'text-wrap', 'white-space', 'text-overflow',
    '-webkit-text-fill-color', 'list-style-type', 'vertical-align', 'object-fit', 'object-position',
    'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
    'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count',
  ];

  const path = (el, root) => {
    const parts = [];
    for (let n = el; n && n !== root; n = n.parentElement) {
      parts.unshift(`${n.tagName.toLowerCase()}:${[...n.parentElement.children].indexOf(n)}`);
    }
    return parts.join('>') || 'root';
  };

  const read = (cs, out, prefix) => {
    for (const p of PROPS) out[prefix + p] = cs.getPropertyValue(p);
  };

  const r2 = (n) => Math.round(n * 2) / 2;

  function snap(sel, tag) {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`Нет элемента ${sel}`);
    if (!innerWidth) throw new Error('innerWidth = 0: панель браузера скрыта, задай размер через resize_window и перезагрузи');
    const rr = root.getBoundingClientRect();
    const els = [root, ...root.querySelectorAll('*')].filter((el) => !el.closest('.glitch-layer'));
    const data = {};
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const e = {
        cls: el.getAttribute('class') || '',
        inline: el.getAttribute('style') || '',
        'rect.x': r2(r.left - rr.left), 'rect.y': r2(r.top - rr.top),
        'rect.w': r2(r.width), 'rect.h': r2(r.height),
      };
      read(getComputedStyle(el), e, '');
      for (const pe of ['::before', '::after', '::marker']) {
        const cs = getComputedStyle(el, pe);
        if (pe === '::marker' ? el.tagName === 'LI' || el.tagName === 'SUMMARY' : cs.content !== 'none' && cs.content !== 'normal') read(cs, e, `${pe} `);
      }
      data[path(el, root)] = e;
    }
    const meta = {
      sel, tag, w: innerWidth, h: innerHeight, rootW: r2(rr.width), rootH: r2(rr.height),
      rootCls: document.documentElement.className, n: els.length, t: new Date().toISOString(),
    };
    localStorage.setItem(KEY + tag, JSON.stringify({ meta, data }));
    return meta;
  }

  const load = (tag) => {
    const raw = localStorage.getItem(KEY + tag);
    if (!raw) throw new Error(`Нет снимка ${tag}`);
    return JSON.parse(raw);
  };

  const differs = (k, a, b) => (k.startsWith('rect.') ? Math.abs(a - b) > 0.5 : a !== b);

  function diff(baseTag, afterTag, noiseTag, limit = 60) {
    const A = load(baseTag), B = load(afterTag), N = noiseTag ? load(noiseTag) : null;
    const warnings = [];
    if (A.meta.w !== B.meta.w) warnings.push(`Разная ширина окна: ${A.meta.w} vs ${B.meta.w}`);
    if (A.meta.rootCls !== B.meta.rootCls) warnings.push(`Разные классы <html>: "${A.meta.rootCls}" vs "${B.meta.rootCls}"`);
    if (A.meta.rootW !== B.meta.rootW || A.meta.rootH !== B.meta.rootH) {
      warnings.push(`Размер блока: ${A.meta.rootW}x${A.meta.rootH} -> ${B.meta.rootW}x${B.meta.rootH}`);
    }
    const items = [];
    let ignored = 0;
    for (const id of new Set([...Object.keys(A.data), ...Object.keys(B.data)])) {
      const a = A.data[id], b = B.data[id];
      if (!a || !b) { items.push({ id, change: a ? 'элемент исчез' : 'новый элемент', cls: (a || b).cls }); continue; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!differs(k, a[k], b[k])) continue;
        const n = N?.data[id];
        if (n && differs(k, a[k], n[k])) { ignored++; continue; } // свойство шумит и без правок
        items.push({ id, cls: a.cls, prop: k, before: a[k], after: b[k] });
      }
    }
    return { count: items.length, ignoredNoise: ignored, warnings, items: items.slice(0, limit) };
  }

  const list = () => Object.keys(localStorage).filter((k) => k.startsWith(KEY)).map((k) => k.slice(KEY.length));
  const clear = () => list().forEach((t) => localStorage.removeItem(KEY + t)) ?? 'ok';

  window.__lean = { snap, diff, list, clear };
})();
