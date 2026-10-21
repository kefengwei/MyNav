#!/usr/bin/env node
/**
 * MyNav 数据生成器
 * ============================================================
 * 唯一真源是 data/links.json。本脚本校验它、再生成 data/links.js
 * （window.NAV_DATA = {...}），这样 index.html 用 file:// 双击打开
 * 也能直接渲染，不需要起本地服务器（fetch 会被 CORS 拦住）。
 *
 * 用法（在仓库根目录执行）：
 *   node tools/build-data.mjs            校验并生成 data/links.js
 *   node tools/build-data.mjs --check    只校验，并检查 links.js 是否同步（CI 用）
 *   node tools/build-data.mjs --stamp    先把 meta.updated 写成今天，再生成
 *   node tools/build-data.mjs --quiet    只在出错时输出
 *
 * 退出码：0 成功；1 数据不合法 / 产物不同步 / 文件缺失
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC_PATH = join(REPO_ROOT, 'data', 'links.json');
export const OUT_PATH = join(REPO_ROOT, 'data', 'links.js');

const ID_RE = /^[A-Za-z0-9_-]+$/;
const URL_RE = /^https?:\/\//i;

function rel(p) {
  return relative(REPO_ROOT, p).replace(/\\/g, '/');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** 校验 links.json，返回 { errors, warnings }。只收集问题，不抛异常。 */
export function validateData(data) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(where + '：' + msg);
  const warn = (where, msg) => warnings.push(where + '：' + msg);

  if (!isPlainObject(data)) {
    errors.push('顶层必须是一个 JSON 对象');
    return { errors, warnings };
  }
  if (data.$schema !== undefined && typeof data.$schema !== 'string') {
    err('$schema', '必须是字符串');
  }

  // meta
  if (data.meta !== undefined) {
    if (!isPlainObject(data.meta)) {
      err('meta', '必须是对象');
    } else {
      const m = data.meta;
      for (const key of ['title', 'subtitle', 'updated']) {
        if (m[key] === undefined) continue;
        if (typeof m[key] !== 'string') err('meta.' + key, '必须是字符串');
      }
      if (m.title !== undefined && !isText(m.title)) err('meta.title', '不能为空');
    }
  }

  // categories
  if (!Array.isArray(data.categories)) {
    err('categories', '必须是数组');
    return { errors, warnings };
  }
  if (!data.categories.length) {
    err('categories', '至少需要一个分类');
    return { errors, warnings };
  }

  const seenIds = new Set();
  const seenUrls = new Map();

  data.categories.forEach((cat, ci) => {
    const base = 'categories[' + ci + ']';

    if (!isPlainObject(cat)) {
      err(base, '必须是对象');
      return;
    }
    const label = isText(cat.name) ? cat.name : base;

    if (!isText(cat.id)) err(base + '.id', '必填，用于锚点跳转');
    else if (!ID_RE.test(cat.id)) err(base + '.id', '只能包含字母、数字、下划线或连字符（用作 URL 锚点）');
    else if (seenIds.has(cat.id)) err(base + '.id', '重复的 id「' + cat.id + '」');
    else seenIds.add(cat.id);

    if (!isText(cat.name)) err(base + '.name', '必填，分类显示名');
    if (cat.emoji !== undefined) warn(base + '.emoji', 'emoji 已废弃：所有分类统一显示文件夹图标，这个字段不起作用，可以删掉');
    if (cat.type !== undefined && cat.type !== 'nav' && cat.type !== 'fav') {
      err(base + '.type', '只能是 "nav"（导航卡片）或 "fav"（收藏夹紧凑列表），省略等于 nav');
    }

    if (!Array.isArray(cat.links)) {
      err(base + '.links', '必须是数组');
      return;
    }
    if (!cat.links.length) warn(label, '分类下没有链接，页面上会显示为空分类');

    cat.links.forEach((link, li) => {
      const lwhere = label + ' → ' + (isText(link && link.name) ? link.name : '第 ' + (li + 1) + ' 条');

      if (!isPlainObject(link)) {
        err(lwhere, '必须是对象');
        return;
      }
      if (!isText(link.name)) err(lwhere, 'name 必填');
      if (!isText(link.url)) err(lwhere, 'url 必填');
      else if (!URL_RE.test(link.url)) err(lwhere, 'url 必须以 http:// 或 https:// 开头');

      for (const key of ['desc', 'icon', 'keywords']) {
        if (link[key] !== undefined && typeof link[key] !== 'string') err(lwhere, key + ' 必须是字符串');
      }
      if (link.tags !== undefined) {
        if (!Array.isArray(link.tags)) err(lwhere, 'tags 必须是字符串数组');
        else if (link.tags.some((t) => typeof t !== 'string')) err(lwhere, 'tags 里只能放字符串');
      }

      if (isText(link.url)) {
        const key = link.url.replace(/\/+$/, '').toLowerCase();
        if (seenUrls.has(key)) {
          warn(lwhere, '与「' + seenUrls.get(key) + '」的 URL 重复');
        } else {
          seenUrls.set(key, lwhere);
        }
      }
    });
  });

  return { errors, warnings };
}

/** 由数据对象生成 data/links.js 源码（去掉 $schema，方便编辑器用但不进运行时）。 */
export function generateSource(data) {
  const clean = Object.assign({}, data);
  delete clean.$schema;

  return [
    '/* =========================================================',
    '   MyNav 数据文件 —— 自动生成，请勿手改',
    '   ---------------------------------------------------------',
    '   真源：data/links.json',
    '   生成：node tools/build-data.mjs',
    '   在可视化管理界面改：打开 admin.html',
    '   ========================================================= */',
    'window.NAV_DATA = ' + JSON.stringify(clean, null, 2) + ';',
    ''
  ].join('\n');
}

function countLinks(data) {
  const categories = (data.categories || []).length;
  const links = (data.categories || []).reduce((n, c) => n + ((c.links || []).length), 0);
  return { categories, links };
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const quiet = argv.includes('--quiet');
  const stamp = argv.includes('--stamp');

  if (!existsSync(SRC_PATH)) {
    console.error('✖ 找不到 ' + rel(SRC_PATH));
    process.exit(1);
  }

  let raw = readFileSync(SRC_PATH, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('✖ ' + rel(SRC_PATH) + ' 不是合法 JSON：' + e.message);
    console.error('  可视化修复：用浏览器打开 admin.html');
    process.exit(1);
  }

  if (stamp && isPlainObject(data)) {
    data.meta = isPlainObject(data.meta) ? data.meta : {};
    data.meta.updated = new Date().toISOString().slice(0, 10);
    writeFileSync(SRC_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    if (!quiet) console.log('· 已把 meta.updated 更新为 ' + data.meta.updated);
  }

  const { errors, warnings } = validateData(data);
  if (warnings.length && !quiet) warnings.forEach((w) => console.warn('⚠ ' + w));
  if (errors.length) {
    console.error('✖ 数据校验失败，共 ' + errors.length + ' 个问题：');
    errors.forEach((e) => console.error('  · ' + e));
    process.exit(1);
  }

  const source = generateSource(data);
  const { categories, links } = countLinks(data);
  const summary = categories + ' 个分类 / ' + links + ' 个链接';

  if (check) {
    if (!existsSync(OUT_PATH)) {
      console.error('✖ ' + rel(OUT_PATH) + ' 不存在，请运行 node tools/build-data.mjs');
      process.exit(1);
    }
    const current = readFileSync(OUT_PATH, 'utf8').replace(/\r\n/g, '\n');
    if (current !== source.replace(/\r\n/g, '\n')) {
      console.error('✖ ' + rel(OUT_PATH) + ' 与 links.json 不同步，请运行 node tools/build-data.mjs');
      process.exit(1);
    }
    if (!quiet) console.log('✔ 校验通过（' + summary + '），产物已同步');
    return;
  }

  writeFileSync(OUT_PATH, source, 'utf8');
  if (!quiet) {
    console.log('✔ 已生成 ' + rel(OUT_PATH) + '（' + summary + '）');
    console.log('  本地预览：双击 index.html');
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
