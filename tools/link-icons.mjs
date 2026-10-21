#!/usr/bin/env node
/**
 * 把 data/icons/ 里已经落盘的图标回填到 data/links.json 的 icon 字段。
 *
 * 用法：
 *   node tools/link-icons.mjs            回填并写入 links.json
 *   node tools/link-icons.mjs --dry-run  只打印将要做的事
 *
 * 为什么需要它：fetch-icons 是等整个队列跑完才写一次 links.json。
 * 如果它在 CI 里被 8 分钟超时杀掉，图标文件已经逐个落盘，但 icon 字段永远没写回，
 * 结果就是一堆孤儿图标文件 + 页面上仍是首字母色块。这个脚本按域名把文件对回去，不联网。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = path.join(REPO_ROOT, 'data', 'links.json');
const ICON_DIR = path.join(REPO_ROOT, 'data', 'icons');
const ICON_REL = 'data/icons';
const MIN_BYTES = 64;
const EXT_RANK = { '.png': 0, '.svg': 1, '.webp': 2, '.ico': 3, '.jpg': 4 };
const dryRun = process.argv.includes('--dry-run');

function hostSlug(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  } catch (e) {
    return null;
  }
}

if (!fs.existsSync(ICON_DIR)) {
  console.error('✖ 没有 data/icons 目录');
  process.exit(1);
}

// 按 slug 归组：一个域名可能有 .png / .ico / .svg 多个文件，按清晰度优先挑
const bySlug = new Map();
let skippedSmall = 0;
for (const name of fs.readdirSync(ICON_DIR)) {
  const abs = path.join(ICON_DIR, name);
  const ext = path.extname(name).toLowerCase();
  if (!(ext in EXT_RANK)) continue;
  let size = 0;
  try { size = fs.statSync(abs).size; } catch (e) { continue; }
  if (size < MIN_BYTES) { skippedSmall++; continue; }
  const slug = name.slice(0, name.length - ext.length);
  const cur = bySlug.get(slug);
  const rank = EXT_RANK[ext];
  if (!cur || rank < cur.rank) bySlug.set(slug, { file: name, rank });
}

const data = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));
let filled = 0;
let already = 0;
let noFile = 0;
const samples = [];

for (const cat of data.categories || []) {
  for (const link of cat.links || []) {
    if (!link || !link.url) continue;
    if (link.icon) { already++; continue; }
    const slug = hostSlug(link.url);
    const hit = slug && bySlug.get(slug);
    if (!hit) { noFile++; continue; }
    if (!dryRun) link.icon = ICON_REL + '/' + hit.file;
    filled++;
    if (samples.length < 8) samples.push(link.name + ' → ' + hit.file);
  }
}

console.log('图标文件 ' + bySlug.size + ' 个可用' + (skippedSmall ? '（跳过 ' + skippedSmall + ' 个损坏/空文件）' : ''));
console.log('已有 icon ' + already + ' 条，本次回填 ' + filled + ' 条，仍无图标 ' + noFile + ' 条');
samples.forEach((s) => console.log('  ✔ ' + s));

if (!dryRun && filled > 0) {
  fs.writeFileSync(SRC_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('✔ 已写入 data/links.json');
  console.log('  下一步：node tools/build-data.mjs');
} else if (filled === 0) {
  console.log('✔ 无需改动');
}