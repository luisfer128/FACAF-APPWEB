// Modules/distribucion-docente.js
import { loadData } from '../indexeddb-storage.js';

const DAYS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO']; // Domingo no usado
const START_TIME = '07:00';
const END_TIME   = '22:00';
const SLOT_MIN   = 30; // minutos por intervalo

// DOM
const docenteInput = document.getElementById('docenteInput');
const docenteDropdown = document.getElementById('docenteDropdown');
const clearBtn = document.getElementById('clearBtn');
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

// ==================== AUTOCOMPLETADO ========================================
let allDocentes = [];
let selectedTeacher = '';
let currentHighlighted = -1;

function filterDocentes(query) {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return allDocentes.filter(doc => 
    doc.toLowerCase().includes(q)
  ).slice(0, 10); // Máximo 10 resultados
}

function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<span class="highlight-match">$1</span>');
}

function showDropdown(matches) {
  docenteDropdown.innerHTML = '';
  const query = docenteInput.value.trim();
  
  if (matches.length === 0) {
    docenteDropdown.classList.remove('show');
    return;
  }

  matches.forEach((docente, index) => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.innerHTML = highlightMatch(docente, query);
    item.setAttribute('data-docente', docente);
    item.setAttribute('data-index', index);
    
    // Event listener para click
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectTeacher(docente);
    });
    
    // Event listener para hover
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll('.dropdown-item.highlighted').forEach(el => {
        el.classList.remove('highlighted');
      });
      item.classList.add('highlighted');
      currentHighlighted = index;
    });
    
    docenteDropdown.appendChild(item);
  });

  docenteDropdown.classList.add('show');
}

function hideDropdown() {
  docenteDropdown.classList.remove('show');
  currentHighlighted = -1;
}

function selectTeacher(teacher) {
  selectedTeacher = teacher;
  docenteInput.value = teacher;
  hideDropdown();
  loadTeacherSchedule(teacher);
  // Remover cualquier estilo de error
  docenteInput.style.borderColor = '';
}

function updateHighlight(items) {
  items.forEach((item, index) => {
    if (index === currentHighlighted) {
      item.classList.add('highlighted');
    } else {
      item.classList.remove('highlighted');
    }
  });
}

function validateAndLoadTeacher() {
  const inputValue = docenteInput.value.trim();
  if (!inputValue) {
    showHeatMap();
    return;
  }

  // Verificar si es un nombre exacto
  const exactMatch = allDocentes.find(doc => 
    doc.toLowerCase() === inputValue.toLowerCase()
  );

  if (exactMatch) {
    selectTeacher(exactMatch);
  } else {
    // Si no es exacto, mostrar mensaje o limpiar
    docenteInput.style.borderColor = '#e74c3c';
    setTimeout(() => {
      docenteInput.style.borderColor = '';
    }, 2000);
  }
}

function clearSelection() {
  docenteInput.value = '';
  selectedTeacher = '';
  hideDropdown();
  showHeatMap();
}

function showHeatMap() {
  if (heatBody.children.length > 0) {
    heatWrap.style.display = '';
    heatLegend.style.display = '';
  }
  schedWrap.style.display = 'none';
  teacherHeader.style.display = 'none';
  teacherSub.style.display = 'none';
}

function loadTeacherSchedule(teacher) {
  // Ocultar heatmap
  heatWrap.style.display = 'none';
  heatLegend.style.display = 'none';

  // Cargar horario del docente (reutilizando la función existente)
  const M = buildTeacherMatrixUnified(dataClases || [], dataActiv || [], teacher);
  renderTeacherTableUnified(M, teacher);
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

// Variables globales para los datos
let dataClases = [];
let dataActiv = [];

// ==================== INIT ===================================================
(async function init(){
  goMenuBtn?.addEventListener('click', () => window.location.href = '../index.html');

  // Cargar datasets
  showOverlay('Cargando datos...');
  [dataClases, dataActiv] = await Promise.all([ loadClasesData(), loadActividadesData() ]);
  hideOverlay();

  // Heatmap global (si hay datos de clases)
  if (Array.isArray(dataClases) && dataClases.length){
    const { counts, max, times } = buildHeatCounts(dataClases);
    renderHeatTable({ counts, max, times });
  } else {
    heatWrap.style.display = 'none';
    heatLegend.style.display = 'none';
  }

  // Recopilar todos los docentes
  allDocentes = Array.from(new Set([
    ...((dataClases||[]).map(r => norm(r.DOCENTE)).filter(Boolean)),
    ...((dataActiv ||[]).map(r => norm(r.DOCENTE)).filter(Boolean)),
  ])).sort((a,b)=>a.localeCompare(b));

  // Event listeners mejorados para el autocompletado
  docenteInput.addEventListener('input', (e) => {
    const query = e.target.value;
    if (query.trim()) {
      const matches = filterDocentes(query);
      showDropdown(matches);
      currentHighlighted = -1; // Reset highlight
    } else {
      hideDropdown();
      showHeatMap();
    }
  });

  docenteInput.addEventListener('keydown', (e) => {
    const items = docenteDropdown.querySelectorAll('.dropdown-item');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        currentHighlighted = Math.min(currentHighlighted + 1, items.length - 1);
        updateHighlight(items);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        currentHighlighted = Math.max(currentHighlighted - 1, 0);
        updateHighlight(items);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentHighlighted >= 0 && items[currentHighlighted]) {
        const selectedDocente = items[currentHighlighted].getAttribute('data-docente');
        selectTeacher(selectedDocente);
      } else {
        hideDropdown();
        validateAndLoadTeacher();
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  docenteInput.addEventListener('blur', (e) => {
    // Solo ocultar si realmente perdemos el foco
    setTimeout(() => {
      if (!docenteDropdown.matches(':hover') && !docenteDropdown.contains(document.activeElement)) {
        hideDropdown();
        if (docenteInput.value.trim()) {
          validateAndLoadTeacher();
        }
      }
    }, 200);
  });

  // Prevenir que el dropdown se cierre al hacer click en él
  docenteDropdown.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  clearBtn?.addEventListener('click', clearSelection);

  // Click fuera para cerrar dropdown
  document.addEventListener('click', (e) => {
    if (!docenteInput.contains(e.target) && !docenteDropdown.contains(e.target)) {
      hideDropdown();
    }
  });
})();