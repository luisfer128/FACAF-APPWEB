import { loadData } from '../indexeddb-storage.js';

// ---- Funciones Helper ----
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
  const normalized = percentage / maxPercentage;
  
  const hue = 120 * (1 - normalized);
  const saturation = 70;
  const lightness = 50;
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// ========= FUNCIÓN PARA GENERAR HORARIO DEL ESTUDIANTE =========
function generarHorarioEstudiante(recordsEstudiante, horariosData) {
  const periodos = Array.from(new Set(recordsEstudiante.map(r => r.PERIODO))).sort(cmpPeriodo);
  const ultimoPeriodo = periodos[periodos.length - 1];
  
  if (!ultimoPeriodo) return null;
  
  const materiasUltimoPeriodo = recordsEstudiante
    .filter(r => r.PERIODO === ultimoPeriodo)
    .map(r => ({
      materia: norm(r.MATERIA),
      grupo: norm(r['GRUPO/PARALELO'])
    }));
  
  if (materiasUltimoPeriodo.length === 0) return null;
  
  const horariosEstudiante = [];
  
  materiasUltimoPeriodo.forEach(({ materia, grupo }) => {
    const horarioMateria = horariosData.find(h => 
      norm(h.MATERIA) === materia && 
      norm(h.GRUPO) === grupo &&
      norm(h.PERIODO) === ultimoPeriodo
    );
    
    if (horarioMateria) {
      horariosEstudiante.push({
        materia: materia,
        grupo: grupo,
        docente: norm(horarioMateria.DOCENTE),
        horarios: {
          LUNES: norm(horarioMateria.LUNES),
          MARTES: norm(horarioMateria.MARTES),
          MIERCOLES: norm(horarioMateria.MIERCOLES),
          JUEVES: norm(horarioMateria.JUEVES),
          VIERNES: norm(horarioMateria.VIERNES),
          SABADO: norm(horarioMateria.SABADO),
        }
      });
    }
  });
  
  return {
    periodo: ultimoPeriodo,
    materias: horariosEstudiante
  };
}

function renderHorarioEstudiante(horarioData) {
  if (!horarioData || horarioData.materias.length === 0) {
    return `
      <div class="chart-section" style="margin-top: 20px;">
        <h3>Horario del Último Período</h3>
        <p class="muted">No se encontró información de horario para el último período.</p>
      </div>
    `;
  }

  const dias = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
  const diasDisplay = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  function parseHorario(horarioStr) {
    if (!horarioStr || horarioStr === '-') return [];
    
    const intervalos = [];
    const horarios = horarioStr.split(',').map(h => h.trim());
    
    horarios.forEach(horario => {
      const match = horario.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (match) {
        const [, h1, m1, h2, m2] = match;
        const inicio = parseInt(h1) * 60 + parseInt(m1);
        const fin = parseInt(h2) * 60 + parseInt(m2);
        
        for (let minutos = inicio; minutos < fin; minutos += 60) {
          const hora = Math.floor(minutos / 60);
          intervalos.push(`${hora.toString().padStart(2, '0')}:00`);
        }
      }
    });
    
    return intervalos;
  }

  function generarHorasCompletas() {
    const horas = [];
    for (let hora = 7; hora <= 22; hora++) {
      horas.push(`${hora.toString().padStart(2, '0')}:00`);
    }
    return horas;
  }

  const horarioMap = {};
  horarioData.materias.forEach(materia => {
    dias.forEach(dia => {
      const intervalos = parseHorario(materia.horarios[dia]);
      intervalos.forEach(intervalo => {
        if (!horarioMap[dia]) horarioMap[dia] = {};
        if (!horarioMap[dia][intervalo]) horarioMap[dia][intervalo] = [];
        horarioMap[dia][intervalo].push(materia);
      });
    });
  });

  function agruparBloques(dia, todasLasHoras) {
    const bloques = [];
    let bloqueActual = null;
    
    todasLasHoras.forEach((hora, index) => {
      const materiasEnHora = horarioMap[dia] && horarioMap[dia][hora] ? horarioMap[dia][hora] : [];
      
      if (materiasEnHora.length === 0) {
        if (bloqueActual) {
          bloques.push(bloqueActual);
          bloqueActual = null;
        }
        bloques.push({ tipo: 'vacio', hora: hora, rowspan: 1 });
      } else if (materiasEnHora.length === 1) {
        const materia = materiasEnHora[0];
        
        if (bloqueActual && 
            bloqueActual.materia.materia === materia.materia && 
            bloqueActual.materia.grupo === materia.grupo) {
          bloqueActual.rowspan += 1;
          bloqueActual.horaFin = hora;
        } else {
          if (bloqueActual) {
            bloques.push(bloqueActual);
          }
          bloqueActual = {
            tipo: 'materia',
            materia: materia,
            hora: hora,
            horaFin: hora,
            rowspan: 1
          };
        }
      } else {
        if (bloqueActual) {
          bloques.push(bloqueActual);
          bloqueActual = null;
        }
        bloques.push({ 
          tipo: 'multiple', 
          materias: materiasEnHora, 
          hora: hora, 
          rowspan: 1 
        });
      }
    });
    
    if (bloqueActual) {
      bloques.push(bloqueActual);
    }
    
    return bloques;
  }

  const todasLasHoras = generarHorasCompletas();
  
  const bloquesPorDia = {};
  dias.forEach(dia => {
    bloquesPorDia[dia] = agruparBloques(dia, todasLasHoras);
  });

  let tablaHorario = `
    <div class="chart-section" style="margin-top: 20px;">
      <h3>Horario del Período ${horarioData.periodo}</h3>
      <div style="overflow-x: auto; width: 100%;">
        <table class="striped" style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="text-align: center; min-width: 80px; font-weight: 700;">Hora</th>
              ${diasDisplay.map(dia => 
                `<th style="text-align: center; min-width: 143px; font-weight: 700;">${dia}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>
  `;

  const bloquesRenderizados = {};
  dias.forEach(dia => {
    bloquesRenderizados[dia] = {};
  });

  const horasOcupadas = new Set();
  dias.forEach(dia => {
    bloquesPorDia[dia].forEach(bloque => {
      if (bloque.tipo !== 'vacio') {
        horasOcupadas.add(bloque.hora);
        if (bloque.rowspan > 1) {
          const inicioIndex = todasLasHoras.indexOf(bloque.hora);
          for (let i = 0; i < bloque.rowspan; i++) {
            if (todasLasHoras[inicioIndex + i]) {
              horasOcupadas.add(todasLasHoras[inicioIndex + i]);
            }
          }
        }
      }
    });
  });

  let primeraHora = '07:00';
  let ultimaHora = '07:00';
  
  if (horasOcupadas.size > 0) {
    const horasOrdenadas = Array.from(horasOcupadas).sort();
    ultimaHora = horasOrdenadas[horasOrdenadas.length - 1];
  }

  const indiceUltimaHora = todasLasHoras.indexOf(ultimaHora);
  const horasAMostrar = todasLasHoras.slice(0, Math.min(indiceUltimaHora + 3, todasLasHoras.length));

  horasAMostrar.forEach((hora, horaIndex) => {
    tablaHorario += `<tr>`;
    tablaHorario += `<td style="font-weight: 600; text-align: center; background: color-mix(in srgb, var(--card) 96%, transparent); border-right: 2px solid var(--border); padding: 12px 8px;">${hora}</td>`;
    
    dias.forEach((dia, diaIndex) => {
      const bloque = bloquesPorDia[dia].find(b => b.hora === hora || 
        (b.rowspan > 1 && todasLasHoras.indexOf(b.hora) <= todasLasHoras.indexOf(hora) && 
         todasLasHoras.indexOf(b.hora) + b.rowspan > todasLasHoras.indexOf(hora)));
      
      const esInicioBloque = bloque && bloque.hora === hora;
      
      if (esInicioBloque && !bloquesRenderizados[dia][bloque.hora]) {
        bloquesRenderizados[dia][bloque.hora] = true;
        
        let contenidoCelda = '';
        const alturaMinima = bloque.rowspan * 60;
        let estilosCelda = `padding: 4px; vertical-align: middle; min-width: 140px; text-align: center; border-left: 1px solid var(--border); height: ${alturaMinima}px;`;
        
        if (bloque.tipo === 'materia') {
          const materia = bloque.materia;
          const nombreCompleto = materia.materia;
          
          contenidoCelda = `
            <div style="
              background: color-mix(in srgb, var(--accent) 20%, transparent);
              border: 2px solid var(--accent);
              border-radius: 10px;
              padding: 12px 10px;
              font-size: 12px;
              line-height: 1.4;
              height: calc(100% - 8px);
              min-height: ${alturaMinima - 8}px;
              display: flex;
              flex-direction: column;
              justify-content: center;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              word-wrap: break-word;
              overflow-wrap: break-word;
            ">
              <div style="
                font-weight: 700; 
                color: var(--text); 
                margin-bottom: 10px; 
                font-size: 13px;
                text-align: center;
                word-wrap: break-word;
                line-height: 1.3;
              ">${nombreCompleto}</div>
              <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px; text-align: center;">Grupo: ${materia.grupo}</div>
              <div style="color: var(--accent); font-size: 10px; font-weight: 600; margin-top: 6px; text-align: center; font-style: italic;">Docente: ${materia.docente}</div>
            </div>
          `;
        } else if (bloque.tipo === 'multiple') {
          contenidoCelda = bloque.materias.map(materia => {
            const nombreCompleto = materia.materia;
            return `
              <div style="
                background: color-mix(in srgb, var(--accent) 15%, transparent);
                border: 1px solid var(--accent);
                border-radius: 8px;
                padding: 10px 8px;
                margin: 4px 0;
                font-size: 11px;
                line-height: 1.3;
                word-wrap: break-word;
                overflow-wrap: break-word;
              ">
                <div style="
                  font-weight: 600; 
                  color: var(--text); 
                  margin-bottom: 4px;
                  text-align: center;
                  word-wrap: break-word;
                  line-height: 1.2;
                ">${nombreCompleto}</div>
                <div style="color: var(--text-secondary); font-size: 10px; text-align: center; margin-bottom: 3px;">Gr: ${materia.grupo}</div>
                <div style="color: var(--accent); font-size: 9px; text-align: center; font-style: italic;">Docente: ${materia.docente}</div>
              </div>
            `;
          }).join('');
        } else {
          contenidoCelda = '';
        }
        
        tablaHorario += `<td style="${estilosCelda}" rowspan="${bloque.rowspan}">
          ${contenidoCelda}
        </td>`;
      } else if (!bloque || (bloque && bloque.hora !== hora && todasLasHoras.indexOf(bloque.hora) > todasLasHoras.indexOf(hora))) {
        const hayBloqueAnterior = bloquesPorDia[dia].some(b => 
          b.rowspan > 1 && 
          todasLasHoras.indexOf(b.hora) < todasLasHoras.indexOf(hora) &&
          todasLasHoras.indexOf(b.hora) + b.rowspan > todasLasHoras.indexOf(hora)
        );
        
        if (!hayBloqueAnterior) {
          tablaHorario += `<td style="padding: 15px 8px; vertical-align: middle; min-width: 140px; border-left: 1px solid var(--border); background: color-mix(in srgb, var(--muted) 5%, transparent); height: 60px;"></td>`;
        }
      }
    });
    tablaHorario += `</tr>`;
  });

  tablaHorario += `
          </tbody>
        </table>
      </div>
      <span style="color: var(--primary); font-size: 16px; font-weight: 600; display: block; margin-top: 15px;">Materias del Período:</span>
      <div style="margin-top: 20px;">
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; width: 100%;">
          ${horarioData.materias.map(materia => `
            <div style="padding: 12px 16px; background: color-mix(in srgb, var(--card) 96%, transparent); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
              <div style="font-weight: 600; color: var(--text); margin-bottom: 3px; line-height: 1.3; font-size: 13px;">${materia.materia}</div>
              <div class="muted" style="font-size: 11px; line-height: 1.3;">
                <div style="margin-bottom: 1px;">Grupo: ${materia.grupo}</div>
                <div>Docente: ${materia.docente}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
  `;

  return tablaHorario;
}


// ========= SISTEMA DE AUTOCOMPLETADO PARA ESTUDIANTES =========
function initStudentAutocomplete(dataFiltrada, studentFilterInput, onSearch) {
  const estudiantesMap = new Map();
  
  dataFiltrada.forEach(record => {
    const id = record.IDENTIFICACION;
    const nombres = `${record.APELLIDOS || ''} ${record.NOMBRES || ''}`.trim();
    
    if (id && nombres && !estudiantesMap.has(id)) {
      estudiantesMap.set(id, {
        id: id,
        nombre: nombres,
        canonNombre: canon(nombres),
        correo: record.CORREO_INSTITUCIONAL || record.CORREO_PERSONAL || '',
        carrera: record.CARRERA || ''
      });
    }
  });
  
  const listaEstudiantes = Array.from(estudiantesMap.values());
  
  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown';
  dropdown.style.cssText = `
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--card, white);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
    z-index: 1000;
    max-height: 300px;
    overflow-y: auto;
    display: none;
    margin-top: 4px;
  `;

  if (!document.querySelector('#student-autocomplete-styles')) {
    const style = document.createElement('style');
    style.id = 'student-autocomplete-styles';
    style.textContent = `
      .autocomplete-dropdown::-webkit-scrollbar {
        width: 8px;
      }
      .autocomplete-dropdown::-webkit-scrollbar-track {
        background: var(--muted, #f1f5f9);
        border-radius: 4px;
      }
      .autocomplete-dropdown::-webkit-scrollbar-thumb {
        background: var(--muted-foreground, #64748b);
        border-radius: 4px;
      }
      .autocomplete-dropdown::-webkit-scrollbar-thumb:hover {
        background: var(--foreground, #0f172a);
      }
    `;
    dropdown.appendChild(style);
  }

  const container = studentFilterInput.parentElement;
  if (container.style.position !== 'relative' && container.style.position !== 'absolute') {
    container.style.position = 'relative';
  }
  container.appendChild(dropdown);

  function showDropdown(filteredEstudiantes) {
    const existingStyle = dropdown.querySelector('style');
    dropdown.innerHTML = '';
    if (existingStyle) dropdown.appendChild(existingStyle);
    
    if (filteredEstudiantes.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    filteredEstudiantes.slice(0, 10).forEach((estudiante, index) => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.style.cssText = `
        padding: 12px 16px;
        cursor: pointer;
        border-bottom: 1px solid var(--border);
        font-size: 14px;
        transition: all 0.15s ease;
        color: var(--text);
        background: transparent;
      `;
      
      if (index === filteredEstudiantes.slice(0, 10).length - 1) {
        item.style.borderBottom = 'none';
      }
      
      item.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 2px; line-height: 1.3;">${estudiante.nombre}</div>
        <div class="item-id" style="font-size: 12px; color: var(--muted); opacity: 0.9; line-height: 1.2;">
          ID: ${estudiante.id} • ${estudiante.carrera}
        </div>
      `;

      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'color-mix(in srgb, var(--accent) 12%, transparent)';
      });
      
      item.addEventListener('mouseleave', () => {
        if (!item.classList.contains('selected')) {
          item.style.backgroundColor = 'transparent';
        }
      });

      item.addEventListener('click', () => {
        studentFilterInput.value = estudiante.nombre;
        hideDropdown();
        onSearch();
      });

      dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
  }

  function hideDropdown() {
    dropdown.style.display = 'none';
  }

  function filterEstudiantes(query) {
    if (!query || query.length < 2) return [];
    
    const queryCanon = canon(query);
    return listaEstudiantes.filter(estudiante => {
      return estudiante.id.includes(query.trim()) || 
             estudiante.canonNombre.includes(queryCanon);
    });
  }

  /* ========= Eventos del autocompletado ========= */
  studentFilterInput?.addEventListener('input', (e) => {
    const query = e.target.value;
    if (query.length < 2) {
      hideDropdown();
      return;
    }
    
    const filtered = filterEstudiantes(query);
    showDropdown(filtered);
  });

  studentFilterInput?.addEventListener('blur', (e) => {
    setTimeout(() => {
      hideDropdown();
    }, 200);
  });

  studentFilterInput?.addEventListener('focus', (e) => {
    const query = e.target.value;
    if (query.length >= 2) {
      const filtered = filterEstudiantes(query);
      showDropdown(filtered);
    }
  });

  studentFilterInput?.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.dropdown-item');
    let currentSelected = dropdown.querySelector('.selected');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!currentSelected) {
        if (items.length > 0) {
          items[0].classList.add('selected');
          items[0].style.backgroundColor = 'var(--accent, #3b82f6)';
          items[0].style.color = 'var(--accent-foreground, white)';
          const idEl = items[0].querySelector('.item-id');
          if (idEl) idEl.style.color = 'rgba(255,255,255,0.9)';
        }
      } else {
        currentSelected.classList.remove('selected');
        currentSelected.style.backgroundColor = '';
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches || 
                      document.body.classList.contains('dark') || 
                      document.documentElement.getAttribute('data-theme') === 'dark';
        
        currentSelected.style.color = isDark ? 'var(--foreground, #e2e8f0)' : 'var(--foreground, #0f172a)';
        const currentIdEl = currentSelected.querySelector('.item-id');
        if (currentIdEl) {
          currentIdEl.style.color = isDark ? 'var(--muted-foreground, #94a3b8)' : 'var(--muted-foreground, #64748b)';
        }
        
        const nextIndex = Array.from(items).indexOf(currentSelected) + 1;
        const nextItem = nextIndex < items.length ? items[nextIndex] : items[0];
        nextItem.classList.add('selected');
        nextItem.style.backgroundColor = 'var(--accent, #3b82f6)';
        nextItem.style.color = 'var(--accent-foreground, white)';
        const nextIdEl = nextItem.querySelector('.item-id');
        if (nextIdEl) nextIdEl.style.color = 'rgba(255,255,255,0.9)';
        
        nextItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!currentSelected) {
        if (items.length > 0) {
          const lastItem = items[items.length - 1];
          lastItem.classList.add('selected');
          lastItem.style.backgroundColor = 'var(--accent, #3b82f6)';
          lastItem.style.color = 'var(--accent-foreground, white)';
          const idEl = lastItem.querySelector('.item-id');
          if (idEl) idEl.style.color = 'rgba(255,255,255,0.9)';
          lastItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } else {
        currentSelected.classList.remove('selected');
        currentSelected.style.backgroundColor = '';
        const isDarkUp = window.matchMedia('(prefers-color-scheme: dark)').matches || 
                        document.body.classList.contains('dark') || 
                        document.documentElement.getAttribute('data-theme') === 'dark';
        
        currentSelected.style.color = isDarkUp ? 'var(--foreground, #e2e8f0)' : 'var(--foreground, #0f172a)';
        const currentIdEl = currentSelected.querySelector('.item-id');
        if (currentIdEl) {
          currentIdEl.style.color = isDarkUp ? 'var(--muted-foreground, #94a3b8)' : 'var(--muted-foreground, #64748b)';
        }
        
        const prevIndex = Array.from(items).indexOf(currentSelected) - 1;
        const prevItem = prevIndex >= 0 ? items[prevIndex] : items[items.length - 1];
        prevItem.classList.add('selected');
        prevItem.style.backgroundColor = 'var(--accent, #3b82f6)';
        prevItem.style.color = 'var(--accent-foreground, white)';
        const prevIdEl = prevItem.querySelector('.item-id');
        if (prevIdEl) prevIdEl.style.color = 'rgba(255,255,255,0.9)';
        
        prevItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentSelected) {
        currentSelected.click();
      } else {
        onSearch();
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
      studentFilterInput.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!studentFilterInput.contains(e.target) && !dropdown.contains(e.target)) {
      hideDropdown();
    }
  });
}

// ========= CÓDIGO PRINCIPAL =========
document.addEventListener('DOMContentLoaded', async () => {
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

  const keyHorarios = 'academicTrackingData_REPORTE_NOMINA_CARRERA_DOCENTES_MATERIA___HORARIOS_xlsx';
  const horariosData = await loadData(keyHorarios);
  if (!Array.isArray(horariosData)) {
    console.warn("⚠️ No se pudieron cargar los datos de horarios desde IndexedDB");
  }

const keyEstudiantes = 'academicTrackingData_REPORTE_NOMINA_ESTUDIANTES_MATRICULADOS_LEGALIZADOS_xlsx';
const estudiantesData = await loadData(keyEstudiantes);
if (!Array.isArray(estudiantesData)) {
  console.warn("⚠️ No se pudieron cargar los datos de estudiantes matriculados desde IndexedDB");
}

const estudiantesMap = new Map();
if (Array.isArray(estudiantesData)) {
  estudiantesData.forEach(est => {
    const id = norm(est.IDENTIFICACION);
    if (id) {
      const fechaNacimiento = norm(est['FECHA NACIMIENTO']);
      let edad = null;
      
      // Calcular edad si existe fecha de nacimiento
      if (fechaNacimiento) {
        let fechaNac;
        
        // Manejar formato DD/MM/YYYY (día/mes/año)
        if (typeof fechaNacimiento === 'string' && fechaNacimiento.includes('/')) {
          const partes = fechaNacimiento.split('/');
          if (partes.length === 3) {
            const dia = partes[0].padStart(2, '0');   // Primer elemento es el día
            const mes = partes[1].padStart(2, '0');   // Segundo elemento es el mes
            const año = partes[2];                    // Tercer elemento es el año
            
            // Crear fecha en formato ISO (YYYY-MM-DD) para evitar confusiones
            fechaNac = new Date(`${año}-${mes}-${dia}`);
          }
        } else {
          fechaNac = new Date(fechaNacimiento);
        }
        
        const fechaActual = new Date();
        
        // Verificar que la fecha sea válida
        if (!isNaN(fechaNac.getTime())) {
          // Calcular diferencia de años
          edad = fechaActual.getFullYear() - fechaNac.getFullYear();
          
          // Obtener mes y día actual
          const mesActual = fechaActual.getMonth(); // 0-11 (enero=0)
          const diaActual = fechaActual.getDate();  // 1-31
          
          // Obtener mes y día de nacimiento
          const mesNacimiento = fechaNac.getMonth(); // 0-11 (enero=0)
          const diaNacimiento = fechaNac.getDate();  // 1-31
          
          // Si no ha cumplido años este año, restar 1
          if (mesActual < mesNacimiento || 
              (mesActual === mesNacimiento && diaActual < diaNacimiento)) {
            edad--;
          }
        }
      }
      
      estudiantesMap.set(id, {
        sexo: norm(est.SEXO),
        etnia: norm(est.ETNIA),
        discapacidad: norm(est.DISCAPACIDAD),
        porcentajeDiscapacidad: norm(est['PORCENTAJE DISCAPACIDAD']),
        numeroHijos: norm(est['NUMERO HIJOS']),
        fechanac: fechaNacimiento,
        edad: edad,
        ciudadResidencia: norm(est['CIUDAD RESIDENCIA'])
      });
    }
  });
}


  backToMenuButton.addEventListener('click', () => {
    window.location.href = '../index.html';
  });

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

  initStudentAutocomplete(dataFiltrada, studentFilterInput, buscar);

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
    const correos = Array.from(new Set(records.flatMap(r => [norm(r.CORREO_INSTITUCIONAL), norm(r.CORREO_PERSONAL)]).filter(Boolean))).join(', ').toLowerCase();
    const telefono = norm(first.CELULAR);
    const carrera = norm(first.CARRERA);
    const aprobadas = records.filter(r => canon(r.ESTADO) === 'APROBADA').length;
    const reprobadas = records.filter(r => canon(r.ESTADO) === 'REPROBADA').length;

    const datosAdicionales = estudiantesMap.get(cedula) || {};
    const sexo = datosAdicionales.sexo || '-';
    const etnia = datosAdicionales.etnia || '-';
    const discapacidad = datosAdicionales.discapacidad || '-';
    const porcentajeDiscapacidad = datosAdicionales.porcentajeDiscapacidad || '';
    const numeroHijos = datosAdicionales.numeroHijos || '-';
    const fechaNacimiento = datosAdicionales.fechanac || '-';
    const edad = datosAdicionales.edad || '-';
    const ciudadResidencia = datosAdicionales.ciudadResidencia || '-';

    const discapacidadCompleta = discapacidad !== '-' && porcentajeDiscapacidad 
      ? `${discapacidad} (${porcentajeDiscapacidad}%)`
      : discapacidad;

    const periodos = Array.from(new Set(records.map(r => r.PERIODO))).sort(cmpPeriodo);
    
    const todosLosPromedios = records.map(r => asNum(r.PROMEDIO)).filter(v => v !== null);
    const promedioGeneral = todosLosPromedios.length 
      ? (todosLosPromedios.reduce((a, b) => a + b, 0) / todosLosPromedios.length) 
      : null;

    studentHeading.textContent = `Datos Generales de ${nombre}`;
    
    // Crear la URL de la foto usando la cédula
    const fotoUrl = `http://67.205.132.245/get_photoSIUG.php?cedula=${cedula}`;
    
    studentInfoBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px 10px; background: color-mix(in srgb, var(--card) 98%, transparent);">
          <div style="display: flex; align-items: flex-start; gap: 25px; justify-content: center; flex-wrap: wrap;">
            <!-- Logo FACAF -->
            <div style="flex-shrink: 0; margin-left: 40px;">
              <style>
                .logo-container .logo-light { display: block; }
                .logo-container .logo-dark { display: none; }
                .dark-mode .logo-container .logo-light,
                html.dark-mode .logo-container .logo-light { display: none; }
                .dark-mode .logo-container .logo-dark,
                html.dark-mode .logo-container .logo-dark { display: block; }
              </style>
              <div class="logo-container">
                <img 
                  src="../recursos/FACAF-CUADRADO.png" 
                  style="
                    width: 200px;
                    height: 200px;
                    object-fit: contain;
                  " 
                  alt="Logo FACAF"
                  class="logo-light"
                />
                <img 
                  src="../recursos/FACAF-CUADRADO-NEGATIVO.png" 
                  style="
                    width: 200px;
                    height: 200px;
                    object-fit: contain;
                  " 
                  alt="Logo FACAF"
                  class="logo-dark"
                />
              </div>
            </div>
            
            <!-- Foto del estudiante -->
            <div style="flex-shrink: 0;">
              <img 
                src="${fotoUrl}" 
                width="150px" 
                style="
                  border-radius: 12px; 
                  box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
                  border: 3px solid var(--border);
                  object-fit: cover;
                  height: 180px;
                  width: 150px;
                " 
                alt="Foto de ${nombre}"
                onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
              />
              <div style="
                display: none;
                width: 150px;
                height: 180px;
                background: color-mix(in srgb, var(--muted) 20%, transparent);
                border: 2px dashed var(--border);
                border-radius: 12px;
                align-items: center;
                justify-content: center;
                color: var(--muted-foreground);
                font-size: 12px;
                text-align: center;
                flex-direction: column;
                gap: 8px;
              ">
                <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V19A2 2 0 0 0 5 21H19A2 2 0 0 0 21 19V9M19 9H14V4H19V9Z"/>
                </svg>
                <span>Foto no<br/>disponible</span>
              </div>
            </div>
            
            <!-- Información del estudiante -->
            <div style="flex: 1; min-width: 300px; text-align: left;">
              <h3 style="margin: 0 0 20px 0; color: var(--primary); font-size: 22px; font-weight: 700; text-transform: uppercase;">
                ${nombre}
              </h3>
              
              <div style="display: grid; grid-template-columns: auto 1fr; gap: 12px 20px; font-size: 15px;">
                <span style="font-weight: 700; color: var(--primary); font-size: 16px;">Cédula:</span>
                <span style="color: var(--text); font-weight: 600; font-size: 16px;">${cedula || '-'}</span>
                
                <span style="font-weight: 700; color: var(--primary);">Carrera:</span>
                <span style="color: var(--text); font-weight: 500;">${carrera || '-'}</span>
                
                <span style="font-weight: 700; color: var(--primary);">Promedio General:</span>
                <span style="color: var(--primary); font-weight: 700; font-size: 16px;">${promedioGeneral !== null ? promedioGeneral.toFixed(2) : '-'}</span>
                
                <span style="font-weight: 700; color: var(--primary);">Aprobadas / Reprobadas:</span>
                <span style="color: var(--text); font-weight: 600;">${aprobadas} / <span style="color: var(--destructive); font-weight: 700;">${reprobadas}</span></span>
              </div>
            </div>
          </div>
        </td>
      </tr>
      <tr><th style="width:160px;">Correos</th><td colspan="3">${correos || '-'}</td></tr>
      <tr><th>Teléfono</th><td>${telefono || '-'}</td><th>Sexo</th><td>${sexo}</td></tr>
      <tr><th>Fecha Nacimiento</th><td>${fechaNacimiento}</td><th>Edad</th><td>${edad}</td></tr>
      <tr><th>Ciudad Residencia</th><td>${ciudadResidencia}</td><th>Etnia</th><td>${etnia}</td></tr>
      <tr><th>Discapacidad</th><td>${discapacidadCompleta}</td><th>Número de Hijos</th><td>${numeroHijos}</td></tr>
    `;

    // No necesitamos función de actualización, CSS lo maneja
    function updateLogos() {
        // CSS maneja automáticamente la visibilidad
        return;
    }

    // No necesario setTimeout para logos

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

    if (horariosData && horariosData.length > 0) {
      const horarioEstudiante = generarHorarioEstudiante(records, horariosData);
      const horarioHtml = renderHorarioEstudiante(horarioEstudiante);
      
      const horarioContainer = document.getElementById('horarioContainer') || 
                              (() => {
                                const div = document.createElement('div');
                                div.id = 'horarioContainer';
                                studentAccordion.parentNode.appendChild(div);
                                return div;
                              })();
      horarioContainer.innerHTML = horarioHtml;
    }

    // Disparar evento
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('student-rendered'));
    }, 100);
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
    
    const dropdown = document.querySelector('.autocomplete-dropdown');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
    
    const horarioContainer = document.getElementById('horarioContainer');
    if (horarioContainer) {
      horarioContainer.innerHTML = '';
    }
    
    sectionDistribucion.style.display = '';
    sectionPromedioNivel.style.display = '';  
    sectionHeatmaps.style.display = '';
    
    studentDetails.style.display = 'none';
    
    if (lineChart) { 
      lineChart.destroy(); 
      lineChart = null; 
    }
    if (barsChart) { 
      barsChart.destroy(); 
      barsChart = null; 
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  clearButton.addEventListener('click', reset);
  studentFilterInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); if (e.key === 'Escape') reset(); });
  studentFilterInput.addEventListener('input', () => { if (studentFilterInput.value.trim() === '') showGeneralView(); });
  searchButton.addEventListener('click', buscar);
});