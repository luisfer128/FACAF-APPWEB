import { loadData } from '../indexeddb-storage.js';

/* ===== Helpers ===== */
const norm = (v) => (v ?? '').toString().trim();
const asNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");

/* ===== Carga con “fallbacks” de claves comunes ===== */
async function loadWithFallback(possibleKeys) {
  for (const k of possibleKeys) {
    const data = await loadData(k);
    if (Array.isArray(data) && data.length) {
      return { key: k, data };
    }
  }
  return { key: null, data: [] };
}

/* ===== Claves posibles para TOTAL y PARCIAL ===== */
const KEYS_TOTAL = [
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx',
  `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`,
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL'
];

const KEYS_PARCIAL = [
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_xlsx',
  `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`,
  'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL'
];

/* ===== Orden de períodos ===== */
function pickMostRecentPeriod(periods) {
  const parse = (p) => {
    const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase() === 'CII' ? 2 : 1, raw: p };
  };
  return periods
    .slice()
    .sort((A, B) => {
      const a = parse(A), b = parse(B);
      if (a.y1 !== b.y1) return b.y1 - a.y1;
      if (a.term !== b.term) return b.term - a.term;
      return String(b.raw).localeCompare(String(a.raw));
    })[0] || '';
}

/* ===== Estado Charts ===== */
let chartNoVez, chartAprobReprob, chartHist, chartEstPorPeriodo;

function destroyCharts(){
  [chartNoVez, chartAprobReprob, chartHist, chartEstPorPeriodo].forEach(ch => {
    if (ch && typeof ch.destroy === 'function') {
      try { ch.destroy(); } catch {}
    }
  });
  chartNoVez = chartAprobReprob = chartHist = chartEstPorPeriodo = null;
}

/* ===== Select de períodos ===== */
async function populatePeriodSelect() {
  const select = document.getElementById('period-select');
  if (!select) return;

  let { data } = await loadWithFallback(KEYS_TOTAL);
  if (!data.length) {
    ({ data } = await loadWithFallback(KEYS_PARCIAL));
  }
  if (!data.length) {
    select.innerHTML = '';
    return null;
  }

  const periods = Array.from(new Set(
    data.map(r => norm(r.PERIODO)).filter(Boolean)
  ));

  periods.sort((A, B) => {
    const parse = (p) => {
      const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
      if (!m) return { y1: -1, term: -1, raw: p };
      return { y1: Number(m[1]), term: m[3].toUpperCase()==='CII' ? 2 : 1, raw: p };
    };
    const pa = parse(A), pb = parse(B);
    if (pa.y1 !== pb.y1) return pb.y1 - pa.y1;
    if (pa.term !== pb.term) return pb.term - pa.term;
    return String(B).localeCompare(String(A));
  });

  const saved = localStorage.getItem('selectedPeriod');
  const selected = (saved && periods.includes(saved)) ? saved : pickMostRecentPeriod(periods);

  select.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
  if (selected) {
    select.value = selected;
    localStorage.setItem('selectedPeriod', selected);
  }
  return selected;
}

/* ===== Estudiantes únicos por período (histórico) ===== */
async function getStudentsByPeriod() {
  const { data } = await loadWithFallback(KEYS_TOTAL);
  if (!Array.isArray(data) || !data.length) return { labels: [], counts: [] };

  const map = new Map(); // PERIODO -> Set(IDENTIFICACION)
  data.forEach(r => {
    const per = norm(r.PERIODO);
    const id  = norm(r.IDENTIFICACION);
    if (!per || !id) return;
    if (!map.has(per)) map.set(per, new Set());
    map.get(per).add(id);
  });

  const parse = (p) => {
    const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase()==='CII' ? 2 : 1, raw: p };
  };

  const labels = [...map.keys()].sort((A,B)=>{
    const a=parse(A), b=parse(B);
    if (a.y1!==b.y1) return a.y1-b.y1;
    if (a.term!==b.term) return a.term-b.term;
    return String(a.raw).localeCompare(String(b.raw));
  });

  const counts = labels.map(p => map.get(p).size);
  return { labels, counts };
}

/* ===== Data del período seleccionado ===== */
async function getDataForSelectedPeriod(period) {
  const { data } = await loadWithFallback(KEYS_TOTAL);
  if (!data.length) return [];
  return data.filter(r => norm(r.PERIODO) === norm(period));
}

/* ===== Agregados generales ===== */
function buildMetrics(rows) {
  const registros = rows.length;
  const estudiantes = new Set(rows.map(r => norm(r.IDENTIFICACION)).filter(Boolean)).size;

  const vezCounts = { '1':0, '2':0, '3':0 };
  rows.forEach(r => {
    const v = norm(r['NO. VEZ']);
    if (v === '1') vezCounts['1']++;
    else if (v === '2') vezCounts['2']++;
    else if (v) vezCounts['3']++;
  });

  const estadoCounts = { APROBADO:0, REPROBADO:0, CURSANDO:0 };
  rows.forEach(r => {
    const e = norm(r.ESTADO).toUpperCase();
    if (e.includes('APROB')) estadoCounts.APROBADO++;
    else if (e.includes('REPROB')) estadoCounts.REPROBADO++;
    else estadoCounts.CURSANDO++;
  });

  const bins = Array.from({length: 10}, (_,i)=>({label:`${i}–${i+1}`, count:0}));
  rows.forEach(r => {
    const p = asNum(r.PROMEDIO);
    if (p === null) return;
    const idx = Math.max(0, Math.min(9, Math.floor(p)));
    bins[idx].count++;
  });

  const mapMat = new Map();
  rows.forEach(r => {
    const m = norm(r.MATERIA);
    if (!m) return;
    const e = norm(r.ESTADO).toUpperCase();
    const o = mapMat.get(m) || { total:0, rep:0 };
    o.total++;
    if (e.includes('REPROB')) o.rep++;
    mapMat.set(m, o);
  });
  const materias = [...mapMat.entries()]
  .map(([materia, o]) => ({
    materia,
    reprobados: o.rep,
    total: o.total,
    pct: o.total ? (o.rep / o.total) : 0
  }))
  // ordenar de mayor a menor % reprobados
  .sort((a, b) => b.pct - a.pct || b.reprobados - a.reprobados)
  .slice(0, 10);


  return { registros, estudiantes, vezCounts, estadoCounts, bins, materias };
}

/* ===== Normalización de docente y filtros ===== */
const canon = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

// Acepta: 6+ dígitos + " - " + nombre
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

const ESTADOS_PERMITIDOS = new Set(['APROBADA', 'REPROBADA']);
const MATERIAS_REGEX_EXCLUIR = [/^INGLES\s+(I|II|III|IV)\b/i];
const materiaExcluida = (materia) => MATERIAS_REGEX_EXCLUIR.some(rx => rx.test(canon(materia)));

/* ===== Top 10 DOCENTES (agregado por docente), solo si DOCENTE = "###### - Nombre" ===== */
function computeTop10DocentesReprobados(rows) {
  const aprobadas = {};
  const reprobadas = {};
  const totales   = {};

  rows.forEach(r => {
    const estado = canon(r.ESTADO);
    if (!ESTADOS_PERMITIDOS.has(estado)) return;

    if (materiaExcluida(r.MATERIA)) return;

    const d = parseDocente(r.DOCENTE);
    if (!d || d.canonNombre === 'MOVILIDAD') return;

    const docente = getNombreDocente(r.DOCENTE);
    if (!docente) return;

    totales[docente]   = (totales[docente]   ?? 0) + 1;
    if (estado === 'APROBADA')  aprobadas[docente]  = (aprobadas[docente]  ?? 0) + 1;
    if (estado === 'REPROBADA') reprobadas[docente] = (reprobadas[docente] ?? 0) + 1;
  });

  return Object.keys(totales).map(docente => {
    const ap  = aprobadas[docente]  ?? 0;
    const rp  = reprobadas[docente] ?? 0;
    const tot = ap + rp;
    const pctReprob = tot > 0 ? (rp / tot) * 100 : 0;
    return { docente, rp, tot, pctReprob };
  })
  .sort((a, b) => (b.pctReprob - a.pctReprob) || (b.tot - a.tot))
  .slice(0, 10);
}

/* ===== KPIs ===== */
function renderKPIs(m) {
  document.getElementById('kpi-registros').textContent = m.registros.toLocaleString('es');
  document.getElementById('kpi-estudiantes').textContent = m.estudiantes.toLocaleString('es');
  document.getElementById('kpi-no-vez').textContent =
    `1: ${m.vezCounts['1'].toLocaleString('es')}, 2: ${m.vezCounts['2'].toLocaleString('es')}, 3: ${m.vezCounts['3'].toLocaleString('es')}`;
}

/* ===== Charts ===== */
async function renderCharts(m) {
  destroyCharts();

  chartNoVez = new Chart(document.getElementById('chartNoVez'), {
    type: 'bar',
    data: {
      labels: ['1', '2', ''],
      datasets: [{ label: 'Conteo', data: [m.vezCounts['1'], m.vezCounts['2'], m.vezCounts['3']] }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx)=>` ${ctx.parsed.x.toLocaleString('es')}` } }
      },
      scales: { x: { beginAtZero: true, ticks: { precision:0 } }, y: { ticks: { precision:0 } } }
    }
  });

  chartAprobReprob = new Chart(document.getElementById('chartAprobReprob'), {
    type: 'doughnut',
    data: {
      labels: ['Aprobado','Reprobado','Cursando'],
      datasets: [{ data: [m.estadoCounts.APROBADO, m.estadoCounts.REPROBADO, m.estadoCounts.CURSANDO] }]
    },
    options: {
      responsive: true, 
      maintainAspectRatio: false, 
      cutout: '60%',
      plugins: { 
        legend: { position:'bottom' },
        tooltip: { 
          callbacks: { 
            label: (ctx) => {
              // Calcular el total
              const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
              // Calcular el porcentaje
              const percentage = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0';
              // Mostrar: "Etiqueta: cantidad (porcentaje%)"
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString('es')} (${percentage}%)`;
            }
          } 
        } 
      }
    }
  });

  const sp = await getStudentsByPeriod();
  chartEstPorPeriodo = new Chart(document.getElementById('chartEstPorPeriodo'), {
    type: 'bar',
    data: {
      labels: sp.labels,
      datasets: [{ label: 'Estudiantes únicos', data: sp.counts }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label:(ctx)=>` ${ctx.parsed.y.toLocaleString('es')}` } }
      },
      scales: {
        x: { ticks: { autoSkip: true, maxRotation: 0, minRotation: 0 } },
        y: { beginAtZero: true, ticks: { precision:0 } }
      }
    }
  });

  // Histograma de PROMEDIO
  chartHist = new Chart(document.getElementById('chartHist'), {
    type: 'bar',
    data: {
      labels: m.bins.map(b => b.label),
      datasets: [{ label: 'Estudiantes', data: m.bins.map(b => b.count) }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display:false }, tooltip: { callbacks: { label:(ctx)=>` ${ctx.parsed.y.toLocaleString('es')}` } } },
      scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
    }
  });
}

/* ===== Tablas ===== */
function renderTables(m, topDocentes) {
  const tbM = document.querySelector('#tbl-materias tbody');
  if (tbM) {
    tbM.innerHTML = m.materias.map((row,i)=>`
      <tr>
        <td>${i+1}</td>
        <td>${row.materia}</td>
        <td>${row.reprobados}</td>
        <td>${row.total}</td>
        <td>${(row.pct*100).toFixed(1)}%</td>
      </tr>
    `).join('');
  }

  const tblD  = document.querySelector('#tbl-docentes');
  const thead = tblD?.querySelector('thead');
  const tbD   = tblD?.querySelector('tbody');

  if (thead) {
    thead.innerHTML = `
      <tr>
        <th style="width:56px;">#</th>
        <th>Profesor</th>
        <th style="text-align:right;width:140px;">Reprobados</th>
        <th style="text-align:right;width:160px;">Total</th>
        <th style="text-align:right;width:160px;">% Reprobados</th>
      </tr>
    `;
  }

  if (tbD) {
    tbD.innerHTML = (topDocentes ?? []).map((x, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${x.docente}</td>
        <td style="text-align:right;">${x.rp}</td>
        <td style="text-align:right;">${x.tot}</td>
        <td style="text-align:right;">${x.pctReprob.toFixed(2)}%</td>
      </tr>
    `).join('');
  }
}

/* ===== Carga principal ===== */
async function loadReport() {
  const selected = document.getElementById('period-select').value;
  const rows = await getDataForSelectedPeriod(selected);

  if (!Array.isArray(rows) || !rows.length) {
    destroyCharts();
    renderKPIs({registros:0, estudiantes:0, vezCounts:{'1':0,'2':0,'3':0}});
    const tm = document.querySelector('#tbl-materias tbody');
    const td = document.querySelector('#tbl-docentes tbody');
    if (tm) tm.innerHTML = '';
    if (td) td.innerHTML = '';
    return;
  }

  const metrics     = buildMetrics(rows);
  const topDocentes = computeTop10DocentesReprobados(rows);
  renderKPIs(metrics);
  renderCharts(metrics);
  renderTables(metrics, topDocentes);
}

/* ===== Eventos ===== */
document.addEventListener('DOMContentLoaded', async () => {
  const initialSelected = await populatePeriodSelect();

  document.getElementById('btn-back').addEventListener('click', () => {
    window.location.href = '../index.html';
  });
  document.getElementById('btn-print').addEventListener('click', () => {
    window.print();
  });
  document.getElementById('period-select').addEventListener('change', (e) => {
    localStorage.setItem('selectedPeriod', e.target.value);
    loadReport();
  });

  if (initialSelected) {
    await loadReport();
  } else {
    document.getElementById('no-data').hidden = true;
  }
});