// emailModule.js
import { loadData } from '../indexeddb-storage.js';

const API_BASE = 'http://178.128.10.70:5000';
let AUTORIDAD = "alvaro.espinozabu@ug.edu.ec"; 

async function initAutoridad() {
  const local = await loadData('emailTemplates');
  if (local && local.autoridad) {
    AUTORIDAD = local.autoridad;
  }
  return AUTORIDAD;
}

const EMAIL_AUTORIDADES = initAutoridad();

/* =========================
   Helpers
========================= */
// Pide plantilla por tipo: "autoridad" | "docente" | "estudiante"
async function getTemplateByType(type) {
  const localTemplates = await loadData("emailTemplates");
  if (localTemplates?.[type]) return localTemplates[type];

  const bdTemplates = await loadData("plantillasCorreos");
  return bdTemplates?.find(t => t.tipo === type)?.contenido || "";
}

// Reemplazo de {palabras_clave}
function replaceKeywords(template, keywords) {
  return template.replace(/\{(.*?)\}/g, (_, key) => {
    const v = keywords[key];
    return (v === 0 || !!v) ? String(v) : `{${key}}`;
  });
}

/** 
 * Parseador robusto del texto de docente que viene dentro del paréntesis de
 * "[Vez] Materia (DOCENTE: PARALELO)".
 * Ejemplos admitidos:
 * - "0601375298 - ORTEGA LEON MARIA VIRGINIA: VE01"
 * - "0601375298-ORTEGA LEON MARIA VIRGINIA"
 * - "ORTEGA LEON MARIA VIRGINIA"
 * Devuelve: { id: "0601375298" | null, nombre: "ORTEGA LEON MARIA VIRGINIA", paralelo: "VE01" | "" }
 */
function parseDocenteString(str = "") {
  const sinParalelo = String(str).split(":")[0].trim(); // quita ": paralelo" si existe
  // Captura cédula (10 dígitos) opcional y el resto como nombre
  // Acepta separadores " - " o "-" o "—"
  const m = sinParalelo.match(/^\s*(\d{9,10})\s*[—-]\s*(.+)$|^(.+)$/);
  if (m) {
    // Caso con cédula y nombre
    if (m[1] && m[2]) {
      return { id: m[1].trim(), nombre: m[2].trim(), paralelo: (str.split(":")[1] || "").trim() };
    }
    // Caso solo nombre
    if (m[3]) {
      return { id: null, nombre: m[3].trim(), paralelo: (str.split(":")[1] || "").trim() };
    }
  }
  return { id: null, nombre: String(str).trim(), paralelo: (str.split(":")[1] || "").trim() };
}

/**
 * Construye mapa por IDENTIFICACION -> { correo, nombre }
 * Usar el archivo REPORTE_DETALLADO_DOCENTES.
 * Columnas esperadas: IDENTIFICACION, CORREO_SIUG, NOMBRES
 */
function extractDocenteCorreoByIdMap(docentesExcel) {
  const map = {};
  for (const d of (docentesExcel || [])) {
    const id = String(d["IDENTIFICACION"] ?? "").trim();
    const correo = String(d["CORREO_SIUG"] ?? "").trim();
    const nombre = String(d["NOMBRES"] ?? "").trim();
    if (id && correo) map[id] = { correo, nombre };
  }
  return map;
}

// POST real al backend Flask (con logging a consola)
async function enviarCorreo(para, contenido) {
  try {
    const response = await fetch(`${API_BASE}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: para, // string o array
        subject: "FACAF Notificación Académica",
        body: contenido
      })
    });

    if (!response.ok) {
      console.error("❌ Error al enviar correo:", await response.text());
    } else {
      console.log("✅ Correo enviado correctamente");
    }
  } catch (err) {
    console.error("❌ Error al conectar con backend:", err);
  }
}

// Extrae nombres LIMPIOS de docentes desde registros (usa solo el nombre, no cédula)
function obtenerNombresDocentesDesdeRegistros(registros) {
  const set = new Set();
  for (const e of registros) {
    for (const m of (e["[Vez] Materia (Docente)"] || [])) {
      const dentroParentesis = m.match(/\(([^)]+)\)/)?.[1];
      if (!dentroParentesis) continue;
      const { nombre } = parseDocenteString(dentroParentesis);
      if (nombre) set.add(nombre);
    }
  }
  return [...set];
}

// Mapa de docenteId -> lista de estudiantes asignados a ese docente
function mapDocenteIdToStudents(estudiantesEnviar) {
  const map = new Map(); // id -> Set(estudiantes)
  for (const e of estudiantesEnviar) {
    for (const m of (e["[Vez] Materia (Docente)"] || [])) {
      const dentroParentesis = m.match(/\(([^)]+)\)/)?.[1];
      if (!dentroParentesis) continue;
      const { id } = parseDocenteString(dentroParentesis);
      if (!id) continue;
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(e.Estudiante);
    }
  }
  return map;
}

/* =========================================================
   1) AUTORIDADES  (lista de docentes solo por NOMBRE)
========================================================= */
export async function enviarCorreoAutoridades(estudiantesEnviar) {
  const plantillaAutoridad = await getTemplateByType("autoridad");

  const nombresEstudiantes = [...new Set(estudiantesEnviar.map(e => e.Estudiante))].join(", ");
  const detalleMaterias = estudiantesEnviar
    .flatMap(e => e["[Vez] Materia (Docente)"] || [])
    .join("\n");

  const docentesSoloNombres = obtenerNombresDocentesDesdeRegistros(estudiantesEnviar).join(", ");

  // 🔹 Nueva forma de agrupar
  const detalleDocenteEstudiante = Object.entries(
    estudiantesEnviar.reduce((acc, est) => {
      if (!acc[est.Estudiante]) acc[est.Estudiante] = [];
      for (const m of est["[Vez] Materia (Docente)"] || []) {
        const dentroParentesis = m.match(/\(([^)]+)\)/)?.[1];
        if (!dentroParentesis) continue;
        const { nombre } = parseDocenteString(dentroParentesis);
        if (nombre && !acc[est.Estudiante].includes(nombre)) {
          acc[est.Estudiante].push(nombre);
        }
      }
      return acc;
    }, {})
  )
  .map(([estudiante, docentes]) => {
    return `${estudiante}:\n    - ${docentes.join("\n    - ")}`;
  })
  .join("\n\n");

  const contenidoAutoridad = replaceKeywords(plantillaAutoridad, {
    nombre_docente: "-",
    detalle_estudiantes: nombresEstudiantes || "-",
    nombre_estudiante: "-",
    detalle_materias: detalleMaterias || "-",
    detalle_docentes: docentesSoloNombres || "-",
    detalle_docentes_estudiantes: detalleDocenteEstudiante || "-"
  });

  await enviarCorreo(EMAIL_AUTORIDADES, contenidoAutoridad);
}

/* =========================================================
   2) DOCENTES  (usa la CÉDULA para buscar CORREO_SIUG en REPORTE_DETALLADO_DOCENTES)
========================================================= */
export async function enviarCorreosDocentes(estudiantesEnviar, docentesExcel) {
  const plantillaDocente = await getTemplateByType("docente");

  // Mapa por IDENTIFICACION (cédula)
  const docenteById = extractDocenteCorreoByIdMap(docentesExcel);

  // Mapa id -> estudiantes (Set)
  const idToStudents = mapDocenteIdToStudents(estudiantesEnviar);

  // Cadena de todos los docentes (SOLO nombres) para contexto
  const todosDocentesStr = obtenerNombresDocentesDesdeRegistros(estudiantesEnviar).join(", ");

  // Global "Estudiante - DocenteNombre"
  const detalleDocenteEstudianteGlobal = estudiantesEnviar
    .flatMap(e =>
      (e["[Vez] Materia (Docente)"] || [])
        .map(m => {
          const dentroParentesis = m.match(/\(([^)]+)\)/)?.[1];
          if (!dentroParentesis) return null;
          const { nombre } = parseDocenteString(dentroParentesis);
          return nombre ? `${e.Estudiante} - ${nombre}` : null;
        })
        .filter(Boolean)
    )
    .join("\n");

  for (const [docenteId, estudiantesSet] of idToStudents.entries()) {
    const info = docenteById[docenteId];
    if (!info) {
      console.warn(`⚠️ Sin correo para docente con IDENTIFICACION "${docenteId}" en REPORTE_DETALLADO_DOCENTES`);
      continue;
    }
    const correoDocente = info.correo;
    // Intenta usar nombre del archivo de docentes; si no, reconstruir desde una muestra
    let nombreDocente = info.nombre || "";
    if (!nombreDocente) {
      // Busca cualquier materia que tenga este id para extraer el nombre
      const sample = estudiantesEnviar.find(e =>
        (e["[Vez] Materia (Docente)"] || []).some(m => {
          const dentroPar = m.match(/\(([^)]+)\)/)?.[1];
          return dentroPar && parseDocenteString(dentroPar).id === docenteId;
        })
      );
      if (sample) {
        const token = (sample["[Vez] Materia (Docente)"] || []).find(m => {
          const dentroPar = m.match(/\(([^)]+)\)/)?.[1];
          return dentroPar && parseDocenteString(dentroPar).id === docenteId;
        });
        if (token) {
          const dentroPar = token.match(/\(([^)]+)\)/)?.[1] || "";
          nombreDocente = parseDocenteString(dentroPar).nombre;
        }
      }
    }

    const estudiantesDeEseDocente = [...estudiantesSet];

    const contenidoDocente = replaceKeywords(plantillaDocente, {
      nombre_docente: nombreDocente || docenteId, // muestra SOLO nombre
      detalle_estudiantes: estudiantesDeEseDocente.map(n => `- ${n}`).join("\n") || "-",
      nombre_estudiante: "-",
      detalle_materias: "-", // si quieres listar materias, se puede construir por id aquí
      detalle_docentes: todosDocentesStr || "-",
      detalle_docentes_estudiantes: detalleDocenteEstudianteGlobal || "-"
    });

    await enviarCorreo(correoDocente, contenidoDocente);
  }
}

/* =========================================================
   3) ESTUDIANTES
========================================================= */
export async function enviarCorreosEstudiantes(estudiantesEnviar) {
  const plantillaEstudiante = await getTemplateByType("estudiante");

  const todosDocentesStr = obtenerNombresDocentesDesdeRegistros(estudiantesEnviar).join(", ");
  const detalleDocenteEstudianteGlobal = estudiantesEnviar
    .flatMap(e =>
      (e["[Vez] Materia (Docente)"] || [])
        .map(m => {
          const dentroParentesis = m.match(/\(([^)]+)\)/)?.[1];
          if (!dentroParentesis) return null;
          const { nombre } = parseDocenteString(dentroParentesis);
          return nombre ? `${e.Estudiante} - ${nombre}` : null;
        })
        .filter(Boolean)
    )
    .join("\n");

  for (const e of estudiantesEnviar) {
    const materiasHtml = (e["[Vez] Materia (Docente)"] || []).join("\n") || "-";
    const correos = String(e.Correo || "")
      .split(/[,;]+/)
      .map(c => c.trim())
      .filter(Boolean);

    if (!correos.length) {
      console.warn(`⚠️ Estudiante "${e.Estudiante}" sin correo.`);
      continue;
    }

    const contenidoEstudiante = replaceKeywords(plantillaEstudiante, {
      nombre_docente: "-",
      detalle_estudiantes: "-",
      nombre_estudiante: e.Estudiante || "-",
      detalle_materias: materiasHtml,
      detalle_docentes: todosDocentesStr || "-",
      detalle_docentes_estudiantes: detalleDocenteEstudianteGlobal || "-"
    });

    await enviarCorreo(correos, contenidoEstudiante);
  }
}

/* =========================================================
   ORQUESTADORES
========================================================= */
export async function enviarCorreos(estudiantesFiltrados, docentesExcel) {
  const estudiantesEnviar = (estudiantesFiltrados || []).filter(e => e.enviar);

  if (!estudiantesEnviar.length) {
    console.warn("⚠️ No hay estudiantes con 'enviar' activo.");
    return;
  }

  await enviarCorreoAutoridades(estudiantesEnviar);
  await enviarCorreosDocentes(estudiantesEnviar, docentesExcel);
  await enviarCorreosEstudiantes(estudiantesEnviar);
}

export async function enviarCorreosNEE(estudiantesFiltrados, docentesExcel) {
  const estudiantesEnviar = (estudiantesFiltrados || []).filter(e => e.enviar);

  if (!estudiantesEnviar.length) {
    console.warn("⚠️ No hay estudiantes con 'enviar' activo.");
    return;
  }

  await enviarCorreoAutoridades(estudiantesEnviar);
  await enviarCorreosDocentes(estudiantesEnviar, docentesExcel);
}
