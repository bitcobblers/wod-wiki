#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const docsRoot = path.resolve(__dirname, '..', 'markdown');
let missing = [];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) yield* walk(res);
    else if (entry.isFile() && res.endsWith('.md')) yield res;
  }
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const linkRe = /\]\((\.\.\/[^)]+|\.\/[^)]+|[^)]+\.md)\)/g; // simple md links
  const codeMermaid = /```mermaid[\s\S]*?```/g;

  // Mermaid fence presence counts as pass for syntax fence
  const mermaids = text.match(codeMermaid) || [];
  // Basic link resolution
  let m;
  while ((m = linkRe.exec(text))) {
    const raw = m[1];
    // Skip http(s) links
    if (/^https?:\/\//.test(raw)) continue;
    const target = path.resolve(path.dirname(file), raw);
    if (!fs.existsSync(target)) {
      missing.push({ file, target: raw });
    }
  }
  return { file, mermaidBlocks: mermaids.length };
}

let total = 0;
for (const f of walk(docsRoot)) {
  total++;
  checkFile(f);
}

if (missing.length) {
  console.error('Missing links:', missing);
  process.exitCode = 1;
} else {
  console.log(`Docs check passed. Files: ${total}`);
}
