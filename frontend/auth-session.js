// auth-session.js
import { loadData, saveData, removeData } from './indexeddb-storage.js';

// Resuelve la ruta correcta al login desde cualquier carpeta
function resolveLoginPath() {
  return location.pathname.includes('/Modules/') ? '../login.html' : 'login.html';
}

// Arranca/renueva sesión (por si quieres reutilizar desde otros flujos)
export async function startSession(minutes = 30) {
  const expirationTime = Date.now() + (minutes * 60 * 1000);
  await saveData('isLoggedIn', true);
  await saveData('sessionExpiresAt', expirationTime);
  return expirationTime;
}

// Verifica expiración al cargar la página. Si no hay sesión o está vencida -> redirige.
export async function ensureSessionGuard() {
  const isLoggedIn = await loadData('isLoggedIn');
  const expiresAt = await loadData('sessionExpiresAt');

  if (!isLoggedIn || !expiresAt || Date.now() > Number(expiresAt)) {
    await removeData('isLoggedIn');
    await removeData('sessionExpiresAt');
    await removeData('userData');
    location.href = resolveLoginPath();
    return false;
  }
  return true;
}

// Programa logout automático al alcanzar el vencimiento, aunque la pestaña siga abierta.
export async function scheduleAutoLogout() {
  const expiresAt = await loadData('sessionExpiresAt');
  if (!expiresAt) return;
  const remaining = Number(expiresAt) - Date.now();
  if (remaining <= 0) {
    await removeData('isLoggedIn');
    await removeData('sessionExpiresAt');
    location.href = resolveLoginPath();
    return;
  }
  setTimeout(async () => {
    await removeData('isLoggedIn');
    await removeData('sessionExpiresAt');
    location.href = resolveLoginPath();
  }, remaining);
}
