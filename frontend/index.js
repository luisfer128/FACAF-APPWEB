// index.js
import { loadData, saveData, removeData } from './indexeddb-storage.js';
import { ensureSessionGuard, scheduleAutoLogout } from './auth-session.js';

const API_BASE = 'http://178.128.10.70:5000';

let __roleReloading = false; // evita continuar flujo si vamos a recargar

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await ensureSessionGuard();
  if (!ok) return;
  await scheduleAutoLogout();

  const menuContainer = document.getElementById('menu-container');
  const menuGrid = menuContainer?.querySelector('.menu-grid');
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  // ---------- Tema (dark / light) ----------
  let btn = document.getElementById('theme-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'theme-toggle';
    document.body.appendChild(btn);
  }

  function updateToggleUI() {
    const isDark = document.documentElement.classList.contains('dark-mode');
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    btn.setAttribute('title', isDark ? 'Modo claro' : 'Modo oscuro');
    btn.setAttribute('aria-pressed', String(isDark));
  }

  // Evita listeners duplicados
  btn.replaceWith(btn.cloneNode(true));
  btn = document.getElementById('theme-toggle');

  // Estado inicial desde localStorage
  const initialTheme = localStorage.getItem('theme');
  if (initialTheme === 'dark') document.documentElement.classList.add('dark-mode');
  if (initialTheme === 'light') document.documentElement.classList.remove('dark-mode');

  btn.addEventListener('click', () => {
    const root = document.documentElement;
    const willDark = !root.classList.contains('dark-mode');
    root.classList.toggle('dark-mode', willDark);
    localStorage.setItem('theme', willDark ? 'dark' : 'light');
    updateToggleUI();
  }, { passive: true });

  updateToggleUI();

  // ---------- Helpers ----------
  const normalizeFileName = (fileName) => fileName.replace(/\W+/g, "_");

  const buildFilesSignature = (files) => {
    if (!Array.isArray(files)) return '';
    const rows = files.map(f => {
      const nombre = String(f.nombre ?? f.NombreArchivo ?? '').trim();
      const id = String(f.id ?? '').trim();
      const fecha = String(f.fecha ?? f.fechaSubida ?? f.FechaSubida ?? f.updatedAt ?? f.actualizado ?? '').trim();
      const tam = String(f.tamano ?? f.size ?? f.length ?? '').trim();
      return `${nombre}|${id}|${fecha}|${tam}`;
    });
    return rows.sort().join('::');
  };

  const showOverlay = (msg = 'Procesando datos...') => {
    if (loadingText) loadingText.textContent = ` ${msg}`;
    if (overlay) overlay.style.display = 'flex';
  };
  const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

  function getRoleFromUserData(obj) {
    try {
      const nested = obj?.usuario?.rol ?? obj?.rol;
      return String(nested ?? '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  function getUsernameFromUserData(obj) {
    try {
      const a = obj?.usuario;
      if (a && typeof a === 'object' && typeof a.usuario === 'string') return a.usuario.trim();
      if (typeof a === 'string' && a.trim()) return a.trim();
      if (typeof obj?.email === 'string') return obj.email.trim();
      return '';
    } catch {
      return '';
    }
  }

  async function ensureXLSXLoaded() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar SheetJS'));
      document.head.appendChild(s);
    });
  }

  async function openAdmin(username) {
    try {
      const resp = await fetch(`${API_BASE}/admin/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: username })
      });
      if (!resp.ok) {
        alert('No autorizado para entrar a Administración.');
        return;
      }
      const { url } = await resp.json();
      window.location.href = `${url}`;
    } catch (e) {
      console.error(e);
      alert('Error al solicitar acceso a Administración.');
    }
  }

  // ---------- Cargar plantillas por defecto si no existen ----------
  async function ensureEmailTemplates() {
    try {
      // Verificar si ya existen plantillas locales
      const local = await loadData('emailTemplates');
      if (local) {
        console.log('✅ Plantillas de email ya existen en IndexedDB');
        return;
      }

      console.log('📧 Cargando plantillas de email por defecto...');
      
      // Intentar cargar desde la API
      const res = await fetch(`${API_BASE}/plantillas`);
      const data = await res.json();

      // Crear objeto con plantillas (API + valor por defecto para correoAutoridad)
      const templates = {
        correoAutoridad: 'alvaro.espinozabu@ug.edu.ec', // valor por defecto
        autoridad: data.autoridad || '',
        docente: data.docente || '',
        estudiante: data.estudiante || ''
      };

      // Guardar en IndexedDB
      await saveData('emailTemplates', templates);
      console.log('✅ Plantillas de email cargadas desde la API y guardadas localmente');

    } catch (error) {
      console.warn('⚠️ Error al cargar plantillas desde la API, usando valores por defecto:', error);
      
      // Si falla la API, usar plantillas vacías con correo por defecto
      const fallbackTemplates = {
        correoAutoridad: 'alvaro.espinozabu@ug.edu.ec',
        autoridad: '',
        docente: '',
        estudiante: ''
      };

      await saveData('emailTemplates', fallbackTemplates);
      console.log('✅ Plantillas de email por defecto guardadas localmente');
    }
  }

  // ---------- Validar rol contra backend y refrescar si cambió ----------
  async function validateRoleAndRefreshIfChanged() {
    const userData = (await loadData('userData')) || {};
    const storedRole = getRoleFromUserData(userData);
    const username = getUsernameFromUserData(userData);
    if (!username) return;

    try {
      const url = `${API_BASE}/usuarios?q=${encodeURIComponent(username)}&limit=1&page=0`;
      const resp = await fetch(url);
      if (!resp.ok) return;

      const bodyText = await resp.text();
      let body;
      try { body = JSON.parse(bodyText); } catch { body = {}; }

      const rows = Array.isArray(body?.data) ? body.data
                 : Array.isArray(body)       ? body
                 : Array.isArray(body?.rows) ? body.rows
                 : [];

      if (!rows.length) return;

      // Toma el que matchee exactamente el usuario; si no, el primero.
      const match = rows.find(r => String(r?.usuario ?? '').toLowerCase() === username.toLowerCase()) || rows[0];
      const backendRole = String(match?.rol ?? '').trim().toLowerCase();
      if (!backendRole) return;

      if (backendRole !== storedRole) {
        // Actualiza userData y recarga
        if (userData?.usuario && typeof userData.usuario === 'object') {
          userData.usuario.rol = backendRole;
        } else {
          userData.rol = backendRole;
        }
        await saveData('userData', userData);

        __roleReloading = true;
        location.reload(); 
      }
    } catch (e) {
      console.warn('No se pudo validar rol en backend:', e);
    }
  }

  // ---------- Sincronización (solo con cambios) ----------
  async function syncFilesFromBackendIfNeeded() {
    try {
      const resp = await fetch(`${API_BASE}/files`);
      if (!resp.ok) throw new Error(`/files respondió ${resp.status}`);
      const files = await resp.json();

      const currentSignature = buildFilesSignature(files);
      const storedSignature = await loadData('filesSignature');

      if (storedSignature && storedSignature === currentSignature) {
        return false;
      }

      showOverlay('Preparando sincronización...');
      await ensureXLSXLoaded();

      const processedFiles = [];
      const total = files.length;
      let done = 0;

      for (const f of files) {
        const nombre = f.nombre ?? f.NombreArchivo;
        const id = f.id;
        if (!nombre || !id) { done++; continue; }

        showOverlay(`Descargando "${nombre}" (${done + 1}/${total})...`);
        const fileRes = await fetch(`${API_BASE}/download/${id}`);
        if (!fileRes.ok) { console.warn('No se pudo descargar:', nombre, id); done++; continue; }

        const blob = await fileRes.blob();
        showOverlay(`Procesando "${nombre}" (${done + 1}/${total})...`);
        const arrayBuffer = await blob.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const key = `academicTrackingData_${normalizeFileName(nombre)}`;
        await saveData(key, jsonData);
        processedFiles.push(nombre);
        done++;
      }

      await saveData('processedFiles', processedFiles);
      await saveData('filesSignature', currentSignature);
      return true;
    } catch (err) {
      console.error('⚠️ Error al sincronizar con backend:', err);
      return false;
    } finally {
      hideOverlay();
    }
  }

  // ---------- Detectar y guardar el último PERIODO + dataset filtrado ----------
  function findLatestPeriod(periods) {
    return periods.sort((a, b) => String(b).localeCompare(String(a)))[0];
  }

  async function applyLatestPeriodFromReport() {
    const TOTAL_KEY = 'academicTrackingData_' + normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL_TOTAL.xlsx');
    let data = await loadData(TOTAL_KEY);

    if (!Array.isArray(data) || data.length === 0) {
      const ALT_KEY = 'academicTrackingData_' + normalizeFileName('REPORTE_RECORD_CALIFICACIONES_POR_PARCIAL.xlsx');
      data = await loadData(ALT_KEY);
      if (!Array.isArray(data) || data.length === 0) {
        console.warn('ℹ️ No se encontró dataset TOTAL ni PARCIAL para obtener PERIODO.');
        return;
      }
    }

    const periods = [...new Set(
      data.map(r => (r['PERIODO'] ?? '').toString().trim()).filter(Boolean)
    )];

    if (periods.length === 0) {
      console.warn('ℹ️ No se encontraron valores de PERIODO en el dataset.');
      return;
    }

    const latest = findLatestPeriod(periods);
    const filtered = data.filter(r => (r['PERIODO'] ?? '').toString().trim() === latest);

    localStorage.setItem('selectedPeriod', latest);
    await saveData('academicTrackingData_REPORTE_POR_SEMESTRE', filtered);
    await saveData('lastPeriodUpdatedAt', new Date().toISOString());

  }

  // ---------- Menú ----------
  function populateMenu(isAdmin, username) {
    if (!menuContainer || !menuGrid) return;

    const items = [
      { icon: 'fas fa-user-check',         title: 'Seguimiento Académico', description: 'Notificaciones a docente y estudiantes por 2da y 3era vez registrados', url: 'Modules/academic-tracking.html' },
      { icon: 'fas fa-child',              title: 'Control NEE',           description: 'Seguimiento a estudiantes con necesidades especiales',                 url: 'Modules/nee-control.html' },
      { icon: 'fas fa-users',              title: 'Tercera Matrícula',     description: 'Notificaciones para estudiantes con tercera matricula NO registrados', url: 'Modules/tercera-matricula.html' },
      { icon: 'fas fa-clipboard',          title: 'Control Parcial',       description: 'Estudiantes reprobados por asistencia o calificación hasta 1er. parcial', url: 'Modules/control-parcial.html' },
      { icon: 'fas fa-flag-checkered',     title: 'Control Final',         description: 'Estudiantes reprobados final parcial',                                url: 'Modules/control-final.html' },
      { icon: 'fas fa-trophy',             title: 'Top Promedios',         description: 'Consulta de los tops 5 en promedio por carrera',                      url: 'Modules/top-promedios.html' },
      { icon: 'fas fa-graduation-cap',     title: 'Consulta Estudiante',   description: 'Revisión de historial académico por estudiante',                       url: 'Modules/consulta-estudiante.html' },
      { icon: 'fas fa-user',               title: 'Consulta Docente',      description: 'Revisión de historial académico por Docente',                          url: 'Modules/consulta-docente.html' },
      { icon: 'fas fa-chalkboard-teacher', title: 'Distribución Docente',  description: 'Carga académica y clases (mapa calor)',                                url: 'Modules/distribucion-docente.html' },
      { icon: 'fas fa-chart-bar',          title: 'Reportes',              description: 'Estadística general de los datos ingresados',                          url: 'Modules/reportes.html' },
      { icon: 'fas fa-cogs',               title: 'Configuración',         description: 'Configuración y parametrizaciones generales del sistema',              url: 'Modules/config.html' },
    ];

    if (isAdmin) {
      items.push({
        icon: 'fas fa-cogs',
        title: 'Administración',
        description: 'Panel de administración de usuarios',
        onClick: () => openAdmin(username)
      });
    }

    // Render
    menuGrid.innerHTML = '';
    for (const item of items) {
      const el = document.createElement('a');
      el.className = 'menu-item';
      el.innerHTML = `<i class="${item.icon}"></i><h3>${item.title}</h3><p>${item.description}</p>`;
      if (item.onClick) {
        el.href = '#';
        el.addEventListener('click', (e) => { e.preventDefault(); item.onClick(); });
      } else {
        el.href = item.url;
      }
      menuGrid.appendChild(el);
    }

    // Botón cerrar sesión (al final del contenedor)
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Cerrar Sesión';
    logoutBtn.classList.add('logout-button');
    logoutBtn.onclick = async () => {
      await removeData('isLoggedIn');
      await removeData('sessionExpiresAt');
      await removeData('userData');
      location.href = 'login.html';
    };
    menuContainer.appendChild(logoutBtn);
  }

  // ---------- Flujo principal ----------
  const isLoggedIn = await loadData('isLoggedIn');
  if (!isLoggedIn) {
    location.href = 'login.html';
    return;
  }

  await validateRoleAndRefreshIfChanged();
  if (__roleReloading) return;

  // Asegurar que existan las plantillas de email
  await ensureEmailTemplates();

  const didSync = await syncFilesFromBackendIfNeeded();

  if (didSync) {
    await applyLatestPeriodFromReport();
  } else {
  }

  // 3) Render del menú
  const userData = (await loadData('userData')) || {};
  const isAdmin = getRoleFromUserData(userData) === 'admin';
  const username = getUsernameFromUserData(userData);
  populateMenu(isAdmin, username);
});