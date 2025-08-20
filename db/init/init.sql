CREATE DATABASE FACAFDB;
GO

USE FACAFDB;
GO

CREATE TABLE ArchivosExcel (
    Id INT PRIMARY KEY IDENTITY(1,1),
    NombreArchivo NVARCHAR(255) UNIQUE NOT NULL,
    TipoMime NVARCHAR(100) NOT NULL,
    Datos VARBINARY(MAX) NOT NULL,
    FechaSubida DATETIME DEFAULT GETDATE()
);

CREATE TABLE PlantillasCorreo (
    Id INT PRIMARY KEY IDENTITY(1,1),
    Autoridad TEXT,
    Docente TEXT,
    Estudiante TEXT
);

CREATE TABLE Usuarios (
    Id       INT IDENTITY(1,1) PRIMARY KEY,
    Usuario  NVARCHAR(150) NOT NULL UNIQUE,
    Estado   BIT NOT NULL DEFAULT 1,                  -- 1 = Activo, 0 = Inactivo
    Rol      NVARCHAR(10) NOT NULL 
        CONSTRAINT DF_Usuarios_Rol DEFAULT N'usuario',
    CONSTRAINT CK_Usuarios_Rol CHECK (Rol IN (N'usuario', N'admin'))
);


INSERT INTO PlantillasCorreo (Autoridad, Docente, Estudiante)
VALUES ('', '', '');


-- Crear un admin 
INSERT INTO Usuarios (Usuario, Estado, Rol)
VALUES (N'luis.baldeons@ug.edu.ec', 1, N'admin');