// seguimiento-academico.js
import { loadData } from '../indexeddb-storage.js';
import { enviarCorreos } from './emailModule.js';

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('academicTrackingTableBody');
  const totalStudentsSpan = document.getElementById('total-students');
  const filterInput = document.getElementById('filterAcademicInput');
  const sendEmailsButton = document.getElementById('sendAcademicEmails');
  const backToMenuButton = document.getElementById('goToMenuButton');
  const periodLabel = document.getElementById("current-period-label");

  if (!tableBody || !totalStudentsSpan || !filterInput || !sendEmailsButton || !backToMenuButton) {
    console.error("Uno o más elementos del DOM no se encontraron. Revisa los IDs en el HTML.");
    return;
  }

  let allStudentsData = [];

  /* ========= Helpers básicos ========= */
  const toId = (v) => String(v ?? '').replace(/\D/g, '').trim(); // Normaliza ID (solo dígitos)
  const norm = (v) => (v ?? '').toString().trim();
  const canon = (s) =>
    norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  function getRiesgoColor(count) {
    if (count >= 5) return '#d93025'; // rojo fuerte
    if (count === 4) return '#f57c00'; // naranja fuerte
    if (count === 3) return '#fbc02d'; // amarillo
    if (count === 2) return '#7cb342'; // verde medio
    return '#4caf50'; // verde claro
  }

  /* ========= UI helpers (SweetAlert2 + fallback) ========= */
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

  /* ========= Carga Detalle Docentes (para cruce) ========= */
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

  /* ========= Detección de docentes faltantes / sin correo (igual que en nee-control) ========= */
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

  /* ========= Render tabla ========= */
  function renderTable(students) {
    tableBody.innerHTML = '';

    students.forEach(student => {
      const row = document.createElement('tr');

      row.insertCell().textContent = student.Identificación || '';
      row.insertCell().textContent = student.Estudiante || '';
      row.insertCell().textContent = student.Correo || '';
      row.insertCell().textContent = student.NEE || '';
      row.insertCell().textContent = student.Nivel || '';

      const vezCell = row.insertCell();
      const vezList = document.createElement('ul');
      (student["[Vez] Materia (Docente)"] || []).forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        vezList.appendChild(li);
      });
      vezCell.appendChild(vezList);

      const riesgoCell = row.insertCell();
      const riesgoDiv = document.createElement('div');
      riesgoDiv.className = 'riesgo-bar-container';

      const progreso = document.createElement('div');
      progreso.className = 'riesgo-bar';
      const cantidad = (student["[Vez] Materia (Docente)"] || []).length;
      const porcentaje = Math.min(cantidad * 20, 100);
      progreso.style.width = `${porcentaje}%`;
      progreso.style.backgroundColor = getRiesgoColor(cantidad);
      riesgoDiv.appendChild(progreso);
      riesgoCell.appendChild(riesgoDiv);

      const enviarCell = row.insertCell();
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.studentId = student.Identificación;
      enviarCell.appendChild(checkbox);

      tableBody.appendChild(row);
    });

    totalStudentsSpan.textContent = `Total de Estudiantes: ${students.length}`;
  }

  /* ========= Carga robusta NEE (con fallbacks y normalización) ========= */
  async function loadNEEMap() {
    const possibleKeys = [
      'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS',
      'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS',
      'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx',
      'REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx'
    ];

    let dataNEE = [];
    for (const k of possibleKeys) {
      const tmp = await loadData(k);
      if (Array.isArray(tmp) && tmp.length) { dataNEE = tmp; break; }
    }

    const neeMap = new Map();
    dataNEE.forEach(r => {
      const id = toId(r['IDENTIFICACION']);
      if (!id) return;
      const disc = norm(r['DISCAPACIDAD']);
      const pct = norm(r['PORCENTAJE DISCAPACIDAD']);
      if (disc) {
        const text = pct ? `${disc} ${pct}%` : disc; // Ej: "Intelectual 42%"
        neeMap.set(id, text);
      }
    });

    return neeMap; // Map<id, "Texto NEE">
  }

  /* ========= Carga principal y cruce con NEE ========= */
  async function loadCalificacionesParcialTotal() {
    const keyNotas = 'academicTrackingData_REPORTE_POR_SEMESTRE';
    const dataNotas = await loadData(keyNotas) || [];

    if (!Array.isArray(dataNotas) || !dataNotas.length) return [];

    // 1) Cargar mapa de NEE
    const neeMap = await loadNEEMap();

    // 2) Detectar periodo actual
    const periodosUnicos = [...new Set(dataNotas.map(r => r["PERIODO"]).filter(Boolean))];
    const periodoActual = periodosUnicos.sort().reverse()[0];
    if (periodLabel) periodLabel.textContent = `📅 Periodo actual: ${periodoActual}`;

    const agrupados = {};

    dataNotas.forEach(entry => {
      const id = toId(entry["IDENTIFICACION"]);
      const periodo = norm(entry["PERIODO"]);
      const noVez = Number(norm(entry["NO. VEZ"]));

      // Filtrar: solo repetidores (>=2) del periodo actual
      if (!id || !Number.isFinite(noVez) || noVez < 2 || periodo !== periodoActual) return;

      const materia = norm(entry["MATERIA"]);
      let docente = norm(entry["DOCENTE"]);
      if (docente.includes(" - ")) docente = docente.split(" - ")[1].trim();

      const item = `[${noVez}] ${materia} (${docente})`;

      if (!agrupados[id]) {
        const neeTexto = neeMap.get(id) || "No";
        agrupados[id] = {
          Identificación: id,
          Estudiante: `${norm(entry["APELLIDOS"])} ${norm(entry["NOMBRES"])}`.trim(),
          Correo: [entry["CORREO_INSTITUCIONAL"], entry["CORREO_PERSONAL"]].filter(Boolean).map(norm).join('; '),
          NEE: neeTexto,
          Nivel: norm(entry["NIVEL"]),
          "[Vez] Materia (Docente)": []
        };
      }

      agrupados[id]["[Vez] Materia (Docente)"].push(item);
    });

    return Object.values(agrupados).map(s => ({
      ...s,
      "[Vez] Materia (Docente)": [...new Set(s["[Vez] Materia (Docente)"])]
    }));
  }

  /* ========= Ejecutar al cargar ========= */
  (async function () {
    allStudentsData = await loadCalificacionesParcialTotal();
    allStudentsData.sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));
    renderTable(allStudentsData);
  })();

  /* ========= Filtro ========= */
  filterInput.addEventListener('input', () => {
    const query = filterInput.value.toLowerCase();
    const filtered = allStudentsData.filter(s =>
      Object.entries(s).some(([k, val]) => {
        if (k === "[Vez] Materia (Docente)") {
          return (Array.isArray(val) && val.some(item => item.toLowerCase().includes(query)));
        }
        return String(val).toLowerCase().includes(query);
      })
    );
    filtered.sort((a, b) => a.Estudiante.localeCompare(b.Estudiante, 'es', { sensitivity: 'base' }));
    renderTable(filtered);
  });

  /* ========= Enviar correos (igual que en nee-control, usando emailModule) ========= */
  sendEmailsButton.addEventListener('click', async () => {
    const selected = [];
    document.querySelectorAll('#academicTrackingTableBody input[type="checkbox"]:checked').forEach(cb => {
      const id = cb.dataset.studentId;
      const student = allStudentsData.find(s => s.Identificación === id);
      if (student && (student["[Vez] Materia (Docente)"]?.length || 0) > 0) {
        selected.push(student);
      }
    });

    if (!selected.length) {
      await showModal({
        icon: 'info',
        title: 'Sin selección',
        html: 'Selecciona al menos un estudiante con materias para enviar correos.'
      });
      return;
    }

    // Normaliza estructura esperada por emailModule
    const payload = selected.map(s => ({
      ...s,
      enviar: true,
      "[Vez] Materia (Docente)": Array.isArray(s["[Vez] Materia (Docente)"])
        ? s["[Vez] Materia (Docente)"].filter(Boolean)
        : [s["[Vez] Materia (Docente)"]].filter(Boolean)
    }));

    // Cargar detalle de docentes (para cruce)
    const docentesExcel = await loadDocentesDetalle();

    // Calcular faltantes/sin correo (fallback local, como en nee-control)
    const expectedMissing = computeMissingDocentes(payload, docentesExcel);
    const expectedNoEmail = computeNoEmailDocentesMessages(payload, docentesExcel);

    showLoading('Enviando correos...');

    try {
      // Enviar usando tu módulo (autoridades + docentes + estudiantes)
      const result = await enviarCorreos(payload, docentesExcel);

      hideLoading();

      await showModal({
        icon: 'success',
        title: 'Correos enviados correctamente',
        html: '',
        timer: 1400
      });

      // Si el módulo devuelve listas, se priorizan; si no, usamos las calculadas
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

  /* ========= Volver al menú ========= */
  backToMenuButton.addEventListener('click', () => {
    window.location.href = '../index.html';
  });
});
