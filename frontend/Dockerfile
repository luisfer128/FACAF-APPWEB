# Imagen base Nginx
FROM nginx:alpine

# Elimina configuración por defecto de nginx
RUN rm -rf /usr/share/nginx/html/*

# Copia todo tu frontend a la carpeta pública de Nginx
COPY . /usr/share/nginx/html

# Configura Nginx para servir archivos estáticos correctamente
RUN cat > /etc/nginx/conf.d/default.conf << 'EOF'
server {
    listen       80;
    listen  [::]:80;
    server_name  localhost;
    
    root   /usr/share/nginx/html;
    index  index.html index.htm;

    # Configuración para archivos estáticos (imágenes) - ESTO ES LO IMPORTANTE
    location ~* \.(png|jpg|jpeg|gif|ico|svg|webp|bmp|tiff)$ {
        expires 1y;
        add_header Cache-Control "public, no-transform";
        try_files $uri =404;
        access_log off;
    }

    location ~* \.(css|js|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public";
        try_files $uri =404;
        access_log off;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }
}
EOF

# Establece los permisos correctos para las imágenes
RUN chmod -R 755 /usr/share/nginx/html/
RUN chown -R nginx:nginx /usr/share/nginx/html/

# Expone el puerto 80 (HTTP)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]