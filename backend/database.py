import os
import pyodbc
from dotenv import load_dotenv
from pathlib import Path

# ======================= CARGA .ENV (carpeta "archivos") =======================
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / "archivos" / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

VALID_ROLES = (u'usuario', u'admin')


def conectar():
    server = os.getenv("DB_SERVER")
    port = os.getenv("DB_PORT")
    if port:
        server = f"{server},{port}"

    return pyodbc.connect(
        'DRIVER={' + os.getenv("DB_DRIVER") + '};'
                                              'SERVER=' + server + ';'
                                                                   'DATABASE=' + os.getenv("DB_NAME") + ';'
                                                                                                        'UID=' + os.getenv(
            "DB_USER") + ';'
                         'PWD=' + os.getenv("DB_PASSWORD") + ';'
    )


def conectar_master():
    """Conecta a la base de datos master para operaciones administrativas"""
    server = os.getenv("DB_SERVER")
    port = os.getenv("DB_PORT")
    if port:
        server = f"{server},{port}"

    return pyodbc.connect(
        'DRIVER={' + os.getenv("DB_DRIVER") + '};'
                                              'SERVER=' + server + ';'
                                                                   'DATABASE=master;'
                                                                   'UID=' + os.getenv("DB_USER") + ';'
                                                                                                   'PWD=' + os.getenv(
            "DB_PASSWORD") + ';',
        autocommit=True
    )


def existe_base_datos():
    """Verifica si la base de datos FACAFDB existe"""
    try:
        conn = conectar_master()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sys.databases WHERE name = ?", (os.getenv("DB_NAME"),))
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()
        return resultado is not None
    except Exception:
        return False


def crear_base_datos():
    """
    Crea la base de datos FACAFDB completa con todas las tablas y datos iniciales
    """
    db_name = os.getenv("DB_NAME")

    try:
        print("🚀 Iniciando proceso de inicialización completa de base de datos...")

        # PASO 1: Verificar si la BD ya existe
        if existe_base_datos():
            print(f"ℹ️ La base de datos {db_name} ya existe. Saltando inicialización.")
            return True

        # PASO 2: Conectar a master y crear la base de datos
        print(f"🔧 Creando base de datos {db_name}...")
        conn_master = conectar_master()
        cursor_master = conn_master.cursor()

        cursor_master.execute(f"CREATE DATABASE [{db_name}]")
        print(f"✅ Base de datos {db_name} creada exitosamente")

        cursor_master.close()
        conn_master.close()

        # PASO 3: Conectar a la nueva base de datos y crear las tablas
        print("🔧 Conectando a la nueva base de datos...")
        conn = conectar()
        cursor = conn.cursor()

        # Crear tabla ArchivosExcel
        print("🔧 Creando tabla ArchivosExcel...")
        cursor.execute("""
            CREATE TABLE ArchivosExcel (
                Id INT PRIMARY KEY IDENTITY(1,1),
                NombreArchivo NVARCHAR(255) UNIQUE NOT NULL,
                TipoMime NVARCHAR(100) NOT NULL,
                Datos VARBINARY(MAX) NOT NULL,
                FechaSubida DATETIME DEFAULT GETDATE()
            )
        """)
        print("✅ Tabla ArchivosExcel creada")

        # Crear tabla PlantillasCorreo
        print("🔧 Creando tabla PlantillasCorreo...")
        cursor.execute("""
            CREATE TABLE PlantillasCorreo (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Autoridad TEXT,
                Docente TEXT,
                Estudiante TEXT
            )
        """)
        print("✅ Tabla PlantillasCorreo creada")

        # Crear tabla Usuarios
        print("🔧 Creando tabla Usuarios...")
        cursor.execute("""
            CREATE TABLE Usuarios (
                Id       INT IDENTITY(1,1) PRIMARY KEY,
                Usuario  NVARCHAR(150) NOT NULL UNIQUE,
                Estado   BIT NOT NULL DEFAULT 1,
                Rol      NVARCHAR(10) NOT NULL 
                    CONSTRAINT DF_Usuarios_Rol DEFAULT N'usuario',
                CONSTRAINT CK_Usuarios_Rol CHECK (Rol IN (N'usuario', N'admin'))
            )
        """)
        print("✅ Tabla Usuarios creada")

        # PASO 4: Insertar datos iniciales
        print("🔧 Insertando datos iniciales...")

        # Insertar plantilla vacía
        cursor.execute("""
            INSERT INTO PlantillasCorreo (Autoridad, Docente, Estudiante)
            VALUES ('', '', '')
        """)
        print("✅ Plantilla inicial insertada")

        # Crear usuario administrador
        cursor.execute("""
            INSERT INTO Usuarios (Usuario, Estado, Rol)
            VALUES (N'luis.baldeons@ug.edu.ec', 1, N'admin')
        """)
        print("✅ Usuario administrador creado: luis.baldeons@ug.edu.ec")

        # Confirmar todos los cambios
        conn.commit()
        cursor.close()
        conn.close()

        print("🎉 ¡Base de datos inicializada completamente con éxito!")
        return True

    except pyodbc.ProgrammingError as e:
        error_msg = str(e).lower()
        if "already exists" in error_msg or "database name already exists" in error_msg:
            print(f"ℹ️ La base de datos {db_name} ya existe")
            return True
        else:
            print(f"❌ Error de programación SQL: {e}")
            return False

    except Exception as e:
        print(f"❌ Error crítico al crear base de datos: {e}")
        return False


def inicializar_base_datos():
    """
    Función principal de inicialización - ahora simplificada
    """
    try:
        return crear_base_datos()
    except Exception as e:
        print(f"💥 Error crítico en inicialización: {e}")
        return False


# ----------------------- UTIL -----------------------
def _row_to_user_dict(row):
    # row: (Id, Usuario, Estado, Rol)
    return {
        "id": int(row[0]),
        "usuario": row[1],
        "activo": bool(row[2]),
        "rol": row[3]
    }


# ======================= ARCHIVOS =======================
def guardar_archivo_excel(archivo):
    nombre = archivo.filename
    tipo = archivo.mimetype
    contenido = archivo.read()

    conn = conectar()
    try:
        cur = conn.cursor()
        # Verifica si ya existe el archivo por nombre
        cur.execute("SELECT Id FROM ArchivosExcel WHERE NombreArchivo = ?", (nombre,))
        existe = cur.fetchone()

        if existe:
            cur.execute("""
                UPDATE ArchivosExcel
                SET TipoMime = ?, Datos = ?, FechaSubida = GETDATE()
                WHERE NombreArchivo = ?
            """, (tipo, contenido, nombre))
        else:
            cur.execute("""
                INSERT INTO ArchivosExcel (NombreArchivo, TipoMime, Datos)
                VALUES (?, ?, ?)
            """, (nombre, tipo, contenido))

        conn.commit()
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()


def listar_archivos():
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("SELECT Id, NombreArchivo, FechaSubida FROM ArchivosExcel ORDER BY FechaSubida DESC")
        rows = cur.fetchall()
        return [
            {'id': row[0], 'nombre': row[1], 'fecha': row[2].strftime('%Y-%m-%d %H:%M:%S')}
            for row in rows
        ]
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()


def obtener_archivo(archivo_id):
    conn = conectar()
    try:
        cur = conn.cursor()
        # FIX: pasar tupla (archivo_id,)
        cur.execute("SELECT NombreArchivo, TipoMime, Datos FROM ArchivosExcel WHERE Id = ?", (archivo_id,))
        row = cur.fetchone()
        return row if row else None
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()


# ======================= PLANTILLAS =======================
def obtener_plantillas():
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("SELECT Autoridad, Docente, Estudiante FROM PlantillasCorreo WHERE Id = 1")
        row = cur.fetchone()
        return {
            'autoridad': row[0] if row else '',
            'docente': row[1] if row else '',
            'estudiante': row[2] if row else ''
        }
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()


def guardar_plantillas(data):
    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE PlantillasCorreo
            SET Autoridad = ?, Docente = ?, Estudiante = ?
            WHERE Id = 1
        """, (data.get('autoridad', ''), data.get('docente', ''), data.get('estudiante', '')))
        conn.commit()
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()


# ======================= USUARIOS =======================
def crear_usuario(usuario: str, rol: str = 'usuario', activo: bool = True):
    if rol not in VALID_ROLES:
        raise ValueError(f"Rol inválido. Solo {VALID_ROLES}")

    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO Usuarios (Usuario, Estado, Rol)
            VALUES (?, ?, ?)
        """, (usuario, 1 if activo else 0, rol))
        conn.commit()

        # Devolver lo creado
        cur.execute("""
            SELECT Id, Usuario, Estado, Rol
            FROM Usuarios
            WHERE UPPER(Usuario) = UPPER(?)
        """, (usuario,))
        row = cur.fetchone()
        return _row_to_user_dict(row) if row else None
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()


def actualizar_usuario_por_id(user_id: int, usuario: str = None, rol: str = None, activo: bool = None):
    sets = []
    params = []

    if usuario is not None:
        sets.append("Usuario = ?")
        params.append(usuario)

    if rol is not None:
        if rol not in VALID_ROLES:
            raise ValueError(f"Rol inválido. Solo {VALID_ROLES}")
        sets.append("Rol = ?")
        params.append(rol)

    if activo is not None:
        sets.append("Estado = ?")
        params.append(1 if activo else 0)

    if not sets:
        return None  # nada que actualizar

    params.append(user_id)

    conn = conectar()
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE Usuarios SET {', '.join(sets)} WHERE Id = ?", params)
        conn.commit()

        cur.execute("SELECT Id, Usuario, Estado, Rol FROM Usuarios WHERE Id = ?", (user_id,))
        row = cur.fetchone()
        return _row_to_user_dict(row) if row else None
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()


def obtener_usuario_por_usuario(usuario: str):
    conn = conectar()
    try:
        cur = conn.cursor()
        # Case-insensitive por seguridad
        cur.execute("""
            SELECT Id, Usuario, Estado, Rol
            FROM Usuarios
            WHERE UPPER(Usuario) = UPPER(?)
        """, (usuario,))
        row = cur.fetchone()
        return _row_to_user_dict(row) if row else None
    finally:
        try:
            cur.close()
        except:
            pass
        conn.close()