# Auditoría estática de LoreVinci — matriz de 400 perspectivas

Fecha: 2026-08-12. Esta matriz no afirma que 400 personas hayan ejecutado la app: son 400 perfiles de prueba que deben cubrirse con casos reproducibles.

## Resultado de esta pasada

- Sintaxis JavaScript: OK (`node --check` en `main.js`, `preload.js` y `renderer/app.js`).
- Importación: se valida tamaño y estructura en el proceso principal; no se persiste el archivo importado antes de que el renderer lo valide.
- XSS: se conserva sanitización al renderizar contenido de capítulos; debe mantenerse al importar y generar.
- Navegación: panel lateral colapsable con botón accesible, persistencia y `Ctrl/Cmd+B`.
- Loader: `position: fixed`, `visibility: hidden` al salir y sin ocupar flujo.
- OAuth: el copy ya no afirma que exista OAuth de Google; el flujo abre OpenRouter para API key manual.
- URLs externas: solo `http`/`https` desde IPC.

## 400 perfiles y foco de prueba

1–40 escritores (fanfic, novela, poesía, guion, coautor, dislexia, TDAH, móvil, offline, multilingüe): pérdida de texto, formato, undo y legibilidad.
41–80 lectores (modo lectura, OLED, zoom, teclado, lector de pantalla, alto contraste, baja visión, traducción): foco, contraste, landmarks, texto largo.
81–120 editores (corrector, continuidad, canon, cronología, power scaling, decisiones, consecuencias): trazabilidad, contradicciones y fuentes.
121–160 investigadores (PDF digital, PDF escaneado, fuente primaria, derivada, duplicados, documentos enormes): límites, mensajes y deduplicación.
161–200 usuarios de IA (sin key, key inválida, timeout, respuesta vacía, modelo desconocido, prompt hostil): errores claros, límites y no filtración de secretos.
201–240 seguridad (XSS, atributos inline, javascript URLs, HTML importado, prompt injection, path traversal, URL externa): sanitización, CSP y allowlists.
241–280 datos (JSON corrupto, backup, restauración, migración, localStorage lleno, dos ventanas, cierre abrupto): integridad y recuperación.
281–320 UX (primer arranque, loader, sidebar, responsive, atajos, modal, cancelación, estados vacíos): no bloqueo, foco y feedback.
321–360 rendimiento (400 capítulos, 10k personajes, imágenes grandes, búsquedas repetidas, render masivo): paginación, límites, memoria y tiempos.
361–400 roles de dominio (Dragon Ball, D&D, romance, misterio, historia, docente, periodista, analista, QA, soporte): reglas, canon, decisiones, consecuencias y exportación.

## Hallazgos abiertos que no se deben maquillar

- La app no puede garantizar coherencia, power scaling ni que un personaje no conozca información sin un grafo temporal/epistémico persistente; eso requiere una funcionalidad posterior, no solo un prompt.
- La API key se guarda localmente; Electron debe usar `safeStorage` antes de tratarlo como secreto protegido.
- `sanitizeTextForPrompt` mitiga delimitadores, pero prompt injection no se puede “sanitizar” por completo; hace falta separar instrucciones y datos y validar salidas.
- No se ejecutaron 400 sesiones humanas. Los perfiles son una cobertura de casos, no evidencia estadística.

## Criterio de salida para beta

Cada perfil debe tener un caso reproducible, resultado esperado y evidencia. No marcar un bug como corregido solo por una lectura mental. Ejecutar primero P0: pérdida de datos, XSS, secretos, importación, API errors, accesibilidad y rendimiento.
