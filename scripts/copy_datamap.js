#!/usr/bin/env node
/**
 * 크롤러 결과를 datamap-web/public/data/datamap.json 으로 복사.
 * GitHub Actions 또는 Kestra 배포 단계에서 wrangler deploy 전에 실행.
 *
 *   node scripts/copy_datamap.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "crawler", "data_go_kr");
const DEST = path.join(ROOT, "datamap-web", "public", "data", "datamap.json");

function findNewestDatedDatamap(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^datamap_\d{6}\.json$/.test(f))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

const candidates = [
  path.join(DATA_DIR, "datamap.json"),
  findNewestDatedDatamap(DATA_DIR),
  path.join(ROOT, "crawler", "datamap.json"),
  findNewestDatedDatamap(path.join(ROOT, "crawler")),
].filter(Boolean);

const src = candidates.find((file) => fs.existsSync(file));

if (!src) {
  console.error("[copy_datamap] 크롤링 결과 파일이 없습니다:", candidates);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.copyFileSync(src, DEST);
console.log(`[copy_datamap] ${path.basename(src)} → public/data/datamap.json`);
