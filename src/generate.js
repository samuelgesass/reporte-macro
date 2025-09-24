// --- 1) Extrae eventos de Investing con tus filtros (EE. UU. y España)
async function fetchInvestingEvents() {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
  });

  // Dar más margen a la navegación y a los selectores
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  // Carga sin esperar a "networkidle" (en Investing no se cumple)
  await page.goto('https://es.investing.com/economic-calendar/', { waitUntil: 'domcontentloaded' });

  // Intento de aceptar cookies si aparece (varían los textos)
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

  // Abrir filtros (si no abre, seguimos sin filtrar y luego filtramos por país/categoría en memoria)
  const tryClick = async (txt) => {
    const el = page.locator(`text=${txt}`).first();
    if (await el.count()) await el.click().catch(()=>{});
  };
  await tryClick('Filtros');
  await tryClick('Seleccionar todos');         // desmarca todo
  await tryClick('Estados Unidos');
  await tryClick('España');
  await tryClick('Categoría');

  // Marca categorías clave
  for (const c of ['Empleo','Actividad Económica','Inflación','Banco central','Índice de Confianza']) {
    const chk = page.locator(`label:has-text("${c}") input`);
    if (await chk.count()) await chk.check().catch(()=>{});
  }

  // Impacto alto (3 toros). Si el control no existe, no pasa nada.
  await tryClick('Impacto');
  await tryClick('3');

  await tryClick('Aplicar');

  // Espera a que exista al menos una fila
  await page.waitForSelector('table tbody tr');

  // Extrae filas visibles (de hoy)
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

  // Filtra por países y relevancia (si no hay alto impacto, dejamos lo que haya)
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
