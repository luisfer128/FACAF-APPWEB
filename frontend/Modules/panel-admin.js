// Modules/admin.js
import { loadData, saveData } from '../indexeddb-storage.js';

const API_BASE = 'http://178.128.10.70:5000';
const DEBUG = false;

// ====== DOM ======
const overlay      = document.getElementById('loading-overlay');
const usersTbody   = document.getElementById('usersTbody');
const usersTable   = document.getElementById('usersTable');

const usuarioInput = document.getElementById('usuario-input');
const rolSelect    = document.getElementById('rol-select');
const activoCheck  = document.getElementById('activo-check');
const activoLabel  = document.getElementById('activo-label');

const createUserBtn = document.getElementById('createUserBtn');
const updateUserBtn = document.getElementById('updateUserBtn');
const clearFormBtn  = document.getElementById('clearFormBtn');
const refreshBtn    = document.getElementById('refreshUsersBtn');

const searchText    = document.getElementById('searchText');
const filterRol     = document.getElementById('filterRol');
const filterActivo  = document.getElementById('filterActivo');

const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');
const loadMoreBtn     = document.getElementById('loadMoreBtn');

const statTotal   = document.getElementById('stat-total');
const statAdmins  = document.getElementById('stat-admins');
const statActivos = document.getElementById('stat-activos');

// ====== Modal helpers ======
function openModal({ title = 'Aviso', message = '', showCancel = false, acceptText = 'Aceptar', cancelText = 'Cancelar', icon = null }) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('modal-backdrop');
    const t = document.getElementById('modal-title');
    const m = document.getElementById('modal-message');
    const ok = document.getElementById('modal-accept');
    const ko = document.getElementById('modal-cancel');
    const ic = document.getElementById('modal-icon');

    if (!backdrop || !t || !m || !ok || !ko) return resolve(false);

    t.textContent = title;
    m.textContent = message;

    if (icon) {
      ic.style.display = '';
      ic.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    } else {
      ic.style.display = 'none';
    }

    ok.textContent = acceptText || 'Aceptar';
    ko.textContent = cancelText || 'Cancelar';
    ko.style.display = showCancel ? '' : 'none';

    const onClose = (val) => {
      backdrop.style.display = 'none';
      ok.removeEventListener('click', onOk);
      ko.removeEventListener('click', onKo);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEsc);
      resolve(val);
    };
    const onOk = () => onClose(true);
    const onKo = () => onClose(false);
    const onBackdrop = (e) => { if (e.target === backdrop) onClose(false); };
    const onEsc = (e) => { if (e.key === 'Escape') onClose(false); };

    ok.addEventListener('click', onOk);
    ko.addEventListener('click', onKo);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);

    backdrop.style.display = 'flex';
  });
}
function modalInfo(message, title = 'Aviso') { return openModal({ title, message, showCancel: false, acceptText: 'Entendido', icon: 'fa-circle-info' }); }
function modalError(message, title = 'Error') { return openModal({ title, message, showCancel: false, acceptText: 'Cerrar', icon: 'fa-triangle-exclamation' }); }
function modalConfirm(message, title = 'Confirmar', acceptText = 'Sí', cancelText = 'No') { return openModal({ title, message, showCancel: true, acceptText, cancelText, icon: 'fa-circle-question' }); }

// ====== Error banner ======
const errorBannerId = 'admin-error-banner';
function showErrorBanner(msg) {
  let el = document.getElementById(errorBannerId);
  if (!el) {
    el = document.createElement('div');
    el.id = errorBannerId;
    el.style.cssText = 'margin:10px 0;padding:10px;border-radius:8px;border:1px solid #fca5a5;background:#fee2e2;color:#991b1b;font-weight:600;';
    usersTable?.parentElement?.insertAdjacentElement('beforebegin', el);
  }
  el.textContent = msg;
}
function hideErrorBanner() {
  const el = document.getElementById(errorBannerId);
  if (el) el.remove();
}

// ====== Estado ======
let USERS_CACHE = [];          // datos ya cargados (paginados)
let selectedId  = null;
let page        = 0;
const PAGE_SIZE = 20;

let sortBy  = 'id';
let sortDir = 'desc';

const CACHE_KEY = 'admin_users_cache_v2';

// ====== Utils ======
const showOverlay = (msg = 'Procesando...') => {
  if (overlay) {
    overlay.style.display = 'flex';
    const spinner = overlay.querySelector('.loading-spinner');
    if (spinner) spinner.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`;
  }
};
const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

const norm   = v => (v ?? '').toString().trim();
const asBool = v => (v === true || v === 1 || v === '1' || v === 'true' || v === 'True');

async function toast(msg) { await modalInfo(msg, 'Aviso'); }

function badgeRol(rol) {
  const isAdmin = rol === 'admin';
  const cls  = isAdmin ? 'badge admin' : 'badge user';
  const icon = isAdmin ? 'fa-shield-halved' : 'fa-user';
  return `<span class="${cls}"><i class="fa-solid ${icon}"></i> ${rol}</span>`;
}
function statusDot(on) { return `<span class="status-dot ${on ? 'on' : 'off'}" title="${on ? 'Activo' : 'Inactivo'}"></span>`; }

function mapUser(x) {
  if (!x || typeof x !== 'object') return null;
  const row = x.data ?? x;
  return {
    id: Number(row.id),
    usuario: norm(row.usuario),
    rol: norm(row.rol || 'usuario').toLowerCase(),
    activo: !!asBool(row.activo),
  };
}

function getRoleFromUserData(obj) {
  try {
    const nested = obj?.usuario?.rol ?? obj?.rol;
    return String(nested ?? '').trim().toLowerCase();
  } catch { return ''; }
}
function getUsernameFromUserData(obj) {
  try {
    const a = obj?.usuario;
    if (a && typeof a === 'object' && typeof a.usuario === 'string') return a.usuario.trim();
    if (typeof a === 'string' && a.trim()) return a.trim();
    if (typeof obj?.email === 'string') return obj.email.trim();
    return '';
  } catch { return ''; }
}

// ====== Render ======
function rowTemplate(u) {
  return `
    <tr data-id="${u.id}">
      <td>${u.id}</td>
      <td>${u.usuario}</td>
      <td>${badgeRol(u.rol)}</td>
      <td>${statusDot(u.activo)}</td>
      <td class="row-actions">
        <button class="file-action-btn" data-action="pick"   title="Seleccionar">
          <i class="fa-solid fa-hand-pointer"></i> Seleccionar
        </button>
        <button class="file-action-btn" data-action="toggle" title="Activar/Desactivar">
          <i class="fa-solid fa-toggle-on"></i> Activar/Desactivar
        </button>
      </td>
    </tr>
  `;
}

function renderTable(list, { append = false } = {}) {
  if (!usersTbody) return;
  if (!append) usersTbody.innerHTML = '';
  const html = list.map(rowTemplate).join('');
  if (append) usersTbody.insertAdjacentHTML('beforeend', html);
  else usersTbody.innerHTML = html;

  selectedId = null;
  updateUserBtn.disabled = true;
}

// ====== API helpers ======
async function apiHealth() {
  try {
    const r = await fetch(`${API_BASE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

function pickRowsFromAnyShape(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.rows)) return json.rows;
  if (Array.isArray(json?.data?.rows)) return json.data.rows;
  return [];
}

async function safeJson(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// ====== API ======
async function apiListUsers({ q = '', rol = '', activo = '', page = 0, limit = PAGE_SIZE, sort_by = 'id', sort_dir = 'desc' } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (rol) params.set('rol', rol);
  if (activo !== '') params.set('activo', activo); // '1' | '0' | ''
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sort_by', sort_by);
  params.set('sort_dir', sort_dir);

  const url = `${API_BASE}/usuarios?${params.toString()}`;
  if (DEBUG) console.log('[GET]', url);

  const resp = await fetch(url);
  const body = await safeJson(resp);
  if (!resp.ok) {
    if (DEBUG) console.error('GET /usuarios FAILED', resp.status, body);
    throw new Error(`/usuarios respondió ${resp.status}`);
  }

  const rowsRaw = pickRowsFromAnyShape(body);
  const rows = rowsRaw.map(mapUser).filter(Boolean);
  const total = Number(body?.total ?? rows.length);

  if (DEBUG) console.log('GET /usuarios ->', { count: rows.length, total, sample: rows[0] });
  return { rows, total };
}

async function apiCreateUser({ usuario, rol = 'usuario', activo = true }) {
  const payload = { usuario, rol, activo: !!activo };
  if (DEBUG) console.log('[POST] /usuarios', payload);
  const resp = await fetch(`${API_BASE}/usuarios`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const out = await safeJson(resp);
  if (!resp.ok) {
    if (DEBUG) console.error('POST /usuarios FAILED', resp.status, out);
    throw new Error(out?.error || 'No se pudo crear usuario');
  }
  const u = mapUser(out?.data);
  if (DEBUG) console.log('POST /usuarios ->', u);
  return u;
}

async function apiUpdateUser(id, { usuario, rol, activo }) {
  const body = {};
  if (usuario !== undefined) body.usuario = usuario;
  if (rol      !== undefined) body.rol     = rol;
  if (activo   !== undefined) body.activo  = !!activo;

  if (DEBUG) console.log('[PUT] /usuarios/' + id, body);
  const resp = await fetch(`${API_BASE}/usuarios/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const out = await safeJson(resp);
  if (!resp.ok) {
    if (DEBUG) console.error('PUT /usuarios FAILED', resp.status, out);
    throw new Error(out?.error || 'No se pudo actualizar usuario');
  }
  const u = mapUser(out?.data);
  if (DEBUG) console.log('PUT /usuarios ->', u);
  return u;
}

// ====== Stats desde el backend ======
async function refreshStatsFromServer() {
  try {
    const t = await apiListUsers({ limit: 1, page: 0, sort_by: 'id', sort_dir: 'desc' });
    if (statTotal) statTotal.textContent = t.total;

    const a = await apiListUsers({ limit: 1, page: 0, rol: 'admin' });
    if (statAdmins) statAdmins.textContent = a.total;

    const ac = await apiListUsers({ limit: 1, page: 0, activo: '1' });
    if (statActivos) statActivos.textContent = ac.total;
  } catch (e) {
    const list = USERS_CACHE;
    if (statTotal)  statTotal.textContent  = list.length;
    if (statAdmins) statAdmins.textContent = list.filter(u => u.rol === 'admin').length;
    if (statActivos)statActivos.textContent= list.filter(u => u.activo).length;
  }
}

// ====== Carga / Paginación / Filtros ======
function currentFilters() {
  return {
    q: norm(searchText?.value ?? ''),
    rol: norm(filterRol?.value ?? '').toLowerCase(),
    activo: norm(filterActivo?.value ?? ''),
  };
}

async function refreshUsers({ reset = true } = {}) {
  hideErrorBanner();
  const { q, rol, activo } = currentFilters();
  if (reset) page = 0;

  showOverlay(`Cargando usuarios...`);
  try {
    let { rows, total } = await apiListUsers({
      q, rol, activo,
      page, limit: PAGE_SIZE,
      sort_by: sortBy, sort_dir: sortDir,
    });

    // Si vino vacío, reintenta sin filtros con límite alto
    if (rows.length === 0 && page === 0) {
      if (DEBUG) console.warn('Lista vacía. Reintentando sin filtros (limit=1000)...');
      const retry = await apiListUsers({ page: 0, limit: 1000, sort_by: 'id', sort_dir: 'desc' });
      if (retry.rows.length > 0) {
        rows = retry.rows;
        total = retry.total;
        if (searchText)  searchText.value = '';
        if (filterRol)   filterRol.value = '';
        if (filterActivo)filterActivo.value = '';
      }
    }

    if (reset) {
      USERS_CACHE = rows;
      renderTable(USERS_CACHE, { append: false });
      await saveData(CACHE_KEY, USERS_CACHE);
    } else {
      USERS_CACHE = [...USERS_CACHE, ...rows];
      renderTable(rows, { append: true });
      await saveData(CACHE_KEY, USERS_CACHE);
    }

    await refreshStatsFromServer();

    if (total === 0) {
      if (await modalConfirm(
        'No hay usuarios en la base de datos.\n¿Deseas crear un usuario administrador de prueba (admin@local)?',
        'Sembrar administrador',
        'Crear',
        'Cancelar'
      )) {
        await apiCreateUser({ usuario: 'admin@local', rol: 'admin', activo: true });
        await refreshUsers({ reset: true });
      }
    }
  } catch (e) {
    console.warn('Fallo al listar en backend. Usando cache local si existe.', e);
    showErrorBanner(`No se pudo obtener la lista de usuarios desde el servidor. Revisa la consola (F12 → Network). Error: ${e.message}`);
    await modalError(`No se pudo obtener la lista de usuarios.\n\nDetalle: ${e.message}`);
    const cached = await loadData(CACHE_KEY);
    if (Array.isArray(cached)) {
      USERS_CACHE = cached.map(mapUser).filter(Boolean);
      renderTable(USERS_CACHE, { append: false });
      const list = USERS_CACHE;
      if (statTotal)  statTotal.textContent  = list.length;
      if (statAdmins) statAdmins.textContent = list.filter(u => u.rol === 'admin').length;
      if (statActivos)statActivos.textContent= list.filter(u => u.activo).length;
    } else {
      usersTbody.innerHTML = `<tr><td colspan="5">No hay datos para mostrar.</td></tr>`;
    }
  } finally {
    hideOverlay();
  }
}

async function loadMore() {
  page += 1;
  await refreshUsers({ reset: false });
}

// ====== Acciones de fila ======
usersTable?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button.file-action-btn');
  if (!btn) return;
  const tr = ev.target.closest('tr[data-id]');
  if (!tr) return;

  const id = Number(tr.getAttribute('data-id'));
  const user = USERS_CACHE.find(u => u.id === id);
  if (!user) return;

  const action = btn.getAttribute('data-action');

  if (action === 'pick') {
    selectedId = id;
    usuarioInput.value    = user.usuario;
    rolSelect.value       = user.rol;
    activoCheck.checked   = !!user.activo;
    activoLabel.textContent = user.activo ? 'Sí' : 'No';
    updateUserBtn.disabled = false;
    usuarioInput.focus();
  }

  if (action === 'toggle') {
    try {
      showOverlay('Actualizando estado...');
      const updated = await apiUpdateUser(user.id, { activo: !user.activo });
      const idx = USERS_CACHE.findIndex(u => u.id === user.id);
      if (idx >= 0) USERS_CACHE[idx] = updated;
      await saveData(CACHE_KEY, USERS_CACHE);
      tr.outerHTML = rowTemplate(updated);
      await refreshStatsFromServer();
    } catch (e) {
      await modalError(`No se pudo actualizar:\n${e.message}`);
    } finally {
      hideOverlay();
    }
  }
});

// ====== Botones principales ======
createUserBtn?.addEventListener('click', async () => {
  const usuario = norm(usuarioInput.value);
  const rol     = norm(rolSelect.value) || 'usuario';
  const activo  = !!activoCheck.checked;

  if (!usuario) { await toast('Ingresa el usuario.'); return; }

  try {
    showOverlay('Creando usuario...');
    await apiCreateUser({ usuario, rol, activo });
    await refreshUsers({ reset: true });
    await modalInfo('Usuario creado.', 'Éxito');
    usuarioInput.value = '';
    rolSelect.value = 'usuario';
    activoCheck.checked = true; activoLabel.textContent = 'Sí';
    selectedId = null; updateUserBtn.disabled = true;
  } catch (e) {
    await modalError(`No se pudo crear:\n${e.message}`);
  } finally {
    hideOverlay();
  }
});

updateUserBtn?.addEventListener('click', async () => {
  if (!selectedId) { await toast('Selecciona una fila primero.'); return; }
  const usuario = norm(usuarioInput.value);
  const rol     = norm(rolSelect.value) || 'usuario';
  const activo  = !!activoCheck.checked;

  try {
    showOverlay('Actualizando usuario...');
    await apiUpdateUser(selectedId, { usuario, rol, activo });
    await refreshUsers({ reset: true });
    await modalInfo('Usuario actualizado.', 'Éxito');
    usuarioInput.value = '';
    rolSelect.value = 'usuario';
    activoCheck.checked = true; activoLabel.textContent = 'Sí';
    selectedId = null;
    updateUserBtn.disabled = true;
  } catch (e) {
    await modalError(`No se pudo actualizar:\n${e.message}`);
  } finally {
    hideOverlay();
  }
});

clearFormBtn?.addEventListener('click', async () => {
  usuarioInput.value = '';
  rolSelect.value = 'usuario';
  activoCheck.checked = true; activoLabel.textContent = 'Sí';
  selectedId = null;
  updateUserBtn.disabled = true;
});

refreshBtn?.addEventListener('click', async () => {
  await refreshUsers({ reset: true });
});

applyFiltersBtn?.addEventListener('click', async () => {
  await refreshUsers({ reset: true });
});

resetFiltersBtn?.addEventListener('click', async () => {
  searchText.value = '';
  filterRol.value = '';
  filterActivo.value = '';
  await refreshUsers({ reset: true });
});

loadMoreBtn?.addEventListener('click', () => loadMore());

// ====== Ordenamiento por encabezados ======
(function setupSortableHeaders() {
  if (!usersTable) return;
  const ths = usersTable.querySelectorAll('thead th');
  const map = [
    { key: 'id' },         // ID
    { key: 'usuario' },    // Usuario
    { key: 'rol' },        // Rol
    { key: 'activo' },     // Activo
    { key: null },         // Acciones (no ordena)
  ];
  ths.forEach((th, i) => {
    const k = map[i]?.key;
    if (!k) return;
    th.style.cursor = 'pointer';
    th.title = 'Ordenar';
    th.addEventListener('click', async () => {
      if (sortBy === k) {
        sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        sortBy = k;
        sortDir = 'asc';
      }
      await refreshUsers({ reset: true });
    });
  });
})();

// ====== Validación de rol al entrar ======
async function validateRoleOnEntry() {
  // 1) Cargar datos de sesión
  const userData = (await loadData('userData')) || {};
  const storedRole = getRoleFromUserData(userData);
  const username   = getUsernameFromUserData(userData);

  if (!username) {
    await modalError('No hay sesión válida. Inicia sesión nuevamente.');
    window.location.href = '../login.html';
    return false;
  }

  try {
    showOverlay('Validando rol de usuario...');
    // 2) Consultar rol real en la BD
    const { rows } = await apiListUsers({ q: username, limit: 1, page: 0 });
    const match = rows.find(r => (r.usuario || '').toLowerCase() === username.toLowerCase()) || rows[0];

    if (!match) {
      await modalError('Usuario no registrado localmente. Contacta al administrador.');
      window.location.href = '../index.html';
      return false;
    }

    const backendRole = (match.rol || '').toLowerCase();

    // 3) Si roles no coinciden => modal y regreso al index (actualizando sesión)
    if (backendRole !== storedRole) {
      // Actualiza userData con el rol real antes de salir
      if (userData?.usuario && typeof userData.usuario === 'object') {
        userData.usuario.rol = backendRole;
      } else {
        userData.rol = backendRole;
      }
      await saveData('userData', userData);

      await modalError('SU ROL NO CONCUERDA AL ASIGNADO. Será redirigido al menú.', 'Rol inconsistente');
      window.location.href = '../index.html';
      return false;
    }

    // 4) Si no es admin => no tiene permiso
    if (backendRole !== 'admin') {
      await modalInfo('NO TIENE PERMISOS PARA ENTRAR A ESTE MODULO.');
      window.location.href = '../index.html';
      return false;
    }

    // OK
    hideOverlay();
    return true;
  } catch (e) {
    hideOverlay();
    await modalError(`No se pudo validar el rol en el servidor.\nDetalle: ${e.message}`);
    window.location.href = '../index.html';
    return false;
  }
}

// ====== Init ======
(async function init() {
  // 0) Validar rol en el backend ANTES de mostrar cualquier cosa
  const valid = await validateRoleOnEntry();
  if (!valid) return;

  const ok = await apiHealth();
  if (!ok) {
    showErrorBanner('No hay conexión con el backend (GET /health falló). Verifica que el servidor Flask esté encendido y accesible.');
  }

  if (activoCheck && activoLabel) {
    activoLabel.textContent = activoCheck.checked ? 'Sí' : 'No';
  }

  await refreshUsers({ reset: true });
})();
