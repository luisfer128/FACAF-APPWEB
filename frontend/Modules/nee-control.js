// nee-control.js
import { enviarCorreosNEE } from './emailModule.js';
import { loadData } from '../indexeddb-storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const tableBody      = document.getElementById('neeStudentTableBody');
  const filterInput    = document.getElementById('filterAcademicInput');
  const totalSpan      = document.getElementById('studentCount');
  const sendEmailsBtn  = document.getElementById('sendEmailsBtn');
  const goToMenuButton = document.getElementById('goToMenuButton');
  const periodLabel    = document.getElementById('current-period-label');

  let allStudentsData = [];

  /* ===========================
   * Helpers de UI (SweetAlert2 + fallback)
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
    if (window.Swal && Swal.isVisible()) {
      Swal.close();
    } else {
      removeLoadingOverlay();
    }
  }

  function showModal({ icon = 'info', title = '', html = '', timer = null }) {
    if (window.Swal) {
      return Swal.fire({ icon, title, html, timer, showConfirmButton: !timer });
    } else {
      return Promise.resolve();
    }
  }

  function stripHtml(s = '') {
    const tmp = document.createElement('div');
    tmp.innerHTML = s;
    return tmp.textContent || tmp.innerText || '';
  }

  function escapeHtml(s = '') {
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // Overlay de respaldo si no hay SweetAlert2
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
    const style = document.createElement('style');
    style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
    overlay.appendChild(style);
    document.body.appendChild(overlay);
  }

  function removeLoadingOverlay() {
    const el = document.getElementById('email-loading-overlay');
    if (el) el.remove();
  }

  /* ===========================
   * Helpers de datos
   * =========================== */
  function norm(v) {
    return (v ?? '').toString().trim();
  }

  function canonName(s) {
    return norm(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getMostCommonPeriodo(rows) {
    const counts = new Map();
    for (const r of rows) {
      const p = norm(r["PERIODO"]);
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    let best = '';
    let bestCount = -1;
    for (const [p, c] of counts.entries()) {
      if (c > bestCount) { best = p; bestCount = c; }
    }
    return best;
  }

  async function getPeriodo() {
    const porSemestre = (await loadData('academicTrackingData_REPORTE_POR_SEMESTRE')) || [];
    const periodo = getMostCommonPeriodo(porSemestre);
    if (periodo && periodLabel) periodLabel.textContent = `📅 Periodo actual: ${periodo}`;
    return periodo || '';
  }

  /* ===========================
   * Render de tabla
   * =========================== */
  function renderTable(students) {
    tableBody.innerHTML = '';

    students.forEach(student => {
      const row = document.createElement('tr');

      row.insertCell().textContent = student.Identificación;
      row.insertCell().textContent = student.Estudiante;
      row.insertCell().textContent = student.Correo;
      row.insertCell().textContent = student.NEE;
      row.insertCell().textContent = student.Nivel || '';

      const vezCell = row.insertCell();
      const ul = document.createElement('ul');
      (student["[Vez] Materia (Docente)"] || []).forEach(m => {
        const li = document.createElement('li');
        li.textContent = m;
        ul.appendChild(li);
      });
      vezCell.appendChild(ul);

      const riesgoCell = row.insertCell();
      const bar = document.createElement('div');
      bar.className = 'riesgo-bar';

      let riesgoTotal = 0;
      (student["[Vez] Materia (Docente)"] || []).forEach(m => {
        const match = String(m).match(/^\[(\d+)\]/);
        const vez = match ? parseInt(match[1], 10) : 1;

        if (vez === 1) riesgoTotal += 1;
        else if (vez === 2) riesgoTotal += 4;
        else if (vez >= 3) riesgoTotal += 6;
      });

      // multiplicamos por 10 para mantener el efecto visual original
      const intensidad = Math.min(riesgoTotal * 10, 100);

      bar.style.width = `${intensidad}%`;
      bar.style.backgroundColor = `hsl(${120 - intensidad}, 100%, 40%)`;
      bar.style.borderRadius = '6px';
      riesgoCell.appendChild(bar);


      const enviarCell = row.insertCell();
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.studentId = student.Identificación;
      enviarCell.appendChild(checkbox);

      tableBody.appendChild(row);
    });

    if (totalSpan) totalSpan.textContent = students.length;
  }

  /* ===========================
   * Carga detalle de docentes (para cruce)
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
   * Utilidades de cruce de docentes
   * =========================== */
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
      for (const c of combos) {
        if (c) set.add(canonName(c));
      }
    }
    return set;
  }

  // Extrae nombres de docente desde: "[Vez] Materia (Docente: Paralelo)"
  function extractDocentesFromSelected(students) {
    const docentes = new Set();
    for (const s of students || []) {
      for (const m of (s["[Vez] Materia (Docente)"] || [])) {
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
    const missing = docentesEnviados.filter(n => !excelSet.has(canonName(n)));
    return missing.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  // —— NUEVO: detectar docentes sin correo en REPORTE_DETALLADO_DOCENTES
  function getDocenteIdFromRow(r) {
    const idKeys = [
      "IDENTIFICACION","IDENTIFICACIÓN","CI","CEDULA","CÉDULA","DOCUMENTO","Documento"
    ];
    for (const k of idKeys) {
      const v = norm(r[k]);
      if (v) return v;
    }
    return '';
  }

  function getEmailFromRow(r) {
    const emailKeys = [
      "CORREO_SIUG","CORREO INSTITUCIONAL","CORREO","EMAIL","MAIL","E-MAIL"
    ];
    for (const k of emailKeys) {
      const v = norm(r[k]);
      if (v) return v;
    }
    return '';
  }

  function getRowNameCandidates(r) {
    const nombres   = norm(r["NOMBRES"]);
    const apellidos = norm(r["APELLIDOS"]);
    const docente   = norm(r["DOCENTE"]) || norm(r["Nombre Docente"]) || norm(r["NOMBRE"]);
    const combos = [
      docente,
      apellidos && nombres ? `${apellidos} ${nombres}` : '',
      nombres && apellidos ? `${nombres} ${apellidos}` : '',
      nombres,
      apellidos
    ].filter(Boolean);
    return combos;
  }

  function rowsMatchNombre(rows, docenteName) {
    const target = canonName(docenteName);
    return rows.filter(r => getRowNameCandidates(r).some(c => canonName(c) === target));
  }

  function computeNoEmailDocentesMessages(selected, docentesExcel) {
    const docentes = extractDocentesFromSelected(selected);
    const messages = new Set();

    for (const nombre of docentes) {
      const matches = rowsMatchNombre(docentesExcel, nombre);
      if (matches.length === 0) continue; // esto lo maneja computeMissingDocentes

      // ¿Alguna fila para ese docente tiene correo?
      const hasAnyEmail = matches.some(getEmailFromRow);
      if (!hasAnyEmail) {
        // Tomamos cualquier ID no vacío (si hay varios, el primero)
        let id = '';
        for (const r of matches) {
          id = getDocenteIdFromRow(r);
          if (id) break;
        }
        const msg = id
          ? `Sin correo para docente con IDENTIFICACION "${id}" en REPORTE_DETALLADO_DOCENTES`
          : `Sin correo para docente "${nombre}" en REPORTE_DETALLADO_DOCENTES`;
        messages.add(msg);
      }
    }

    // Ordenar de forma estable/alfabética
    return Array.from(messages).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  /* ===========================
   * Carga y merge de datos
   * =========================== */
  async function loadAndMergeData() {
    const periodoActual = await getPeriodo();

    const porSemestre    = (await loadData('academicTrackingData_REPORTE_POR_SEMESTRE')) || [];
    const calificaciones = (await loadData('academicTrackingData_REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL_xlsx')) || [];
    const legalizados    = (await loadData('academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx')) || [];

    // 1) Mapa NEE SOLO si existen ambos campos (DISCAPACIDAD y PORCENTAJE)
    const mapNEE = new Map();
    const eligibleIDs = new Set();
    for (const est of legalizados) {
      const id = norm(est["IDENTIFICACION"]);
      if (!id) continue;
      const discapacidad = norm(est["DISCAPACIDAD"]);
      const porcentaje   = norm(est["PORCENTAJE DISCAPACIDAD"]);
      if (!discapacidad || !porcentaje) continue;

      const nivelLeg = norm(est["NIVEL"]);
      const neeText  = `${discapacidad} (${porcentaje}%)`;
      mapNEE.set(id, { NEE: neeText, NivelLegalizados: nivelLeg });
      eligibleIDs.add(id);
    }

    // 2) Base desde POR_SEMESTRE (PERIODO actual), solo IDs elegibles
    const baseStudents = new Map();
    for (const r of porSemestre) {
      if (norm(r["PERIODO"]) !== periodoActual) continue;

      const id = norm(r["IDENTIFICACION"]);
      if (!id || !eligibleIDs.has(id)) continue;

      const apellidos  = norm(r["APELLIDOS"]);
      const nombres    = norm(r["NOMBRES"]);
      const estudiante = `${apellidos} ${nombres}`.replace(/\s+/g, ' ').trim();

      const correoInst = norm(r["CORREO_INSTITUCIONAL"]);
      const correoPers = norm(r["CORREO_PERSONAL"]);
      const correos    = [correoInst, correoPers].filter(Boolean).join('; ');

      let nivel = norm(r["NIVEL"]) || mapNEE.get(id)?.NivelLegalizados || '';
      const NEE = mapNEE.get(id)?.NEE;

      if (!baseStudents.has(id)) {
        baseStudents.set(id, {
          Identificación: id,
          Estudiante: estudiante,
          Correo: correos,
          NEE,
          Nivel: nivel,
          "[Vez] Materia (Docente)": new Set(),
        });
      }

      const vez      = norm(r["NO. VEZ"]) || '?';
      const materia  = norm(r["MATERIA"]);
      const docente  = norm(r["DOCENTE"]);
      const paralelo = norm(r["GRUPO/PARALELO"]);
      if (materia || docente) {
        baseStudents.get(id)["[Vez] Materia (Docente)"]
          .add(`[${vez}] ${materia} (${docente}: ${paralelo})`);
      }
    }

    // 3) Enriquecer con CALIFICACIONES (mismo PERIODO), solo IDs ya presentes
    for (const n of calificaciones) {
      if (norm(n["PERIODO"]) !== periodoActual) continue;

      const id = norm(n["IDENTIFICACION"]);
      if (!id || !baseStudents.has(id)) continue;

      const vez      = norm(n["NO. VEZ"]) || '?';
      const materia  = norm(n["MATERIA"]);
      const docente  = norm(n["DOCENTE"]);
      const paralelo = norm(n["GRUPO/PARALELO"]);
      if (materia || docente) {
        baseStudents.get(id)["[Vez] Materia (Docente)"]
          .add(`[${vez}] ${materia} (${docente}: ${paralelo})`);
      }
    }

    // 4) Convertir y filtrar (deben tener al menos 1 ítem en la lista)
    allStudentsData = Array.from(baseStudents.values())
      .map(s => ({
        ...s,
        "[Vez] Materia (Docente)": Array.from(s["[Vez] Materia (Docente)"]).filter(Boolean),
      }))
      .filter(s => s["[Vez] Materia (Docente)"].length > 0)
      .sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));

    renderTable(allStudentsData);
  }

  /* ===========================
   * Inicialización
   * =========================== */
  await loadAndMergeData();

  /* ===========================
   * Filtro por texto
   * =========================== */
  filterInput?.addEventListener('input', () => {
    const q = filterInput.value.toLowerCase();
    const filtered = allStudentsData.filter(s => {
      const simpleMatch = [
        s.Identificación, s.Estudiante, s.Correo, s.NEE, s.Nivel
      ].some(v => String(v ?? '').toLowerCase().includes(q));

      const listMatch = (s["[Vez] Materia (Docente)"] || []).some(item =>
        String(item).toLowerCase().includes(q)
      );

      return simpleMatch || listMatch;
    });
    renderTable(filtered);
  });

  /* ===========================
   * Envío de correos con loader + modales
   * =========================== */
  sendEmailsBtn?.addEventListener('click', async () => {
    // Recopilar seleccionados
    const selected = [];
    document
      .querySelectorAll('#neeStudentTableBody input[type="checkbox"]:checked')
      .forEach(cb => {
        const id = cb.dataset.studentId;
        const student = allStudentsData.find(s => s.Identificación === id);
        if (student && (student["[Vez] Materia (Docente)"]?.length || 0) > 0) {
          selected.push({ ...student, enviar: true });
        }
      });

    if (!selected.length) {
      await showModal({
        icon: 'info',
        title: 'Sin selección',
        html: 'Selecciona al menos un estudiante para enviar correos.'
      });
      return;
    }

    // Cargar detalle de docentes (para cruce)
    const docentesExcel = await loadDocentesDetalle();

    // Mostrar loader
    showLoading('Enviando correos...');

    try {
      // Listas derivadas de nuestra lógica
      const expectedMissingNames = computeMissingDocentes(selected, docentesExcel);
      const expectedNoEmailMsgs  = computeNoEmailDocentesMessages(selected, docentesExcel);

      // Ejecutar envío
      const result = await enviarCorreosNEE(selected, docentesExcel);

      hideLoading();

      // Éxito general
      await showModal({
        icon: 'success',
        title: 'Correos enviados correctamente',
        html: '',
        timer: 1400
      });

      // Preferimos datos devueltos por el módulo si existen:
      const missingByModule = Array.isArray(result?.missingDocentes) ? result.missingDocentes : null;
      const noEmailByModule = Array.isArray(result?.noEmailMessages) ? result.noEmailMessages : null;

      const missingDocentes = missingByModule?.length ? missingByModule : expectedMissingNames;
      const noEmailMessages = noEmailByModule?.length ? noEmailByModule : expectedNoEmailMsgs;

      if (missingDocentes.length) {
        const listHtml = `<ul style="text-align:left;margin:0;padding-left:18px">${missingDocentes
          .map(d => `<li>${escapeHtml(d)}</li>`)
          .join('')}</ul>`;

        await showModal({
          icon: 'warning',
          title: 'Los siguientes docentes no figuran en Detalle Docente:',
          html: listHtml
        });
      }

      if (noEmailMessages.length) {
        const listHtml = `<ul style="text-align:left;margin:0;padding-left:18px">${noEmailMessages
          .map(msg => `<li>${escapeHtml(msg)}</li>`)
          .join('')}</ul>`;

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

  /* ===========================
   * Volver al menú
   * =========================== */
  goToMenuButton?.addEventListener('click', () => {
    window.location.href = '../index.html';
  });
});