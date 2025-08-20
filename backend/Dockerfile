# Imagen base oficial de Python
FROM python:3.11-slim

# Variables de entorno para producción
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Instala dependencias del sistema necesarias para pyodbc
RUN apt-get update && \
    apt-get install -y gcc g++ gnupg2 curl apt-transport-https unixodbc-dev && \
    curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add - && \
    curl https://packages.microsoft.com/config/debian/11/prod.list > /etc/apt/sources.list.d/mssql-release.list && \
    apt-get update && ACCEPT_EULA=Y apt-get install -y msodbcsql17 && \
    rm -rf /var/lib/apt/lists/*

# Directorio de trabajo
WORKDIR /app

# Copia requirements.txt
COPY backend/requirements.txt .

# Instala dependencias de Python
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copia toda la app
COPY backend/ .

# Expone el puerto
EXPOSE 5000

# Comando para arrancar Flask
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "main:app", "--workers=4"]

