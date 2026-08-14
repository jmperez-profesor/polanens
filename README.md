# Reparto Voleibol Santa Pola (SPA offline)

Aplicación web de página única para gestionar coche compartido de entrenamientos sin backend.

## Características

- SPA **100% navegador** con persistencia en **IndexedDB** (con fallback a localStorage solo si IndexedDB no está disponible).
- Vistas:
  1. Calendario mensual de entrenamientos y viajes.
  2. Resumen por conductor/a con total de viajes.
  3. Vista por niña con su historial del mes.
  4. Alta de viajes (incluye estado `confirmada / si está / no va`).
  5. Importación masiva de entrenamientos/eventos por bloque de texto.
  6. Edición de eventos para cambios de última hora.
  7. Partidos de fin de semana (hora, rival y casa/fuera).
  8. Gestión de vacaciones/excepciones por conductor.
  9. Estadísticas mensuales por conductor y por niña.
- Gestión de conductores desde Ajustes (alta de nuevos conductores con color y teléfono opcional).
- Visualización de versión de la app desde Ajustes.
- Exportar/importar backup JSON completo.
- Botón de duplicar estructura del mes anterior.
- Semana actual destacada en el calendario.
- Semanas anteriores en tamaño reducido para no saturar la vista.
- Modo oscuro.
- Offline-first con Service Worker + manifest (PWA básica).
- Semilla inicial con datos reales de agosto (botón “Cargar datos de ejemplo”), incluyendo a Ramón como conductor.

## Estructura

- `index.html`: UI principal.
- `styles.css`: estilos responsive, mobile-first.
- `js/db.js`: capa IndexedDB y operaciones CRUD.
- `js/seed.js`: datos de ejemplo y carga inicial.
- `js/app.js`: lógica de vistas, formularios y estadísticas.
- `manifest.webmanifest` y `sw.js`: soporte PWA/offline.

## Uso local

Opcionalmente puedes abrir `index.html` directamente, pero para service worker/PWA conviene servir por HTTP local:

```bash
python3 -m http.server 8080
```

Abrir `http://localhost:8080`.

## Despliegue en GitHub Pages

1. Sube estos archivos a un repositorio.
2. En GitHub: **Settings → Pages**.
3. En “Build and deployment”, selecciona rama (`main`) y carpeta raíz (`/root`).
4. Guarda y abre la URL publicada.

## Formato de importación de eventos

Una línea por sesión:

```text
2026-08-12,17:00,19:00,Silvia Martínez,tarde,Entreno normal,entrenamiento,,
2026-08-16,10:30,12:00,Silvia Martínez,mañana,Partido amistoso,partido,CV Elche,casa
24,11:00,13:00,Silvia Martínez,mañana,Presentación,entrenamiento,,
```

- Si pones solo el día (`24`), se usa el mes activo seleccionado en la app.
