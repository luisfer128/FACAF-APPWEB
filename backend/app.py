from dotenv import load_dotenv
import os
from flask import send_from_directory, Flask, request, jsonify, send_file
from flask_cors import CORS
from pathlib import Path
from io import BytesIO
import secrets, time
import requests
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
import msal

# ======================= CARGA .ENV ===========================
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / "archivos" / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

# ======================= FLASK APP ===========================
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# ======================= CONFIG ===========================
UG_AUTH_URL   = os.getenv("UG_AUTH_URL", "https://servicioenlinea.ug.edu.ec/SeguridadTestAPI/api/CampusVirtual/ValidarCuentaInstitucionalv3")
USUARIO_OUTLOOK = os.getenv("OUTLOOK_USER")
CLIENT_ID       = os.getenv("MS_CLIENT_ID")
CLIENT_SECRET   = os.getenv("MS_CLIENT_SECRET")
TENANT_ID       = os.getenv("MS_TENANT_ID", "250f76e7-6105-42e3-82d0-be7c460aea59")
SCOPES          = ["https://graph.microsoft.com/.default"]
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "10"))  # segundos

# ======================= INICIALIZACIÓN BD ===========================
print("🚀 Iniciando aplicación FACAF...")
if inicializar_base_datos():
    print("✅ Sistema listo - Base de datos inicializada correctamente")
else:
    print("❌ ADVERTENCIA: Problemas en inicialización de BD. Algunas funciones pueden fallar.")

try:
    conn = conectar()
    conn.close()
    print("✅ Conexión final exitosa con FACAFDB")
except Exception as e:
    print(f"❌ Error de conexión final: {e}")

# ======================= ARCHIVOS ===========================
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

# ======================= PLANTILLAS ===========================
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

# ======================= USUARIOS (CRUD básico) ===========================
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
        actualizado = actualizar_usuario_por_id(user_id=user_id, usuario=usuario, rol=rol, activo=activo if activo is not None else None)
        if not actualizado:
            return jsonify({"error": "No se actualizó (verifique Id o campos)"}), 404
        return jsonify({"message": "Usuario actualizado", "data": actualizado}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ======================= CORREO (MS Graph + OAuth2) ===========================
msal_app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=f"https://login.microsoftonline.com/{TENANT_ID}",
    client_credential=CLIENT_SECRET
)

def obtener_token_graph():
    result = msal_app.acquire_token_for_client(scopes=SCOPES)
    if "access_token" in result:
        return result["access_token"]
    else:
        raise Exception(f"Error obteniendo token: {result.get('error_description', result)}")

def enviar_correo_graph(destinatarios, asunto, cuerpo):
    access_token = obtener_token_graph()
    graph_endpoint = f"https://graph.microsoft.com/v1.0/users/{USUARIO_OUTLOOK}/sendMail"
    to_recipients = [{"emailAddress": {"address": email}} for email in destinatarios]
    payload = {
        "message": {
            "subject": asunto,
            "body": {"contentType": "HTML", "content": cuerpo},
            "toRecipients": to_recipients
        },
        "saveToSentItems": "true"
    }
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    resp = requests.post(graph_endpoint, headers=headers, json=payload)
    if resp.status_code != 202:
        raise Exception(f"Error enviando correo: {resp.status_code} - {resp.text}")

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
    try:
        enviar_correo_graph(to_emails, subject, body)
        return jsonify({"message": "Correo enviado correctamente"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ======================= AUTENTICACIÓN UG ===========================
def _parse_ug_result(obj: dict):
    if not isinstance(obj, dict):
        return None, None
    node = obj.get("ug", obj)
    if not isinstance(node, dict):
        return None, None
    raw_id = node.get("id")
    mensaje = node.get("mensaje")
    try: id_int = int(str(raw_id).strip())
    except Exception: id_int = None
    return id_int, mensaje

@app.post("/auth/ug")
def proxy_auth():
    data_json = request.get_json(silent=True) or {}
    usuario_in = (request.form.get('usuario') or data_json.get("usuario") or "").strip()
    clave = (request.form.get('clave') or data_json.get("clave") or "").strip()
    if not usuario_in or not clave:
        return jsonify({"id": 0, "mensaje": "Usuario/clave vacíos"}), 400
    try:
        resp = requests.post(UG_AUTH_URL, data={"usuario": usuario_in, "clave": clave}, headers={"User-Agent": "Mozilla/5.0"}, timeout=REQUEST_TIMEOUT)
        try: ug_payload = resp.json()
        except: ug_payload = {"status": resp.status_code, "text": resp.text}
        ug_id, ug_msg = _parse_ug_result(ug_payload)
        if ug_id == 0:
            return jsonify({"ok": False, "ug": {"id": 0, "mensaje": ug_msg or "CREDENCIALES ERRADAS"}}), 401
        if ug_id == 1:
            user_row = obtener_usuario_por_usuario(usuario_in)
            if user_row:
                return jsonify({"ok": True, "registrado": True, "usuario": {"id": user_row["id"], "usuario": user_row["usuario"], "rol": user_row["rol"], "activo": bool(user_row["activo"])}}), 200
            return jsonify({"ok": True, "registrado": False, "usuario": usuario_in, "mensaje": "Usuario válido en UG pero no registrado localmente"}), 200
        return jsonify({"ok": False, "ug": ug_payload, "mensaje": "Respuesta de UG sin 'id' válido"}), 502
    except requests.RequestException as e:
        return jsonify({"error": "No se pudo contactar con la API de la UG", "detalle": str(e)}), 502

# ======================= USUARIOS (LISTAR / GET) ===========================
TABLE_USUARIOS = "[Usuarios]"

def _parse_bool_param(v):
    if v is None: return None
    s = str(v).strip().lower()
    if s in ("1","true","t","yes","y","si","sí"): return True
    if s in ("0","false","f","no","n"): return False
    return None

@app.get("/usuarios")
def api_listar_usuarios():
    cur = None; cn = None
    try:
        q = (request.args.get("q") or "").strip()
        rol = (request.args.get("rol") or "").strip().lower()
        activo_q = _parse_bool_param(request.args.get("activo"))
        page  = max(0, int(request.args.get("page", 0)))
        limit = max(1, min(200, int(request.args.get("limit", 20))))
        sort_by  = (request.args.get("sort_by") or "id").strip().lower()
        sort_dir = (request.args.get("sort_dir") or "desc").strip().lower()
        allowed_sort = {"id":"[Id]","usuario":"[Usuario]","rol":"[Rol]","activo":"[Estado]"}
        sort_col = allowed_sort.get(sort_by,"[Id]")
        sort_dir = "ASC" if sort_dir=="asc" else "DESC"
        where = []; params=[]
        if q: where.append("[Usuario] LIKE ?"); params.append(f"%{q}%")
        if rol in ("admin","usuario"): where.append("[Rol]=?"); params.append(rol)
        if activo_q is not None: where.append("[Estado]=?"); params.append(1 if activo_q else 0)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        cn = conectar(); cur = cn.cursor()
        count_sql = f"SELECT COUNT(*) FROM {TABLE_USUARIOS} {where_sql}"
        cur.execute(count_sql, params); total=int(cur.fetchone()[0])
        offset = page*limit
        list_sql = f"SELECT [Id],[Usuario],[Rol],[Estado] FROM {TABLE_USUARIOS} {where_sql} ORDER BY {sort_col} {sort_dir} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
        cur.execute(list_sql, params+[offset,limit])
        rows = cur.fetchall()
        data = [{"id":int(r[0]),"usuario":str(r[1]).strip(),"rol":str(r[2]).strip().lower(),"activo":bool(r[3])} for r in rows]
        cur.close(); cn.close()
        total_pages = (total+limit-1)//limit
        return jsonify({"data":data,"page":page,"limit":limit,"total":total,"total_pages":total_pages,"sort_by":sort_by,"sort_dir":sort_dir}), 200
    except Exception as e:
        try: cur.close(); cn.close()
        except: pass
        return jsonify({"error": f"No se pudo listar usuarios: {e}"}), 500

@app.get("/usuarios/<int:user_id>")
def api_obtener_usuario(user_id: int):
    cur=None; cn=None
    try:
        cn = conectar(); cur=cn.cursor()
        cur.execute(f"SELECT [Id],[Usuario],[Rol],[Estado] FROM {TABLE_USUARIOS} WHERE [Id]=?", (user_id,))
        r = cur.fetchone()
        cur.close(); cn.close()
        if not r: return jsonify({"error":"Usuario no encontrado"}), 404
        return jsonify({"data":{"id":int(r[0]),"usuario":str(r[1]).strip(),"rol":str(r[2]).strip().lower(),"activo":bool(r[3])}}), 200
    except Exception as e:
        try: cur.close(); cn.close()
        except: pass
        return jsonify({"error": f"No se pudo obtener usuario: {e}"}), 500

@app.post("/admin/link")
def admin_link():
    data = request.get_json(silent=True) or {}
    username = (data.get("usuario") or "").strip()
    if not username:
        return jsonify({"error": "usuario requerido"}), 400
    row = obtener_usuario_por_usuario(username)
    if not row or row["rol"].lower()!="admin" or not bool(row["activo"]):
        return jsonify({"error":"forbidden"}), 403
    return jsonify({"url": f"/Modules/panel-admin.html"})

# ======================= MAIN ===========================
if __name__ == '__main__':
    port = int(os.getenv("PORT","5000"))
    debug = os.getenv("FLASK_DEBUG","1")=="1"
    app.run(host='0.0.0.0', port=port, debug=debug)
