// tercera-matricula.js
import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

/* ===========================
 * Utils básicos
 * =========================== */
const norm = (s) => (s ?? '').toString().trim();
const asNum = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const canon = (s) =>
  norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const KEY_POR_SEMESTRE  = 'academicTrackingData_REPORTE_POR_SEMESTRE';
const KEY_PARCIAL_TOTAL = 'academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx';

function getPeriodoAnterior(periodo) {
  const match = String(periodo).match(/(\d{4})\s*-\s*(\d{4})\s+(CI{1,2})/);
  if (!match) return null;
  const y1 = parseInt(match[1]);
  const y2 = parseInt(match[2]);
  const ciclo = match[3];
  return (ciclo === 'CII') ? `${y1} - ${y2} CI` : `${y1 - 1} - ${y2 - 1} CII`;
}

function docenteFrom(raw) {
  const d = norm(raw);
  const parts = d.split(' - ');
  return parts.length === 2 ? norm(parts[1]) : d;
}

function buildKey(id, materia) {
  return `${id}||${materia}`;
}

/* ===========================
 * UI helpers (SweetAlert2 + fallback)
 * =========================== */
function showLoading(title = 'Enviando correos...') {
  if (window.Swal) {
    Swal.fire({
      title,
      html: 'Esto puede tardar unos segundos.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => { Swal.showLoading(); }
    });
  } else {
    createLoadingOverlay(title);
  }
}
function hideLoading() {
  if (window.Swal && Swal.isVisible()) Swal.close();
  else removeLoadingOverlay();
}
function showModal({ icon = 'info', title = '', html = '', timer = null }) {
  if (window.Swal) {
    return Swal.fire({ icon, title, html, timer, showConfirmButton: !timer });
  } else {
    alert(stripHtml(`${title}\n\n${html}`));
    return Promise.resolve();
  }
}
function stripHtml(s = '') {
  const tmp = document.createElement('div'); tmp.innerHTML = s;
  return tmp.textContent || tmp.innerText || '';
}
function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
// Fallback overlay si no hay SweetAlert2
function createLoadingOverlay(text) {
  if (document.getElementById('email-loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'email-loading-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 99999; color: #fff; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
  `;
  overlay.innerHTML = `
    <div style="padding: 18px 22px; background: rgba(0,0,0,.65); border-radius: 10px; text-align:center; min-width: 260px">
      <div class="spinner" style="width:36px;height:36px;border:4px solid #fff;border-top-color:transparent;border-radius:50%;margin:0 auto 12px;animation:spin 1s linear infinite"></div>
      <div>${escapeHtml(text)}</div>
    </div>
  `;
  const style = document.createElement('style'); style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
  overlay.appendChild(style);
  document.body.appendChild(overlay);
}
function removeLoadingOverlay() {
  const el = document.getElementById('email-loading-overlay'); if (el) el.remove();
}

/* ===========================
 * Carga de docentes (detalle)
 * =========================== */
async function loadDocentesDetalle() {
  const keys = [
    'academicTrackingData_REPORTE_DETALLADO_DOCENTES_xlsx',
    'REPORTE_DETALLADO_DOCENTES',
    'academicTrackingData_REPORTE_DETALLADO_DOCENTES',
  ];
  for (const k of keys) {
    const data = await loadData(k);
    if (Array.isArray(data) && data.length) return data;
  }
  console.warn('⚠️ No se encontró REPORTE_DETALLADO_DOCENTES en IndexedDB');
  return [];
}

/* ===========================
 * Detección de docentes faltantes / sin correo (como en nee-control)
 * =========================== */
// Set de nombres canónicos presentes en el excel (prueba varias columnas/combos)
function buildDocentesExcelSet(docentesExcel) {
  const set = new Set();
  for (const r of docentesExcel || []) {
    const nombres   = norm(r["NOMBRES"]);
    const apellidos = norm(r["APELLIDOS"]);
    const docente   = norm(r["DOCENTE"]) || norm(r["Nombre Docente"]) || norm(r["NOMBRE"]);
    const combos = new Set([
      nombres,
      apellidos,
      docente,
      apellidos && nombres ? `${apellidos} ${nombres}` : '',
      nombres && apellidos ? `${nombres} ${apellidos}` : ''
    ]);
    for (const c of combos) if (c) set.add(canon(c));
  }
  return set;
}

// Extrae el nombre dentro del paréntesis de "[Vez] Materia (Docente: Paralelo)"
function extractDocentesFromSelected(students) {
  const docentes = new Set();
  for (const s of students || []) {
    const arr = Array.isArray(s["[Vez] Materia (Docente)"]) ? s["[Vez] Materia (Docente)"] : [s["[Vez] Materia (Docente)"]];
    for (const m of (arr || [])) {
      const inside = String(m).match(/\(([^)]+)\)/)?.[1] || '';
      const nombre = inside.split(':')[0]?.trim();
      if (nombre) docentes.add(nombre);
    }
  }
  return Array.from(docentes);
}

function computeMissingDocentes(selected, docentesExcel) {
  const excelSet = buildDocentesExcelSet(docentesExcel);
  const docentesEnviados = extractDocentesFromSelected(selected);
  const missing = docentesEnviados.filter(n => !excelSet.has(canon(n)));
  return missing.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

// Utilidades para “sin correo”
function getDocenteIdFromRow(r) {
  const idKeys = ["IDENTIFICACION","IDENTIFICACIÓN","CI","CEDULA","CÉDULA","DOCUMENTO","Documento"];
  for (const k of idKeys) { const v = norm(r[k]); if (v) return v; }
  return '';
}
function getEmailFromRow(r) {
  const emailKeys = ["CORREO_SIUG","CORREO INSTITUCIONAL","CORREO","EMAIL","MAIL","E-MAIL"];
  for (const k of emailKeys) { const v = norm(r[k]); if (v) return v; }
  return '';
}
function rowNameCandidates(r) {
  const nombres   = norm(r["NOMBRES"]);
  const apellidos = norm(r["APELLIDOS"]);
  const docente   = norm(r["DOCENTE"]) || norm(r["Nombre Docente"]) || norm(r["NOMBRE"]);
  return [docente, apellidos && nombres ? `${apellidos} ${nombres}` : '', nombres && apellidos ? `${nombres} ${apellidos}` : '', nombres, apellidos]
    .filter(Boolean);
}
function rowsMatchNombre(rows, docenteName) {
  const target = canon(docenteName);
  return rows.filter(r => rowNameCandidates(r).some(c => canon(c) === target));
}
function computeNoEmailDocentesMessages(selected, docentesExcel) {
  const docentes = extractDocentesFromSelected(selected);
  const messages = new Set();
  for (const nombre of docentes) {
    const matches = rowsMatchNombre(docentesExcel, nombre);
    if (matches.length === 0) continue; // los no-encontrados se manejan aparte
    const hasAnyEmail = matches.some(getEmailFromRow);
    if (!hasAnyEmail) {
      // si hay varias filas, toma el primer ID no vacío
      let id = '';
      for (const r of matches) { id = getDocenteIdFromRow(r); if (id) break; }
      messages.add(
        id
          ? `Sin correo para docente con IDENTIFICACION "${id}" en REPORTE_DETALLADO_DOCENTES`
          : `Sin correo para docente "${nombre}" en REPORTE_DETALLADO_DOCENTES`
      );
    }
  }
  return Array.from(messages).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/* ===========================
 * Construcción de filas (igual a tu código)
 * =========================== */
async function buildRows() {
  const semestre = await loadData(KEY_POR_SEMESTRE);
  const calificaciones = await loadData(KEY_PARCIAL_TOTAL);
  if (!Array.isArray(semestre) || !Array.isArray(calificaciones)) return [];

  const periodoActual = norm(semestre[0]?.PERIODO);
  const periodoAnterior = getPeriodoAnterior(periodoActual);

  const periodLabel = document.getElementById("current-period-label");
  if (periodLabel) periodLabel.textContent = `📅 Periodo actual: ${periodoActual}`;
  if (!periodoAnterior) return [];

  const anteriores = new Map();
  const actuales = new Set();

  for (const row of calificaciones) {
    const id = norm(row["IDENTIFICACION"]);
    const materia = norm(row["MATERIA"]);
    const periodo = norm(row["PERIODO"]);
    const noVez = asNum(row["NO. VEZ"]);
    const promedio = asNum(row["PROMEDIO"]);
    if (!id || !materia || !periodo || noVez === null) continue;

    const key = buildKey(id, materia);

    if (periodo === periodoAnterior && noVez === 2 && promedio < 7) {
      anteriores.set(key, row);
    }
    if (periodo === periodoActual && noVez === 3) {
      actuales.add(key);
    }
  }

  const resultado = [];
  for (const [key, row] of anteriores.entries()) {
    if (!actuales.has(key)) {
      const id = norm(row["IDENTIFICACION"]);
      const nombre = `${norm(row["APELLIDOS"])} ${norm(row["NOMBRES"]).trim()}`;
      const correo = [norm(row["CORREO_INSTITUCIONAL"]), norm(row["CORREO_PERSONAL"])].filter(Boolean).join('; ');
      const nivel   = norm(row["NIVEL"]);
      const materia = norm(row["MATERIA"]);
      const docente = docenteFrom(row["DOCENTE"]);

      resultado.push({
        _key: key,
        Identificacion: id,
        Estudiante: nombre,
        Correo: correo,
        Nivel: nivel,
        Materia: materia,
        Docente: docente,
        '[Vez] Materia (Docente)': `[2] ${materia} (${docente})`
      });
    }
  }

  resultado.sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));
  return resultado;
}

/* ===========================
 * Render de tabla (igual a tu código)
 * =========================== */
function renderTable(rows) {
  const tbody = document.getElementById('academicTrackingTableBody');
  const totalSpan = document.getElementById('total-students');
  const totalStu = document.getElementById('total-materia');
  if (!tbody) return;

  tbody.innerHTML = '';

  // 🔹 Set para estudiantes únicos
  const uniqueStudents = new Set();

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.insertCell().textContent = r.Identificacion;
    tr.insertCell().textContent = r.Estudiante;
    tr.insertCell().textContent = r.Correo;
    tr.insertCell().textContent = r.Nivel;
    tr.insertCell().textContent = r.Materia;

    const cbCell = tr.insertCell();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.key = r._key;
    cbCell.appendChild(cb);

    tbody.appendChild(tr);

    // 🔹 Agregamos al Set
    uniqueStudents.add(r.Identificacion);
  });

  if (totalSpan) totalSpan.textContent = `Total de Registros: ${rows.length}`;
  if (totalStu) totalStu.textContent = `Total de Estudiantes: ${uniqueStudents.size}`;
}


/* ===========================
 * Main
 * =========================== */
document.addEventListener('DOMContentLoaded', async () => {
  const filterInput = document.getElementById('filterAcademicInput');
  const backBtn     = document.getElementById('goToMenuButton');
  const sendBtn     = document.getElementById('sendAcademicEmails');

  let allRows = await buildRows();
  renderTable(allRows);

  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    const filtered = allRows.filter(r =>
      [r.Identificacion, r.Estudiante, r.Correo, r.Nivel, r.Materia]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    );
    renderTable(filtered);
  });

  // ===== Envío (similar a nee-control pero usando enviarCorreos del emailModule) =====
  sendBtn?.addEventListener('click', async () => {
    // Seleccionados
    const selected = [];
    document
      .querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked')
      .forEach(cb => {
        const key = cb.dataset.key;
        const row = allRows.find(r => r._key === key);
        if (row) selected.push(row);
      });

    if (!selected.length) {
      await showModal({ icon: 'info', title: 'Sin selección', html: 'Selecciona al menos un registro para enviar correos.' });
      return;
    }

    // Normaliza estructura esperada por emailModule (array en "[Vez] Materia (Docente)" + flag enviar)
    const payload = selected.map(r => ({
      ...r,
      enviar: true,
      "[Vez] Materia (Docente)": Array.isArray(r["[Vez] Materia (Docente)"])
        ? r["[Vez] Materia (Docente)"].filter(Boolean)
        : [r["[Vez] Materia (Docente)"]].filter(Boolean)
    }));

    // Carga detalle de docentes para cruce
    const docentesExcel = await loadDocentesDetalle();

    // Cálculo local (fallback) para mostrar modales como en nee-control
    const expectedMissing = computeMissingDocentes(payload, docentesExcel);
    const expectedNoEmail = computeNoEmailDocentesMessages(payload, docentesExcel);

    showLoading('Enviando correos...');

    try {
      // Enviar usando tu módulo
      const result = await enviarCorreos(payload, docentesExcel);
      hideLoading();

      // Modal de éxito
      await showModal({
        icon: 'success',
        title: 'Correos enviados correctamente',
        html: '',
        timer: 1400
      });

      // Si tu emailModule devolviera arrays, se priorizan; si no, usamos los calculados
      const missingDocentes = Array.isArray(result?.missingDocentes) && result.missingDocentes.length
        ? result.missingDocentes
        : expectedMissing;

      const noEmailMessages = Array.isArray(result?.noEmailMessages) && result.noEmailMessages.length
        ? result.noEmailMessages
        : expectedNoEmail;

      if (missingDocentes.length) {
        const listHtml = `<ul style="text-align:left;margin:0;padding-left:18px">${missingDocentes
          .map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`;
        await showModal({
          icon: 'warning',
          title: 'Los siguientes docentes no figuran en Detalle Docente:',
          html: listHtml
        });
      }

      if (noEmailMessages.length) {
        const listHtml = `<ul style="text-align:left;margin:0;padding-left:18px">${noEmailMessages
          .map(msg => `<li>${escapeHtml(msg)}</li>`).join('')}</ul>`;
        await showModal({
          icon: 'warning',
          title: 'Correos no enviados por falta de email en REPORTE_DETALLADO_DOCENTES:',
          html: listHtml
        });
      }

    } catch (err) {
      hideLoading();
      await showModal({
        icon: 'error',
        title: 'Error al enviar correos',
        html: `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(err?.message || String(err))}</pre>`
      });
    }
  });

  backBtn?.addEventListener('click', () => { window.location.href = '../index.html'; });
});
