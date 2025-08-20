from dotenv import load_dotenv
import os
from flask import send_from_directory
import secrets, time
from pathlib import Path

_admin_tokens = {}

# ======================= CARGA .ENV (carpeta "archivos") =======================
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / "archivos" / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from io import BytesIO
import smtplib
import base64
import time
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from database import (
    guardar_archivo_excel,
    listar_archivos,
    obtener_archivo,
    guardar_plantillas,
    obtener_plantillas,
    conectar,
    crear_usuario,
    actualizar_usuario_por_id,
    obtener_usuario_por_usuario,
    inicializar_base_datos,
)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# ======================= CONFIG ============================
UG_AUTH_URL = os.getenv(
    "UG_AUTH_URL",
    "https://servicioenlinea.ug.edu.ec/SeguridadTestAPI/api/CampusVirtual/ValidarCuentaInstitucionalv3"
)

USUARIO_OUTLOOK = os.getenv("OUTLOOK_USER")
CLIENT_ID       = os.getenv("MS_CLIENT_ID")
CLIENT_SECRET   = os.getenv("MS_CLIENT_SECRET")
TOKEN_URL       = os.getenv("MS_TOKEN_URL", "https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
SCOPE           = os.getenv("MS_SCOPE", "https://outlook.office365.com/.default")

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.office365.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "10"))  # segundos

# Cache simple para el token OAuth2
_token_cache = {"access_token": None, "expires_at": 0}

# ======================= INICIALIZACIÓN BD ============================
print("🚀 Iniciando aplicación FACAF...")

# Intentar inicializar la base de datos
if inicializar_base_datos():
    print("✅ Sistema listo - Base de datos inicializada correctamente")
else:
    print("❌ ADVERTENCIA: Problemas en inicialización de BD. Algunas funciones pueden fallar.")

# Verificar conexión final
try:
    conn = conectar()
    conn.close()
    print("✅ Conexión final exitosa con FACAFDB")
except Exception as e:
    print(f"❌ Error de conexión final: {e}")


# ======================= ARCHIVOS ============================
@app.post('/upload')
def subir_archivo():
    archivo = request.files.get('file')
    if not archivo or archivo.filename.strip() == '':
        return jsonify({'error': 'No se envió archivo o nombre vacío'}), 400

    try:
        guardar_archivo_excel(archivo)
        return jsonify({'message': f'Archivo "{archivo.filename}" guardado correctamente'}), 200
    except Exception as e:
        return jsonify({'error': f'No se pudo guardar: {e}'}), 500


@app.delete('/delete/by-name/<string:filename>')
def eliminar_archivo_por_nombre(filename):
    try:
        conexion = conectar()
        cursor = conexion.cursor()
        cursor.execute("DELETE FROM ArchivosExcel WHERE NombreArchivo = ?", (filename,))
        rows = cursor.rowcount
        conexion.commit()
        cursor.close()
        conexion.close()
        if rows and rows > 0:
            return jsonify({'message': 'Archivo eliminado correctamente'}), 200
        return jsonify({'error': 'Archivo no encontrado'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get('/files')
def listar():
    try:
        archivos = listar_archivos()
        return jsonify(archivos)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get('/download/<int:archivo_id>')
def descargar(archivo_id):
    try:
        archivo = obtener_archivo(archivo_id)
        if not archivo:
            return jsonify({'error': 'Archivo no encontrado'}), 404

        nombre, tipo, contenido = archivo
        bio = BytesIO(contenido)
        return send_file(
            bio,
            as_attachment=True,
            download_name=nombre,
            mimetype=tipo or 'application/octet-stream'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= PLANTILLAS ============================
@app.get('/plantillas')
def get_plantillas():
    try:
        data = obtener_plantillas()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.post('/plantillas')
def update_plantillas():
    try:
        datos = request.get_json(silent=True) or {}
        guardar_plantillas(datos)
        return jsonify({'message': 'Plantillas actualizadas correctamente'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ======================= USUARIOS (CRUD básico) ============================
@app.post("/usuarios")
def api_crear_usuario():
    data = request.get_json(silent=True) or {}
    usuario = (data.get("usuario") or "").strip()
    rol = (data.get("rol") or "usuario").strip().lower()
    activo = data.get("activo", True)

    if not usuario:
        return jsonify({"error": "Campo 'usuario' es obligatorio"}), 400
    if rol not in ("usuario", "admin"):
        return jsonify({"error": "Rol inválido. Solo 'usuario' o 'admin'"}), 400

    try:
        creado = crear_usuario(usuario, rol, bool(activo))
        return jsonify({"message": "Usuario creado", "data": creado}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.put("/usuarios/<int:user_id>")
def api_actualizar_usuario(user_id: int):
    data = request.get_json(silent=True) or {}
    usuario = data.get("usuario")
    rol = data.get("rol")
    activo = data.get("activo")

    if rol is not None:
        rol = str(rol).strip().lower()
        if rol not in ("usuario", "admin"):
            return jsonify({"error": "Rol inválido. Solo 'usuario' o 'admin'"}), 400

    try:
        actualizado = actualizar_usuario_por_id(
            user_id=user_id,
            usuario=usuario,
            rol=rol,
            activo=activo if activo is not None else None
        )
        if not actualizado:
            return jsonify({"error": "No se actualizó (verifique Id o campos)"}), 404
        return jsonify({"message": "Usuario actualizado", "data": actualizado}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ======================= CORREO (Outlook OAuth2) ============================
def obtener_token_oauth2():
    """Usa client_credentials. Cachea el token en memoria hasta expirar."""
    global _token_cache
    now = time.time()
    if _token_cache["access_token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["access_token"]

    data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials",
        "scope": SCOPE
    }

    resp = requests.post(TOKEN_URL, data=data, timeout=REQUEST_TIMEOUT)
    if resp.status_code != 200:
        raise Exception(f"Error al obtener token: {resp.text}")

    j = resp.json()
    token = j["access_token"]
    expires_in = int(j.get("expires_in", 3600))
    _token_cache = {
        "access_token": token,
        "expires_at": now + expires_in
    }
    return token


def generate_oauth2_string(email, access_token):
    auth_string = f"user={email}\x01auth=Bearer {access_token}\x01\x01"
    return base64.b64encode(auth_string.encode()).decode()


def enviar_correo(destinatarios, asunto, mensaje_html):
    access_token = obtener_token_oauth2()

    msg = MIMEMultipart()
    msg['From'] = USUARIO_OUTLOOK
    msg['To'] = ", ".join(destinatarios)
    msg['Subject'] = asunto
    msg.attach(MIMEText(mensaje_html, 'html', _charset='utf-8'))

    auth_string = generate_oauth2_string(USUARIO_OUTLOOK, access_token)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=REQUEST_TIMEOUT) as server:
        server.starttls()
        code, resp = server.docmd("AUTH", "XOAUTH2 " + auth_string)
        if code != 235:
            raise smtplib.SMTPAuthenticationError(code, resp)
        server.send_message(msg)


@app.post('/send-email')
def send_email():
    data = request.get_json(silent=True) or {}
    to_list = data.get("to")
    subject = data.get("subject", "FACAF Notificación Académica")
    body = data.get("body", "")

    if not to_list or not body:
        return jsonify({"error": "Faltan destinatarios o contenido"}), 400

    if isinstance(to_list, str):
        to_emails = [email.strip() for email in to_list.split(';') if email.strip()]
    elif isinstance(to_list, list):
        to_emails = [str(x).strip() for x in to_list if str(x).strip()]
    else:
        return jsonify({"error": "Formato incorrecto en campo 'to'"}), 400

    if not to_emails:
        return jsonify({"error": "Lista de destinatarios vacía"}), 400

    try:
        enviar_correo(to_emails, subject, body)
        return jsonify({"message": "Correo enviado correctamente"}), 200
    except smtplib.SMTPAuthenticationError as e:
        detalle = e.smtp_error.decode() if hasattr(e.smtp_error, 'decode') else str(e)
        return jsonify({"error": f"SMTP AUTH falló: {detalle}"}), 500
    except Exception as e:
        print("❌ Error al enviar correo:", e)
        return jsonify({"error": "Error al enviar correo"}), 500


# ======================= AUTENTICACIÓN UG + Usuarios ============================

def _parse_ug_result(obj: dict):
    """
    Soporta dos formas de respuesta:
    1) Plano: {"id": "1", "mensaje": "OK"}
    2) Envuelto: {"ug": {"id": "1", "mensaje": "OK"}}
    Devuelve (id_int, mensaje) o (None, None) si no se puede parsear.
    """
    if not isinstance(obj, dict):
        return None, None

    node = obj.get("ug", obj)  # toma 'ug' si existe; si no, usa el nivel raíz
    if not isinstance(node, dict):
        return None, None

    raw_id = node.get("id")
    mensaje = node.get("mensaje")
    try:
        id_int = int(str(raw_id).strip())
    except Exception:
        id_int = None

    return id_int, mensaje


@app.post("/auth/ug")
def proxy_auth():
    data_json = request.get_json(silent=True) or {}
    usuario_in = (request.form.get('usuario') or data_json.get("usuario") or "").strip()
    clave      = (request.form.get('clave')   or data_json.get("clave")   or "").strip()

    if not usuario_in or not clave:
        return jsonify({"id": 0, "mensaje": "Usuario/clave vacíos"}), 400

    try:
        resp = requests.post(
            UG_AUTH_URL,
            data={"usuario": usuario_in, "clave": clave},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=REQUEST_TIMEOUT
        )

        # Intentar leer JSON; si no es JSON, preparar estructura básica
        try:
            ug_payload = resp.json()
        except Exception:
            ug_payload = {"status": resp.status_code, "text": resp.text}

        ug_id, ug_msg = _parse_ug_result(ug_payload)

        # Si la UG nos respondió claramente con id 0 o 1
        if ug_id == 0:
            return jsonify({"ok": False, "ug": {"id": 0, "mensaje": ug_msg or "CREDENCIALES ERRADAS"}}), 401

        if ug_id == 1:
            # ✅ Autenticado en UG: validar en nuestra BD con el MISMO usuario del front
            user_row = obtener_usuario_por_usuario(usuario_in)

            if user_row:
                return jsonify({
                    "ok": True,
                    "registrado": True,
                    "usuario": {
                        "id": user_row["id"],
                        "usuario": user_row["usuario"],
                        "rol": user_row["rol"],
                        "activo": bool(user_row["activo"])
                    }
                }), 200

            # Autenticó en UG, pero no existe en nuestra BD
            return jsonify({
                "ok": True,
                "registrado": False,
                "usuario": usuario_in,
                "mensaje": "Usuario válido en UG pero no registrado localmente"
            }), 200

        # Si no pudimos obtener un id válido de la UG
        return jsonify({
            "ok": False,
            "ug": ug_payload,
            "mensaje": "Respuesta de UG sin 'id' válido"
        }), 502

    except requests.RequestException as e:
        return jsonify({"error": "No se pudo contactar con la API de la UG", "detalle": str(e)}), 502

# ======================= USUARIOS (LISTAR / GET) ============================
TABLE_USUARIOS = "[Usuarios]"  # por seguridad, con corchetes

def _parse_bool_param(v):
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("1", "true", "t", "yes", "y", "si", "sí"): return True
    if s in ("0", "false", "f", "no", "n"): return False
    return None

@app.get("/usuarios")
def api_listar_usuarios():
    """
    Lista usuarios con filtros y paginación.
    Query params:
      q: buscar por Usuario (LIKE)
      rol: 'admin' | 'usuario'
      activo: '1'|'0' o 'true'|'false' -> mapea a Estado
      page: int (default 0)
      limit: int (default 20)
      sort_by: 'id'|'usuario'|'rol'|'activo' (default 'id')
      sort_dir: 'asc'|'desc' (default 'desc')
    """
    cur = None
    cn = None
    try:
        q        = (request.args.get("q") or "").strip()
        rol      = (request.args.get("rol") or "").strip().lower()
        activo_q = _parse_bool_param(request.args.get("activo"))

        try:  page  = max(0, int(request.args.get("page", 0)))
        except: page = 0
        try:  limit = max(1, min(200, int(request.args.get("limit", 20))))
        except: limit = 20

        sort_by  = (request.args.get("sort_by")  or "id").strip().lower()
        sort_dir = (request.args.get("sort_dir") or "desc").strip().lower()

        # Mapea las claves del front a columnas reales
        allowed_sort = {
            "id":      "[Id]",
            "usuario": "[Usuario]",
            "rol":     "[Rol]",
            "activo":  "[Estado]",
        }
        sort_col = allowed_sort.get(sort_by, "[Id]")
        sort_dir = "ASC" if sort_dir == "asc" else "DESC"

        where = []
        params = []

        if q:
            where.append("[Usuario] LIKE ?")
            params.append(f"%{q}%")

        if rol in ("admin", "usuario"):
            where.append("[Rol] = ?")
            params.append(rol)

        if activo_q is not None:
            where.append("[Estado] = ?")
            params.append(1 if activo_q else 0)

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        cn = conectar()
        cur = cn.cursor()

        # Total
        count_sql = f"SELECT COUNT(*) FROM {TABLE_USUARIOS} {where_sql}"
        cur.execute(count_sql, params)
        total = int(cur.fetchone()[0])

        # Datos paginados
        offset = page * limit
        list_sql = f"""
            SELECT [Id], [Usuario], [Rol], [Estado]
            FROM {TABLE_USUARIOS}
            {where_sql}
            ORDER BY {sort_col} {sort_dir}
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        """
        cur.execute(list_sql, params + [offset, limit])
        rows = cur.fetchall()

        data = []
        for r in rows:
            # r: (Id, Usuario, Rol, Estado)
            data.append({
                "id": int(r[0]),
                "usuario": (str(r[1]).strip() if r[1] is not None else ""),
                "rol": (str(r[2]).strip().lower() if r[2] is not None else "usuario"),
                "activo": bool(r[3])  # mapea Estado -> activo (bool)
            })

        cur.close(); cur = None
        cn.close(); cn = None

        total_pages = (total + limit - 1) // limit
        return jsonify({
            "data": data,
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": total_pages,
            "sort_by": sort_by,
            "sort_dir": sort_dir
        }), 200

    except Exception as e:
        try:
            if cur: cur.close()
            if cn: cn.close()
        except: pass
        return jsonify({"error": f"No se pudo listar usuarios: {e}"}), 500


@app.get("/usuarios/<int:user_id>")
def api_obtener_usuario(user_id: int):
    """Obtiene un usuario por Id (mapea Estado -> activo)."""
    cur = None
    cn = None
    try:
        cn = conectar()
        cur = cn.cursor()
        cur.execute(f"SELECT [Id], [Usuario], [Rol], [Estado] FROM {TABLE_USUARIOS} WHERE [Id] = ?", (user_id,))
        r = cur.fetchone()
        cur.close(); cur = None
        cn.close(); cn = None

        if not r:
            return jsonify({"error": "Usuario no encontrado"}), 404

        return jsonify({
            "data": {
                "id": int(r[0]),
                "usuario": (str(r[1]).strip() if r[1] is not None else ""),
                "rol": (str(r[2]).strip().lower() if r[2] is not None else "usuario"),
                "activo": bool(r[3])  # Estado -> activo
            }
        }), 200

    except Exception as e:
        try:
            if cur: cur.close()
            if cn: cn.close()
        except: pass
        return jsonify({"error": f"No se pudo obtener usuario: {e}"}), 500


@app.post("/admin/link")
def admin_link():
    data = request.get_json(silent=True) or {}
    username = (data.get("usuario") or "").strip()
    if not username:
        return jsonify({"error": "usuario requerido"}), 400

    row = obtener_usuario_por_usuario(username)
    if not row or row["rol"].lower() != "admin" or not bool(row["activo"]):
        return jsonify({"error": "forbidden"}), 403

    return jsonify({"url": f"/Modules/panel-admin.html"})

# ======================= MAIN ========================================
if __name__ == '__main__':
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    app.run(host='0.0.0.0', port=port, debug=debug)
