/* ==========================================================================
   Master Design - авторская версия, script.js
   Фирменный ход: ноутбук в интро "включается" и показывает работы на своём экране.
   Прямоугольник экрана измерен по кадрам видео (яркость 0-2 внутри экрана)
   и хранится в SCREEN: [left, top, width, height] в долях кадра, кадры 100..209 при 24 fps.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const root = document.documentElement;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const desktop = () => matchMedia('(min-width: 1024px)').matches;
  const portrait = matchMedia('(orientation: portrait) and (max-width: 1023px)').matches;
  const hasGsap = typeof window.gsap !== 'undefined';
  const motion = hasGsap && !reduced;
  if (motion) root.classList.add('motion');

  const FPS = 24;
  const SCREEN_FROM = 100;
  const SCREEN = [[0.286,0.234,0.428,0.296],[0.286,0.233,0.428,0.304],[0.286,0.232,0.428,0.313],[0.286,0.23,0.428,0.33],[0.286,0.228,0.429,0.347],[0.285,0.227,0.429,0.362],[0.285,0.226,0.43,0.378],[0.285,0.224,0.431,0.392],[0.284,0.223,0.432,0.406],[0.283,0.223,0.433,0.419],[0.283,0.222,0.434,0.432],[0.282,0.221,0.436,0.445],[0.281,0.221,0.438,0.456],[0.28,0.22,0.44,0.466],[0.279,0.22,0.442,0.474],[0.278,0.219,0.444,0.479],[0.277,0.223,0.446,0.48],[0.276,0.226,0.448,0.478],[0.275,0.229,0.451,0.477],[0.273,0.232,0.453,0.476],[0.272,0.235,0.456,0.475],[0.27,0.234,0.459,0.477],[0.269,0.233,0.463,0.481],[0.267,0.232,0.466,0.484],[0.266,0.231,0.469,0.487],[0.264,0.229,0.472,0.491],[0.262,0.227,0.475,0.495],[0.261,0.225,0.479,0.499],[0.259,0.223,0.482,0.503],[0.257,0.22,0.485,0.507],[0.256,0.219,0.489,0.511],[0.254,0.217,0.492,0.515],[0.252,0.215,0.496,0.52],[0.25,0.213,0.501,0.524],[0.247,0.211,0.505,0.529],[0.245,0.209,0.509,0.533],[0.243,0.207,0.514,0.538],[0.241,0.205,0.518,0.543],[0.239,0.203,0.523,0.548],[0.236,0.201,0.527,0.553],[0.234,0.199,0.532,0.558],[0.231,0.197,0.537,0.563],[0.229,0.194,0.542,0.568],[0.226,0.192,0.547,0.574],[0.224,0.189,0.552,0.579],[0.221,0.187,0.558,0.585],[0.218,0.184,0.563,0.591],[0.215,0.181,0.569,0.597],[0.212,0.179,0.575,0.603],[0.209,0.176,0.581,0.609],[0.206,0.173,0.587,0.616],[0.203,0.17,0.593,0.622],[0.2,0.167,0.6,0.629],[0.197,0.164,0.606,0.636],[0.194,0.16,0.613,0.644],[0.191,0.157,0.619,0.65],[0.187,0.154,0.626,0.658],[0.183,0.151,0.633,0.664],[0.18,0.148,0.64,0.672],[0.177,0.145,0.647,0.679],[0.173,0.141,0.654,0.687],[0.17,0.138,0.661,0.694],[0.166,0.135,0.668,0.702],[0.162,0.131,0.675,0.71],[0.159,0.128,0.683,0.718],[0.155,0.124,0.69,0.726],[0.151,0.121,0.698,0.734],[0.147,0.117,0.705,0.741],[0.144,0.114,0.713,0.749],[0.14,0.11,0.72,0.757],[0.136,0.107,0.728,0.765],[0.132,0.103,0.735,0.774],[0.129,0.099,0.743,0.782],[0.125,0.095,0.75,0.791],[0.121,0.092,0.758,0.799],[0.117,0.088,0.765,0.807],[0.114,0.085,0.773,0.816],[0.11,0.081,0.781,0.812],[0.106,0.077,0.788,0.808],[0.102,0.072,0.796,0.805],[0.098,0.069,0.804,0.801],[0.094,0.065,0.812,0.797],[0.09,0.061,0.819,0.806],[0.086,0.057,0.827,0.826],[0.082,0.053,0.836,0.847],[0.078,0.049,0.844,0.869],[0.074,0.045,0.852,0.89],[0.07,0.041,0.861,0.911],[0.066,0.037,0.869,0.919],[0.062,0.033,0.877,0.928],[0.058,0.029,0.885,0.937],[0.054,0.025,0.893,0.946],[0.049,0.021,0.901,0.955],[0.045,0.017,0.91,0.964],[0.041,0.013,0.918,0.973],[0.037,0.008,0.927,0.982],[0.033,0.005,0.935,0.989],[0.028,0.003,0.944,0.994],[0.024,0.001,0.952,0.997],[0.019,0,0.961,0.999],[0.015,0,0.97,0.999],[0.011,0,0.979,0.999],[0.007,0,0.987,0.999],[0.004,0,0.993,0.999],[0.002,0,0.997,0.999],[0,0,0.999,0.999],[0,0,1,0.999],[0,0,1,0.999],[0,0,1,0.999],[0,0,1,0.999]];

  let smoother = null;

  /* ---------- Scroll-video: fetch -> blob, currentTime по скроллу ---------- */
  class ScrollVideo {
    constructor(video) {
      this.video = video;
      const px = innerWidth * Math.min(devicePixelRatio || 1, 2);
      this.src = px > 1400 ? video.dataset.srcDesktop : video.dataset.srcMobile;
      this.target = 0;
      this.pending = false;
      this.promise = null;
      this.onFrame = null;
      video.muted = true;
      video.playsInline = true;
      video.addEventListener('seeked', () => {
        this.pending = false;
        if (this.onFrame) this.onFrame(video.currentTime);
        if (Math.abs(video.currentTime - this.target) > 0.02) this.seek();
      });
    }

    load(onProgress) {
      if (this.promise) return this.promise;
      const v = this.video;
      this.promise = (async () => {
        try {
          const res = await fetch(this.src);
          if (!res.ok || !res.body) throw new Error(res.status);
          const total = Number(res.headers.get('content-length')) || 0;
          const reader = res.body.getReader();
          const chunks = [];
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            got += value.length;
            if (onProgress && total) onProgress(got / total);
          }
          v.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
        } catch (e) {
          v.src = this.src; // file:// или сбой сети
        }
        v.load();
        await new Promise((r) => {
          if (v.readyState >= 2) return r();
          v.addEventListener('loadeddata', r, { once: true });
          v.addEventListener('error', r, { once: true });
        });
        try { await v.play(); v.pause(); } catch (e) { /* iOS: не критично */ }
        this.duration = v.duration || 0;
        v.currentTime = this.target;
        v.classList.add('is-ready');
        if (onProgress) onProgress(1);
      })();
      return this.promise;
    }

    seek() {
      this.pending = true;
      this.video.currentTime = this.target;
    }

    render(p) {
      if (!this.duration) return;
      this.target = clamp(p, 0, 1) * (this.duration - 0.05);
      if (!this.pending) this.seek();
    }
  }

  const intro = new ScrollVideo($('.js-video'));
  const reel = new ScrollVideo($('.js-video-process'));

  /* ---------- Прелоадер: счётчик по реальной загрузке видео ---------- */
  function runLoader() {
    const el = $('.js-loader');
    const count = $('.js-loader-count');
    const bar = $('.js-loader-bar');
    let real = 0;
    const loading = reduced ? document.fonts.ready : Promise.all([document.fonts.ready, intro.load((p) => { real = p; })]);
    const ready = Promise.race([loading, new Promise((r) => setTimeout(r, 8000))]);

    if (!hasGsap) return ready.then(() => el.remove());

    return new Promise((resolve) => {
      let shown = 0;
      let done = false;
      ready.then(() => { done = true; });
      const tick = () => {
        const goal = done ? 1 : real * 0.95;
        shown += (goal - shown) * 0.08;
        if (done && 1 - shown < 0.005) shown = 1;
        count.textContent = Math.round(shown * 100);
        bar.style.transform = `scaleX(${shown})`;
        if (shown === 1) {
          gsap.ticker.remove(tick);
          gsap.timeline({ onComplete: () => { el.remove(); resolve(); } })
            .to(count, { yPercent: -30, opacity: 0, duration: 0.6, ease: 'power3.in' })
            .to(el, { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut' }, '-=0.2');
        }
      };
      gsap.ticker.add(tick);
    });
  }

  /* ---------- Экран ноутбука: координаты кадра -> координаты сцены ---------- */
  const stage = $('.js-stage');
  const screen = $('.js-screen');
  const shots = $$('.js-shot');
  const final = $('.js-screen-final');

  // Где на сцене реально нарисован кадр видео (учитывает object-fit и transform: scale)
  function frameBox() {
    const v = intro.video;
    const r = v.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const vw = v.videoWidth || 1280;
    const vh = v.videoHeight || 720;
    const fit = getComputedStyle(v).objectFit;
    const k = fit === 'contain' ? Math.min(r.width / vw, r.height / vh) : Math.max(r.width / vw, r.height / vh);
    const w = vw * k;
    const h = vh * k;
    return { x: r.left - s.left + (r.width - w) / 2, y: r.top - s.top + (r.height - h) / 2, w, h };
  }

  function screenAt(frame) {
    const f = clamp(frame - SCREEN_FROM, 0, SCREEN.length - 1);
    const i = Math.floor(f);
    const a = SCREEN[i];
    const b = SCREEN[Math.min(i + 1, SCREEN.length - 1)];
    const t = f - i;
    return a.map((v, k) => lerp(v, b[k], t));
  }

  // Прозрачность работы i: 4 отрезка по 20 кадров (112..192), мягкая смена
  function shotOpacity(frame, i) {
    const start = 112 + i * 20;
    const fadeIn = clamp((frame - start) / 5, 0, 1);
    const fadeOut = i === shots.length - 1 ? clamp((196 - frame) / 6, 0, 1) : clamp((start + 25 - frame) / 5, 0, 1);
    return Math.min(fadeIn, fadeOut);
  }

  function updateScreen(time) {
    const frame = time * FPS;
    const on = frame >= 108;
    screen.style.visibility = on ? 'visible' : 'hidden';
    if (!on) return;
    const box = frameBox();
    const [l, t, w, h] = screenAt(frame);
    Object.assign(screen.style, {
      left: `${box.x + l * box.w}px`,
      top: `${box.y + t * box.h}px`,
      width: `${w * box.w}px`,
      height: `${h * box.h}px`,
      opacity: String(clamp((frame - 108) / 6, 0, 1)),
    });
    shots.forEach((s, i) => { s.style.opacity = String(shotOpacity(frame, i)); });
    final.style.opacity = String(clamp((frame - 194) / 8, 0, 1));
  }

  /* ---------- Интро: pin + видео + разъезд заголовка ---------- */
  function initIntro() {
    if (!motion) return;
    intro.onFrame = updateScreen;
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '.js-intro',
        start: 'top top',
        end: '+=380%',
        pin: true,
        scrub: true,
        onUpdate: (self) => intro.render(self.progress),
        // Секция работ наезжает на последний экран интро (margin-top: -100svh), но видна
        // только после снятия pin - тогда её надпись стоит ровно на месте надписи на экране ноутбука
        onLeave: () => gsap.set('.js-work', { autoAlpha: 1 }),
        onEnterBack: () => gsap.set('.js-work', { autoAlpha: 0 }),
      },
    });
    gsap.set('.js-work', { autoAlpha: 0 });
    tl.to('.js-line-left', { xPercent: -70, opacity: 0, ease: 'power2.in', duration: 0.3 }, 0)
      .to('.js-line-right', { xPercent: 70, opacity: 0, ease: 'power2.in', duration: 0.3 }, 0)
      .to('.js-intro-foot', { opacity: 0, y: 20, duration: 0.08 }, 0)
      .to({}, { duration: 0.7 });
    if (portrait) {
      tl.fromTo(stage, { '--zoom': 1.55, '--shift': '-18vh' }, { '--zoom': 1, '--shift': '0vh', duration: 0.8, ease: 'none' }, 0);
    }
    addEventListener('resize', () => updateScreen(intro.video.currentTime));
  }

  function introIn() {
    if (!motion) return;
    const lines = $$('.js-line-left, .js-line-right');
    lines.forEach((l) => { l.style.overflow = 'clip'; });
    const split = new SplitText(lines, { type: 'chars', aria: 'none' });
    gsap.from(split.chars, { yPercent: 110, duration: 1.4, stagger: 0.02, ease: 'expo.out', onComplete: () => lines.forEach((l) => { l.style.overflow = ''; }) });
    gsap.from('.js-intro-foot', { opacity: 0, y: 20, duration: 1, delay: 0.5, ease: 'expo.out' });
  }

  /* ---------- Работы: горизонтальная лента на десктопе ---------- */
  function initWork() {
    if (!motion || !desktop()) return;
    const track = $('.js-track');
    const dist = () => track.scrollWidth - innerWidth;
    gsap.to(track, {
      x: () => -dist(),
      ease: 'none',
      scrollTrigger: { trigger: '.js-work', start: 'top top', end: () => `+=${dist()}`, pin: true, scrub: true, invalidateOnRefresh: true },
    });
  }

  /* ---------- Манифест: слова загораются ---------- */
  function initManifesto() {
    if (!motion) return;
    const el = $('.js-manifesto');
    const split = new SplitText(el, { type: 'words', wordsClass: 'word', aria: 'none' });
    ScrollTrigger.create({
      trigger: el,
      start: 'top 75%',
      end: 'bottom 50%',
      scrub: true,
      onUpdate: (self) => {
        const n = Math.round(self.progress * split.words.length);
        split.words.forEach((w, i) => w.classList.toggle('is-on', i < n));
      },
    });
  }

  /* ---------- Процесс: видео закреплено, перематывается шагами ---------- */
  function initProcess() {
    const steps = $$('.js-step');
    if (!motion) { steps.forEach((s) => s.classList.add('is-active')); return; }
    ScrollTrigger.create({ trigger: '.js-process', start: 'top bottom+=150%', once: true, onEnter: () => reel.load() });
    ScrollTrigger.create({
      trigger: '.js-process',
      start: 'top top',
      end: 'bottom bottom',
      pin: '.process__media',
      pinSpacing: false,
      onUpdate: (self) => reel.render(self.progress),
    });
    steps.forEach((s) => ScrollTrigger.create({
      trigger: s,
      start: 'top 65%',
      end: 'bottom 35%',
      toggleClass: 'is-active',
    }));
  }

  /* ---------- Заголовки секций: строки выезжают из маски ---------- */
  function initHeadings() {
    if (!motion) return;
    $$('.process__title, .services__title, .faq__title, .contact__title').forEach((h) => {
      const split = new SplitText(h, { type: 'lines', mask: 'lines', aria: 'none' });
      gsap.from(split.lines, {
        yPercent: 105,
        duration: 1.3,
        stagger: 0.1,
        ease: 'expo.out',
        scrollTrigger: { trigger: h, start: 'top 85%', once: true },
        onComplete: () => split.revert(),
      });
    });
    $$('.service, .faq__item').forEach((row) => gsap.from(row, {
      opacity: 0,
      y: 30,
      duration: 1,
      ease: 'expo.out',
      scrollTrigger: { trigger: row, start: 'top 90%', once: true },
    }));
  }

  /* ---------- Курсор ---------- */
  function initCursor() {
    if (!motion || !fine) return;
    const c = $('.js-cursor');
    const label = $('.js-cursor-label');
    root.classList.add('has-cursor');
    const x = gsap.quickTo(c, 'x', { duration: 0.25, ease: 'power3' });
    const y = gsap.quickTo(c, 'y', { duration: 0.25, ease: 'power3' });
    addEventListener('pointermove', (e) => { x(e.clientX); y(e.clientY); }, { passive: true });
    document.addEventListener('pointerover', (e) => {
      const tagged = e.target.closest('[data-cursor]');
      const link = e.target.closest('a, button, summary, input');
      c.classList.toggle('is-label', Boolean(tagged));
      c.classList.toggle('is-link', !tagged && Boolean(link));
      label.textContent = tagged ? tagged.dataset.cursor : '';
    });
  }

  /* ---------- Прогресс, якоря ---------- */
  function initNav() {
    const bar = $('.js-progress');
    if (hasGsap) ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (s) => { bar.style.transform = `scaleX(${s.progress})`; } });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const target = $(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      if (smoother) smoother.scrollTo(target, true, 'top top');
      else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  /* ---------- Форма (отправку на MODX подключить позже) ---------- */
  function initForm() {
    const form = $('.js-form');
    const status = $('.js-form-status');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.elements.website.value) return;
      const checks = {
        name: (v) => v.trim().length >= 2,
        contact: (v) => /^@?[a-zA-Z]\w{4,31}$/.test(v.trim()) || v.replace(/\D/g, '').length >= 10,
      };
      let ok = true;
      Object.entries(checks).forEach(([name, test]) => {
        const valid = test(form.elements[name].value);
        form.elements[name].closest('.form__field').classList.toggle('has-error', !valid);
        if (!valid && ok) { form.elements[name].focus(); ok = false; }
      });
      if (!ok) { status.textContent = 'Проверьте имя и контакт: нужен телефон (10+ цифр) или @ник.'; return; }
      status.textContent = 'Отправляю...';
      setTimeout(() => { form.reset(); status.textContent = 'Спасибо! Отвечу в течение рабочего дня.'; }, 1200);
    });
  }

  /* ---------- Старт ---------- */
  async function start() {
    if (hasGsap) {
      gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);
      ScrollTrigger.config({ ignoreMobileResize: true });
      if (motion) smoother = ScrollSmoother.create({ wrapper: '#smooth-wrapper', content: '#smooth-content', smooth: 1.1, smoothTouch: false });
    }
    initIntro();
    await runLoader();
    initWork();
    initManifesto();
    initProcess();
    initHeadings();
    initCursor();
    initNav();
    initForm();
    if (hasGsap) ScrollTrigger.refresh();
    introIn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.MV = { intro, reel, get smoother() { return smoother; } };
})();
