// top-promedios.js
import { loadData } from '../indexeddb-storage.js';

const KEY = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';

// Cantidad esperada de materias por nivel y carrera
const nivelMateriasED  = {1:7, 2:7, 3:7, 4:6, 5:5, 6:5, 7:5, 8:5};
const nivelMateriasPAF = {1:7, 2:7, 3:7, 4:5, 5:5, 6:4, 7:4, 8:6, 9:4};

const carreras = {
  'ENTRENAMIENTO DEPORTIVO': { alias: 'ED',  niveles: nivelMateriasED  },
  'PEDAGOGÍA DE LA ACTIVIDAD FÍSICA Y DEPORTE': { alias: 'PAF', niveles: nivelMateriasPAF }
};

/* ================= Helpers ================= */
const norm = (v) => (v ?? '').toString().trim();
const asNum = (v) => {
  const n = Number((v ?? '').toString().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function groupBy(arr, fn) {
  return arr.reduce((acc, item) => {
    const key = fn(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {});
}

// Intento robusto para ordenar periodos (cae a orden alfabético desc si no reconoce patrón)
function sortPeriodosDesc(periodos) {
  // Ejemplos soportados: "2024-2025 I", "2024-2025 II", "2025-I", "2025 II", etc.
  const roman = { 'I':1, 'II':2, 'III':3, 'IV':4 };
  const parse = (p) => {
    const s = norm(p);
    // extrae años y término si existe
    const m = s.match(/(?:(\d{4})(?:\s*[-/]\s*(\d{4}))?)\s*([IVX]+|\bI{1,3}\b|\bII\b|\bIII\b)?$/i);
    if (!m) return { y1: s, y2: '', t: 0, raw: s };
    const y1 = Number(m[1]) || 0;
    const y2 = Number(m[2]) || y1;
    const tRaw = norm(m[3] || '');
    const t = roman[tRaw] || 0;
    return { y1, y2, t, raw: s };
  };
  return [...periodos].sort((a, b) => {
    const A = parse(a), B = parse(b);
    return (B.y2 - A.y2) || (B.y1 - A.y1) || (B.t - A.t) || B.raw.localeCompare(A.raw);
  });
}

/* =============== Núcleo de Top Promedios (filtrado por periodo) =============== */
async function initTopPromedios() {
  const data = await loadData(KEY);
  const container = document.getElementById('top-promedios-container');
  const periodSelect = document.getElementById('periodSelect');

  if (!Array.isArray(data) || data.length === 0) {
    container.innerHTML = `<p>No hay datos disponibles.</p>`;
    return;
  }

  // 1) Construye lista de periodos únicos y ordénalos
  const periodosSet = new Set(data.map(r => norm(r["PERIODO"])).filter(Boolean));
  const periodos = sortPeriodosDesc([...periodosSet]);

  // 2) Pinta opciones en el <select>
  periodSelect.innerHTML = periodos.map(p => `<option value="${p}">${p}</option>`).join('');
  const defaultPeriodo = periodos[0]; // más reciente
  periodSelect.value = defaultPeriodo;

  // 3) Render inicial con el periodo por defecto
  renderForPeriodo(data, defaultPeriodo);

  // 4) Re-render al cambiar el periodo (no se toca el almacenamiento global)
  periodSelect.addEventListener('change', () => {
    renderForPeriodo(data, periodSelect.value);
  });
}

function renderForPeriodo(allData, periodoSeleccionado) {
  const data = allData.filter(r => norm(r["PERIODO"]) === norm(periodoSeleccionado));
  const agrupados = groupBy(data, row => norm(row["IDENTIFICACION"]));
  const resultados = {};

  for (const [id, materias] of Object.entries(agrupados)) {
    if (!materias.length) continue;

    const carrera   = norm(materias[0]["CARRERA"]);
    const nivel     = norm(materias[0]["NIVEL"]);
    const noVez     = asNum(materias[0]["NO. VEZ"]);
    const estudiante= `${norm(materias[0]["APELLIDOS"])} ${norm(materias[0]["NOMBRES"])}`;
    const correos   = [norm(materias[0]["CORREO_INSTITUCIONAL"]), norm(materias[0]["CORREO_PERSONAL"])].filter(Boolean).join('<br>');

    if (!carreras[carrera]) continue;
    const { alias, niveles } = carreras[carrera];
    const numEsperado = niveles[nivel];

    // Criterios
    if (!numEsperado || noVez !== 1) continue;
    const todasNivel = materias.every(r => norm(r["NIVEL"]) === nivel);
    if (!todasNivel) continue;
    if (materias.length !== numEsperado) continue;

    const proms = materias.map(m => asNum(m["PROMEDIO"])).filter(n => n !== null);
    if (proms.length !== numEsperado) continue;

    const promGeneral = (proms.reduce((a, b) => a + b, 0) / proms.length).toFixed(2);

    // MA / VE porcentajes desde GRUPO/PARALELO
    const grupoParalelos = materias.map(m => norm(m["GRUPO/PARALELO"]));
    const total = grupoParalelos.length;
    const maCount = grupoParalelos.filter(g => g.includes("MA")).length;
    const veCount = grupoParalelos.filter(g => g.includes("VE")).length;
    const maPorcentaje = total > 0 ? `${((maCount / total) * 100).toFixed(2)}%` : "NO REGISTRADO%";
    const vePorcentaje = total > 0 ? `${((veCount / total) * 100).toFixed(2)}%` : "NO REGISTRADO%";

    const key = `${alias} - Nivel ${nivel}`;
    (resultados[key] ||= []).push({
      id,
      nombre: estudiante,
      correo: correos,
      grupo: `<strong>MA:</strong> ${maPorcentaje}<br><strong>VE:</strong> ${vePorcentaje}`,
      promedio: promGeneral
    });
  }

  renderResultados(resultados, periodoSeleccionado);
}

function renderResultados(resultados, periodoLabel) {
  const container = document.getElementById('top-promedios-container');
  container.innerHTML = `
    <h1>Top 5 Promedios por Carrera y Nivel [${periodoLabel}]</h1>
    <p><strong>Criterios:</strong><br>
    • Deben tener todas las asignaturas que les corresponde<br>
    • No repetidores<br>
    • No materias adelantadas/atrasadas<br>
    • Corresponde por nivel dentro de malla</p>`;

  const keysOrdenadas = Object.keys(resultados).sort((a, b) => {
    const [carA, nA] = a.split(' - Nivel ').map(v => isNaN(v) ? v : Number(v));
    const [carB, nB] = b.split(' - Nivel ').map(v => isNaN(v) ? v : Number(v));
    return carA.localeCompare(carB) || (Number(nA) - Number(nB));
  });

  if (!keysOrdenadas.length) {
    container.innerHTML += `<p>No hay estudiantes que cumplan los criterios en este periodo.</p>`;
    return;
  }

  keysOrdenadas.forEach(key => {
    const lista = resultados[key];
    lista.sort((a, b) => parseFloat(b.promedio) - parseFloat(a.promedio));
    const top5 = lista.slice(0, 5);

    const tabla = `
      <h2>${key}</h2>
      <table>
        <thead>
          <tr>
            <th>Identificación</th>
            <th>Nombre</th>
            <th>Correo</th>
            <th>Grupo</th>
            <th>Promedio General</th>
          </tr>
        </thead>
        <tbody>
          ${top5.map(s => `
            <tr>
              <td data-label="Identificación">${s.id}</td>
              <td data-label="Nombre">${s.nombre}</td>
              <td data-label="Correo">${s.correo}</td>
              <td data-label="Grupo">${s.grupo}</td>
              <td data-label="Promedio General">${s.promedio}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    container.innerHTML += tabla;
  });
}

document.addEventListener('DOMContentLoaded', initTopPromedios);
