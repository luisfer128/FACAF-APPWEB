import { loadData } from '../indexeddb-storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  // ---- DOM ----
  const chartDistribucionCanvas = document.getElementById('chartDistribucionPromedios');
  const studentFilterInput = document.getElementById('studentFilter');
  const searchButton = document.getElementById('searchButton');
  const clearButton = document.getElementById('clearButton');
  const backToMenuButton = document.getElementById('goToMenuButton');

  const sectionDistribucion = document.getElementById('sectionDistribucion');
  const sectionPromedioNivel = document.getElementById('sectionPromedioNivel');
  const sectionHeatmaps = document.getElementById('sectionHeatmaps');

  const studentDetails = document.getElementById('studentDetails');
  const studentInfoBody = document.getElementById('studentInfoBody');
  const studentHeading = document.getElementById('studentHeading');
  const studentAccordion = document.getElementById('studentAccordion');

  const lineCanvas = document.getElementById('chartEstudianteLine');
  const barsCanvas = document.getElementById('chartEstudianteBars');

  const key = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';
  const allData = await loadData(key);
  if (!Array.isArray(allData)) {
    console.error("❌ No se pudo cargar data desde IndexedDB con la clave:", key);
    return;
  }

  backToMenuButton.addEventListener('click', () => {
    window.location.href = '../index.html';
  });

  // ---- Helpers ----
  const norm = (s) => (s ?? '').toString().trim();
  const asNum = (v) => {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const canon = (s) =>
    (s ?? '').toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

  function parsePeriodo(p) {
    const m = String(p).match(/(\d{4})\s*-\s*(\d{4})\s*(CI{1,2})/i);
    if (!m) return { a: 0, b: 0, ciclo: 0 };
    return { a: +m[1], b: +m[2], ciclo: /CII/i.test(m[3]) ? 1 : 0 };
  }
  function cmpPeriodo(p1, p2) {
    const A = parsePeriodo(p1), B = parsePeriodo(p2);
    if (A.a !== B.a) return A.a - B.a;
    if (A.b !== B.b) return A.b - B.b;
    return A.ciclo - B.ciclo;
  }

  // ===== Paleta fija por nivel =====
  function colorNivel(n) {
    // tonos fijos por nivel; si llega uno fuera de 1..9, se calcula.
    const hues = {1:210, 2:0, 3:30, 4:60, 5:120, 6:280, 7:330, 8:180, 9:40};
    const h = hues[n] ?? ((n * 37) % 360);
    return `hsl(${h}, 72%, 50%)`;
  }

  // ===== Función para color gradual del heatmap =====
  function getHeatmapColor(percentage, maxPercentage) {
    // Normalizar el porcentaje de 0 a 1
    const normalized = percentage / maxPercentage;
    
    // Interpolación de verde (120°) a rojo (0°) en HSL
    // Verde: hsl(120, 70%, 50%) -> Rojo: hsl(0, 70%, 50%)
    const hue = 120 * (1 - normalized); // De 120 (verde) a 0 (rojo)
    const saturation = 70;
    const lightness = 50;
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  // filtros globales
  const ESTADOS_PERMITIDOS = new Set(['APROBADA', 'REPROBADA']);
  const DOCENTES_EXCLUIDOS = new Set(['MOVILIDAD']);
  const MATERIAS_REGEX_EXCLUIR = [/^INGLES\s+(I|II|III|IV)\b$/];
  const materiaExcluida = (materia) => MATERIAS_REGEX_EXCLUIR.some(rx => rx.test(canon(materia)));

  const dataFiltrada = allData.filter(r => {
    const estado = canon(r.ESTADO);
    if (!ESTADOS_PERMITIDOS.has(estado)) return false;
    if (DOCENTES_EXCLUIDOS.has(canon(r.DOCENTE))) return false;
    if (materiaExcluida(r.MATERIA)) return false;
    return true;
  });

  // ====== Gráficos globales ======
  const estudiantesPorPeriodo = {};
  dataFiltrada.forEach(e => {
    const id = e.IDENTIFICACION, per = e.PERIODO, pr = asNum(e.PROMEDIO);
    if (!id || !per || pr === null) return;
    (estudiantesPorPeriodo[id] ||= {})[per] ||= [];
    estudiantesPorPeriodo[id][per].push(pr);
  });

  const promediosGenerales = Object.values(estudiantesPorPeriodo).map(perMap => {
    const ultimoPer = Object.keys(perMap).sort(cmpPeriodo).reverse()[0];
    const arr = perMap[ultimoPer] || [];
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  });

  const rangos = ['0–1','1–2','2–3','3–4','4–5','5–6','6–7','7–8','8–9','9–10'];
  const distribucion = new Array(10).fill(0);
  promediosGenerales.forEach(p => distribucion[Math.min(Math.floor(p), 9)]++);

  new Chart(chartDistribucionCanvas, {
    type: 'bar',
    data: { labels: rangos, datasets: [{ label: 'Cantidad de estudiantes', data: distribucion }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  function promedioPorNivel(data) {
    const perNiv = {};
    data.forEach(e => {
      const per = e.PERIODO, niv = e.NIVEL, pr = asNum(e.PROMEDIO);
      if (!per || !niv || pr === null) return;
      (perNiv[per] ||= {})[niv] ||= [];
      perNiv[per][niv].push(pr);
    });
    const labels = Object.keys(perNiv).sort(cmpPeriodo);
    const niveles = Array.from(new Set(data.map(d => d.NIVEL))).sort((a, b) => a - b);
    const datasets = niveles.map(niv => {
      const label = `Nivel ${niv}`;
      const color = colorNivel(niv);
      return {
        label,
        data: labels.map(p => {
          const arr = perNiv[p][niv] || [];
          return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
        }),
        spanGaps: true,
        tension: 0.3,
        borderWidth: 2,
        borderColor: color,
        backgroundColor: color,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#fff',
        pointBorderWidth: 2
      };
    });
    return { labels, datasets };
  }

  // ---- Promedio por Nivel (general) con tooltip por dataset ----
  const g = promedioPorNivel(dataFiltrada);
  new Chart(document.getElementById('chartPromedioPorNivel'), {
    type: 'line',
    data: g,
    options: {
      responsive: true,
      interaction: { mode: 'dataset', intersect: false },
      hover: { mode: 'dataset', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          title: (items) => items?.[0]?.dataset?.label ?? '',
          callbacks: {
            label: (ctx) => {
              const periodo = g.labels[ctx.dataIndex];
              const v = ctx.parsed.y;
              return `${periodo}: ${v ?? '-'}`;
            },
            labelColor: (ctx) => ({
              borderColor: ctx.dataset.borderColor,
              backgroundColor: ctx.dataset.backgroundColor
            })
          },
          displayColors: true
        }
      },
      elements: {
        line: { borderWidth: 2 },
        point: { radius: 4, hoverRadius: 6, backgroundColor: '#fff', borderWidth: 2 }
      },
      scales: { y: { beginAtZero: false, grace: '5%' } }
    }
  });

  // ---- Por carrera (mismo comportamiento y mismos colores) ----
  function grafPorCarrera(carrera, id, titulo) {
    const d = dataFiltrada.filter(e => e.CARRERA === carrera);
    const gg = promedioPorNivel(d);
    new Chart(document.getElementById(id), {
      type: 'line',
      data: gg,
      options: {
        responsive: true,
        interaction: { mode: 'dataset', intersect: false },
        hover: { mode: 'dataset', intersect: false },
        plugins: {
          title: { display: true, text: titulo },
          legend: { position: 'bottom' },
          tooltip: {
            title: (items) => items?.[0]?.dataset?.label ?? '',
            callbacks: {
              label: (ctx) => {
                const periodo = gg.labels[ctx.dataIndex];
                const v = ctx.parsed.y;
                return `${periodo}: ${v ?? '-'}`;
              },
              labelColor: (ctx) => ({
                borderColor: ctx.dataset.borderColor,
                backgroundColor: ctx.dataset.backgroundColor
              })
            },
            displayColors: true
          }
        },
        elements: {
          line: { borderWidth: 2 },
          point: { radius: 4, hoverRadius: 6, backgroundColor: '#fff', borderWidth: 2 }
        },
        scales: { y: { beginAtZero: false, grace: '5%' } }
      }
    });
  }
  grafPorCarrera('PEDAGOGÍA DE LA ACTIVIDAD FÍSICA Y DEPORTE', 'chartPedagogia');
  grafPorCarrera('ENTRENAMIENTO DEPORTIVO', 'chartEntrenamiento');

  // ====== Heatmaps con colores graduales ======
  function calcularMatrizReprobados(data) {
    const materias = [...new Set(data.map(d => d.MATERIA))].sort();
    const periodos = [...new Set(data.map(d => d.PERIODO))].sort(cmpPeriodo);
    const matrix = materias.map(() => Array(periodos.length).fill(0));
    const totalPorPeriodo = Array(periodos.length).fill(0);
    data.forEach(d => {
      if (d.ESTADO === 'REPROBADA') {
        const i = materias.indexOf(d.MATERIA);
        const j = periodos.indexOf(d.PERIODO);
        if (i !== -1 && j !== -1) { matrix[i][j]++; totalPorPeriodo[j]++; }
      }
    });
    for (let j = 0; j < periodos.length; j++) {
      const tot = totalPorPeriodo[j] || 1;
      for (let i = 0; i < materias.length; i++) matrix[i][j] = Math.round((matrix[i][j] / tot) * 100);
    }
    return { matrix, materias, periods: periodos };
  }

  function drawBubbleHeatmap(canvasId, title, m) {
    const maxPct = Math.max(...m.matrix.flat(), 1);
    const pts = [];
    m.periods.forEach((per, j) => {
      m.materias.forEach((mat, i) => {
        const v = m.matrix[i][j];
        if (v > 0) {
          pts.push({ 
            x: per, 
            y: mat, 
            r: (v / maxPct) * 25 + 5, 
            v,
            backgroundColor: getHeatmapColor(v, maxPct),
            borderColor: getHeatmapColor(v, maxPct)
          });
        }
      });
    });
    
    const canvas = document.getElementById(canvasId);
    canvas.height = Math.max(400, m.materias.length * 25);
    new Chart(canvas, {
      type: 'bubble',
      data: { 
        datasets: [{ 
          label: '% Reprobados', 
          data: pts,
        }] 
      },
      options: {
        responsive: false,
        plugins: {
          title: { display: true, text: title },
          tooltip: { 
            callbacks: { 
              title: (it) => `${it[0].raw.y} — ${it[0].raw.x}`, 
              label: (it) => `${it.raw.v}%`,
              labelColor: (ctx) => ({
                borderColor: ctx.raw.borderColor,
                backgroundColor: ctx.raw.backgroundColor
              })
            } 
          }
        },
        scales: {
          x: { type: 'category', labels: m.periods, title: { display: false, text: 'Período' } },
          y: { type: 'category', labels: m.materias, title: { display: false, text: 'Materia' } }
        },
        elements: {
          point: {
            backgroundColor: function(ctx) {
              return ctx.raw?.backgroundColor || '#999';
            },
            borderColor: function(ctx) {
              return ctx.raw?.borderColor || '#999';
            }
          }
        }
      }
    });
  }

  drawBubbleHeatmap('heatmapGeneral', 'Heatmap General % Reprobados (Normalizado)', calcularMatrizReprobados(dataFiltrada));
  drawBubbleHeatmap('heatmapPAF', 'PAF % Reprobados (Normalizado)', calcularMatrizReprobados(dataFiltrada.filter(d => d.CARRERA === 'PEDAGOGÍA DE LA ACTIVIDAD FÍSICA Y DEPORTE')));
  drawBubbleHeatmap('heatmapEntrenamiento', 'Entrenamiento Deportivo % Reprobados (Normalizado)', calcularMatrizReprobados(dataFiltrada.filter(d => d.CARRERA === 'ENTRENAMIENTO DEPORTIVO')));

  // ========= MODO ESTUDIANTE =========
  let lineChart = null;
  let barsChart = null;

  function showGeneralView() {
    sectionDistribucion.style.display = '';
    sectionPromedioNivel.style.display = '';
    sectionHeatmaps.style.display = '';
    studentDetails.style.display = 'none';
    if (lineChart) { lineChart.destroy(); lineChart = null; }
    if (barsChart) { barsChart.destroy(); barsChart = null; }
  }
  function showStudentView() {
    sectionDistribucion.style.display = 'none';
    sectionPromedioNivel.style.display = 'none';
    sectionHeatmaps.style.display = 'none';
    studentDetails.style.display = '';
  }

  function pickStudentRecords(q) {
    const qCanon = canon(q);
    if (!qCanon) return null;
    const byId = dataFiltrada.filter(r => canon(r.IDENTIFICACION) === qCanon);
    if (byId.length) return byId;
    const exactName = dataFiltrada.filter(r => canon(`${r.APELLIDOS} ${r.NOMBRES}`) === qCanon);
    if (exactName.length) return exactName;
    const containsName = dataFiltrada.filter(r => canon(`${r.APELLIDOS} ${r.NOMBRES}`).includes(qCanon));
    if (containsName.length) return containsName;
    const containsId = dataFiltrada.filter(r => String(r.IDENTIFICACION || '').includes(q));
    return containsId.length ? containsId : null;
  }

  function renderStudent(records) {
    const first = records[0];
    const nombre = `${norm(first.APELLIDOS)} ${norm(first.NOMBRES)}`.trim();
    const cedula = norm(first.IDENTIFICACION);
    const correos = Array.from(new Set(records.flatMap(r => [norm(r.CORREO_INSTITUCIONAL), norm(r.CORREO_PERSONAL)]).filter(Boolean))).join(', ');
    const telefono = norm(first.CELULAR);
    const aprobadas = records.filter(r => canon(r.ESTADO) === 'APROBADA').length;
    const reprobadas = records.filter(r => canon(r.ESTADO) === 'REPROBADA').length;

    const periodos = Array.from(new Set(records.map(r => r.PERIODO))).sort(cmpPeriodo);
    const periodoActual = periodos[periodos.length - 1];
    const promActual = (() => {
      const arr = records.filter(r => r.PERIODO === periodoActual).map(r => asNum(r.PROMEDIO)).filter(v => v !== null);
      const s = arr.reduce((a, b) => a + b, 0);
      return arr.length ? (s / arr.length) : null;
    })();

    studentHeading.textContent = `Datos Generales de ${nombre}`;
    studentInfoBody.innerHTML = `
      <tr><th style="width:160px;">Cédula</th><td>${cedula || '-'}</td><th>Nombre</th><td>${nombre || '-'}</td></tr>
      <tr><th>Correos</th><td>${correos || '-'}</td><th>Teléfonos</th><td>${telefono || '-'}</td></tr>
      <tr><th>Promedio general (${periodoActual})</th><td>${promActual !== null ? promActual.toFixed(2) : '-'}</td><th>Veces Reprobadas</th><td>${reprobadas}</td></tr>
      <tr><th>Materias Aprobadas</th><td>${aprobadas}</td><th></th><td></td></tr>
    `;

    const promsPorPeriodo = periodos.map(p => {
      const arr = records.filter(r => r.PERIODO === p).map(r => asNum(r.PROMEDIO)).filter(v => v !== null);
      return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
    });

    if (lineChart) lineChart.destroy();
    lineChart = new Chart(lineCanvas, {
      type: 'line',
      data: {
        labels: periodos,
        datasets: [{
          label: 'Promedio',
          data: promsPorPeriodo,
          spanGaps: true,
          tension: 0.3,
          borderWidth: 2,
          borderColor: 'hsl(210, 72%, 50%)',
          backgroundColor: 'hsl(210, 72%, 50%)',
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        interaction: { mode: 'dataset', intersect: false },
        hover: { mode: 'dataset', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            title: (items) => items?.[0]?.dataset?.label ?? '',
            callbacks: {
              label: (ctx) => {
                const periodo = periodos[ctx.dataIndex];
                const v = ctx.parsed.y;
                return `${periodo}: ${v ?? '-'}`;
              }
            }
          }
        },
        scales: { y: { beginAtZero: false, grace: '5%' } }
      }
    });

    const aprobadasPer = periodos.map(p => records.filter(r => r.PERIODO === p && canon(r.ESTADO) === 'APROBADA').length);
    const reprobadasPer = periodos.map(p => records.filter(r => r.PERIODO === p && canon(r.ESTADO) === 'REPROBADA').length);
    if (barsChart) barsChart.destroy();
    barsChart = new Chart(barsCanvas, {
      type: 'bar',
      data: {
        labels: periodos,
        datasets: [
          { label: 'Aprobadas', data: aprobadasPer, backgroundColor: 'hsl(210, 72%, 55%)' },
          { label: 'Reprobadas', data: reprobadasPer, backgroundColor: 'hsl(0, 72%, 60%)' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
      }
    });

    // Acordeón por período
    studentAccordion.innerHTML = '';
    [...periodos].sort(cmpPeriodo).reverse().forEach(p => {
      const rows = records.filter(r => r.PERIODO === p);
      const idx = periodos.indexOf(p);
      const prom = promsPorPeriodo[idx];
      const htmlRows = rows.map(r => `
        <tr>
          <td>${norm(r.NIVEL)}</td>
          <td>${norm(r.MATERIA)}</td>
          <td>${norm(r['GRUPO/PARALELO'])}</td>
          <td>${norm(r.DOCENTE).split(' - ').pop()}</td>
          <td>${asNum(r.PROMEDIO) ?? '-'}</td>
          <td>${norm(r['NO. VEZ'])}</td>
          <td>${norm(r.ESTADO)}</td>
        </tr>`).join('');
      const details = document.createElement('details');
      details.style.marginBottom = '10px';
      details.innerHTML = `
        <summary style="cursor:pointer;font-weight:600;">${p} — Promedio: ${prom !== null ? prom.toFixed(2) : '-'}</summary>
        <div style="overflow:auto;margin-top:8px;">
          <table class="striped">
            <thead><tr><th>Nivel</th><th>Materia</th><th>Grupo</th><th>Docente</th><th>Promedio</th><th>Vez</th><th>Estado</th></tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </div>`;
      studentAccordion.appendChild(details);
    });
  }

  function buscar() {
    const q = studentFilterInput.value.trim();
    if (!q) { reset(); return; }
    const records = pickStudentRecords(q);
    if (!records || !records.length) {
      alert('No se encontró el estudiante.');
      return;
    }
    showStudentView();
    renderStudent(records);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    studentFilterInput.value = '';
    showGeneralView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // eventos
  searchButton.addEventListener('click', buscar);
  clearButton.addEventListener('click', reset);
  studentFilterInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); if (e.key === 'Escape') reset(); });
  studentFilterInput.addEventListener('input', () => { if (studentFilterInput.value.trim() === '') showGeneralView(); });
});