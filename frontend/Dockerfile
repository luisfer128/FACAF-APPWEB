# Imagen base Nginx
FROM nginx:alpine

# Elimina configuración por defecto de nginx
RUN rm -rf /usr/share/nginx/html/*

# Copia todo tu frontend a la carpeta pública de Nginx
COPY . /usr/share/nginx/html

# Expone el puerto 80 (HTTP)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
