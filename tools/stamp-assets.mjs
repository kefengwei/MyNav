#!/usr/bin/env node
/**
 * 给 HTML 里的静态资源链接注入版本号。
 *
 * 为什么需要：GitHub Pages 对所有文件都返回 Cache-Control: max-age=600。
 * 发版后 10 分钟内，浏览器可能已经拿到新的 index.html、却还在用旧的 app.js
 * （或反过来），出现「新 HTML + 旧 JS」混搭——例如首页点「编辑」毫无反应，
 * 因为旧 app.js 上没有 window.MyNavApp，editor.js 直接静默退出。
 *
 * 用法：
 *   node tools/stamp-assets.mjs _site     在 CI 的 Prepare site 之后调用
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) {
  console.error('用法：node tools/stamp-assets.mjs <目录>');
  process.exit(1);
}

function version() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (e) { /* 不是 git 仓库就退化成时间戳 */ }
  return Date.now().toString(36);
}

const v = version();
const RE = /(["'])(assets\/[\w.-]+\.(?:css|js)|data\/links\.js)(\?[^"']*)?(["'])/g;
let files = 0;
let hits = 0;
for (const name of ['index.html', 'admin.html']) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const out = src.replace(RE, (m, q1, url, q, q2) => { hits++; return q1 + url + '?v=' + v + q2; });
  if (out !== src) { fs.writeFileSync(p, out); files++; }
}
console.log('✔ 已给 ' + files + ' 个 HTML 的 ' + hits + ' 处资源链接注入 ?v=' + v);
