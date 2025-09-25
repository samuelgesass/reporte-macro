// src/generate.js
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import 'dayjs/locale/es.js';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
import { chromium } from 'playwright';

dayjs.extend(utc); dayjs.extend(tz);
dayjs.locale('es');

const TZ = 'Europe/Madrid';

/* ------- util ------- */
function blogTitle(d) {
  // ej: "jueves 25 de septiembre de 2025"
  return d.tz(TZ).format('dddd D [de] MMMM [de] YYYY');
}

// elimina fences tipo ```html ... ```
function stripCodeFences(s) {
  if (!s) return s;
  let t = s.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\n?/, '');
    t = t.replace(/\n?```$/, '');
  }
  return t;
}

// tema + navbar (Reporte de hoy / Histórico)
function wrapWithTheme(innerHtml, pageTitle) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${pageTitle} — Reporte macro</title>
<style>
:root{
  --bg:#0b0f17; --panel:#141a24; --panel-2:#0f1622; --txt:#e6edf3; --muted:#9fb0c2;
  --acc:#3b82f6; --good:#10b981; --bad:#ef4444; --warn:#f59e0b; --bd:#1f2a37;
}
*{box-sizing:border-box}
body{margin:0;background:linear-gradient(180deg,#0b0f17 0%,#0e1320 100%);color:var(--txt);font:16px/1.6 Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif}
.nav{position:sticky;top:0;background:#0c1320cc;backdrop-filter:blur(8px);border-bottom:1px solid var(--bd);z-index:10}
.nav-inner{max-width:980px;margin:0 auto;padding:10px 16px;display:flex;gap:16px;align-items:center;justify-content:space-between}
.nav a{color:var(--muted);text-decoration:none;padding:6px 10px;border:1px solid var(--bd);border-radius:10px}
.nav a.primary{color:#fff;background:var(--acc);border-color:transparent}
.container{max-width:980px;margin:24px auto;padding:0 16px}
.card{background:linear-gradient(180deg,var(--panel) 0%,var(--panel-2) 100%);border:1px solid var(--bd);border-radius:14px;padding:18px;box-shadow:0 8px 20px rgba(0,0,0,.25);margin-bottom:16px}
.card h2{font-size:18px;margin:0 0 10px}
.table{width:100%;border-collapse:collapse;font-size:14px}
.table th,.table td{padding:10px 8px;border-bottom:1px solid var(--bd);vertical-align:top}
.table th{color:var(--muted);font-weight:600;text-align:left}
.table td.time{text-align:right;color:var(--muted);white-space:nowrap}
.note{color:var(--muted);font-size:14px;margin-top:8px}
.hl{color:var(--acc);font-weight:600}
.up{color:var(--good)} .down{color:var(--bad)} .warn{color:var(--warn)}
footer{margin:24px 0 8px;text-align:center;color:var(--muted);font-size:13px}
</style>
</head>
<body>
  <nav class="nav">
    <div class="nav-inner">
      <div style="font-weight:700">Reporte macro</div>
      <div style="display:flex;gap:10px">
        <a class="primary" href="./latest.html">Reporte de hoy</a>
        <a href="./">Histórico</a>
      </div>
    </div>
  </nav>
  <div class="container">
    ${innerHtml}
    <footer>Generado automáticamente con tu terminología (crecimiento, inflación, empleo, política monetaria). Los mercados descuentan expectativas futuras.</footer>
  </div>
</body>
</html>`;
}

/* ------- 1) Scraping Investing (EE. UU. + EUROPA) ------- */
async function fetchInvestingEvents() {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
  });

  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  await page.goto('https://es.investing.com/economic-calendar/', { waitUntil: 'domcontentloaded' });

  // cookies/overlays
  const consentSelectors = [
    '#onetrust-accept-btn-handler',
    'button:has-text("Aceptar")',
    'button:has-text("Estoy de acuerdo")',
    'button:has-text("De acuerdo")'
  ];
  for (const sel of consentSelectors) {
    const btn = page.locator(sel);
    if (await btn.count()) { await btn.click().catch(()=>{}); break; }
  }
  await page.evaluate(() => {
    const killers = [
      '#onetrust-banner-sdk', '#onetrust-consent-sdk', '.overlay', '.modal', '[style*="position: fixed"]'
    ];
    document.querySelectorAll(killers.join(',')).forEach(el => el.remove());
  });

  const click = async (txt) => {
    const el = page.locator(`text=${txt}`).first();
    if (await el.count()) await el.click().catch(()=>{});
  };

  // Filtros: EE. UU. + EUROPA (Eurozona + España)
  await click('Filtros');
  await click('Seleccionar todos');
  await click('Estados Unidos');
  await click('Eurozona');
  await click('España');

  await click('Categoría');
  for (const c of ['Empleo','Actividad Económica','Inflación','Banco central','Índice de Confianza']) {
    const chk = page.locator(`label:has-text("${c}") input`);
    if (await chk.count()) await chk.check().catch(()=>{});
  }
  await click('Impacto'); await click('3');   // alto impacto
  await click('Aplicar');

  // No exigimos visible; leemos DOM
  await page.waitForSelector('table tbody tr', { state: 'attached' });

  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr'));
    return trs.map(tr => {
      const tds = tr.querySelectorAll('td');
      const hora = (tds[0]?.innerText || '').trim();
      const nombre = (tds[1]?.innerText || '').trim();
      const real = (tds[3]?.innerText || '').trim();
      const anterior = (tds[4]?.innerText || '').trim();
      const consenso = (tds[5]?.innerText || '').trim();
      const flag = tr.querySelector('img[title]')?.getAttribute('title') || '';
      const bulls = (tds[2]?.querySelectorAll('i[class*="bull"]') || []).length;
      return { hora, nombre, real, anterior, consenso, pais: flag, impacto: bulls };
    });
  });

  await browser.close();

  // Filtro en memoria (por si UI no aplicó todo)
  const keepUS = r => r.pais === 'Estados Unidos';
  const keepEU = r => r.pais === 'Eurozona' || r.pais === 'España';
  const keepCat = r => /(empleo|desempleo|nóminas|PMI|PIB|ventas|producción|confianza|IPC|IPP|PCE|banco central|tipos|actas|comparecencia)/i.test(r.nombre);

  let us = rows.filter(r => keepUS(r) && keepCat(r));
  let eu = rows.filter(r => keepEU(r) && keepCat(r));

  const altosUS = us.filter(e => e.impacto === 3);
  const altosEU = eu.filter(e => e.impacto === 3);
  us = altosUS.length ? altosUS : us;
  eu = altosEU.length ? altosEU : eu;

  return { us, eu };
}

/* ------- 2) Llamada a OpenAI con tu terminología ------- */
async function callOpenAI({ us, eu }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY');

  const todayH1 = `${blogTitle(dayjs())} — 07:30 (Madrid)`;

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
"Actúas como analista macro. Usa la terminología del curso del usuario: cuatro motores (crecimiento, inflación, empleo, política monetaria), sorpresas vs consenso, narrativa. Estilo directo, crítico y sin rodeos."
      },
      {
        role: "user",
        content:
`Genera un REPORTE DIARIO en español (hora Madrid) con esta estructura:

1) RESUMEN DE NARRATIVA: situación de EE. UU. y Europa (Eurozona y España) en los cuatro motores y qué descuenta el mercado HOY. Si un dato enlaza con publicaciones de los últimos 2–3 días, añade 1–2 frases de CONTEXTO.
2) ESTADOS UNIDOS: tabla con eventos de hoy (NOMBRE EXACTO Investing), HORA (Madrid), DATO ANTERIOR, CONSENSO, DATO REAL si existe e IMPACTO esperado (activos / EURUSD) + comentario corto.
3) EUROPA (Eurozona y España): misma tabla agregada y comentario corto (si hay 2+ eventos, cada uno en su fila).
4) SESGO TÁCTICO EURUSD: 2–3 líneas claras sobre qué escenario favorece USD o EUR hoy según sorpresas vs consenso.

Usa EXACTAMENTE estos eventos (si falta un campo, escribe "—"; no inventes):
US_EVENTS=${JSON.stringify(us)}
EU_EVENTS=${JSON.stringify(eu)}

Salida: HTML puro listo para publicar (sin fences/markdown). Encabeza con <h1>${todayH1}</h1>.`
      }
    ],
    temperature: 0.2
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  return stripCodeFences(data.choices[0].message.content);
}

/* ------- 3) Generación de blog: post diario + latest + histórico ------- */
async function main() {
  // Fallback: si Investing falla, publicamos igual
  let us = [], eu = [];
  try {
    const got = await fetchInvestingEvents();
    us = got.us; eu = got.eu;
  } catch (err) {
    console.error('Fallo scraping Investing (publico con fallback):', err.message || err);
  }

  const innerHtml = await callOpenAI({ us, eu });

  const outDir = 'dist';
  const postsDir = path.join(outDir, 'posts');
  fs.mkdirSync(postsDir, { recursive: true });

  const todayIso = dayjs().tz(TZ).format('YYYY-MM-DD');
  const title = blogTitle(dayjs());

  // Si existe un seed manual para hoy, lo priorizamos (opcional)
  const seedPath = path.join('seed', `${todayIso}.html`);
  const content = fs.existsSync(seedPath) ? fs.readFileSync(seedPath, 'utf-8') : innerHtml;

  const wrapped = wrapWithTheme(content, title);

  // Post del día
  const postPath = path.join(postsDir, `${todayIso}.html`);
  fs.writeFileSync(postPath, wrapped);

  // latest.html → redirige al post del día
  const latest = `<!doctype html><meta http-equiv="refresh" content="0; url=./posts/${todayIso}.html">`;
  fs.writeFileSync(path.join(outDir, 'latest.html'), latest);

  // Índice (más reciente primero)
  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.html')).sort().reverse();
  const links = files.map(f => {
    const d = dayjs(f.replace('.html',''));
    return `<li><a href="./posts/${f}">${blogTitle(d)}</a></li>`;
  }).join('\n');

  const indexHtml = wrapWithTheme(
    `<h1>Histórico de reportes</h1>
     <ol>${links}</ol>`,
    'Histórico de reportes'
  );
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);

  console.log(`OK: generado post ${postPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
