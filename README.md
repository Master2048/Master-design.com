# Master Design - сайт-портфолио

Статический прототип главной страницы: HTML / CSS / vanilla JS + GSAP (ScrollTrigger, ScrollSmoother, SplitText). Целевая CMS - MODX.

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Страница. Блоки размечены комментариями `chunk:*` - это будущие чанки MODX |
| `design-tokens.css` | Все токены: цвета, градиенты секций, типографика, отступы, стекло, моушен |
| `style.css` | Стили (BEM, mobile-first) |
| `script.js` | Вся логика, модули `init*()` |
| `design-system.md` | Правила дизайн-системы, где что лежит в коде |
| `seo-plan.md` | Ключевые фразы и их распределение |
| `progress.md` | Статус, замеры, **плейсхолдеры для замены**, чек-лист ручной проверки |
| `.htaccess` | Сжатие, кэш, закрытие `.mp4` и `.md` |
| `assets/` | Шрифты, иконки, картинки, кадры видео, GSAP. Переносится в MODX как есть |

## Запуск локально

Любой статический сервер из корня проекта, например OSPanel (домен `Master-design.com`). Открывать через `http://`, не `file://`, иначе браузер заблокирует загрузку кадров видео.

## Версия CSS/JS (обязательно после каждого изменения)

`.htaccess` разрешает браузеру хранить `.css` и `.js` 30 дней, а `.html` всегда скачивается заново. Поэтому **после каждой правки `script.js`, `style.css` или `design-tokens.css` нужно поднять версию `?v=`** в ссылках на эти файлы сразу в трёх страницах: `index.html`, `offer.html`, `privacy.html`.

- Формат: дата + буква. `20260929a` → `20260929b` → … , в новый день `20260930a`.
- Версия одна на все три файла и все три страницы.
- Без новой версии телефоны до месяца берут старые скрипты и стили из кэша вместе со свежим HTML. Эта смесь ломала прелоадер и анимации на Android (Chrome).

```html
<link rel="stylesheet" href="design-tokens.css?v=20260929b">
<link rel="stylesheet" href="style.css?v=20260929b">
<script src="script.js?v=20260929b" defer></script>
```

## Диагностика на устройстве

Открыть страницу с `?debug` в адресе: внизу появится панель с выбранным уровнем качества (`quality`), причиной (`reason`) и значениями, из которых он считается (сеть, память, reduced-motion, FPS). Обычные посетители её не видят.

## Перенос на MODX

1. `assets/` скопировать как есть. Пути в CSS/JS относительные.
2. Шаблон: содержимое `index.html`. Блоки `chunk:head-*` → чанки шапки, `title` / `description` / `canonical` → `[[*longtitle]]`, `[[*description]]`, `[[~[[*id]]? &scheme=`full`]]`.
3. Секции `chunk:section-*` → чанки. Кейсы, отзывы, FAQ → MIGX TV (FAQPage schema генерировать из того же MIGX).
4. Форма: FormIt (`&hooks=`spam,email``, `&validate=`website:blank``). В `script.js` найти `TODO(MODX)` и заменить имитацию отправки на `fetch`.
5. sitemap.xml → pdoSitemap, robots.txt → ресурс MODX.
6. `.htaccess` объединить со штатным `ht.access` MODX.
7. CSS/JS минифицировать через MinifyX.
8. Перед запуском пройти раздел «Плейсхолдеры» в `progress.md`.

## Пересборка видео (ffmpeg)

Из исходников `assets/video/*.mp4` (HEVC 2560×1440). Ключевой кадр каждые 4 кадра и без B-кадров - это важно для плавной перемотки скроллом:

```bash
ffmpeg -i Laptop_animation.mp4 -an -vf "scale=1920:-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset slower -crf 20 -g 4 -keyint_min 4 -sc_threshold 0 -bf 0 -movflags +faststart hero/hero-1920.mp4
ffmpeg -i Laptop_animation.mp4 -an -vf "scale=1280:-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset slower -crf 22 -g 4 -keyint_min 4 -sc_threshold 0 -bf 0 -movflags +faststart hero/hero-1280.mp4
```

Для Character то же самое (crf 21 и 23). Имена файлов прописаны в `data-src-desktop` / `data-src-mobile` у тега `<video>`.
