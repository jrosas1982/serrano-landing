# Serrano Landing

Landing page estática preparada para crecer a sitio más grande.

## Estructura

- `index.html`: entrada principal.
- `css/main.css`: estilos globales.
- `js/config.js`: configuración de entorno (`dev`/`prod`).
- `js/app.js`: comportamiento UI (links dinámicos).
- `assets/images/logo`: logos usados en header/footer.
- `assets/images/sections`: imágenes de secciones (estudios, servicios, baja visión, obras sociales).
- `docs/referencias/site-original.html`: snapshot del sitio original para referencia visual.

## Configuración de entorno

Editar `js/config.js`:

- `env: "dev"` para pruebas.
- `env: "prod"` para producción.

El botón/links con `data-dynamic-link="turno"` toman la URL según entorno.

## Flujo Git recomendado

1. Actualizar `main`.
2. Crear rama de feature/chore.
3. Commit pequeño y descriptivo.
4. Push y Pull Request.
