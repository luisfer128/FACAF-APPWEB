// config.js
import { saveData, loadData } from '../indexeddb-storage.js';

const API_BASE = 'http://178.128.10.70:5000';

const norm = (v) => (v ?? '').toString().trim();
function normalizeFileName(fileName) {
  return fileName.replace(/\W+/g, "_");
}

/* ===============================
   LISTAR ARCHIVOS PROCESADOS (desde backend)
================================= */
async function fetchAndRenderProcessedFiles() {
  const processedFilesListDiv = document.getElementById('processed-files-list');
  if (!processedFilesListDiv) return;
  processedFilesListDiv.innerHTML = '';

  try {
    const res = await fetch(`${API_BASE}/files`);
    const files = await res.json();

    if (Array.isArray(files) && files.length > 0) {
      const title = document.createElement('h3');
      title.textContent = 'Archivos Procesados:';
      processedFilesListDiv.appendChild(title);

      files.forEach(file => {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'processed-file';
        fileDiv.style.display = 'flex';
        fileDiv.style.alignItems = 'center';
        fileDiv.style.justifyContent = 'space-between';
        fileDiv.style.gap = '12px';
        fileDiv.style.padding = '8px 12px';
        fileDiv.style.border = '1px solid #e5e7eb';
        fileDiv.style.borderRadius = '8px';
        fileDiv.style.marginBottom = '8px';

        fileDiv.innerHTML = `
          <span class="file-name" title="${file.nombre}">${file.nombre}</span>
          <div class="file-actions">
            <button class="file-action-btn" title="Ver columnas" onclick="viewFileDetails('${file.nombre}')">
              <i class="fas fa-eye"></i>
            </button>
            <button class="file-action-btn" title="Eliminar" onclick="removeFile(this, '${file.nombre}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        `;
        processedFilesListDiv.appendChild(fileDiv);
      });
    } else {
      processedFilesListDiv.textContent = 'No hay archivos en el servidor.';
    }
  } catch (error) {
    console.error('❌ Error obteniendo archivos procesados:', error);
    processedFilesListDiv.textContent = 'No fue posible obtener el listado.';
  }
}

/* ===============================
   VER DETALLE DE UN ARCHIVO
================================= */
window.viewFileDetails = async function (fileName) {
  try {
    const key = `academicTrackingData_${normalizeFileName(fileName)}`;
    const data = await loadData(key);

    if (data && Array.isArray(data) && data.length) {
      const recordCount = data.length;
      const firstRecord = data[0] || {};
      const columns = Object.keys(firstRecord);
      const columnList = columns.map(col => `<li>${col}</li>`).join('');

      await Swal.fire({
        title: `<i class="fas fa-file-excel"></i> ${fileName}`,
        html: `
          <p><strong>📊 Registros:</strong> ${recordCount}</p>
          <p><strong>📅 Estado:</strong> Procesado correctamente</p>
          <p><strong>🗄️ Almacenado en:</strong> IndexedDB</p>
          <hr>
          <p><strong>📋 Columnas:</strong></p>
          <ul style="text-align: left; max-height: 220px; overflow-y: auto; margin:0;">
            ${columnList}
          </ul>
        `,
        icon: 'info',
        confirmButtonText: 'Cerrar',
        confirmButtonColor: '#3085d6',
        width: '600px'
      });

    } else {
      await Swal.fire({
        icon: 'warning',
        title: 'Sin datos',
        text: `El archivo "${fileName}" no contiene registros procesados en IndexedDB.`,
        confirmButtonColor: '#d33'
      });
    }
  } catch (error) {
    console.error('Error obteniendo detalles:', error);
    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: '❌ No se pudo obtener la información del archivo.',
      confirmButtonColor: '#d33'
    });
  }
};

/* ===============================
   ELIMINAR ARCHIVO por nombre (en backend) y refrescar
================================= */
window.removeFile = async function (btn, filename) {
  if (!filename || typeof filename !== "string") {
    return alert("Nombre inválido.");
  }
  if (!confirm(`¿Deseas eliminar el archivo "${filename}"?`)) return;

  try {
    const response = await fetch(`${API_BASE}/delete/by-name/${encodeURIComponent(filename)}`, {
      method: "DELETE"
    });
    const result = await response.json();

    if (response.ok) {
      btn.closest('.processed-file')?.remove();
      alert("✅ Archivo eliminado");
      await fetchAndRenderProcessedFiles();
    } else {
      alert("❌ Error al eliminar: " + (result.error || "desconocido"));
    }
  } catch (err) {
    console.error("❌ Error de red:", err);
    alert("No se pudo eliminar.");
  }
};

/* ===============================
   SOLO ACTUALIZAR LA VISTA POR PERIODO (NO DESCARGA)
   Guarda academicTrackingData_REPORTE_POR_SEMESTRE en IndexedDB
================================= */
async function updatePeriodViewFromLocal() {
  const selectedPeriod = document.getElementById("period-select")?.value;

  if (!selectedPeriod) {
    await Swal.fire({
      icon: 'warning',
      title: 'Selecciona un período',
      text: 'Debes elegir un período para actualizar la vista.',
    });
    return;
  }

  const KEY_TOTAL   = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`;
  const KEY_PARCIAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`;

  let base = await loadData(KEY_TOTAL);
  let source = 'TOTAL';
  if (!Array.isArray(base) || !base.length) {
    base = await loadData(KEY_PARCIAL);
    source = 'PARCIAL';
  }
  if (!Array.isArray(base) || !base.length) {
    await Swal.fire({
      icon: 'warning',
      title: 'Sin datos base',
      text: 'No se encuentra el dataset en IndexedDB para filtrar por período. Realiza una sincronización primero.',
    });
    return;
  }

  const filtered = base.filter(r => norm(r['PERIODO']) === selectedPeriod);
  await saveData("academicTrackingData_REPORTE_POR_SEMESTRE", filtered);
  console.log(`📂 Vista por período actualizada desde ${source} → (${filtered.length} registros)`);

  await Swal.fire({
    icon: 'success',
    title: 'Periodo actualizado',
    text: `La tabla se actualizó para el período: ${selectedPeriod}`,
    confirmButtonColor: '#3085d6'
  });
}

/* ===============================
   SUBIR ARCHIVOS (si hay) o SOLO actualizar por PERIODO (si no hay)
================================= */
async function processExcelFile() {
  const fileInput = document.getElementById('excel-file-input');
  const files = fileInput?.files;
  const uploadStatus = document.getElementById('upload-status');
  const loadingOverlay = document.getElementById('loading-overlay');

  // Si NO hay archivos seleccionados: SOLO actualiza la vista por PERIODO
  if (!files || files.length === 0) {
    await updatePeriodViewFromLocal();
    return;
  }

  // Si hay archivos, sube al backend y luego sincroniza todo
  try {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    console.log("📤 Iniciando procesamiento de archivos...");

    for (let i = 0; i < files.length; i++) {
      console.log(`➡️ Subiendo archivo ${files[i].name}`);

      const formData = new FormData();
      formData.append("file", files[i]);

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
      });

      console.log(`📬 Respuesta recibida (${response.status})`);
      const result = await response.json();
      console.log("📦 Resultado:", result);

      if (uploadStatus) {
        if (response.ok) {
          uploadStatus.textContent = result.message || 'Archivo subido.';
          uploadStatus.style.color = 'green';
        } else {
          uploadStatus.textContent = result.error || 'Error al subir el archivo';
          uploadStatus.style.color = 'red';
        }
      }
    }

    console.log("🔄 Sincronizando desde backend...");
    await syncFilesFromBackendToIndexedDB();
    await fetchAndRenderProcessedFiles();
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    await Swal.fire({
      icon: 'success',
      title: '¡Archivos procesados!',
      text: '✅ Los archivos Excel se han subido y sincronizado correctamente.',
      confirmButtonColor: '#3085d6'
    });

    if (fileInput) {
      fileInput.value = '';
      const selectedFilesText = document.getElementById('selected-files-text');
      if (selectedFilesText) selectedFilesText.textContent = 'Ningún archivo seleccionado';
    }

  } catch (error) {
    console.error('❌ Error al procesar archivo(s):', error);
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: '❌ Ocurrió un error al procesar los archivos.',
      confirmButtonColor: '#d33'
    });
  }

  setTimeout(() => {
    if (uploadStatus) uploadStatus.textContent = '';
  }, 6000);
}

/* ===============================
   SINCRONIZACIÓN COMPLETA (descarga TODO del backend)
   - Guarda datasets por archivo en IndexedDB
   - Para el TOTAL, también guarda academicTrackingData_REPORTE_POR_SEMESTRE del período seleccionado
================================= */
async function syncFilesFromBackendToIndexedDB() {
  const periodSelect = document.getElementById("period-select");
  const selectedPeriod =
    periodSelect?.value || localStorage.getItem('selectedPeriod') || '';

  const res = await fetch(`${API_BASE}/files`);
  const files = await res.json();

  for (let file of files) {
    const fileRes = await fetch(`${API_BASE}/download/${file.id}`);
    if (!fileRes.ok) {
      console.warn('No se pudo descargar:', file.nombre, file.id);
      continue;
    }
    const blob = await fileRes.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // SheetJS ya está cargado desde el HTML
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    const fileKey = normalizeFileName(file.nombre);

    // Si es el TOTAL, guardamos además la vista por PERIODO 
    if (file.nombre.toUpperCase().includes("REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL")) {
      let targetPeriod = selectedPeriod;
      if (!targetPeriod) {
        // Si aún no hay selección, deducir el más reciente del propio archivo
        const uniquePeriods = Array.from(new Set(jsonData.map(r => norm(r['PERIODO'])).filter(Boolean)));
        targetPeriod = pickMostRecentPeriod(uniquePeriods);
        // Persistir selección deducida
        if (targetPeriod) {
          localStorage.setItem('selectedPeriod', targetPeriod);
          if (periodSelect && [...periodSelect.options].some(o => o.value === targetPeriod)) {
            periodSelect.value = targetPeriod;
          }
        }
      }
      const filtered = jsonData.filter(row => norm(row['PERIODO']) === targetPeriod);
      await saveData("academicTrackingData_REPORTE_POR_SEMESTRE", filtered);
      console.log(`📂 Guardado academicTrackingData_REPORTE_POR_SEMESTRE (${filtered.length} registros) para ${targetPeriod}`);
    }

    // Guardar dataset por archivo (sin filtro)
    const key = `academicTrackingData_${fileKey}`;
    await saveData(key, jsonData);
  }

  // Refrescar combo de periodos tras sincronizar
  await populatePeriodSelectFromLocal();
}

/* ===============================
   Selección del período más reciente
================================= */
function pickMostRecentPeriod(periods) {
  const parsePeriod = (p) => {
    const m = String(p).match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase() === 'CII' ? 2 : 1, raw: p };
  };
  const sorted = periods.slice().sort((A, B) => {
    const a = parsePeriod(A), b = parsePeriod(B);
    if (a.y1 !== b.y1) return b.y1 - a.y1;   // año inicial DESC
    if (a.term !== b.term) return b.term - a.term; // CII (2) antes que CI (1)
    return String(b.raw).localeCompare(String(a.raw));
  });
  return sorted[0] || '';
}

/* ================
   LLENAR COMBO 
================ */
async function populatePeriodSelectFromLocal() {
  const select = document.getElementById('period-select');
  if (!select) return;

  const KEY_TOTAL   = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx')}`;
  const KEY_PARCIAL = `academicTrackingData_${normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx')}`;

  let data = await loadData(KEY_TOTAL);
  if (!Array.isArray(data) || !data.length) {
    data = await loadData(KEY_PARCIAL);
  }
  if (!Array.isArray(data) || !data.length) {
    console.warn('No hay datos en IndexedDB para construir el combo de PERIODO.');
    return;
  }

  const periodsSet = new Set(
    data.map(r => norm(r['PERIODO'])).filter(Boolean)
  );
  let periods = Array.from(periodsSet);

  const parsePeriod = (p) => {
    const m = p.match(/(\d{4}).*?(\d{4}).*(CI{1,2})/i);
    if (!m) return { y1: -1, term: -1, raw: p };
    return { y1: Number(m[1]), term: m[3].toUpperCase()==='CII' ? 2 : 1, raw: p };
  };
  periods.sort((A, B) => {
    const a = parsePeriod(A), b = parsePeriod(B);
    if (a.y1 !== b.y1) return b.y1 - a.y1;
    if (a.term !== b.term) return b.term - a.term;
    return String(b.raw).localeCompare(String(a.raw));
  });

  // Mantener selección previa si sigue válida; si no, usar la más reciente
  const saved = localStorage.getItem('selectedPeriod');
  const selected = (saved && periods.includes(saved)) ? saved : pickMostRecentPeriod(periods);

  // Render de opciones
  select.innerHTML = '';
  for (const p of periods) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  }
  if (selected) {
    select.value = selected;
    localStorage.setItem('selectedPeriod', selected);
  }
}

/* ===============================
   CARGAR / GUARDAR PLANTILLAS
================================= */
async function loadTemplates() {
  try {
    // Primero intentar cargar desde IndexedDB (datos locales)
    const local = await loadData('emailTemplates');
    if (local) {
      document.getElementById('correo').value = local.correoAutoridad || '';
      document.getElementById('template-autoridad').value = local.autoridad || '';
      document.getElementById('template-docente').value = local.docente || '';
      document.getElementById('template-estudiante').value = local.estudiante || '';
    }

    // Luego cargar las plantillas desde la API (solo las 3 plantillas, no correoAutoridad)
    const res = await fetch(`${API_BASE}/plantillas`);
    const data = await res.json();

    // Solo actualizar las plantillas desde la API, mantener correoAutoridad local
    document.getElementById('template-autoridad').value = data.autoridad || document.getElementById('template-autoridad').value;
    document.getElementById('template-docente').value = data.docente || document.getElementById('template-docente').value;
    document.getElementById('template-estudiante').value = data.estudiante || document.getElementById('template-estudiante').value;

  } catch (error) {
    console.error('⚠️ Error cargando plantillas de la API:', error);
    // Si falla la API, solo usar datos locales
    const local = await loadData('emailTemplates');
    if (local) {
      document.getElementById('correo').value = local.correoAutoridad || '';
      document.getElementById('template-autoridad').value = local.autoridad || '';
      document.getElementById('template-docente').value = local.docente || '';
      document.getElementById('template-estudiante').value = local.estudiante || '';
    }
  }
}

/* ===============================
   DOMContentLoaded
================================= */
document.addEventListener('DOMContentLoaded', async function () {
  // Mostrar nombres de archivos elegidos
  const backToMenuButton = document.getElementById('goToMenuButton');
  document.getElementById('excel-file-input')?.addEventListener('change', function (event) {
    const selectedFilesText = document.getElementById('selected-files-text');
    const files = event.target.files;
    if (selectedFilesText) {
      if (files && files.length > 0) {
        const fileNames = Array.from(files).map(f => f.name).join(', ');
        selectedFilesText.textContent = 'Archivo(s) seleccionado(s): ' + fileNames;
      } else {
        selectedFilesText.textContent = 'Ningún archivo seleccionado';
      }
    }
  });

  // Botón "Procesar Archivo(s)"
  document.getElementById('process-files-button')?.addEventListener('click', processExcelFile);

  // Guardar plantillas
  document.getElementById('save-templates-button')?.addEventListener('click', async function () {
    const templateAutoridad = document.getElementById('template-autoridad').value;
    const templateDocente   = document.getElementById('template-docente').value;
    const templateEstudiante= document.getElementById('template-estudiante').value;
    const correoInput = document.getElementById('correo').value.trim();
    const correoAutoridad = correoInput === "" ? "alvaro.espinozabu@ug.edu.ec" : correoInput;

    // Guardar todo localmente en IndexedDB
    const localTemplates = { 
      correoAutoridad: correoAutoridad, 
      autoridad: templateAutoridad, 
      docente: templateDocente, 
      estudiante: templateEstudiante 
    };
    await saveData('emailTemplates', localTemplates);

    // Solo enviar las plantillas (no correoAutoridad) a la API
    const apiTemplates = { 
      autoridad: templateAutoridad, 
      docente: templateDocente, 
      estudiante: templateEstudiante 
    };

    try {
      await fetch(`${API_BASE}/plantillas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiTemplates)
      });
      await Swal.fire({
        icon: 'success',
        title: '¡Plantillas guardadas!',
        text: '✅ Plantillas guardadas correctamente.',
        confirmButtonColor: '#3085d6'
      });
    } catch (error) {
      console.error('❌ Error al guardar plantillas en la API:', error);
      await Swal.fire({
        icon: 'warning',
        title: 'Guardado parcial',
        text: '⚠️ Las plantillas se guardaron localmente, pero no se pudo sincronizar con el servidor.',
        confirmButtonColor: '#f39c12'
      });
    }
  });

  // Carga inicial
  await loadTemplates();
  await fetchAndRenderProcessedFiles();
  await populatePeriodSelectFromLocal();

  // Si hay combo, restaurar selección previa (ya aplicada en populate) y actualizar vista al cambiar
  const periodSelect = document.getElementById('period-select');
  if (periodSelect) {
    periodSelect.addEventListener('change', async () => {
      localStorage.setItem('selectedPeriod', periodSelect.value);
      await updatePeriodViewFromLocal(); // actualizar tabla sin recargar
    });
  }

  backToMenuButton.addEventListener('click', () => {
        window.location.href = '../index.html';
  });

  // Tooltip robusto para .info-badge (hover y foco)
(function setupFloatingTooltip(){
  let tipEl = null;

  const show = (el) => {
    const text = el.getAttribute('data-tooltip') || el.getAttribute('title') || '';
    if (!text) return;

    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tooltip-pop';
      document.body.appendChild(tipEl);
    }
    tipEl.textContent = text;
    tipEl.style.opacity = '0';
    tipEl.style.display = 'block';

    const r = el.getBoundingClientRect();
    const margin = 10;

    // Primero centrado arriba del ícono
    // (OJO: con position: fixed NO se suman scrollX/scrollY)
    let left = r.left + r.width / 2 - tipEl.offsetWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipEl.offsetWidth - 8));

    let top = r.top - tipEl.offsetHeight - margin;
    let pos = 'top';

    // Si no hay espacio arriba, ponlo abajo del ícono
    if (top < 8) {
      top = r.bottom + margin;
      pos = 'bottom';
    }

    tipEl.dataset.pos = pos;      // para la flecha
    tipEl.style.left = `${left}px`;
    tipEl.style.top  = `${top}px`;
    tipEl.style.opacity = '1';
  };


  const hide = () => { if (tipEl) tipEl.style.display = 'none'; };

  // Delegación de eventos (soporta futuros badges)
  document.addEventListener('mouseenter', (e) => {
    const t = e.target.closest('.info-badge');
    if (t) show(t);
  }, true);

  document.addEventListener('mouseleave', (e) => {
    const t = e.target.closest('.info-badge');
    if (t) hide();
  }, true);

  document.addEventListener('focusin',  (e) => { const t = e.target.closest('.info-badge'); if (t) show(t); });
  document.addEventListener('focusout', (e) => { const t = e.target.closest('.info-badge'); if (t) hide(); });
})();

});