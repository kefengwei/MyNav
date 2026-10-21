#!/usr/bin/env node
/**
 * MyNav 书签导入工具
 * ============================================================
 * 把浏览器导出的书签文件转换成 data/links.json（导航站唯一真源），支持：
 *   - Netscape Bookmark HTML（Chrome / Edge / Firefox / Safari 导出的 .html）
 *   - Chromium 系 Bookmarks JSON（Chrome/Edge 的 "Bookmarks" 文件）
 *
 * 用法（在仓库根目录执行）：
 *   node tools/import-bookmarks.mjs bookmarks.html
 *   node tools/import-bookmarks.mjs bookmarks.html --depth 1
 *   node tools/import-bookmarks.mjs "C:\Users\me\Desktop\bookmarks.html" --no-icons
 *
 * 常用参数：
 *   --out <path>       输出文件，默认 data/links.json
 *   --depth <n>        分类取书签的第几层文件夹；默认取最深层
 *   --no-icons         不导出书签自带的图标（favicon），只用首字母色块
 *   --title <text>     站点标题，默认沿用 links.json 里已有的
 *   --subtitle <text>  副标题，默认沿用 links.json 里已有的
 *   --dry-run          只统计，不写文件
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData, generateSource, SRC_PATH, OUT_PATH } from './build-data.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ROOT_FOLDER_RE = /^(书签栏|其他书签|收藏夹栏|移动设备书签|书签|收藏夹|Bookmarks bar|Bookmarks toolbar|Bookmarks Toolbar|Other bookmarks|Mobile bookmarks|Bookmarks|Favorites bar|Favorites)$/i;
const SKIP_SCHEME_RE = /^(chrome|edge|about|javascript|file|data|place|moz-extension|chrome-extension|view-source|blob|ftp):/i;
const MAX_ICON_BYTES = 64 * 1024;

/* ---------------- 参数 ---------------- */
function parseArgs(argv) {
  const opts = {
    input: '',
    out: join(REPO_ROOT, 'data', 'links.json'),
    depth: 0,
    icons: true,
    title: '',
    subtitle: '',
    dryRun: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = resolve(process.cwd(), argv[++i]);
    else if (a === '--depth') opts.depth = Number(argv[++i]) || 0;
    else if (a === '--no-icons') opts.icons = false;
    else if (a === '--title') opts.title = argv[++i] || opts.title;
    else if (a === '--subtitle') opts.subtitle = argv[++i] || opts.subtitle;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (!opts.input) opts.input = a;
  }

  if (!opts.input) { printHelp(); process.exit(1); }
  return opts;
}

function printHelp() {
  console.log([
    '',
    'MyNav 书签导入工具',
    '',
    '  node tools/import-bookmarks.mjs <书签文件> [选项]',
    '',
    '  书签文件：Chrome/Edge 导出的 .html，或 Chrome/Edge 的 Bookmarks JSON',
    '',
    '  选项：',
    '    --out <path>      输出文件，默认 data/links.json',
    '    --depth <n>       分类取第几层文件夹，默认取最深层（1 = 只取第一层）',
    '    --no-icons        不导出书签图标',
    '    --title <text>    站点标题（默认沿用 links.json 中已有的）',
    '    --subtitle <text> 副标题（默认沿用 links.json 中已有的）',
    '    --dry-run         只统计不写文件',
    '',
    '  示例：',
    '    node tools/import-bookmarks.mjs bookmarks.html --depth 1',
    ''
  ].join('\n'));
}

/* ---------------- 通用工具 ---------------- */
function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function cleanText(text) {
  return decodeEntities(String(text).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttributes(raw) {
  const attrs = {};
  const re = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) attrs[m[1].toUpperCase()] = m[2];
  return attrs;
}

function normalizeUrl(url) {
  if (!url) return '';
  // 书签 HTML 里的 HREF 是实体转义过的，必须先解码再补协议
  const trimmed = decodeEntities(String(url)).trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    // 没有协议，按 http 补全
    return 'http://' + trimmed;
  }
  return trimmed;
}

function shouldKeep(entry) {
  if (!entry.url) return false;
  if (SKIP_SCHEME_RE.test(entry.url)) return false;
  if (!/^https?:\/\//i.test(entry.url)) return false;
  if (entry.url.length > 2000) return false;
  return true;
}

function categoryOf(pathStack, depth) {
  const cleaned = pathStack.filter((p) => p && !ROOT_FOLDER_RE.test(p.trim()));
  if (!cleaned.length) return '未分类';
  const picked = depth > 0 ? cleaned.slice(0, depth) : [cleaned[cleaned.length - 1]];
  return picked.join(' / ') || '未分类';
}

/* ---------------- Netscape Bookmark HTML 解析 ---------------- */
function parseNetscapeHtml(html, opts) {
  const entries = [];

  const TOKEN_RE = new RegExp(
    '<DT>\\s*<H3\\b([^>]*)>([\\s\\S]*?)</H3>' +      // 1,2 文件夹
    '|<DT>\\s*<A\\b([^>]*)>([\\s\\S]*?)</A>' +       // 3,4 链接
    '|<DD>([\\s\\S]*?)(?=<DT>|</DL>|<HR>|$)' +            // 5   描述
    '|<DL\\b[^>]*>|</DL>',                                  // 6,7 层级
    'gi'
  );

  const stack = [];
  let pendingFolder = null;
  let lastEntry = null;
  let m;

  while ((m = TOKEN_RE.exec(html)) !== null) {
    const token = m[0];

    if (/^<DL/i.test(token)) {
      if (pendingFolder !== null) {
        stack.push(pendingFolder);
        pendingFolder = null;
      } else {
        stack.push('');
      }
      continue;
    }

    if (/^<\/DL/i.test(token)) {
      stack.pop();
      continue;
    }

    if (m[2] !== undefined) {
      // <DT><H3>文件夹名</H3>
      pendingFolder = cleanText(m[2]);
      continue;
    }

    if (m[4] !== undefined) {
      // <DT><A ...>标题</A>
      const attrs = parseAttributes(m[3]);
      const name = cleanText(m[4]) || attrs.HREF || '';
      const url = normalizeUrl(attrs.HREF);
      lastEntry = {
        name: name || url,
        url,
        desc: '',
        iconData: opts.icons ? (attrs.ICON || '') : '',
        path: stack.filter(Boolean).slice()
      };
      entries.push(lastEntry);
      continue;
    }

    if (m[5] !== undefined && lastEntry) {
      // <DD>描述
      const desc = cleanText(m[5]);
      if (desc && !lastEntry.desc) lastEntry.desc = desc;
    }
  }

  return entries;
}

/* ---------------- Chromium Bookmarks JSON 解析 ---------------- */
function parseChromiumJson(json) {
  const entries = [];

  function walk(node, path) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, path)); return; }
    if (node.type === 'url' && node.url) {
      entries.push({
        name: cleanText(node.name || '') || node.url,
        url: normalizeUrl(node.url),
        desc: '',
        iconData: '',
        path: path.slice()
      });
      return;
    }
    if (Array.isArray(node.children)) {
      const nextPath = node.name ? path.concat(node.name) : path;
      node.children.forEach((child) => walk(child, nextPath));
    }
  }

  const roots = json.roots || {};
  Object.values(roots).forEach((root) => {
    if (root && Array.isArray(root.children)) {
      root.children.forEach((child) => walk(child, []));
    }
  });
  return entries;
}

/* ---------------- 图标落盘 ---------------- */
function saveIcons(entries, iconsDir) {
  const saved = new Map();
  let written = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.iconPath !== undefined) continue;
    const data = entry.iconData;
    entry.iconPath = '';
    if (!data) continue; // 本来就没有图标，不计入跳过

    const mm = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(data);
    if (!mm) { skipped++; continue; }

    let buffer;
    try {
      buffer = mm[2] ? Buffer.from(mm[3], 'base64') : Buffer.from(decodeURIComponent(mm[3]), 'binary');
    } catch (e) {
      skipped++;
      continue;
    }
    if (!buffer || !buffer.length || buffer.length > MAX_ICON_BYTES) { skipped++; continue; }

    const mime = (mm[1] || '').toLowerCase();
    const ext = mime.includes('svg') ? '.svg'
      : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg'
      : mime.includes('icon') ? '.ico'
      : mime.includes('gif') ? '.gif'
      : mime.includes('webp') ? '.webp'
      : '.png';

    const hash = createHash('sha1').update(entry.url).digest('hex').slice(0, 12);
    const filename = hash + ext;
    const full = join(iconsDir, filename);

    if (!existsSync(full)) {
      writeFileSync(full, buffer);
      written++;
    }
    entry.iconPath = 'data/icons/' + filename;
    saved.set(entry.url, entry.iconPath);
  }

  return { written, skipped, saved };
}

/* ---------------- 组装 links.json 数据 ---------------- */
function buildData(groups, meta, today) {
  return {
    $schema: './links.schema.json',
    meta: {
      title: meta.title,
      subtitle: meta.subtitle,
      updated: today
    },
    categories: groups.map((group, gi) => ({
      id: 'cat-' + (gi + 1),
      name: group.name,
      links: group.links.map((entry) => {
        const link = { name: entry.name, url: entry.url };
        if (entry.desc) link.desc = entry.desc;
        if (entry.iconPath) link.icon = entry.iconPath;
        return link;
      })
    }))
  };
}

/* 读已有 links.json 的 meta，重新导入时保留用户改过的标题 */
function readExistingMeta(file) {
  try {
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return (parsed && parsed.meta) || {};
  } catch (e) {
    return {};
  }
}

/* ---------------- 主流程 ---------------- */
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = resolve(process.cwd(), opts.input);

  if (!existsSync(inputPath)) {
    console.error('✖ 找不到文件：' + inputPath);
    process.exit(1);
  }

  let raw = readFileSync(inputPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const trimmed = raw.trim();
  let entries;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch (e) {
      console.error('✖ JSON 解析失败：' + e.message);
      process.exit(1);
    }
    entries = parseChromiumJson(json);
    console.log('· 已识别为 Chromium Bookmarks JSON');
  } else {
    entries = parseNetscapeHtml(raw, opts);
    console.log('· 已识别为 Netscape Bookmark HTML');
  }

  const total = entries.length;
  let skippedScheme = 0;
  const seen = new Set();
  const kept = [];

  for (const entry of entries) {
    if (!shouldKeep(entry)) { skippedScheme++; continue; }
    const key = entry.url.replace(/\/$/, '');
    if (seen.has(key)) { skippedScheme++; continue; }
    seen.add(key);
    kept.push(entry);
  }

  console.log('· 解析到 ' + total + ' 条，可用 ' + kept.length + ' 条，跳过 ' + skippedScheme + ' 条（非 http / 重复）');

  if (!kept.length) {
    console.error('✖ 没有可用链接，未生成文件。');
    process.exit(1);
  }

  // 按分类分组，保持出现顺序
  const map = new Map();
  for (const entry of kept) {
    const cat = categoryOf(entry.path, opts.depth);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(entry);
  }
  // 保持书签中的出现顺序，不按数量重排，结果更可预测、也更好手工调整
  const groups = [...map.entries()].map(([name, links]) => ({ name, links }));

  // 图标
  let iconStats = { written: 0, skipped: 0 };
  if (opts.icons) {
    const iconsDir = join(REPO_ROOT, 'data', 'icons');
    mkdirSync(iconsDir, { recursive: true });
    iconStats = saveIcons(kept, iconsDir);
    console.log('· 图标：写入 ' + iconStats.written + ' 个，跳过 ' + iconStats.skipped + ' 个 → data/icons/');
  } else {
    kept.forEach((e) => { e.iconPath = ''; });
    console.log('· 图标：已关闭（使用首字母色块）');
  }

  // 沿用已有 links.json 的 meta（用户可能改过标题），除非命令行显式指定
  const existing = readExistingMeta(opts.out);
  const meta = {
    title: opts.title || existing.title || 'MyNav',
    subtitle: opts.subtitle || existing.subtitle || '我的网络收藏'
  };

  const dataset = buildData(groups, meta, new Date().toISOString().slice(0, 10));

  const { errors, warnings } = validateData(dataset);
  warnings.forEach((w) => console.warn('⚠ ' + w));
  if (errors.length) {
    console.error('✖ 生成的数据不合法，未写入：');
    errors.forEach((e) => console.error('  · ' + e));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log('· --dry-run：未写入文件。分类预览：');
    groups.forEach((g) => console.log('    ' + g.name + '  (' + g.links.length + ')'));
    return;
  }

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(dataset, null, 2) + '\n', 'utf8');

  const relOut = opts.out.replace(REPO_ROOT + '\\', '').replace(/\\/g, '/');
  console.log('');
  console.log('✔ 已生成 ' + relOut + '（' + groups.length + ' 个分类 / ' + kept.length + ' 个链接）');
  groups.forEach((g) => console.log('    - ' + g.name + '  (' + g.links.length + ')'));

  // 目标就是 data/links.json 时，顺带生成 data/links.js，双击 index.html 即可预览
  if (resolve(opts.out) === resolve(SRC_PATH)) {
    writeFileSync(OUT_PATH, generateSource(dataset), 'utf8');
    console.log('');
    console.log('✔ 已同步生成 data/links.js');
    console.log('  本地预览：直接双击 index.html（或 admin.html 可视化编辑）');
  } else {
    console.log('');
    console.log('· 输出不在 data/links.json，跳过生成 links.js');
    console.log('  手动同步：node tools/build-data.mjs');
  }
}

main();
