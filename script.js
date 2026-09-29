/* ==========================================================================
   Master Design - script.js
   Порядок: конфиг -> качество -> утилиты -> scroll-video -> GSAP -> модули -> старт
   Правила анимаций: design-system.md (раздел 7), уровни качества: раздел 10.
   ========================================================================== */

(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /* ---------- Словарь моушена (зеркало --ease-* / --duration-* из design-tokens.css) ---------- */
  const MOTION = {
    ease: {
      premium: 'expo.out',
      entrance: 'power4.out',
      exit: 'expo.in',
      inOut: 'expo.inOut',
      hover: 'power3.out',
      spring: 'back.out(1.6)',
      elastic: 'elastic.out(1, 0.4)',
    },
    // секунды - как ожидает GSAP
    duration: { micro: 0.15, hover: 0.35, reveal: 1.1, exit: 0.5, section: 1.6, cinematic: 2.4 },
    stagger: 0.06,
  };

  /* ---------- Медиа-условия ---------- */
  const mq = (q) => matchMedia(q).matches;
  const media = {
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    reducedData: mq('(prefers-reduced-data: reduce)'),
    finePointer: mq('(hover: hover) and (pointer: fine)'),
    desktop: mq('(min-width: 1024px)'),
  };

  /* ---------- Adaptive quality: high / mid / low ---------- */
  function detectQuality() {
    const conn = navigator.connection || {};
    const memory = navigator.deviceMemory; // нет в Safari/Firefox
    const cores = navigator.hardwareConcurrency;

    if (media.reducedMotion || media.reducedData || conn.saveData) return 'low';
    // Только 2G считается "без анимаций". 3G у Chrome - это просто rtt >= 270 мс, на мобильном
    // интернете и даже на Wi-Fi бывает постоянно; раньше регулярка ловила и его
    if (/^(slow-)?2g$/.test(conn.effectiveType || '')) return 'low';
    // Chrome округляет память вниз до степени двойки: телефон на 3 ГБ показывает 2. Поэтому 2 ГБ -
    // это обычный бюджетный смартфон (realme, 8 ядер), а не "слабое" устройство. Low - только до 1 ГБ
    if (memory && memory <= 1) return 'low';
    if (cores && cores <= 2) return 'low';
    if ((memory && memory <= 4) || (cores && cores <= 4) || !media.desktop) return 'mid';
    return 'high';
  }

  let quality = detectQuality();

  function setQuality(level) {
    quality = level;
    root.classList.remove('q-high', 'q-mid', 'q-low');
    root.classList.add(`q-${level}`);
  }

  setQuality(quality);

  // Слабый Android: облегчаем только фон (частицы hero, анимация пятен bg-mesh), ключевая анимация
  // (видео, расшифровка заголовка) не трогается. deviceMemory и hardwareConcurrency Chrome на Android
  // отдаёт, на iPhone их нет - iOS сюда не попадает в любом случае
  const liteAndroid = /Android/i.test(navigator.userAgent)
    && ((navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4));
  root.classList.toggle('lite-android', liteAndroid);

  function measureFps(duration = 2000) {
    return new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = (now) => {
        frames++;
        if (now - start < duration) requestAnimationFrame(tick);
        else resolve((frames * 1000) / (now - start));
      };
      requestAnimationFrame(tick);
    });
  }

  const hasGsap = typeof window.gsap !== 'undefined';
  const animated = hasGsap && quality !== 'low';
  let smoother = null;
  let touchOnly = false; // только сенсорный ввод (телефон, планшет) - ставится в initGsap

  /* ==========================================================================
     Scroll-video: <video> H.264, currentTime привязан к скроллу (design-system.md, раздел 11)
     Файл скачивается целиком (fetch -> blob): честный прогресс для прелоадера
     и мгновенная перемотка без range-запросов. Ключевой кадр каждые 4 кадра.
     ========================================================================== */
  class ScrollVideo {
    constructor(video) {
      this.video = video;
      // Телефоны и планшеты: 1280 - кадр при перемотке декодируется примерно вдвое быстрее, чем 1920,
      // поэтому перемотка успевает за пальцем и не пропускает кадры пачками
      this.src = (!media.desktop && video.dataset.srcMobile) || video.dataset.srcDesktop;
      this.fps = Number(video.dataset.fps) || 24;
      this.progress = 0;
      this.frame = -1; // кадр, который запрошен последним
      this.frames = 0; // 0 - ролик ещё не загружен
      this.pending = false;
      this.watchdog = 0;
      this.promise = null;
      video.muted = true;
      video.playsInline = true;
      video.addEventListener('seeked', () => this.onSeeked());
    }

    onSeeked() {
      clearTimeout(this.watchdog);
      this.pending = false;
      // За время перемотки скролл ушёл дальше - сразу догоняем, без ожидания следующего onUpdate
      if (this.frameFor(this.progress) !== this.frame) this.seek();
    }

    // Прогресс -> номер кадра: шаг строго линейный, одинаковый на любом устройстве
    frameFor(progress) {
      return Math.round(clamp(progress, 0, 1) * (this.frames - 1));
    }

    // Загрузка с прогрессом (onProgress: 0..1)
    preload(onProgress) {
      if (this.promise) return this.promise;
      const video = this.video;
      const ready = () => new Promise((resolve) => {
        if (video.readyState >= 2) return resolve();
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('error', resolve, { once: true });
      });

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
          video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
        } catch (e) {
          // file:// или ошибка сети: обычная загрузка, без прогресса
          video.src = this.src;
        }
        video.load();
        await ready();
        if (onProgress) onProgress(1);
        // iOS Safari показывает кадры при перемотке только после первого play()
        try { await video.play(); video.pause(); } catch (e) { /* не критично */ }
        this.frames = Math.max(1, Math.floor((video.duration || 0) * this.fps));
        // Скролл мог уйти вперёд, пока файл грузился: сразу показываем нужный кадр, а не нулевой
        this.frame = -1;
        this.pending = false;
        this.seek();
        video.classList.add('is-ready');
      })();
      return this.promise;
    }

    seek() {
      if (!this.frames) return;
      const frame = this.frameFor(this.progress);
      if (frame === this.frame) return;
      this.frame = frame;
      this.pending = true;
      // Середина кадра, а не его граница: на границе браузеры по-разному округляют
      // и показывают то этот, то предыдущий кадр - отсюда "дрожание" при медленном скролле.
      // Последний кадр тоже внутри ролика (на точном конце некоторые браузеры дают чёрный кадр)
      this.video.currentTime = (frame + 0.5) / this.fps;
      // Страховка: если 'seeked' не пришёл (Safari иногда теряет его при частой перемотке),
      // видео не должно навсегда застыть на старом кадре
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => this.onSeeked(), 250);
    }

    render(progress) {
      this.progress = progress;
      if (!this.pending) this.seek();
    }
  }

  const videos = {};
  function createVideos() {
    if (quality === 'low') return;
    const hero = $('.hero .js-scroll-video');
    const reel = $('.showreel .js-scroll-video');
    if (hero) videos.hero = new ScrollVideo(hero);
    if (reel) videos.reel = new ScrollVideo(reel);
  }

  /* ==========================================================================
     GSAP + ScrollSmoother
     ========================================================================== */
  function initGsap() {
    if (!hasGsap) return;
    gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);
    gsap.defaults({ ease: MOTION.ease.premium, duration: MOTION.duration.reveal });
    ScrollTrigger.config({ ignoreMobileResize: true });

    touchOnly = ScrollTrigger.isTouch === 1;

    // Телефоны и планшеты: полностью нативный скролл. ScrollSmoother на них всё равно не сглаживает
    // (smoothTouch: false), а normalizeScroll переводил скролл на JS - на реальных устройствах
    // страница дёргалась и скролл "ломался" на тяжёлых секциях ниже hero
    if (quality !== 'low' && !touchOnly) {
      smoother = ScrollSmoother.create({
        wrapper: '#smooth-wrapper',
        content: '#smooth-content',
        smooth: quality === 'high' ? 1.2 : 0.8,
        smoothTouch: false,
        effects: false,
      });
    }

  }

  // Закрепление секции со scroll-video на distance% высоты экрана.
  // Десктоп: GSAP pin внутри ScrollSmoother, скролл уже сглажен - scrub: true.
  // Телефон: CSS position: sticky вместо GSAP pin. Sticky двигает браузер в том же кадре, что и
  // нативный скролл, поэтому нет рывка при закреплении/откреплении (GSAP-pin на нативном скролле
  // переключается на position: fixed с опозданием на кадр - в Chrome это читалось как прыжок вверх).
  // scrub 0.8 - сглаживание того же порядка, что у ScrollSmoother (smooth 0.8 на mid): видео идёт
  // одинаково на десктопе и телефоне, а не рывками за пальцем.
  function pinSettings(section, distance) {
    if (touchOnly) {
      section.classList.add('is-sticky');
      section.style.setProperty('--pin-distance', distance / 100);
      return {
        trigger: section,
        start: 'top top',
        // Длина в пикселях от высоты секции и сцены (обе не зависят от нижней панели браузера).
        // 'bottom bottom' считался бы от высоты окна: при скрытии панели конец сдвигался, и
        // прогресс (кадр видео) скакал
        end: () => `+=${section.offsetHeight - section.firstElementChild.offsetHeight}`,
        scrub: 0.8,
      };
    }
    return { trigger: section, start: 'top top', end: `+=${distance}%`, pin: true, scrub: smoother ? true : 0.8 };
  }

  function scrollToTarget(target) {
    const navH = $('.navbar').offsetHeight;
    if (smoother) {
      smoother.scrollTo(target, true, target === 0 ? undefined : `top ${navH}px`);
    } else if (target === 0) {
      window.scrollTo({ top: 0, behavior: media.reducedMotion ? 'auto' : 'smooth' });
    } else {
      const top = target.getBoundingClientRect().top + window.scrollY - navH;
      window.scrollTo({ top, behavior: media.reducedMotion ? 'auto' : 'smooth' });
    }
  }

  /* ==========================================================================
     Прелоадер: каретка печатает логотип, пока грузятся шрифты, постер и первые кадры
     ========================================================================== */
  const DEV_SKIP_PRELOADER = false; // TEMP: убрать перед сдачей - пропускает прелоадер для ускорения разработки

  function runPreloader() {
    const el = $('.js-preloader');
    if (!el) return Promise.resolve();
    if (DEV_SKIP_PRELOADER) {
      root.classList.add('fonts-ready');
      // Прелоадер обычно сам грузит видео (это его прогресс) - раз мы его выключили,
      // догружаем ролик здесь же, иначе скраббинг hero остаётся без кадров
      if (videos.hero) videos.hero.preload();
      el.remove();
      return Promise.resolve();
    }
    const text = $('.js-preloader-text', el);
    const fill = $('.js-preloader-fill', el);
    const count = $('.js-preloader-count', el);
    const word = text.textContent;

    const parts = { fonts: 0, poster: 0, frames: videos.hero ? 0 : 1 };
    const weights = { fonts: 0.2, poster: 0.2, frames: 0.6 };
    const progress = () => Object.keys(parts).reduce((s, k) => s + parts[k] * weights[k], 0);

    const posterImg = $('.hero__poster img');
    const posterReady = posterImg.complete
      ? Promise.resolve()
      : new Promise((r) => { posterImg.addEventListener('load', r, { once: true }); posterImg.addEventListener('error', r, { once: true }); });

    const loading = Promise.all([
      document.fonts.ready.then(() => { parts.fonts = 1; root.classList.add('fonts-ready'); }),
      posterReady.then(() => { parts.poster = 1; }),
      videos.hero ? videos.hero.preload((p) => { parts.frames = p; }) : Promise.resolve(),
    ]);
    const timeout = new Promise((r) => setTimeout(r, 7000));
    const ready = Promise.race([loading, timeout]);

    // Без анимаций: просто дождаться и убрать
    if (!hasGsap || quality === 'low') {
      return ready.then(() => {
        el.classList.add('is-done');
        el.style.transition = 'opacity .4s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 450);
      });
    }

    return new Promise((resolve) => {
      text.textContent = '';
      const shown = { p: 0 };
      let loaded = false;
      ready.then(() => { loaded = true; });

      // Печать логотипа
      const typing = gsap.to({ n: 0 }, {
        n: word.length,
        duration: word.length * 0.07,
        ease: 'none',
        delay: 0.3,
        onUpdate() { text.textContent = word.slice(0, Math.round(this.targets()[0].n)); },
      });

      // Плавный прогресс: догоняет реальный
      const tick = () => {
        const real = loaded ? 1 : progress();
        shown.p += (real - shown.p) * 0.12;
        if (loaded && 1 - shown.p < 0.004) shown.p = 1;
        fill.style.transform = `scaleX(${shown.p})`;
        count.textContent = `${Math.round(shown.p * 100)}%`;
        if (shown.p >= 1 && typing.progress() === 1) {
          gsap.ticker.remove(tick);
          exit();
        }
      };
      gsap.ticker.add(tick);

      function exit() {
        const tl = gsap.timeline({
          onComplete: () => { el.remove(); resolve(); },
        });
        tl.to(count, { opacity: 0, duration: 0.3 })
          .to($('.preloader__bar', el), { scaleX: 0, transformOrigin: 'right', duration: 0.6, ease: MOTION.ease.inOut }, '<')
          .to($('.preloader__logo', el), { yPercent: -40, opacity: 0, duration: 0.7, ease: MOTION.ease.exit }, '-=0.2')
          .add(() => el.classList.add('is-done'))
          .to(el, { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: MOTION.ease.inOut }, '-=0.25');
      }
    });
  }

  /* ==========================================================================
     Навбар, меню, якоря, прогресс скролла
     ========================================================================== */
  function initNavbar() {
    const navbar = $('.js-navbar');
    const burger = $('.js-burger');
    const nav = $('.js-nav');

    const onScroll = () => navbar.classList.toggle('is-scrolled', window.scrollY > 40);
    // Обычное событие scroll: срабатывает и при резких переходах (якоря, scrollTo), в отличие от onUpdate
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const setMenu = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('is-locked', open);
      if (smoother) smoother.paused(open);
    };

    burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); burger.focus(); }
    });

    // Все якорные ссылки: плавный скролл через ScrollSmoother
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;
      const id = link.getAttribute('href');
      const target = id === '#hero' || id === '#' ? 0 : $(id);
      if (target === null) return;
      e.preventDefault();
      if (nav.classList.contains('is-open')) setMenu(false);
      if (link.dataset.service) {
        const radio = $(`input[name="type"][value="${link.dataset.service}"]`);
        if (radio) radio.checked = true;
      }
      scrollToTarget(target);
      if (target !== 0) history.replaceState(null, '', id);
    });

    // Активный пункт меню
    if (hasGsap) {
      $$('.nav__link').forEach((link) => {
        const section = $(link.getAttribute('href'));
        if (!section) return;
        ScrollTrigger.create({
          trigger: section,
          start: 'top 50%',
          end: 'bottom 50%',
          onToggle: (self) => link.classList.toggle('is-active', self.isActive),
        });
      });
    }
  }

  function initScrollProgress() {
    if (!hasGsap) return;
    const fill = $('.js-scroll-progress-fill');
    const caret = $('.js-scroll-progress-caret');
    const bar = $('.js-scroll-progress');
    const mobile = $('.js-navbar-progress');
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        const p = self.progress;
        fill.style.transform = `scaleY(${p})`;
        caret.style.transform = `translateY(${p * bar.offsetHeight}px)`;
        mobile.style.transform = `scaleX(${p})`;
      },
    });
  }

  /* ==========================================================================
     Hero: закрепление + скраббинг видео + расшифровка заголовка + частицы
     Всё движение hero - один таймлайн длиной 1, привязанный к скроллу (pinSettings, 260%)
     ========================================================================== */
  let heroSplit = null;
  // Символы декодирования для эффекта "код проявляется" в заголовке hero
  const CODE_GLYPHS = '01</>{}[]#$%&*+=;:_';
  function pseudoRandom(seed) {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  function scrambleText(text, seed) {
    return text.replace(/\S/g, (ch, i) => CODE_GLYPHS[Math.floor(pseudoRandom(seed + i * 3.17) * CODE_GLYPHS.length)]);
  }

  // Разбивка заголовка на символы и стартовые (скрытые) состояния - готовится под прелоадером
  function splitHeroTitle() {
    const title = $('.js-hero-title');
    // aria: auto - SplitText ставит aria-label на сам <h1> (там он допустим), куски скрывает
    heroSplit = new SplitText(title, { type: 'words,chars', charsClass: 'hero__char', ignore: '.text-gradient' });
    // Градиентное слово не режем на буквы (иначе ломается background-clip): "ключ" анимируется
    // и расшифровывается целиком, одним блоком
    heroSplit.chars.push(...title.querySelectorAll('.text-gradient'));
    title.querySelectorAll('.hero__title-line').forEach((l) => { l.style.overflow = 'clip'; l.style.paddingBottom = '0.06em'; });
    heroSplit.chars.forEach((el) => { el.dataset.ch = el.textContent; });
    gsap.set(heroSplit.chars, { yPercent: 40, opacity: 0 });
    gsap.set('.js-hero-lead', { opacity: 0, y: 10 });
    gsap.set('.js-hero-fade', { opacity: 0, y: 24 });
  }

  // Позиция символа от конца своей строки (0 - последний): blur-акцент на финале каждой строки
  function charsFromLineEnd(chars) {
    const fromEnd = new Map();
    const count = new Map();
    for (let i = chars.length - 1; i >= 0; i--) {
      const line = chars[i].closest('.hero__title-line');
      const n = count.get(line) || 0;
      count.set(line, n + 1);
      fromEnd.set(chars[i], n);
    }
    return fromEnd;
  }

  function initHero() {
    if (!animated) return;
    splitHeroTitle();

    const video = videos.hero;
    // Пауза в конце: после последнего кадра секция ещё HERO_HOLD * 100% высоты остаётся закреплённой,
    // чтобы заголовок и подзаголовок успели прочитать, прежде чем страница поедет дальше
    const HERO_HOLD = 0.4;
    const total = 1 + HERO_HOLD;
    const tl = gsap.timeline({
      // Видео ведёт время таймлайна, а не сырой прогресс скролла: кадр и текст всегда синхронны
      // и сглажены одинаково на десктопе (ScrollSmoother) и на телефоне (scrub).
      // Кадры занимают время 0..1, дальше видео стоит на последнем кадре
      onUpdate() { if (video) video.render(Math.min(1, this.time())); },
      scrollTrigger: pinSettings($('.js-hero'), 260 * total),
    });

    // Текст появляется поздно (крышка почти раскрыта) и остаётся видимым до конца прокрутки.
    // Каждый символ "декодируется": череда случайных code-глифов акцентным цветом, затем
    // настоящая буква (design-system: сквозной код-мотив). Последние 3 символа каждой строки
    // дополнительно проявляются из blur 4 / 8 / 12px.
    const revealStart = 0.56;
    const charStep = 0.006;
    const fromEnd = charsFromLineEnd(heroSplit.chars);
    heroSplit.chars.forEach((el, i) => {
      const seed = i + 1;
      const at = revealStart + i * charStep;
      const decode = { s: 0 };
      const n = fromEnd.get(el);
      tl.to(el, { yPercent: 0, opacity: 1, duration: 0.28, ease: 'power3.out' }, at);
      if (n < 3) {
        tl.fromTo(el, { filter: `blur(${(3 - n) * 4}px)` }, { filter: 'blur(0px)', duration: 0.32, ease: 'power2.out' }, at);
      }
      tl.to(decode, {
        s: 4,
        duration: 0.24,
        ease: 'power1.inOut',
        // Глиф рисуется псевдоэлементом поверх настоящей (прозрачной) буквы: ширина символа
        // не меняется, строка не "дышит" и не перескакивает на новую строку во время расшифровки
        onUpdate: () => {
          const step = Math.round(decode.s);
          const scrambling = step < 4;
          if (scrambling) el.dataset.glyph = scrambleText(el.dataset.ch, seed + step * 4.1);
          el.classList.toggle('is-scrambling', scrambling);
        },
      }, at);
    });

    // Сдвиг подзаголовка маленький специально: на резком/инерционном скролле лаг ScrollSmoother
    // делал крупный сдвиг заметно "дёрганым"
    tl.to('.js-hero-lead', { opacity: 1, y: 0, duration: 0.32, ease: 'sine.out' }, revealStart + 0.08)
      // Гасим детали указателя, а не сам контейнер: контейнер скрыт анимацией появления (.js-hero-fade),
      // и твин запомнил бы opacity 0 как начальную - после refresh указатель исчезал навсегда
      .to('.scroll-hint__mouse, .scroll-hint__chevrons', { opacity: 0, duration: 0.05 }, 0)
      .to('.hero__vignette', { opacity: 0.4, duration: 0.3 }, 0)
      // Анимация занимает время 0..1 (совпадает с кадром видео), затем HERO_HOLD - пауза на готовом кадре.
      // Дистанция пина умножена на total, поэтому скорость прокрутки самой анимации прежняя
      .set({}, {}, total);

    // Частицы разлетаются вместе с наездом камеры: слой чуть растёт и уходит вверх по скроллу.
    // На слабом Android частиц нет (initHeroParticles) - пустой скрытый слой не анимируем
    if (!liteAndroid) {
      tl.fromTo('.js-hero-particles', { scale: 1, yPercent: 0 }, { scale: 1.35, yPercent: -8, ease: 'none', duration: 1 }, 0);
    }
  }

  /* ---------- Частицы hero: пыль в воздухе, как в самом ролике ----------
     Мягкие бело-голубоватые пятнышки разного размера, медленный дрейф в случайную сторону,
     без мерцания. Глубина как у боке: крупные - "ближе к камере", прозрачнее и плывут быстрее,
     мелкие - дальние, чётче и почти стоят. Только transform - всё на композиторе.
     На телефоне точек вдвое меньше, на слабом Android нет совсем; вне экрана анимация на паузе */
  function initHeroParticles() {
    const box = $('.js-hero-particles');
    // Слабый Android: контейнер скрыт в style.css (.lite-android)
    if (!box || !animated || liteAndroid) return;
    const rnd = gsap.utils.random;
    const count = touchOnly || !media.desktop ? 18 : 36;
    const frag = document.createDocumentFragment();
    const tweens = [];
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('i');
      dot.className = 'hero__particle';
      const depth = Math.random() ** 2; // 0 - далеко (большинство), 1 - у самой камеры
      const size = 1.5 + depth * 6;
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.left = `${rnd(0, 100)}%`;
      dot.style.top = `${rnd(5, 95)}%`;
      dot.style.opacity = (0.55 - depth * 0.35).toFixed(2);
      frag.appendChild(dot);
      const reach = 20 + depth * 70; // px: ближние смещаются заметнее
      tweens.push(
        gsap.fromTo(dot, { x: 0, y: 0 }, {
          x: rnd(-reach, reach),
          y: rnd(-reach, reach * 0.4), // лёгкий перевес вверх, как у тёплой пыли
          duration: rnd(16, 28) - depth * 6,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
        }).progress(Math.random()),
      );
    }
    box.appendChild(frag);
    // Плавное появление всего слоя, без мигания отдельных точек
    gsap.fromTo(box, { opacity: 0 }, { opacity: 1, duration: 2, ease: 'sine.out', delay: 0.4 });
    ScrollTrigger.create({
      trigger: box.closest('.pin-spacer') || '.js-hero',
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => tweens.forEach((t) => t.paused(!self.isActive)),
    });
  }

  // После прелоадера виден только ноутбук и указатель прокрутки - текст появится по скроллу
  function heroIntro() {
    if (!heroSplit) return;
    gsap.to('.js-hero-fade', { opacity: 1, y: 0, duration: MOTION.duration.reveal, delay: 0.3, clearProps: 'transform' });
  }

  /* ==========================================================================
     Showreel: второе scroll-video с подписями по этапам
     ========================================================================== */
  function initShowreel() {
    if (!animated || !videos.reel) return;
    const video = videos.reel;
    const captions = $$('.js-caption');

    // Кадры грузим заранее, когда секция на подходе
    ScrollTrigger.create({
      trigger: '.js-showreel',
      start: 'top bottom+=150%',
      once: true,
      onEnter: () => video.preload(),
    });

    const tl = gsap.timeline({
      onUpdate() { video.render(this.progress()); },
      scrollTrigger: pinSettings($('.js-showreel'), 300),
    });
    const slot = 1 / captions.length;
    captions.forEach((c, i) => {
      const at = i * slot;
      tl.fromTo(c, { opacity: 0, y: 40, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: slot * 0.3, ease: 'power2.out' }, at + slot * 0.05);
      if (i < captions.length - 1) tl.to(c, { opacity: 0, y: -30, filter: 'blur(8px)', duration: slot * 0.25, ease: 'power2.in' }, at + slot * 0.72);
    });
    tl.to({}, { duration: 0.001 }, 1);
  }

  /* ==========================================================================
     About: слова "загораются" по скроллу
     ========================================================================== */
  function initAbout() {
    const el = $('.js-statement');
    if (!animated || !el) return;
    // aria: none - на <p> aria-label запрещён, а слова без разбиения на буквы читаются нормально
    const split = new SplitText(el, { type: 'words', wordsClass: 'word', aria: 'none' });
    const words = split.words;
    ScrollTrigger.create({
      trigger: el,
      start: 'top 80%',
      end: 'bottom 55%',
      scrub: true,
      onUpdate: (self) => {
        const n = Math.round(self.progress * words.length);
        words.forEach((w, i) => w.classList.toggle('is-on', i < n));
      },
    });
  }

  /* ==========================================================================
     Stats: счётчики
     ========================================================================== */
  function initStats() {
    if (!animated) return;
    $$('.js-count').forEach((el) => {
      const to = Number(el.dataset.to);
      const obj = { v: 0 };
      el.textContent = '0';
      ScrollTrigger.create({
        trigger: el,
        start: 'top 85%',
        once: true,
        onEnter: () => gsap.to(obj, {
          v: to,
          duration: 2.2,
          ease: 'expo.out',
          onUpdate: () => { el.textContent = Math.round(obj.v); },
        }),
      });
    });
  }

  /* ==========================================================================
     Reveal заголовков: каретка "вписывает" строки (сквозной элемент)
     ========================================================================== */
  function initReveals() {
    if (!animated) return;

    $$('.js-reveal').forEach((heading) => {
      const split = new SplitText(heading, { type: 'lines', linesClass: 'reveal-line', aria: 'none' });
      const caret = document.createElement('span');
      caret.className = 'reveal-caret';
      caret.setAttribute('aria-hidden', 'true');
      heading.style.position = 'relative';
      heading.appendChild(caret);

      gsap.set(split.lines, { clipPath: 'inset(-10% 100% -10% 0)' });
      gsap.set(caret, { opacity: 0 });

      const tl = gsap.timeline({
        paused: true,
        onComplete: () => { split.revert(); caret.remove(); },
      });
      split.lines.forEach((line, i) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        const width = range.getBoundingClientRect().width;
        const lineBox = line.getBoundingClientRect();
        const hBox = heading.getBoundingClientRect();
        const align = getComputedStyle(heading).textAlign;
        const offset = align === 'center' ? (lineBox.width - width) / 2 : 0;
        const dur = clamp(width / 900, 0.45, 0.9);
        tl.set(caret, { opacity: 1, x: offset, y: lineBox.top - hBox.top, height: lineBox.height * 0.8 }, i === 0 ? 0 : '>-0.05')
          .fromTo(line,
            { clipPath: `inset(-10% ${100 - (offset / lineBox.width) * 100}% -10% ${(offset / lineBox.width) * 100}%)` },
            { clipPath: 'inset(-10% 0% -10% 0%)', duration: dur, ease: 'power3.inOut' }, '<')
          .to(caret, { x: offset + width, duration: dur, ease: 'power3.inOut' }, '<');
      });
      tl.to(caret, { opacity: 0, duration: 0.3, delay: 0.15 });

      ScrollTrigger.create({ trigger: heading, start: 'top 85%', once: true, onEnter: () => tl.play() });
    });

    // Второстепенные появления: у каждой секции свой характер
    const rise = (targets, trigger, vars = {}) => {
      gsap.from(targets, {
        y: 40,
        opacity: 0,
        duration: MOTION.duration.reveal,
        stagger: MOTION.stagger * 2,
        ease: MOTION.ease.entrance,
        scrollTrigger: { trigger, start: 'top 82%', once: true },
        ...vars,
      });
    };

    $$('.section-lead').forEach((el) => rise(el, el));
    rise('.about__meta > *', '.about__meta');

    // Услуги: строки выезжают, линия-разделитель прорисовывается
    $$('.js-service').forEach((row) => {
      gsap.from(row, {
        x: -40,
        opacity: 0,
        duration: MOTION.duration.reveal,
        ease: MOTION.ease.premium,
        scrollTrigger: { trigger: row, start: 'top 88%', once: true },
      });
    });

    // Портфолио: шторка открывает превью, картинка "оседает"
    $$('.js-case').forEach((card) => {
      const mediaEl = $('.case-card__media', card);
      const img = $('img', card);
      const tl = gsap.timeline({ scrollTrigger: { trigger: card, start: 'top 80%', once: true } });
      tl.from(mediaEl, { clipPath: 'inset(100% 0 0 0 round 24px)', duration: MOTION.duration.section, ease: MOTION.ease.inOut })
        .from(img, { scale: 1.25, duration: MOTION.duration.cinematic, ease: MOTION.ease.premium, clearProps: 'transform' }, '<')
        .from($$('.case-card__body > *', card), { y: 24, opacity: 0, stagger: MOTION.stagger, duration: MOTION.duration.reveal }, '-=1.4');
    });

    // Отзывы: поднимаются с лёгким наклоном
    gsap.from('.review', {
      y: 60,
      rotateX: -12,
      transformPerspective: 1000,
      transformOrigin: 'top center',
      opacity: 0,
      stagger: 0.12,
      duration: MOTION.duration.section,
      ease: MOTION.ease.premium,
      clearProps: 'transform',
      scrollTrigger: { trigger: '.reviews__grid', start: 'top 80%', once: true },
    });

    rise('.faq__item', '.faq__list', { y: 20, stagger: MOTION.stagger });
    rise(['.cta__text', '.cta .btn'], '.cta__inner', { delay: 0.4 });
    rise(['.contacts__list li', '.form'], '.contacts__grid', { stagger: MOTION.stagger });
  }

  /* ==========================================================================
     Портфолио: X-ray линза + tilt (desktop) / скан-проход (touch)
     ========================================================================== */
  function initPortfolio() {
    $$('.js-lens').forEach((el) => {
      const img = $('img', el);
      const done = () => el.classList.add('is-loaded');
      if (img.complete) done(); else img.addEventListener('load', done, { once: true });

      if (!hasGsap) return;

      if (media.finePointer && quality !== 'low') {
        const lens = gsap.quickTo(el, '--lens-r', { duration: 0.6, ease: MOTION.ease.premium, unit: 'px' });
        const rx = gsap.quickTo(el, 'rotateX', { duration: 0.8, ease: MOTION.ease.hover });
        const ry = gsap.quickTo(el, 'rotateY', { duration: 0.8, ease: MOTION.ease.hover });
        gsap.set(el, { transformPerspective: 1200 });

        el.addEventListener('pointerenter', () => lens(90));
        el.addEventListener('pointerleave', () => { lens(0); rx(0); ry(0); });
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          const px = e.clientX - r.left;
          const py = e.clientY - r.top;
          el.style.setProperty('--x', `${px}px`);
          el.style.setProperty('--y', `${py}px`);
          rx((py / r.height - 0.5) * -5);
          ry((px / r.width - 0.5) * 6);
        });
      } else if (quality !== 'low') {
        ScrollTrigger.create({
          trigger: el,
          start: 'top 60%',
          once: true,
          onEnter: () => {
            el.classList.add('is-scanned');
            gsap.fromTo(el, { '--scan': '-20%' }, {
              '--scan': '130%',
              duration: 1.8,
              delay: 0.8,
              ease: 'power2.inOut',
              onComplete: () => el.classList.remove('is-scanned'),
            });
          },
        });
      }
    });
  }

  /* ==========================================================================
     Процесс: линия прогресса и активные шаги
     ========================================================================== */
  function initProcess() {
    if (!hasGsap) return;
    const list = $('.js-process');
    if (quality !== 'low') {
      gsap.to('.js-process-fill', {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: { trigger: list, start: 'top 65%', end: 'bottom 65%', scrub: true },
      });
    } else {
      gsap.set('.js-process-fill', { scaleY: 1 });
    }
    $$('.js-step').forEach((step) => {
      ScrollTrigger.create({
        trigger: step,
        start: 'top 65%',
        onEnter: () => step.classList.add('is-active'),
        onLeaveBack: () => step.classList.remove('is-active'),
      });
    });
  }

  /* ==========================================================================
     FAQ: плавный аккордеон на <details>
     ========================================================================== */
  function initFaq() {
    const items = $$('.faq__item');
    items.forEach((item) => {
      const summary = $('summary', item);
      const answer = $('.faq__answer', item);
      summary.addEventListener('click', (e) => {
        if (!hasGsap || media.reducedMotion) return; // нативное поведение
        e.preventDefault();
        if (item.open) close(item); else open(item);
      });

      function open(el) {
        items.filter((o) => o !== el && o.open).forEach(close);
        el.open = true;
        gsap.fromTo(answer, { height: 0, opacity: 0 }, {
          height: 'auto', opacity: 1, duration: 0.6, ease: MOTION.ease.premium,
          onComplete: () => ScrollTrigger.refresh(),
        });
      }
    });

    function close(el) {
      const answer = $('.faq__answer', el);
      gsap.to(answer, {
        height: 0, opacity: 0, duration: 0.45, ease: MOTION.ease.hover,
        onComplete: () => { el.open = false; gsap.set(answer, { clearProps: 'height,opacity' }); ScrollTrigger.refresh(); },
      });
    }
  }

  /* ==========================================================================
     Stack: бесконечная бегущая строка (клоны для бесшовности)
     ========================================================================== */
  function initMarquee() {
    if (media.reducedMotion) return;
    $$('.marquee__row').forEach((row) => {
      [...row.children].forEach((item) => {
        const clone = item.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        row.appendChild(clone);
      });
    });
  }

  /* ==========================================================================
     CTA: падающие строки кода (фон)
     ========================================================================== */
  function initCodeRain() {
    const box = $('.js-code-rain');
    if (!box || quality === 'low') return;
    const snippets = [
      '<section class="cta">', 'gsap.to(el, { y: 0 })', '[[!FormIt? &hooks=`email`]]', 'display: grid;',
      'const site = build()', 'loading="lazy"', '--ease-premium', 'ScrollTrigger.create()', '[[*pagetitle]]',
      'backdrop-filter: blur()', 'fetchpriority="high"', 'aria-label="Меню"', 'clamp(2rem, 5vw, 6rem)',
      'new SplitText(h2)', '@media (min-width: 1024px)', 'site.launch()', '<picture>', 'font-display: swap',
    ];
    const cols = Math.min(14, Math.floor(box.offsetWidth / 120));
    const frag = document.createDocumentFragment();
    for (let c = 0; c < cols; c++) {
      const col = document.createElement('div');
      col.className = 'cta__rain-col';
      const lines = Array.from({ length: 16 }, () => snippets[Math.floor(Math.random() * snippets.length)]);
      col.textContent = [...lines, ...lines].join('\n');
      col.style.animationDuration = `${28 + Math.random() * 30}s`;
      col.style.animationDelay = `${-Math.random() * 40}s`;
      col.style.opacity = String(0.5 + Math.random() * 0.5);
      frag.appendChild(col);
    }
    box.appendChild(frag);
  }

  /* ==========================================================================
     Мышь как на stackbyte.dev: системный курсор + токены кода из-под курсора
     + едва заметный прожектор. Плюс magnetic-кнопки.
     Параметры сняты с оригинала: выброс не чаще 150 мс и с шансом 50%,
     до 4 токенов одновременно, появление 0.6 с (scale 0.5 -> 1, opacity 0.8),
     самый старый гаснет каждые 600 мс.
     ========================================================================== */
  const TRAIL_TOKENS = [
    'const', 'let', '=>', 'return', 'async', 'await', 'import', 'export',
    '{}', '[]', '()', '&&', '||', '===', '++', ';',
    '<div>', '</>', '[[*id]]', '[[!FormIt]]', 'gsap.to()', 'flex', 'grid', ':hover',
  ];
  // Зоны, где токены кода не вылетают: навбар и линза - там свой эффект,
  // hero - там видео, формы/попапы - токены под полем ввода будут мешать
  const NO_TRAIL_ZONES = ['.js-hero', '.js-navbar', '.js-lens', '.js-form', '.js-messenger', '.js-cookie'];
  const NO_TRAIL_SELECTOR = NO_TRAIL_ZONES.join(', ');

  function initCursor() {
    if (!hasGsap || !media.finePointer || quality === 'low') return;

    // Кастомный курсор вместо системного: точка летит вслед за мышью мгновенно,
    // кольцо отстаёт от неё с инерцией и раскрывается над ссылками/кнопками.
    const dot = $('.js-cursor-dot');
    const ring = $('.js-cursor-ring');
    const layer = $('.js-cursor-layer');
    root.classList.add('has-cursor');

    // popover="manual" кладёт слой курсора в top layer браузера - иначе обычный
    // z-index бессилен против navbar (sticky) и особенно против dialog.showModal()
    // (мессенджер), который сам живёт в top layer поверх всего остального.
    // Переоткрываем popover курсора при каждом открытии/закрытии любого <dialog>,
    // чтобы он оказался выше него же в стеке top layer.
    if (layer.showPopover) {
      const bringToFront = () => {
        if (layer.matches(':popover-open')) layer.hidePopover();
        layer.showPopover();
      };
      bringToFront();
      $$('dialog').forEach((d) => {
        new MutationObserver(bringToFront).observe(d, { attributes: true, attributeFilter: ['open'] });
      });
    }

    const dotX = gsap.quickTo(dot, 'x', { duration: 0.06, ease: 'power3' });
    const dotY = gsap.quickTo(dot, 'y', { duration: 0.06, ease: 'power3' });
    const ringX = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3' });
    const ringY = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3' });
    window.addEventListener('mousemove', (e) => {
      dotX(e.clientX);
      dotY(e.clientY);
      ringX(e.clientX);
      ringY(e.clientY);
    }, { passive: true });
    document.addEventListener('pointerover', (e) => {
      const link = e.target.closest('a, button, summary, input, textarea, [data-magnetic]');
      ring.classList.toggle('is-link', Boolean(link));
    });

    // Прожектор: CSS-переменные --mx/--my, обновление не чаще кадра
    const glow = $('.js-cursor-glow');
    let raf = null;
    let last = { x: 0, y: 0 };
    window.addEventListener('mousemove', (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        glow.style.setProperty('--mx', `${last.x}px`);
        glow.style.setProperty('--my', `${last.y}px`);
        raf = null;
      });
    }, { passive: true });

    // Токены кода
    const trail = $('.js-code-trail');
    const live = [];
    let lastSpawn = 0;

    const fadeOldest = () => {
      const el = live.shift();
      if (!el) return;
      gsap.to(el, { opacity: 0, scale: 0.5, duration: 0.6, ease: 'power2.out', onComplete: () => el.remove() });
      if (live.length) schedule();
    };
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(fadeOldest, 600);
    };

    window.addEventListener('mousemove', (e) => {
      const now = performance.now();
      if (now - lastSpawn < 150) return;
      lastSpawn = now;
      if (Math.random() > 0.5) return;
      if (e.target.closest && e.target.closest(NO_TRAIL_SELECTOR)) return;

      const el = document.createElement('span');
      el.className = 'code-trail__token';
      el.textContent = TRAIL_TOKENS[Math.floor(Math.random() * TRAIL_TOKENS.length)];
      trail.appendChild(el);
      // Вылетают из-за края кольца (отстаёт от мыши), а не из-под самой точки курсора
      const ringX = gsap.getProperty(ring, 'x');
      const ringY = gsap.getProperty(ring, 'y');
      const angle = Math.random() * Math.PI * 2;
      const edge = (ring.classList.contains('is-link') ? 27 : 17) + 6;
      const spawnX = ringX + Math.cos(angle) * edge;
      const spawnY = ringY + Math.sin(angle) * edge;
      gsap.set(el, { x: spawnX, y: spawnY, xPercent: -50, yPercent: -50, opacity: 0, scale: 0.5 });
      gsap.to(el, { opacity: 0.6, scale: 1, duration: 0.6, ease: 'power2.out' });
      live.push(el);
      if (live.length > 4) {
        const extra = live.shift();
        gsap.to(extra, { opacity: 0, scale: 0.5, duration: 0.3, onComplete: () => extra.remove() });
      }
      schedule();
    }, { passive: true });

    // Magnetic: кнопка тянется за курсором, возвращается с пружиной
    $$('[data-magnetic]').forEach((btn) => {
      const mx = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' });
      const my = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' });
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.3);
        my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      btn.addEventListener('pointerleave', () => {
        gsap.to(btn, { x: 0, y: 0, duration: 0.9, ease: MOTION.ease.elastic });
      });
    });
  }

  /* ==========================================================================
     Атмосфера: mesh-фон реагирует на скролл и курсор
     ========================================================================== */
  function initAtmosphere() {
    if (!hasGsap || quality !== 'high') return;
    const mesh = $('.bg-mesh');
    const mx = gsap.quickTo(mesh, 'x', { duration: 2.5, ease: 'power2' });
    const my = gsap.quickTo(mesh, 'y', { duration: 2.5, ease: 'power2' });
    let scrollY = 0;
    let px = 0;
    let py = 0;
    const apply = () => { mx(px); my(py + scrollY); };
    window.addEventListener('pointermove', (e) => {
      px = (e.clientX / innerWidth - 0.5) * 40;
      py = (e.clientY / innerHeight - 0.5) * 40;
      apply();
    }, { passive: true });
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => { scrollY = self.progress * -120; apply(); },
    });
  }

  /* ==========================================================================
     Форма: валидация, honeypot, состояния (отправку берёт MODX FormIt)
     ========================================================================== */
  function initForm() {
    const form = $('.js-form');
    if (!form) return;
    const status = $('.js-form-status', form);
    const submit = $('.form__submit', form);
    let tried = false;

    const rules = {
      name: (v) => (v.trim().length >= 2 ? '' : 'Укажите имя - хотя бы 2 буквы'),
      contact: (v) => {
        const s = v.trim();
        if (!s) return 'Нужен телефон или Telegram, чтобы я мог ответить';
        const digits = s.replace(/\D/g, '');
        const isPhone = /^[+\d\s()-]+$/.test(s) && digits.length >= 10 && digits.length <= 15;
        const isTg = /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(s);
        return isPhone || isTg ? '' : 'Проверьте номер (10+ цифр) или ник в формате @username';
      },
    };

    const showError = (input, msg) => {
      const field = input.closest('.field');
      const err = $(`#${input.getAttribute('aria-describedby')}`);
      field.classList.toggle('has-error', Boolean(msg));
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      $('span', err).textContent = msg;
    };

    const validate = () => {
      let firstBad = null;
      Object.keys(rules).forEach((name) => {
        const input = form.elements[name];
        const msg = rules[name](input.value);
        showError(input, msg);
        if (msg && !firstBad) firstBad = input;
      });
      const agree = form.elements.agree;
      const agreeErr = $('#f-agree-err');
      agreeErr.classList.toggle('is-visible', !agree.checked);
      $('span', agreeErr).textContent = agree.checked ? '' : 'Нужно согласие на обработку данных';
      if (!agree.checked && !firstBad) firstBad = agree;
      return firstBad;
    };

    form.addEventListener('input', (e) => {
      if (!tried) return;
      const input = e.target;
      if (rules[input.name]) showError(input, rules[input.name](input.value));
      if (input.name === 'agree') validate();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      tried = true;
      status.textContent = '';
      status.className = 'form__status js-form-status';

      // Honeypot: бот заполнил скрытое поле - делаем вид, что всё ок
      if (form.elements.website.value) {
        status.textContent = 'Спасибо! Заявка отправлена.';
        return;
      }

      const bad = validate();
      if (bad) { bad.focus(); return; }

      submit.classList.add('is-loading');
      submit.setAttribute('aria-busy', 'true');
      $('.btn__text', submit).textContent = 'Отправляю...';

      // TODO(MODX): заменить имитацию на fetch к FormIt-обработчику
      setTimeout(() => {
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        form.classList.add('is-sent');
        $('.btn__text', submit).textContent = 'Заявка отправлена';
        status.classList.add('is-success');
        status.textContent = 'Спасибо! Отвечу в течение рабочего дня.';
        form.reset();
        tried = false;
        setTimeout(() => {
          form.classList.remove('is-sent');
          $('.btn__text', submit).textContent = 'Отправить заявку';
        }, 5000);
      }, 1400);
    });
  }

  /* ==========================================================================
     Плавающие элементы: наверх, мессенджер, cookie + consent
     ========================================================================== */
  const CONSENT_KEY = 'md-consent';
  const METRIKA_ID = null; // TODO: номер счётчика Яндекс.Метрики

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } },
  };

  function loadAnalytics() {
    if (!METRIKA_ID || window.ym) return;
    /* eslint-disable */
    (function (m, e, t, r, i, k, a) { m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); }; m[i].l = 1 * new Date(); k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a); })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    /* eslint-enable */
    window.ym(METRIKA_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  }

  function initFloating() {
    // Наверх
    const toTop = $('.js-to-top');
    const toggleTop = (y) => toTop.classList.toggle('is-visible', y > innerHeight * 1.5);
    if (hasGsap) ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => toggleTop(self.scroll()) });
    else window.addEventListener('scroll', () => toggleTop(window.scrollY), { passive: true });
    toTop.addEventListener('click', () => scrollToTarget(0));

    // Мессенджер
    const dialog = $('.js-messenger');
    const openBtn = $('.js-messenger-open');
    openBtn.addEventListener('click', () => {
      if (dialog.open) { dialog.close(); return; }
      dialog.showModal();
      if (smoother) smoother.paused(true);
    });
    $('.js-messenger-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (smoother) smoother.paused(false); openBtn.focus(); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

    // Cookie + согласие на аналитику
    const banner = $('.js-cookie');
    const consent = storage.get(CONSENT_KEY);
    if (consent === 'all') loadAnalytics();
    const show = () => { banner.hidden = false; };
    const hide = () => { banner.hidden = true; };
    if (!consent) setTimeout(show, 1800);
    $('.js-cookie-accept').addEventListener('click', () => { storage.set(CONSENT_KEY, 'all'); hide(); loadAnalytics(); });
    $('.js-cookie-decline').addEventListener('click', () => { storage.set(CONSENT_KEY, 'necessary'); hide(); });
    $('.js-cookie-open').addEventListener('click', show);
  }

  /* ==========================================================================
     Старт
     ========================================================================== */
  async function start() {
    initGsap();
    createVideos();

    // Разметка для анимаций готовится под прелоадером
    initHero();
    initHeroParticles();
    initMarquee();
    initCodeRain();

    await runPreloader();

    initNavbar();
    initScrollProgress();
    initShowreel();
    initAbout();
    initStats();
    initPortfolio();
    initProcess();
    initFaq();
    initForm();
    initFloating();
    initCursor();
    initAtmosphere();
    initReveals();

    if (hasGsap) ScrollTrigger.refresh();
    heroIntro();

    // Понижение качества по факту FPS (grain и курсор отключаются через классы).
    // Только high -> mid: в low прячутся видео и контент, которые к этому моменту уже работают,
    // а первые 2 с после загрузки FPS на Android почти всегда проседает (декодирование видео, шрифты)
    if (quality === 'high') {
      measureFps().then((fps) => { if (fps < 40) setQuality('mid'); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // Доступ для отладки из консоли
  window.MD = { MOTION, videos, get quality() { return quality; }, get smoother() { return smoother; } };
})();
