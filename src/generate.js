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

function blogTitle(d) {
  // ej: "miércoles 24 de septiembre de 2025"
  return d.tz(TZ).format('dddd D [de] MMMM [de] YYYY');
}

// --- 1) Extrae eventos de Investing con tus filtros
async function fetchInvestingEvents() {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
  });

  // Márgenes amplios: Investing a veces tarda
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  // No uses "networkidle" aquí
  await page.goto('https://es.investing.com/economic-calendar/', { waitUntil: 'domcontentloaded' });

  // Aceptar cookies si aparece
  const consentSelectors = [
    'button:has-text("Aceptar")',
    'button:has-text("Estoy de acuerdo")',
    'button:has-text("De acuerdo")',
    '#onetrust-accept-btn-handler'
  ];
  for (const sel of consentSelectors) {
    const btn = page.locator(sel);
    if (await btn.count()) { await btn.click().catch(()=>{}); break; }
  }

  // Helpers
  const click = async (txt) => {
    const el = page.locator(`text=${txt}`).first();
    if (await el.count()) await el.click().catch(()=>{});
  };

  // Abre filtros y aplica como en tu captura
  await click('Filtros');
  await click('Seleccionar todos'); // limpia países
  await click('Estados Unidos');
  await click('España');

  await click('Categoría');
  for (const c of ['Empleo','Actividad Económica','Inflación','Banco central','Índice de Confianza']) {
    const chk = page.locator(`label:has-text("${c}") input`);
    if (await chk.count()) await chk.check().catch(()=>{});
  }

  await click('Impacto'); // prioriza alto
  await click('3');       // 3 toros

  await click('Aplicar');

  // Espera tabla
  await page.waitForSelector('table tbody tr');

  // Extrae filas
  const rows = await page.$$eval('table tbody tr', trs => trs.map(tr => {
    const tds = tr.querySelectorAll('td');
    const hora = (tds[0]?.innerText || '').trim();
    const nombre = (tds[1]?.innerText || '').trim();
    const real = (tds[3]?.innerText || '').trim();
    const anterior = (tds[4]?.innerText || '').trim();
    const consenso = (tds[5]?.innerText || '').trim();
    const flag = tr.querySelector('img[title]')?.getAttribute('title') || '';
    const bulls = tds[2]?.querySelectorAll('i[class*="bull"]').length || 0;
    return { hora, nombre, real, anterior, consenso, pais: flag, impacto: bulls };
  }));

  await browser.close();

  // Filtro adicional en memoria (por si la UI no aplicó algo)
  const keepCountry = r => ['Estados Unidos', 'España'].includes(r.pais);
  const keepCat = r => /(empleo|desempleo|nóminas|PMI|PIB|ventas|producción|confianza|IPC|IPP|PCE|banco central|tipos|actas|comparecencia)/i.test(r.nombre);
  let evs = rows.filter(r => keepCountry(r) && keepCat(r));
  const altos = evs.filter(e => e.impacto === 3);
  evs = altos.length ? altos : evs;

  return {
    us: evs.filter(e => e.pais === 'Estados Unidos'),
    es: evs.filter(e => e.pais === 'España')
  };
}

// --- 2) Llama a OpenAI con tu API key para redactar el informe
async function callOpenAI({ us, es }) {
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

1) RESUMEN DE NARRATIVA: EEUU y España en los cuatro motores y qué descuenta el mercado HOY. Si un dato de hoy se enlaza con publicaciones de los últimos 2–3 días (misma serie o bancos centrales), añade 1–2 frases de CONTEXTO.
2) ESTADOS UNIDOS: tabla con eventos de hoy (NOMBRE EXACTO de Investing), HORA (Madrid), DATO ANTERIOR, CONSENSO, DATO REAL si existe, e IMPACTO esperado por activos (incluye EURUSD) + comentario corto.
3) ESPAÑA: misma tabla y comentario corto.
4) SESGO TÁCTICO EURUSD: 2–3 líneas claras según sorpresa vs consenso.

Usa EXACTAMENTE estos eventos (no inventes nada; pon "—" si falta):
US_EVENTS=${JSON.stringify(us)}
ES_EVENTS=${JSON.stringify(es)}

Formato de salida: HTML listo para publicar. Encabeza con <h1>${todayH1}</h1>.`
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
  return data.choices[0].message.content;
}

// --- 3) Genera: un post por día, índice ordenado y latest.html
async function main() {
  const { us, es } = await fetchInvestingEvents();
  const html = await callOpenAI({ us, es });

  const outDir = 'dist';
  const postsDir = path.join(outDir, 'posts');
  fs.mkdirSync(postsDir, { recursive: true });

  const todayIso = dayjs().tz(TZ).format('YYYY-MM-DD');
  const title = blogTitle(dayjs());

  // Post del día
  const postPath = path.join(postsDir, `${todayIso}.html`);
  const wrapped = `<!doctype html><html lang="es"><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — Reporte macro</title>
  <body style="font-family:system-ui;max-width:900px;margin:24px auto;padding:0 16px">
    ${html}
  </body></html>`;
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

  const indexHtml = `<!doctype html><html lang="es"><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Reportes macro (entradas)</title>
  <body style="font-family:system-ui;max-width:900px;margin:24px auto;padding:0 16px">
    <h1>Reportes macro</h1>
    <p><a href="./latest.html">Ir al reporte de hoy</a></p>
    <h2>Entradas</h2>
    <ol>
      ${links}
    </ol>
  </body></html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);

  console.log(`OK: generado post ${postPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
