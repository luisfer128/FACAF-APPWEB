// seguimiento-reprobados.js (aplica el mismo flujo de envío)
import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

const norm = (s) => (s ?? '').toString().trim();
const asNum = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const KEY_REPORTE = 'academicTrackingData_REPORTE_POR_SEMESTRE';
const KEY_NOMINA  = 'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx';

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
// Fallback overlay
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
 * Carga Detalle Docentes (para cruce)
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
 * Detección de docentes faltantes / sin correo
 * (idéntico a nee-control / seguimiento-academico)
 * =========================== */
const canon = (s) =>
  norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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
 * Build rows (tu lógica original)
 * =========================== */
async function buildRows() {
  const datosNotas  = await loadData(KEY_REPORTE);
  const datosNomina = await loadData(KEY_NOMINA);
  if (!Array.isArray(datosNotas) || !Array.isArray(datosNomina)) return [];

  const mapaNEE = new Map();
  for (const r of datosNomina) {
    const id = norm(r["IDENTIFICACION"]);
    const disc = norm(r["DISCAPACIDAD"]);
    const pct  = norm(r["PORCENTAJE DISCAPACIDAD"]);
    if (id) mapaNEE.set(id, disc ? `${disc}${pct ? ` (${pct}%)` : ''}` : '');
  }

  const rows = [];
  for (const row of datosNotas) {
    const id = norm(row["IDENTIFICACION"]);
    if (!id) continue;

    const estado = norm(row["ESTADO"]);
    if (estado !== "REPROBADO") {
      const p1 = asNum(row["PRIMER_PARCIAL"]);
      const p2 = asNum(row["SEGUNDO_PARCIAL"]);
      const a1 = asNum(row["ASISTENCIA_PRIMER_PARCIAL"]);
      const a2 = asNum(row["ASISTENCIA_SEGUNDO_PARCIAL"]);

      const p1Bad = p1 !== null && p1 < 4;
      const p2Bad = p2 !== null && p2 < 4;
      const a1Bad = a1 !== null && a1 < 40;
      const a2Bad = a2 !== null && a2 < 40;

      if (!p1Bad && !p2Bad && !a1Bad && !a2Bad) continue;
    }

    const noVez   = asNum(row["NO. VEZ"]);
    const tieneNEE = mapaNEE.has(id) && mapaNEE.get(id);
    if (!tieneNEE && (noVez === null || noVez < 2)) continue;
    if (tieneNEE && (noVez === null || noVez < 1)) continue;

    const promParc = asNum(row["PROMEDIO_PARCIALES"]);
    const recup    = asNum(row["RECUPERACION"]);
    const mejor    = asNum(row["MEJORAMIENTO"]);
    const extra    = recup ?? mejor;

    const parcialFinal = `${promParc ?? '-'} / ${extra ?? '-'}`;

    const materia = norm(row["MATERIA"]);
    const docente = norm(row["DOCENTE"]);
    const vez     = `[${noVez}] ${materia}${docente ? ` (${docente})` : ''}`;

    rows.push({
      _key: `${id}||${materia}`,
      Identificación: id,
      Estudiante: `${norm(row["APELLIDOS"])} ${norm(row["NOMBRES"])}`,
      Correo: [norm(row["CORREO_INSTITUCIONAL"]), norm(row["CORREO_PERSONAL"])].filter(Boolean).join('; '),
      NEE: tieneNEE ? mapaNEE.get(id) : '',
      Nivel: norm(row["NIVEL"]),
      "[Vez] Materia (Docente)": vez,
      "Parcial Final/[Mejor/Recup]": parcialFinal,
      Promedio: asNum(row["PROMEDIO"])?.toFixed(2) ?? '-',
      Estado: '💀',
    });
  }

  return rows;
}

/* ===========================
 * Render tabla (tu lógica)
 * =========================== */
function renderTable(rows) {
  const tbody    = document.getElementById('academicTrackingTableBody');
  const totalSpan= document.getElementById('total-materia');
  const totalStu = document.getElementById('total-students');
  const resumen  = document.getElementById('estado-resumen');
  if (!tbody) return;

  tbody.innerHTML = '';
  let skullCount = 0;

  // 🔹 Set para contar estudiantes únicos
  const uniqueStudents = new Set();

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.insertCell().textContent = r.Identificación;
    tr.insertCell().textContent = r.Estudiante;
    tr.insertCell().textContent = r.Correo;
    tr.insertCell().textContent = r.NEE;
    tr.insertCell().textContent = r.Nivel;
    tr.insertCell().textContent = r["[Vez] Materia (Docente)"];
    tr.insertCell().textContent = r["Parcial Final/[Mejor/Recup]"];
    tr.insertCell().textContent = r.Promedio;
    tr.insertCell().textContent = r.Estado;

    const cbCell = tr.insertCell();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.key = r._key;
    cbCell.appendChild(cb);

    tbody.appendChild(tr);
    skullCount++;

    // 🔹 Agregamos al set el ID del estudiante
    uniqueStudents.add(r.Identificación);
  });

  if (totalSpan) totalSpan.textContent = `Total de Materias: ${rows.length}`;
  if (totalStu) totalStu.textContent   = `Total de Estudiantes: ${uniqueStudents.size}`;
  if (resumen) {
    resumen.innerHTML = `<span class="count-badge count-badge--skull">${skullCount} 💀</span>`;
  }
}


/* ===========================
 * Main
 * =========================== */
document.addEventListener('DOMContentLoaded', async () => {
  const filterInput = document.getElementById('filterAcademicInput');
  const sendBtn     = document.getElementById('sendAcademicEmails');
  const backBtn     = document.getElementById('goToMenuButton');
  const periodLabel = document.getElementById("current-period-label");
  const periodoData = await loadData(KEY_REPORTE);

  if (periodLabel && Array.isArray(periodoData) && periodoData.length > 0) {
    const primerPeriodo = periodoData.find(row => row["PERIODO"]);
    if (primerPeriodo) {
      periodLabel.textContent = `📅 Periodo actual: ${primerPeriodo["PERIODO"]}`;
    }
  }

  let allRows = await buildRows();

  // ⬇️ NUEVO: mostrar únicamente Promedio < 7 (descarta '-' o valores nulos)
  allRows = allRows.filter(r => {
    const p = asNum(r.Promedio);
    return p !== null && p < 7;
  });

  allRows.sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));
  renderTable(allRows);

  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    // allRows ya está prefiltrado a Promedio < 7, solo aplicamos el texto
    const filtered = allRows.filter((r) =>
      [
        r.Identificación, r.Estudiante, r.Correo, r.NEE, r.Nivel,
        r["[Vez] Materia (Docente)"], r["Parcial Final/[Mejor/Recup]"], r.Promedio
      ].some(v => String(v ?? '').toLowerCase().includes(q))
    );
    renderTable(filtered);
  });

  /* ===========================
   * Envío de correos (igual que en nee-control/seguimiento-academico)
   * =========================== */
  sendBtn?.addEventListener('click', async () => {
    // 1) Recolectar filas seleccionadas
    const selectedRows = [];
    document.querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked')
      .forEach(cb => {
        const key = cb.dataset.key;
        const row = allRows.find(r => r._key === key);
        if (row) selectedRows.push(row);
      });

    if (!selectedRows.length) {
      await showModal({
        icon: 'info',
        title: 'Sin selección',
        html: 'Selecciona al menos un estudiante para enviar correos.'
      });
      return;
    }

    // 2) Agrupar por estudiante para construir payload esperado por emailModule
    const byId = new Map();
    for (const r of selectedRows) {
      if (!byId.has(r.Identificación)) {
        byId.set(r.Identificación, {
          Identificación: r.Identificación,
          Estudiante: r.Estudiante,
          Correo: r.Correo,
          NEE: r.NEE,
          Nivel: r.Nivel,
          "[Vez] Materia (Docente)": new Set()
        });
      }
      byId.get(r.Identificación)["[Vez] Materia (Docente)"].add(r["[Vez] Materia (Docente)"]);
    }

    const payload = Array.from(byId.values()).map(s => ({
      ...s,
      enviar: true,
      "[Vez] Materia (Docente)": Array.from(s["[Vez] Materia (Docente)"]).filter(Boolean)
    }));

    // 3) Cargar detalle de docentes para cruce
    const docentesExcel = await loadDocentesDetalle();

    // 4) Cálculos locales (fallback) de faltantes/sin correo
    const expectedMissing = computeMissingDocentes(payload, docentesExcel);
    const expectedNoEmail = computeNoEmailDocentesMessages(payload, docentesExcel);

    // 5) Enviar usando el módulo
    showLoading('Enviando correos...');
    try {
      const result = await enviarCorreos(payload, docentesExcel);

      hideLoading();

      await showModal({
        icon: 'success',
        title: 'Correos enviados correctamente',
        html: '',
        timer: 1400
      });

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

  backBtn?.addEventListener('click', () => {
    window.location.href = '../index.html';
  });
});