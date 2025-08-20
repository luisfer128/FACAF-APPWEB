// consulta-docente.js
import { loadData } from '../indexeddb-storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const backToMenuButton   = document.getElementById('goToMenuButton');
  const docenteFilterInput = document.getElementById('docenteFilter');
  const searchButton       = document.getElementById('searchButton');

  backToMenuButton?.addEventListener('click', () => {
    window.location.href = '../index.html';
  });

  const KEY = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';
  const allData = await loadData(KEY);
  if (!Array.isArray(allData)) {
    console.error('❌ No se pudo cargar data desde IndexedDB con la clave:', KEY);
    return;
  }

  /* ========= Helpers ========= */
  const norm = (s) => (s ?? '').toString().trim();
  const canon = (s) =>
    (s ?? '')
      .toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

  // Acepta: 6+ dígitos + " - " + nombre (si tu ID tiene 10 dígitos, cambia {6,} a {10})
  const DOCENTE_REGEX = /^\s*(\d{6,})\s*-\s*([A-Za-zÁÉÍÓÚÜÑ\s.'-]+)\s*$/i;
  function parseDocente(raw) {
    const txt = norm(raw);
    const m = txt.match(DOCENTE_REGEX);
    if (!m) return null;
    return { id: m[1], nombre: norm(m[2]), canonNombre: canon(m[2]), full: txt };
  }
  function getNombreDocente(raw) {
    const p = parseDocente(raw);
    return p ? p.nombre : null;
  }

  /* ========= Exclusiones ========= */
  const ESTADOS_PERMITIDOS = new Set(['APROBADA', 'REPROBADA']);
  const MATERIAS_REGEX_EXCLUIR = [/^INGLES\s+(I|II|III|IV)\b/i];
  const materiaExcluida = (materia) => MATERIAS_REGEX_EXCLUIR.some(rx => rx.test(canon(materia)));

  /* ========= FILTRO BASE: estado válido, docente válido, excluir Inglés I–IV ========= */
  const dataFiltrada = allData.filter(r => {
    const estado = canon(r.ESTADO);
    if (!ESTADOS_PERMITIDOS.has(estado)) return false;

    if (materiaExcluida(r.MATERIA)) return false;

    const d = parseDocente(r.DOCENTE);
    if (!d) return false;                   // descarta “REAJUSTE…”, “CONVALID…” etc.
    if (d.canonNombre === 'MOVILIDAD') return false;

    if (!norm(r.PERIODO) || !norm(r.MATERIA)) return false;
    return true;
  });

  /* ========= Sección de “Top” y gráficos generales ========= */
  let hostTop = document.getElementById('top10ReprobadosContainer');
  if (!hostTop) {
    hostTop = document.createElement('section');
    hostTop.id = 'top10ReprobadosContainer';
    document.body.appendChild(hostTop);
  }

  // Contenedor del gráfico general (barras laterales + tabla)
  const chartsWrap = document.createElement('section');
  chartsWrap.className = 'chart-section';
  chartsWrap.style.marginTop = '8px';
  chartsWrap.style.marginBottom = '18px';
  chartsWrap.innerHTML = `
    <h3>Resumen de Aprobadas</h3>
    <div style="display:grid;grid-template-columns:1fr;gap:18px;">
      <div>
        <h4 style="margin:0 0 8px;">Docente (Top 15) — Aprobadas vs Reprobadas</h4>
        <canvas id="chartAprobadosBar" class="chart-canvas"></canvas>
      </div>
    </div>
  `;
  hostTop.parentNode.insertBefore(chartsWrap, hostTop);

  const barCanvas = chartsWrap.querySelector('#chartAprobadosBar');

  /* ====== Construcción del TOP apilado: Aprobadas vs Reprobadas por DOCENTE (todos sus cursos) ====== */
  const aprobadasPorDoc   = {};
  const reprobadasPorDoc  = {};
  const totalPorDoc       = {};

  dataFiltrada.forEach(r => {
    const docente = getNombreDocente(r.DOCENTE);
    if (!docente) return;
    const estado = canon(r.ESTADO);

    totalPorDoc[docente] = (totalPorDoc[docente] ?? 0) + 1;
    if (estado === 'APROBADA') {
      aprobadasPorDoc[docente] = (aprobadasPorDoc[docente] ?? 0) + 1;
    } else if (estado === 'REPROBADA') {
      reprobadasPorDoc[docente] = (reprobadasPorDoc[docente] ?? 0) + 1;
    }
  });

  // Ordena por % de REPROBADOS (mayor a menor) y toma Top 15
  const topStacked = Object.keys(totalPorDoc)
    .map(docente => {
      const ap  = aprobadasPorDoc[docente]  ?? 0;
      const rp  = reprobadasPorDoc[docente] ?? 0;
      const tot = ap + rp;
      const rpct = tot > 0 ? (rp / tot) * 100 : 0; // % reprobados
      const apct = 100 - rpct;                     // % aprobados
      return { docente, ap, rp, tot, apct, rpct };
    })
    .filter(x => x.tot > 0)
    .sort((a, b) => (b.rpct - a.rpct) || (b.tot - a.tot)) // más reprobados primero; desempate por mayor total
    .slice(0, 15);

  const labelsStack = topStacked.map(x => x.docente);
  const dataAp      = topStacked.map(x => x.ap);       // absolutos (para tooltip/tabla)
  const dataRp      = topStacked.map(x => x.rp);
  const dataApPct   = topStacked.map(x => x.apct);     // %
  const dataRpPct   = topStacked.map(x => x.rpct);


  // === Gráfico GENERAL (normalizado a %) y ordenado por % aprobación desc ===
  let chartBarGeneral = new Chart(barCanvas, {
    type: 'bar',
    data: {
      labels: labelsStack,
      datasets: [
        {
          label: 'Aprobadas (%)',
          data: dataApPct,
          backgroundColor: 'rgba(34,197,94,0.45)',
          borderColor: 'rgba(34,197,94,1)',
          borderWidth: 1,
          stack: 'total'
        },
        {
          label: 'Reprobadas (%)',
          data: dataRpPct,
          backgroundColor: 'rgba(239,68,68,0.45)',
          borderColor: 'rgba(239,68,68,1)',
          borderWidth: 1,
          stack: 'total'
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          max: 100,
          ticks: {
            precision: 0,
            callback: (v) => v + '%'
          }
        },
        y: { stacked: true }
      },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            title: (items) => items?.[0]?.label ?? '',
            // ⬇️ Eliminado el beforeBody que rompía
            label: (ctx) => {
              const val = typeof ctx.parsed?.x === 'number' ? ctx.parsed.x : ctx.parsed;
              return `${ctx.dataset.label}: ${val.toFixed(2)}%`;
            },
            afterBody: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              const ap  = dataAp[idx] ?? 0;
              const rp  = dataRp[idx] ?? 0;
              const tot = ap + rp;
              const pctAp = tot > 0 ? ((ap / tot) * 100).toFixed(2) : '0.00';
              return [
                `Aprobadas: ${ap}`,
                `Reprobadas: ${rp}`,
                `Total: ${tot}`,
                `% Aprobación: ${pctAp}%`
              ];
            }
          }
        }
      }
    }
  });

  /* ===== Tabla informativa bajo el gráfico (números absolutos) ===== */
  const tableWrap = document.createElement('div');
  tableWrap.style.marginTop = '12px';
  tableWrap.style.overflowX = 'auto';

  const table = document.createElement('table');
  table.className = 'striped';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:56px;">#</th>
        <th>Docente</th>
        <th style="text-align:right;width:140px;">Aprobadas</th>
        <th style="text-align:right;width:140px;">Reprobadas</th>
        <th style="text-align:right;width:160px;">Total</th>
        <th style="text-align:right;width:140px;">% Aprobación</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  topStacked.forEach((x, i) => {
    const pct = x.tot > 0 ? ((x.ap / x.tot) * 100).toFixed(2) : '0.00';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${x.docente}</td>
      <td style="text-align:right;">${x.ap}</td>
      <td style="text-align:right;">${x.rp}</td>
      <td style="text-align:right;">${x.tot}</td>
      <td style="text-align:right;">${pct}%</td>
    `;
    tbody.appendChild(tr);
  });
  tableWrap.appendChild(table);
  barCanvas.parentElement.appendChild(tableWrap);

  /* ========= TOP 10 REPROBADOS (vista general) ========= */
  function renderTop10() {
    // limpiar hostTop
    while (hostTop.firstChild) hostTop.removeChild(hostTop.firstChild);

    const allowed = new Set(['APROBADA', 'REPROBADA']);
    const porPeriodo = {};
    const globalData = {};

    dataFiltrada.forEach(row => {
      const periodo = norm(row.PERIODO);
      const estado = canon(row.ESTADO);
      if (!periodo || !allowed.has(estado)) return;

      const docenteNombre = getNombreDocente(row.DOCENTE);
      if (!docenteNombre) return;
      const materia = norm(row.MATERIA);
      if (!materia) return;

      const keyP = `${docenteNombre}||${materia}`;
      if (!porPeriodo[periodo]) porPeriodo[periodo] = {};
      if (!porPeriodo[periodo][keyP]) {
        porPeriodo[periodo][keyP] = { docente: docenteNombre, materia, total: 0, reprobadas: 0 };
      }
      porPeriodo[periodo][keyP].total += 1;
      if (estado === 'REPROBADA') porPeriodo[periodo][keyP].reprobadas += 1;

      const keyG = keyP;
      if (!globalData[keyG]) globalData[keyG] = { docente: docenteNombre, materia, total: 0, reprobadas: 0 };
      globalData[keyG].total += 1;
      if (estado === 'REPROBADA') globalData[keyG].reprobadas += 1;
    });

    const globalItems = Object.values(globalData)
      .filter(x => x.total > 0)
      .map(x => ({
        docente: x.docente,
        materia: x.materia,
        pct: +((x.reprobadas / x.total) * 100).toFixed(2),
        total: x.total
      }))
      .sort((a, b) => (b.pct - a.pct) || (b.total - a.total))
      .slice(0, 10);

    const h2Global = document.createElement('h2');
    h2Global.textContent = 'Top 10 Global de Materias Con Más Reprobados';
    h2Global.style.margin = '24px 0 12px';
    hostTop.appendChild(h2Global);

    const tableGlobal = document.createElement('table');
    tableGlobal.className = 'striped';
    tableGlobal.innerHTML = `
      <thead>
        <tr>
          <th style="width:56px;">#</th>
          <th>Profesor</th>
          <th>Materia</th>
          <th style="text-align:right;width:140px;">% Reprobados</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tbG = tableGlobal.querySelector('tbody');
    globalItems.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${it.docente}</td>
        <td>${it.materia}</td>
        <td style="text-align:right;">${it.pct.toFixed(2)}</td>`;
      tbG.appendChild(tr);
    });
    hostTop.appendChild(tableGlobal);

    const h2Periodos = document.createElement('h2');
    h2Periodos.textContent = 'Top 10 de Reprobados Por Período';
    h2Periodos.style.margin = '24px 0 12px';
    hostTop.appendChild(h2Periodos);

    const periodos = Object.keys(porPeriodo).sort().reverse();
    const accordions = [];

    function openAccordion(acc) {
      if (acc.dataset.open === '1') return;
      const content = acc.querySelector('.acc-content');
      content.style.display = 'block';
      const target = content.scrollHeight;
      content.style.maxHeight = '0px';
      content.style.opacity = '0';
      content.getBoundingClientRect();
      content.style.transition = 'max-height 300ms ease, opacity 300ms ease';
      content.style.maxHeight = target + 'px';
      content.style.opacity = '1';
      acc.dataset.open = '1';
    }
    function closeAccordion(acc) {
      if (acc.dataset.open !== '1') return;
      const content = acc.querySelector('.acc-content');
      const current = content.scrollHeight;
      content.style.maxHeight = current + 'px';
      content.style.opacity = '1';
      content.getBoundingClientRect();
      content.style.transition = 'max-height 300ms ease, opacity 300ms ease';
      content.style.maxHeight = '0px';
      content.style.opacity = '0';
      acc.dataset.open = '0';
      content.addEventListener('transitionend', function handler() {
        if (acc.dataset.open === '0') content.style.display = 'none';
        content.removeEventListener('transitionend', handler);
      });
    }

    periodos.forEach(periodo => {
      const items = Object.values(porPeriodo[periodo] || {})
        .filter(x => x.total > 0)
        .map(x => ({
          docente: x.docente,
          materia: x.materia,
          pct: +((x.reprobadas / x.total) * 100).toFixed(2),
          total: x.total
        }))
        .sort((a, b) => (b.pct - a.pct) || (b.total - a.total))
        .slice(0, 10);

      const acc = document.createElement('div');
      acc.className = 'acc top10-acc';
      acc.dataset.open = '0';
      acc.style.marginBottom = '10px';
      acc.style.border = '1px solid var(--border)';
      acc.style.borderRadius = '8px';
      acc.style.overflow = 'hidden';
      acc.style.background = 'var(--card)';

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'top10-acc__header';
      header.textContent = periodo;
      header.style.width = '100%';
      header.style.textAlign = 'left';
      header.style.fontWeight = '600';
      header.style.padding = '10px 12px';
      header.style.background = 'color-mix(in srgb, var(--card) 96%, transparent)';
      header.style.border = 'none';
      header.style.cursor = 'pointer';

      const content = document.createElement('div');
      content.className = 'acc-content top10-acc__content';
      content.style.display = 'none';
      content.style.maxHeight = '0px';
      content.style.overflow = 'hidden';
      content.style.opacity = '0';
      content.style.willChange = 'max-height, opacity';
      content.style.background = 'var(--card)';

      const tableWrapP = document.createElement('div');
      tableWrapP.className = 'top10-acc__table-wrap';
      tableWrapP.style.borderTop = '1px solid var(--border)';

      const tableP = document.createElement('table');
      tableP.className = 'striped top10-acc__table';
      tableP.innerHTML = `
        <thead>
          <tr>
            <th style="width:56px;">#</th>
            <th>Profesor</th>
            <th>Materia</th>
            <th style="text-align:right;width:140px;">% Reprobados</th>
          </tr>
        </thead>
        <tbody></tbody>`;

      const tbP = tableP.querySelector('tbody');

      if (items.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" style="padding:12px;">Sin datos para este período.</td>`;
        tbP.appendChild(tr);
      } else {
        items.forEach((it, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>${it.docente}</td>
            <td>${it.materia}</td>
            <td style="text-align:right;">${it.pct.toFixed(2)}</td>`;
          tbP.appendChild(tr);
        });
      }

      tableWrapP.appendChild(tableP);
      content.appendChild(tableWrapP);

      header.addEventListener('click', () => {
        const isOpen = acc.dataset.open === '1';
        if (isOpen) accordions.forEach(closeAccordion);
        else {
          accordions.forEach(closeAccordion);
          openAccordion(acc);
        }
      });

      acc.appendChild(header);
      acc.appendChild(content);
      hostTop.appendChild(acc);
      accordions.push(acc);
    });
  }

  // Render inicial (vista general)
  renderTop10();

  /* ========= HISTORIAL DEL DOCENTE (vista filtrada) ========= */
  const histSection = document.createElement('section');
  histSection.id = 'historialDocenteContainer';
  histSection.className = 'chart-section';
  histSection.style.display = 'none';
  histSection.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <h3 id="histTitle" style="margin:0;">Historial del Docente</h3>
      <button id="btnClearFilter" class="action-button secondary-button" type="button">Quitar filtro / Ver general</button>
    </div>
    <div id="histKpis" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;"></div>
    <div style="margin-top:12px;">
      <h4 style="margin:8px 0;">Aprobadas vs Reprobadas por PERÍODO</h4>
      <canvas id="histChartPeriodo" class="chart-canvas"></canvas>
    </div>
    <div style="margin-top:12px;">
      <h4 style="margin:8px 0;">Detalle por Materia</h4>
      <div id="histTableWrap" style="overflow-x:auto;"></div>
    </div>
  `;
  // Insertamos el historial arriba de hostTop (para que ocupe el mismo bloque visual)
  hostTop.parentNode.insertBefore(histSection, hostTop);

  let histChart; // instancia Chart del historial

  function matchesDocente(row, q) {
    if (!q) return false;
    const p = parseDocente(row.DOCENTE);
    if (!p) return false;
    const f = canon(q);
    // cédula exacta o nombre contiene
    return p.id === q.trim() || p.canonNombre.includes(f);
  }

  function renderDocenteHistory(query) {
    // Filtrar filas del docente
    const rows = dataFiltrada.filter(r => matchesDocente(r, query));
    // Ocultar vista general
    chartsWrap.style.display = 'none';
    hostTop.style.display   = 'none';
    // Mostrar historial
    histSection.style.display = 'block';

    const histTitle = histSection.querySelector('#histTitle');
    const histKpis  = histSection.querySelector('#histKpis');
    const tableWrap = histSection.querySelector('#histTableWrap');
    const canvas    = histSection.querySelector('#histChartPeriodo');

    // Limpieza
    histKpis.innerHTML = '';
    tableWrap.innerHTML = '';
    if (histChart) { histChart.destroy(); histChart = null; }

    if (rows.length === 0) {
      histTitle.textContent = `Historial del Docente — (sin coincidencias)`;
      tableWrap.innerHTML = `<p class="muted">No se encontraron registros para “${query}”.</p>`;
      return;
    }

    // Nombre a mostrar
    const uniqueDocs = new Set(rows.map(r => getNombreDocente(r.DOCENTE)));
    histTitle.textContent = uniqueDocs.size === 1
      ? `Historial del Docente: ${Array.from(uniqueDocs)[0]}`
      : `Historial de docentes que coinciden con: "${query}"`;

    // Totales globales
    let aprobadas = 0, reprobadas = 0;
    rows.forEach(r => {
      const e = canon(r.ESTADO);
      if (e === 'APROBADA') aprobadas++;
      else if (e === 'REPROBADA') reprobadas++;
    });
    const total = aprobadas + reprobadas;
    const pct   = total > 0 ? ((aprobadas / total) * 100).toFixed(2) : '0.00';

    // KPIs
    const kpiTpl = (label, value) => `
      <div class="card" style="padding:10px 14px;min-width:180px;">
        <div class="muted" style="font-size:12px;">${label}</div>
        <div style="font-size:22px;font-weight:700;">${value}</div>
      </div>`;
    histKpis.insertAdjacentHTML('beforeend', kpiTpl('Aprobadas', aprobadas));
    histKpis.insertAdjacentHTML('beforeend', kpiTpl('Reprobadas', reprobadas));
    histKpis.insertAdjacentHTML('beforeend', kpiTpl('Total', total));
    histKpis.insertAdjacentHTML('beforeend', kpiTpl('% Aprobación', `${pct}%`));

    // ===== Por PERÍODO (NORMALIZADO A % y ORDENADO por % aprobación DESC) =====
    const per = {};
    rows.forEach(r => {
      const periodo = norm(r.PERIODO);
      const e = canon(r.ESTADO);
      if (!per[periodo]) per[periodo] = { ap: 0, rp: 0 };
      if (e === 'APROBADA') per[periodo].ap++;
      else if (e === 'REPROBADA') per[periodo].rp++;
    });

    const periodosOrdenados = Object.keys(per)
      .map(p => {
        const ap = per[p].ap;
        const rp = per[p].rp;
        const tot = ap + rp;
        const pctAp = tot ? (ap / tot) * 100 : 0;
        return { periodo: p, ap, rp, tot, pctAp };
      })
      .sort((a, b) => b.pctAp - a.pctAp); // mayor % aprobación primero

    const labelsP   = periodosOrdenados.map(x => x.periodo);
    const serieApAbs = periodosOrdenados.map(x => x.ap);
    const serieRpAbs = periodosOrdenados.map(x => x.rp);
    const serieApPct = periodosOrdenados.map(x => x.pctAp);
    const serieRpPct = periodosOrdenados.map(x => 100 - x.pctAp);

    // Gráfico apilado horizontal por período (en %)
    histChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labelsP,
        datasets: [
          {
            label: 'Aprobadas (%)',
            data: serieApPct,
            backgroundColor: 'rgba(34,197,94,0.45)',
            borderColor: 'rgba(34,197,94,1)',
            borderWidth: 1,
            stack: 'total'
          },
          {
            label: 'Reprobadas (%)',
            data: serieRpPct,
            backgroundColor: 'rgba(239,68,68,0.45)',
            borderColor: 'rgba(239,68,68,1)',
            borderWidth: 1,
            stack: 'total'
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            max: 100,
            ticks: {
              precision: 0,
              callback: (v) => v + '%'
            }
          },
          y: { stacked: true }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = typeof ctx.parsed?.x === 'number' ? ctx.parsed.x : ctx.parsed;
                return `${ctx.dataset.label}: ${val.toFixed(2)}%`;
              },
              afterBody: (items) => {
                const idx = items?.[0]?.dataIndex ?? 0;
                const ap = serieApAbs[idx] ?? 0;
                const rp = serieRpAbs[idx] ?? 0;
                const tot = ap + rp;
                const pctAp = tot > 0 ? ((ap / tot) * 100).toFixed(2) : '0.00';
                return [
                  `Aprobadas: ${ap}`,
                  `Reprobadas: ${rp}`,
                  `Total: ${tot}`,
                  `% Aprobación: ${pctAp}%`
                ];
              }
            }
          }
        }
      }
    });

    // ===== Tabla por MATERIA (agregada en todo el historial del docente) =====
    const materias = {};
    rows.forEach(r => {
      const m = norm(r.MATERIA);
      const e = canon(r.ESTADO);
      if (!materias[m]) materias[m] = { ap: 0, rp: 0 };
      if (e === 'APROBADA') materias[m].ap++;
      else if (e === 'REPROBADA') materias[m].rp++;
    });
    const listaMaterias = Object.entries(materias).map(([materia, v]) => ({
      materia, ap: v.ap, rp: v.rp, tot: v.ap + v.rp
    })).sort((a, b) => b.tot - a.tot);

    const tbl = document.createElement('table');
    tbl.className = 'striped';
    tbl.innerHTML = `
      <thead>
        <tr>
          <th style="width:56px;">#</th>
          <th>Materia</th>
          <th style="text-align:right;width:140px;">Aprobadas</th>
          <th style="text-align:right;width:140px;">Reprobadas</th>
          <th style="text-align:right;width:160px;">Total</th>
          <th style="text-align:right;width:140px;">% Aprobación</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbodyM = tbl.querySelector('tbody');
    listaMaterias.forEach((x, i) => {
      const pctM = x.tot > 0 ? ((x.ap / x.tot) * 100).toFixed(2) : '0.00';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${x.materia}</td>
        <td style="text-align:right;">${x.ap}</td>
        <td style="text-align:right;">${x.rp}</td>
        <td style="text-align:right;">${x.tot}</td>
        <td style="text-align:right;">${pctM}%</td>
      `;
      tbodyM.appendChild(tr);
    });
    tableWrap.innerHTML = '';
    tableWrap.appendChild(tbl);
  }

  // Quitar filtro (volver a vista general)
  histSection.querySelector('#btnClearFilter').addEventListener('click', () => {
    docenteFilterInput.value = '';
    histSection.style.display = 'none';
    chartsWrap.style.display  = '';
    hostTop.style.display     = '';
  });

  /* ========= Eventos del filtro ========= */
  function onSearch() {
    const q = norm(docenteFilterInput.value);
    if (!q) {
      // Si el filtro está vacío, vuelve a la vista general
      histSection.style.display = 'none';
      chartsWrap.style.display  = '';
      hostTop.style.display     = '';
      return;
    }
    renderDocenteHistory(q);
  }

  searchButton?.addEventListener('click', onSearch);
  docenteFilterInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSearch();
  });
});
