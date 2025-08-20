// Modules/distribucion-docente.js
import { loadData } from '../indexeddb-storage.js';

const DAYS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO']; // Domingo no usado
const START_TIME = '07:00';
const END_TIME   = '22:00';
const SLOT_MIN   = 30; // minutos por intervalo

// DOM
const docenteSelect = document.getElementById('docenteSelect');
const heatWrap   = document.getElementById('heatWrap');
const heatLegend = document.getElementById('heatLegend');
const heatBody   = document.getElementById('heatBody');
const schedBody  = document.getElementById('schedBody');
const schedWrap  = document.getElementById('schedWrap');
const teacherHeader = document.getElementById('teacherHeader');
const teacherTitle  = document.getElementById('teacherTitle');
const teacherSub    = document.getElementById('teacherSub');
const chipClassHours= document.getElementById('chipClassHours');
const chipActHours  = document.getElementById('chipActHours');
const goMenuBtn = document.getElementById('goMenu');

const overlay = document.getElementById('loading-overlay');
const showOverlay = (msg='Procesando...') => {
  if (overlay) {
    overlay.style.display = 'flex';
    const s = overlay.querySelector('.loading-spinner');
    if (s) s.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`;
  }
};
const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

const norm = v => (v ?? '').toString().trim();

// === Claves de IndexedDB (como las guarda index.js) ==========================
const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");
const KEY_CLASES = 'academicTrackingData_' + normalizeFileName('REPORTE_NOMINA_CARRERA_DOCENTES_MATERIA_+_HORARIOS.xlsx');
const KEY_ACTIV  = 'academicTrackingData_' + normalizeFileName('REPORTE_DOCENTES_HORARIOS_DISTRIBITIVO.xlsx');

// Búsqueda flexible por si cambia un poco el nombre
async function loadFromGuess(regex) {
  const processed = await loadData('processedFiles');
  if (Array.isArray(processed)) {
    const hit = processed.find(n => regex.test(n));
    if (hit) {
      const key = 'academicTrackingData_' + normalizeFileName(hit);
      const data = await loadData(key);
      if (Array.isArray(data) && data.length) return data;
    }
  }
  return [];
}

// Data sources
async function loadClasesData(){
  let data = await loadData(KEY_CLASES);
  if (Array.isArray(data) && data.length) return data;
  return await loadFromGuess(/NOMINA.*DOCENTES.*HORARIOS/i);
}
async function loadActividadesData(){
  let data = await loadData(KEY_ACTIV);
  if (Array.isArray(data) && data.length) return data;
  return await loadFromGuess(/DOCENTES.*HORARIOS.*DISTRIB/i);
}

// Utilidades de tiempo
function toMinutes(hhmm){
  const [h,m] = hhmm.split(':').map(Number);
  return (h*60 + (m||0));
}
function* slotsRange(startHHMM, endHHMM, stepMin = SLOT_MIN) {
  let t = toMinutes(startHHMM), end = toMinutes(endHHMM);
  for (; t < end; t += stepMin) yield t;
}
function minutesToLabel(min){
  const h = Math.floor(min/60), m = min%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function parseRanges(cell){
  // "08:00 - 10:00" ; "09:00-10:30" ; múltiples separados por ',' o ';'
  const s = norm(cell);
  if (!s) return [];
  return s.split(/[;,]/).map(x => x.trim()).filter(Boolean).map(part => {
    const m = part.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!m) return null;
    let a = m[1]; let b = m[2];
    if (a.length < 5) a = a.padStart(5,'0');
    if (b.length < 5) b = b.padStart(5,'0');
    return {start: a, end: b};
  }).filter(Boolean);
}

// Paleta del heatmap (verde->rojo)
function colorFor(value, max){
  const t = (max<=0)?0 : Math.max(0, Math.min(1, value / max));
  const hue = 120 * (1 - t); // 120 (verde) -> 0 (rojo)
  return `hsl(${hue} 60% 45%)`;
}

// Eje de tiempo
function buildTimeAxis(){
  const out = [];
  for (let m = toMinutes(START_TIME); m <= toMinutes(END_TIME); m += SLOT_MIN){
    out.push(minutesToLabel(m));
  }
  return out;
}

// ==================== HEATMAP (CLASES) ======================================
function buildHeatCounts(data) {
  const times = buildTimeAxis();
  const counts = {}; // counts[slotLabel][day] = n
  times.forEach(t => { counts[t] = {}; DAYS.forEach(d => counts[t][d] = 0); });

  for (const row of data) {
    for (const day of DAYS) {
      const ranges = parseRanges(row?.[day]);
      for (const rr of ranges){
        for (const t of slotsRange(rr.start, rr.end, SLOT_MIN)){
          const label = minutesToLabel(t);
          if (counts[label]) counts[label][day] += 1;
        }
      }
    }
  }

  let max = 0;
  for (const t of times){ for (const day of DAYS){ if (counts[t][day] > max) max = counts[t][day]; } }
  return { counts, max, times };
}

function renderHeatTable({ counts, max, times }){
  heatBody.innerHTML = '';
  for (let i=0; i<times.length-1; i++){
    const t = times[i];
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.textContent = t; tr.appendChild(th);

    for (const day of DAYS){
      const v = counts[t][day] || 0;
      const td = document.createElement('td');
      const div = document.createElement('div');
      div.className = 'cell';
      div.style.background = colorFor(v, max);
      div.style.color = '#fff';
      div.textContent = String(v);
      td.appendChild(div);
      tr.appendChild(td);
    }
    heatBody.appendChild(tr);
  }
}

// ==================== HORARIO UNIFICADO POR DOCENTE =========================
// Devuelve matrix[slot][day] = { classes:[...], acts:[...] } y totales de horas
function buildTeacherMatrixUnified(dataClases, dataActiv, teacher){
  const times = buildTimeAxis();
  const matrix = {};
  times.forEach(t => { matrix[t] = {}; DAYS.forEach(d => matrix[t][d] = { classes: [], acts: [] }); });

  // CLASES
  const rowsC = (dataClases||[]).filter(r => norm(r.DOCENTE).toUpperCase() === norm(teacher).toUpperCase());
  for (const r of rowsC){
    const subj  = norm(r.MATERIA);
    const aula  = norm(r.AULA);
    const grupo = norm(r.GRUPO);
    for (const day of DAYS){
      const ranges = parseRanges(r?.[day]);
      for (const rr of ranges){
        for (const t of slotsRange(rr.start, rr.end, SLOT_MIN)){
          const label = minutesToLabel(t);
          matrix[label][day].classes.push({ subj, aula, grupo });
        }
      }
    }
  }

  // ACTIVIDADES (omitir HABILITADO=NO)
  const rowsA = (dataActiv||[]).filter(r =>
    norm(r.DOCENTE).toUpperCase() === norm(teacher).toUpperCase() &&
    norm(r.HABILITADO).toUpperCase() !== 'NO'
  );
  for (const r of rowsA){
    const gestion   = norm(r.GESTIONES_VARIAS) || 'GESTIONES VARIAS';
    const actividad = norm(r.ACTIVIDADES);
    for (const day of DAYS){
      const ranges = parseRanges(r?.[day]);
      for (const rr of ranges){
        for (const t of slotsRange(rr.start, rr.end, SLOT_MIN)){
          const label = minutesToLabel(t);
          matrix[label][day].acts.push({ gestion, actividad });
        }
      }
    }
  }

  // ====== Cálculo de horas (deduplicado por slot por tipo) ======
  let classSlots = 0, actSlots = 0;
  for (let i=0; i<times.length-1; i++){
    const t = times[i];
    for (const day of DAYS){
      if (matrix[t][day].classes.length > 0) classSlots += 1;
      if (matrix[t][day].acts.length    > 0) actSlots   += 1;
    }
  }
  const slotHours = SLOT_MIN / 60;         // 0.5 si SLOT_MIN=30
  const hoursClass = classSlots * slotHours;
  const hoursAct   = actSlots   * slotHours;

  return { matrix, times, hoursClass, hoursAct };
}

function fmtHours(h){
  // Formato bonito: enteros como "9H"; medios como "9.5H"
  const rounded = Math.round(h * 2) / 2; // a pasos de 0.5
  return (Number.isInteger(rounded)) ? `${rounded}H` : `${rounded.toFixed(1)}H`;
}

function renderTeacherTableUnified({ matrix, times, hoursClass, hoursAct }, teacher){
  // Cabecera y chips
  teacherHeader.style.display = '';
  teacherSub.style.display    = '';
  teacherTitle.textContent    = teacher;
  chipClassHours.textContent  = fmtHours(hoursClass);
  chipActHours.textContent    = fmtHours(hoursAct);

  // Tabla
  schedWrap.style.display = '';
  schedBody.innerHTML = '';

  for (let i=0; i<times.length-1; i++){
    const t = times[i];
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.textContent = t; tr.appendChild(th);

    for (const day of DAYS){
      const info = matrix[t][day];
      const td = document.createElement('td');
      const div = document.createElement('div');
      const hasAny = (info.classes.length + info.acts.length) > 0;

      div.className = 'slot' + (hasAny ? ' busy' : '');

      if (hasAny){
        // CLASES
        for (const c of info.classes){
          const block = document.createElement('div');
          block.className = 'row';
          block.innerHTML = `
            <span class="tag class">CLASE</span>
            <div class="subj">${c.subj || 'Clase'}</div>
            <div class="meta">
              ${c.grupo ? `Grupo: ${c.grupo}` : ''}${c.grupo && c.aula ? ' · ' : ''}${c.aula ? `Aula: ${c.aula}` : ''}
            </div>
          `;
          div.appendChild(block);
        }
        // ACTIVIDADES
        for (const a of info.acts){
          const block = document.createElement('div');
          block.className = 'row';
          block.innerHTML = `
            <span class="tag act">GESTIONES_VARIAS</span>
            <div class="subj">${a.gestion}</div>
            ${a.actividad ? `<div class="meta">Actividad: ${a.actividad}</div>` : ''}
          `;
          div.appendChild(block);
        }
      } else {
        div.textContent = ''; // libre
      }

      td.appendChild(div);
      tr.appendChild(td);
    }
    schedBody.appendChild(tr);
  }
}

// ==================== INIT ===================================================
(async function init(){
  goMenuBtn?.addEventListener('click', () => window.location.href = '../index.html');

  // Cargar datasets
  showOverlay('Cargando datos...');
  const [dataClases, dataActiv] = await Promise.all([ loadClasesData(), loadActividadesData() ]);
  hideOverlay();

  // Heatmap global (si hay datos de clases)
  if (Array.isArray(dataClases) && dataClases.length){
    const { counts, max, times } = buildHeatCounts(dataClases);
    renderHeatTable({ counts, max, times });
  } else {
    heatWrap.style.display = 'none';
    heatLegend.style.display = 'none';
  }

  // Poblar combo con unión de docentes de ambos archivos
  const docentes = Array.from(new Set([
    ...((dataClases||[]).map(r => norm(r.DOCENTE)).filter(Boolean)),
    ...((dataActiv ||[]).map(r => norm(r.DOCENTE)).filter(Boolean)),
  ])).sort((a,b)=>a.localeCompare(b));

  docenteSelect.innerHTML = `<option value="">-- MAPA DE CALOR --</option>` +
    docentes.map(d => `<option value="${d}">${d}</option>`).join('');

  // Selección de docente
  docenteSelect.addEventListener('change', () => {
    const teacher = docenteSelect.value;

    if (!teacher){
      // Sin selección -> mostrar heatmap si hay
      if (Array.isArray(dataClases) && dataClases.length){
        heatWrap.style.display   = '';
        heatLegend.style.display = '';
      }
      schedWrap.style.display    = 'none';
      teacherHeader.style.display= 'none';
      teacherSub.style.display   = 'none';
      return;
    }

    // Con docente, ocultar heatmap/leyenda
    heatWrap.style.display   = 'none';
    heatLegend.style.display = 'none';

    const M = buildTeacherMatrixUnified(dataClases||[], dataActiv||[], teacher);
    renderTeacherTableUnified(M, teacher);
  });

  // (Opcional) precargar el primero:
  // if (docentes.length) { docenteSelect.value = docentes[0]; docenteSelect.dispatchEvent(new Event('change')); }
})();
