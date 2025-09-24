// src/generate.js
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
import { chromium } from 'playwright';

dayjs.extend(utc); dayjs.extend(tz);
const TZ = 'Europe/Madrid';
const TODAY = dayjs().tz(TZ).format('ddd DD MMM YYYY');

// --- 1) Extrae eventos de Investing con tus filtros (EE. UU. y España)
async function fetchInvestingEvents() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://es.investing.com/economic-calendar/', { waitUntil: 'networkidle' });

  // Abre filtros
  const byText = (t) => page.locator(`text=${t}`).first();
  await (await byText('Filtros')).click().catch(()=>{});
  // Países: desmarcar todos y marcar EE. UU. + España
  await byText('Seleccionar todos').click().catch(()=>{});
  await byText('Estados Unidos').click().catch(()=>{});
  await byText('España').click().catch(()=>{});
  // Categorías
  await byText('Categoría').click().catch(()=>{});
  for (const c of ['Empleo','Actividad Económica','Inflación','Banco central','Índice de Confianza']) {
    const chk = page.locator(`label:has-text("${c}") input`);
    if (await chk.count()) await chk.check().catch(()=>{});
  }
  // Impacto alto (3 toros)
  await byText('Impacto').click().catch(()=>{});
  await byText('3').click().catch(()=>{});
  // Aplicar
  await byText('Aplicar').click().catch(()=>{});

  // Espera tabla y lee filas
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
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

  // Filtra por países y relevancia (y si no hay alto impacto, deja lo que haya)
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

// --- 2) Llama a tu cuenta (OpenAI) para redactar el reporte con tu terminología
async function callOpenAI({ us, es }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY');

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Eres un analista macro. Usa la terminología del curso del usuario: cuatro motores (crecimiento, inflación, empleo, política monetaria), sorpresas vs consenso, narrativa. Estilo directo y crítico." },
      { role: "user", content:
`Genera un REPORTE DIARIO en español (hora Madrid) con esta estructura:

1) RESUMEN DE NARRATIVA: EEUU y España en los cuatro motores y qué descuenta el mercado HOY.
2) ESTADOS UNIDOS: tabla con eventos de hoy (NOMBRE EXACTO de Investing), HORA (Madrid), DATO ANTERIOR, CONSENSO, DATO REAL si existe, e IMPACTO esperado (incluye EURUSD).
3) ESPAÑA: misma tabla y comentario corto.
4) SESGO TÁCTICO EURUSD: 2-3 líneas claras según sorpresa vs consenso.

Usa EXACTAMENTE estos eventos (no inventes nada; pon "—" si falta un dato):
US_EVENTS=${JSON.stringify(us)}
ES_EVENTS=${JSON.stringify(es)}

Formato de salida: **HTML** listo para publicar. Incluye <h1> con la fecha: "${TODAY} — 07:30 (Madrid)".`
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

// --- 3) Escribe dist/latest.html + portada
async function main() {
  const { us, es } = await fetchInvestingEvents();
  const html = await callOpenAI({ us, es });

  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync(path.join('dist', 'latest.html'), html);

  const indexHtml = `<!doctype html><meta charset="utf-8"><title>Reportes macro</title>
  <body style="font-family:system-ui;max-width:900px;margin:24px auto;padding:0 16px">
    <h1>Reportes macro</h1>
    <p><a href="./latest.html">Ver reporte de hoy (07:30 Madrid)</a
