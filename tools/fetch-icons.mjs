#!/usr/bin/env node
/**
 * 抓取链接站点的真实图标，落盘到 data/icons/ 并写回 data/links.json 的 icon 字段。
 *
 * 用法：
 *   node tools/fetch-icons.mjs              抓取缺失图标的链接
 *   node tools/fetch-icons.mjs --all        全部重新抓取
 *   node tools/fetch-icons.mjs --force      忽略本地缓存重新下载
 *   node tools/fetch-icons.mjs --dry-run    只打印将要做的事
 *   node tools/fetch-icons.mjs --limit=5    只处理前 5 个
 *   node tools/fetch-icons.mjs --include-fav 连收藏夹类一起抓（默认跳过，避免 CI 超时）
 *   node tools/fetch-icons.mjs --concurrency=24  并发数（默认 16）
 *   node tools/fetch-icons.mjs --timeout=6000    单个请求超时毫秒（默认 8000，首页额外封顶 6000）
 *
 * 抓取顺序（拿到清晰图标就停）：
 *   1. 首页 HTML 里的 <link rel="apple-touch-icon">（通常 180x180 PNG，最清晰）
 *   2. 首页 HTML 里的 <link rel="icon">（PNG/SVG/ICO 都可能）
 *   3. 根目录 /apple-touch-icon.png
 *   4. 根目录 /favicon.ico
 *   5. favicon.im 公开服务（只用于被 Cloudflare 拦截、直连拿不到的站点）
 *
 * 加速策略：第 1、2 步要先拿首页才能知道地址，所以「首页 + 根目录 apple-touch-icon.png
 * + favicon.im」三者并发发出，避免一条链接被串行的 5 次超时拖到 40 秒以上。
 * 单条最坏耗时 ≈ 两轮超时，而不是六轮。另有多 worker 拉取，慢站点不会卡住整批。
 *
 * 抓不到的链接保持无 icon 字段，前端会自动回落到首字母色块。
 * 只处理导航类（type 不是 "fav"）的分类：收藏夹类条数多、图标在 16px 单行里看不清，
 * 抓它们只会拖长 CI 时间（GitHub Actions 每轮都有 8 分钟上限）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = path.join(REPO_ROOT, 'data', 'links.json');
const ICON_DIR = path.join(REPO_ROOT, 'data', 'icons');
const ICON_REL = 'data/icons';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_BYTES = 96 * 1024;

const argv = process.argv.slice(2);
function numArg(name, fallback) {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  if (!hit) return fallback;
  const n = parseInt(hit.slice(name.length + 3), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const opts = {
  all: argv.includes('--all'),
  force: argv.includes('--force'),
  dryRun: argv.includes('--dry-run'),
  includeFav: argv.includes('--include-fav'),
  limit: numArg('limit', 0),
  concurrency: Math.min(64, numArg('concurrency', 16)),
  timeout: Math.min(30000, numArg('timeout', 8000))
};
// 首页只用来解析 <link rel="icon">，不必等太久；超时了就靠根目录候选兜底。
const HOME_TIMEOUT = Math.min(opts.timeout, 6000);

function hostSlug(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  } catch (e) {
    return 'unknown';
  }
}

function extFrom(contentType, url) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('svg')) return '.svg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('icon') || ct.includes('vnd.microsoft.icon')) return '.ico';
  const m = /\.(png|svg|ico|jpe?g|webp)(\?|$)/i.exec(url || '');
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.ico';
}

// 超时计时器覆盖整个请求（含 body 读取）。之前只覆盖响应头，
// 慢速站点在 arrayBuffer()/text() 阶段可以无上限挂着，是「一条链接卡 40 秒」的主因之一。
async function request(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,image/*,*/*' }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHomepage(url) {
  try {
    const res = await request(url, HOME_TIMEOUT);
    if (!res.ok) return { apple: [], icon: [] };
    const text = await res.text();
    return findIconLinks(text.slice(0, 400000), res.url || url);
  } catch (e) {
    return { apple: [], icon: [] };
  }
}

function findIconLinks(html, baseUrl) {
  const out = { apple: [], icon: [] };
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
    const href = (/\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag) || [])[1] || '';
    if (!href) continue;
    const relLower = rel.toLowerCase();
    if (!/icon/.test(relLower)) continue;
    let abs;
    try { abs = new URL(href, baseUrl).href; } catch (e) { continue; }
    if (/apple-touch-icon/.test(relLower)) out.apple.push(abs);
    else out.icon.push(abs);
  }
  return out;
}

function looksLikeHtml(buf) {
  const head = buf.subarray(0, 256).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || /<svg[\s>]/.test(head)) return false; // <?xml?><svg ...> 也算图片
  return head.startsWith('<');
}

const PLACEHOLDER_SVG = 'font-style="italic">f</text>';
function isPlaceholder(buf) {
  if (buf.length > 400) return false;
  return buf.toString('utf8').includes(PLACEHOLDER_SVG);
}

async function fetchCandidate(url) {
  try {
    const res = await request(url, opts.timeout);
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const ext = extFrom(res.headers.get('content-type'), url);
    // 太小的响应不可能是图标（踩过：4KB 的 /favicon.ico 位置返回 8 字节 PNG 魔数）
    if (buf.length < 60) return null;
    // 返回的是网页而不是图片：图标只能是 PNG/JPEG/WEBP/ICO 二进制或 SVG，
    // 所以「以 < 开头但不含 <svg」一定是 HTML 错误页（踩过：404 页存成 .png）。
    if (looksLikeHtml(buf)) return null;
    // favicon.im 对抓不到的域名会返回一张「灰色圆形 + 斜体 f」的占位 SVG（257 字节），
    // 全站长得一模一样，比首字母色块还难看，直接丢弃让前端回落。
    if (isPlaceholder(buf)) return null;
    return { buf, ext };
  } catch (e) {
    return null;
  }
}

// 并发试多个候选，取第一个成功的（保留候选顺序语义：谁先回来用谁）
async function firstHit(urls) {
  if (!urls.length) return null;
  const results = await Promise.all(urls.map((u) => fetchCandidate(u).then((got) => ({ u, got })).catch(() => null)));
  for (const r of results) if (r && r.got) return { ...r.got, from: r.u };
  return null;
}

async function grabIcon(siteUrl) {
  const origin = new URL(siteUrl).origin;
  // 5. 第三方公开 favicon 服务（仅构建期用一次，抓到就落盘，运行时零外部请求）
  const bareHost = new URL(siteUrl).hostname.replace(/^www\./, '');
  const thirdParty = 'https://favicon.im/' + bareHost + '?larger=true';
  const rootApple = origin + '/apple-touch-icon.png';

  // 互不依赖的三个请求同时发出：首页（用来解析 <link rel="icon">）、
  // 根目录 apple-touch-icon.png、favicon.im。慢站点不再一层层串行等待。
  const [htmlLinks, appleTouch, fallback] = await Promise.all([
    fetchHomepage(siteUrl),
    fetchCandidate(rootApple),
    fetchCandidate(thirdParty)
  ]);

  // 1+2. 首页声明的图标质量最好，并发试，谁先成功用谁
  const declared = [...new Set([...htmlLinks.apple.slice(0, 2), ...htmlLinks.icon.slice(0, 2)])];
  if (declared.length) {
    const got = await firstHit(declared);
    if (got) return got;
  }

  // 3. 根目录 apple-touch-icon.png
  if (appleTouch) return { ...appleTouch, from: rootApple };

  // 4. 根目录 /favicon.ico
  const ico = await fetchCandidate(origin + '/favicon.ico');
  if (ico) return { ...ico, from: origin + '/favicon.ico' };

  // 5. favicon.im 兜底
  if (fallback) return { ...fallback, from: thirdParty };

  return null;
}

async function main() {
  if (!fs.existsSync(SRC_PATH)) {
    console.error('✖ 找不到 ' + path.relative(REPO_ROOT, SRC_PATH));
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));

  const targets = [];
  let skippedFav = 0;
  for (const cat of data.categories || []) {
    // 收藏夹类不抓图标：条目多、收益低，还会把 CI 的抓取时间撑爆。
    // 这类链接保持无 icon，前端回落成首字母色块。
    if (cat.type === 'fav' && !opts.includeFav) {
      skippedFav += (cat.links || []).length;
      continue;
    }
    for (const link of cat.links || []) {
      if (!link || !link.url) continue;
      if (opts.all || !link.icon) targets.push({ link, cat });
    }
  }
  const queue = opts.limit ? targets.slice(0, opts.limit) : targets;

  console.log('→ 待处理 ' + queue.length + ' 条链接' + (opts.dryRun ? '（dry-run）' : '')
    + (skippedFav ? '（跳过收藏夹类 ' + skippedFav + ' 条）' : ''));

  if (!opts.dryRun && !fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });

  let ok = 0;
  let fail = 0;
  const failed = [];

  async function work(item) {
    const slug = hostSlug(item.link.url);
    try {
      const hit = await grabIcon(item.link.url);
      if (!hit) { fail++; failed.push(item.link.url); return; }
      const file = slug + hit.ext;
      const abs = path.join(ICON_DIR, file);
      if (!opts.dryRun) {
        fs.writeFileSync(abs, hit.buf);
        item.link.icon = ICON_REL + '/' + file;
      }
      ok++;
      console.log('  ✔ ' + item.link.name + '  ' + Math.round(hit.buf.length / 1024) + 'KB  ' + hit.ext + '  ← ' + hit.from.replace(originOf(hit.from), ''));
    } catch (e) {
      fail++;
      failed.push(item.link.url);
    }
  }

  function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }

  // 增量落盘：CI 里这一步有 8 分钟上限，超时会被 SIGTERM 杀掉。
  // 如果只在最后写一次 links.json，被杀的代价是「图标文件都在、icon 字段全丢」，
  // 页面上一片首字母色块，还得靠 tools/link-icons.mjs 事后补救。所以每 20 个写一次。
  let lastFlush = 0;
  function flush() {
    fs.writeFileSync(SRC_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    lastFlush = ok;
  }
  let killed = false;
  function onKill(sig) {
    if (killed) return;
    killed = true;
    if (!opts.dryRun && ok > lastFlush) {
      try { flush(); } catch (e) { /* 落盘失败也要退出 */ }
    }
    console.log('⚠ 收到 ' + sig + '，已保存进度（' + ok + ' 个图标）');
    process.exit(0);
  }
  process.on('SIGTERM', () => onKill('SIGTERM'));
  process.on('SIGINT', () => onKill('SIGINT'));

  // 多 worker 拉取：不按批 Promise.all 等待，慢站点不会把整批拖成木桶。
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= queue.length) return;
      await work(queue[i]);
      if (!opts.dryRun && ok - lastFlush >= 20) flush();
    }
  }
  const pool = Math.min(opts.concurrency, Math.max(1, queue.length));
  console.log('→ 并发 ' + pool + ' · 单请求超时 ' + opts.timeout + 'ms · 首页封顶 ' + HOME_TIMEOUT + 'ms');
  await Promise.all(Array.from({ length: pool }, () => worker()));

  if (!opts.dryRun && ok > lastFlush) {
    flush();
    console.log('✔ 已写入 ' + path.relative(REPO_ROOT, SRC_PATH) + '（' + ok + ' 个图标）');
    console.log('  下一步：node tools/build-data.mjs');
  }

  if (fail) {
    console.log('⚠ ' + fail + ' 条抓取失败（保持首字母色块）：');
    failed.slice(0, 10).forEach((u) => console.log('   - ' + u));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('✖ ' + e.message);
    process.exit(1);
  });
}
