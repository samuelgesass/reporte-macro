// src/build.js (opcional, no se usa ya)
import fs from 'fs';
import path from 'path';
fs.mkdirSync('dist', { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><title>Reportes macro</title>
<body style="font-family:system-ui;max-width:900px;margin:24px auto;padding:0 16px">
  <h1>Reportes macro</h1>
  <p>Este archivo no se usa. El workflow genera /latest.html y /posts/AAAA-MM-DD.html con src/generate.js.</p>
</body>`;
fs.writeFileSync(path.join('dist','index.html'), html);
console.log('build.js ok');
