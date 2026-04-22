# Serrano Landing

Landing page estática preparada para crecer a sitio más grande.

## Estructura

- `index.html`: entrada principal.
- `css/main.css`: estilos globales.
- `js/config.js`: configuración de entorno (`dev`/`prod`) y API.
- `js/app.js`: links dinámicos + carga de novedades.
- `assets/images/logo`: logos usados en header/footer.
- `assets/images/sections`: imágenes de secciones.
- `backend`: API + panel admin para novedades/newsletter.
- `docs/referencias/site-original.html`: snapshot de referencia.

## Configuración de entorno frontend

Editar `js/config.js`:

- `env: "dev"` para pruebas.
- `env: "prod"` para producción.

Además:

- `links.{env}.turno`: URL del botón sacar turno.
- `api.{env}.newsBaseUrl`: URL base del backend de novedades.

## Backend de Novedades (MVP)

Ubicación: `backend/`

Incluye:

- API pública: `GET /api/news` (solo publicadas)
- API admin:
  - `GET /api/admin/news`
  - `POST /api/admin/news` (multipart con `image`)
  - `PUT /api/admin/news/:id`
  - `DELETE /api/admin/news/:id`
- Panel admin para Community Manager: `/admin`

Datos que carga CM:

- título
- texto descriptivo
- imagen
- estado (`draft` / `published`)

### Correr backend local

1. Ir a `backend/`
2. Instalar deps: `npm install`
3. Crear `.env` desde `.env.example`
4. Ejecutar: `npm start`

Por defecto levanta en `http://localhost:4000`.
Usa MySQL y crea la tabla `news` automáticamente al iniciar.

## Deploy con Dockploy

### Frontend (landing)

Archivos clave:

- `Dockerfile`
- `docker/nginx.conf`
- `.dockerignore`

Pasos:

1. Crear app desde repo Git.
2. Branch: normalmente `main`.
3. Build type: Dockerfile.
4. Exponer puerto contenedor `80`.
5. Asignar dominio/subdominio.
6. Activar SSL (Let's Encrypt).

### Backend (novedades)

Archivos clave:

- `backend/Dockerfile`
- `backend/.dockerignore`

Pasos:

1. Crear segunda app en Dockploy apuntando a `backend/`.
2. Build context: `backend`.
3. Puerto contenedor: `4000`.
4. Variables:
   - `DB_CLIENT` (`sqlite` para local, `mysql` para producción)
   - `SQLITE_FILE` (solo si `DB_CLIENT=sqlite`)
   - `ADMIN_TOKEN`
   - `CORS_ORIGIN` (dominio del frontend)
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - `MYSQL_DATABASE`
5. Publicar bajo subdominio API, por ejemplo `api.tudominio.com`.
6. En frontend (`js/config.js`) usar ese host en `newsBaseUrl`.

## Flujo Git recomendado

1. Actualizar `main`.
2. Crear rama de feature/chore.
3. Commit pequeño y descriptivo.
4. Push y Pull Request.
