// src/build.js
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
dayjs.extend(utc); dayjs.extend(tz);

const TZ = 'Europe/Madrid';
const today = dayjs().tz(TZ);

const US_EVENTS = [];
const ES_EVENTS = [];

const mdTable = (rows) => {
  if (!rows.length) return '_Hoy no hay eventos relevantes con esos filtros._';
  const head = '| Evento (Investing) | Hora (Madrid) | Dato anterior | Consenso | Dato real |\n|---|---:|---:|---:|---:|';
  return [head, ...rows.map(r =>
    `| ${r.nombre} | ${r.hora} | ${r.anterior || '—'} | ${r.consenso || '—'} | ${r.real || '—'} |`
  )].join('\n');
};

const resumen = `- **EE. UU.**: crecimiento, inflación, empleo y política monetaria. El mercado reacciona a **sorpresa vs. consenso**.
- **España**: IPP/IPC, PMI, empleo. El driver de **EURUSD** suele ser EE. UU.`;

const sesgo = `**Sesgo EURUSD**: sorpresas **alcistas** en crecimiento/ inflación de EE. UU. ⇒ **USD+** (EURUSD ↓). A la **baja** ⇒ **USD−** (EURUSD ↑).`;

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Reporte macro — ${today.format('ddd DD MMM YYYY')} — 07:30 (Madrid)</title>
<style>
 body{font-family:system-ui,Segoe UI,Inter,Roboto,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.5}
 table{width:100%;border-collapse:collapse;margin:8px 0 24px}
 th,td{border:1px solid #ddd;padding:8px} th{text-align:left}
 .muted{color:#6b7280} .section{margin:24px 0}
</style></head><body>
<h1>REPORTE MACRO — ${today.format('ddd DD MMM YYYY')} — 07:30 (Madrid)</h1>
<div class="section"><h2>1) RESUMEN DE NARRATIVA</h2><p>${resumen}</p></div>
<div class="section"><h2>2) ESTADOS UNIDOS</h2>${mdTable(US_EVENTS)}</div>
<div class="section"><h2>3) ESPAÑA</h2>${mdTable(ES_EVENTS)}</div>
<div class="section"><h2>4) SESGO TÁCTICO EURUSD</h2><p>${sesgo}</p></div>
<div class="section muted">Última actualización: ${today.format('YYYY-MM-DD HH:mm')} (${TZ})</div>
</body></html>`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(path.join('dist', 'latest.html'), html);
console.log('OK: dist/latest.html generado');
