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
 *
 * 抓取顺序（拿到清晰图标就停）：
 *   1. 首页 HTML 里的 <link rel="apple-touch-icon">（通常 180x180 PNG，最清晰）
 *   2. 首页 HTML 里的 <link rel="icon">（PNG/SVG/ICO 都可能）
 *   3. 根目录 /apple-touch-icon.png
 *   4. 根目录 /favicon.ico
 *   5. favicon.im 公开服务（只用于被 Cloudflare 拦截、直连拿不到的站点）
 *
 * 抓不到的链接保持无 icon 字段，前端会自动回落到首字母色块。
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
const CONCURRENCY = 4;

const argv = process.argv.slice(2);
const opts = {
  all: argv.includes('--all'),
  force: argv.includes('--force'),
  dryRun: argv.includes('--dry-run'),
  limit: (function () {
    const hit = argv.find((a) => a.startsWith('--limit='));
    return hit ? Math.max(0, parseInt(hit.slice(8), 10) || 0) : 0;
  })()
};

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

async function timedFetch(url, timeoutMs) {
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

async function fetchCandidate(url) {
  const res = await timedFetch(url, 9000);
  if (!res.ok) return null;
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return null;
  const ext = extFrom(res.headers.get('content-type'), url);
  // 明显的 HTML 错误页直接丢弃
  const head = buf.subarray(0, 80).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return null;
  return { buf, ext };
}

async function grabIcon(siteUrl) {
  const origin = new URL(siteUrl).origin;

  // 1+2. 解析首页声明的图标
  let htmlLinks = { apple: [], icon: [] };
  try {
    const res = await timedFetch(siteUrl, 9000);
    if (res.ok) {
      const text = await res.text();
      htmlLinks = findIconLinks(text.slice(0, 400000), res.url || siteUrl);
    }
  } catch (e) { /* 首页拿不到就跳过 */ }

  // 5. 第三方公开 favicon 服务（仅构建期用一次，抓到就落盘，运行时零外部请求）
  const bareHost = new URL(siteUrl).hostname.replace(/^www\./, '');

  const candidates = [
    ...htmlLinks.apple.slice(0, 2),
    ...htmlLinks.icon.slice(0, 2),
    origin + '/apple-touch-icon.png',
    origin + '/favicon.ico',
    'https://favicon.im/' + bareHost + '?larger=true'
  ];

  const seen = new Set();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const got = await fetchCandidate(url);
      if (got) return { ...got, from: url };
    } catch (e) { /* 试下一个 */ }
  }
  return null;
}

async function main() {
  if (!fs.existsSync(SRC_PATH)) {
    console.error('✖ 找不到 ' + path.relative(REPO_ROOT, SRC_PATH));
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));

  const targets = [];
  for (const cat of data.categories || []) {
    for (const link of cat.links || []) {
      if (!link || !link.url) continue;
      if (opts.all || !link.icon) targets.push({ link, cat });
    }
  }
  const queue = opts.limit ? targets.slice(0, opts.limit) : targets;

  console.log('→ 待处理 ' + queue.length + ' 条链接' + (opts.dryRun ? '（dry-run）' : ''));

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

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    await Promise.all(queue.slice(i, i + CONCURRENCY).map(work));
  }

  if (!opts.dryRun && ok > 0) {
    fs.writeFileSync(SRC_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
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
