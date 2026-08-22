# Validación adversarial de la retroalimentación beta — Mesa RPG

**Fecha:** 2026-08-20 (America/Santiago)  
**Alcance:** `renderer/rpg-engine.js`, Mesa RPG, Muse AI, sugerencias en tiempo real, generador automático, fuentes y persistencia.  
**Reglamento de prueba:** 100 reglas + 46 fórmulas del caso entregado por el beta tester (`tests/fixtures/rpg-beta-rules.txt`).

## Veredicto

**APROBADO para los fallos reproducibles informados por el beta tester.**

La validación automatizada completa ejecuta **378 comprobaciones en 12 suites**. La batería adversarial específica reproduce las frases y situaciones del reporte, usa fuentes hostiles, respuestas corruptas y sesiones largas. El resultado actual es **70/70** en esa batería y **378/378** en el conjunto total.

Esto no significa que cualquier modelo externo sea infalible. Significa que una respuesta defectuosa ya no debe llegar sin control al manuscrito o a la partida: se valida, se intenta reparar una vez y, si sigue siendo insegura, se descarta y se reemplaza por una resolución local trazable.

## Matriz de aceptación

| ID | Retroalimentación reproducida | Criterio de salida | Evidencia | Estado |
|---|---|---|---|---|
| BETA-01 | Aparece `The user wants…`, `I need to…`, `Let me…` | Ninguna frase de razonamiento interno llega a la UI o capítulo | Respuesta inglesa, reparación y doble fallo inyectados | ✅ |
| BETA-02 | Diálogos quedan en inglés aunque la narración esté en español | Detectar también inglés dentro de comillas, rayas o campos JSON | `Stop right there and put your hands up` incrustado | ✅ |
| BETA-03 | La IA controla al personaje | Rechazar movimientos, decisiones, palabras o pensamientos impuestos | Casos con y sin pronombre: `Tú decides…`, `Levantas…`, `no puedes evitar sentir…` | ✅ |
| BETA-04 | El GM continúa sin esperar | Cada salida válida termina con pregunta explícita | Si falta, se añade `¿Qué haces?` | ✅ |
| BETA-05 | La fuente Spider-Man no se usa | Nombre y pasaje relevante llegan al contexto del GM y Muse | Prompt inspeccionado en prueba | ✅ |
| BETA-06 | Un documento intenta inyectar instrucciones | La fuente se etiqueta como dato y no puede cambiar idioma/agencia | Fuente con `IGNORE ALL PREVIOUS INSTRUCTIONS` | ✅ |
| BETA-07 | `asdadsdasd` hace que Muse exponga el prompt | Muse filtra la fuga y devuelve solo texto visible español | Reproducción literal del caso | ✅ |
| BETA-08 | Cada charla parece crear otro capítulo | 100 interacciones adicionales conservan el mismo número de capítulos | 105 turnos del jugador en una sola sesión | ✅ |
| BETA-09 | Más de 100 reglas no se toman | Parsear 100 exactas y también 125 consecutivas, sin recorte fijo | Se verifican números únicos y extremos 1/100 | ✅ |
| BETA-10 | Las fórmulas son solo texto decorativo | Evaluarlas localmente con variables y explicar operación/resultado | 45 de 46 automatizables con contexto | ✅ |
| BETA-11 | No se explica si una acción es posible | Toda acción muestra posible/bloqueada, coste, tirada, fórmula y razón | Dominio, RCRT, PEM, armas, CD | ✅ |
| BETA-12 | No se detectan contradicciones | Advertir regla vs. fórmula y elegir precedencia explícita | Recuperación y Choque de Dominios | ✅ |
| BETA-13 | Las acciones se sienten demasiado manuales | Aceptar lenguaje natural además de `//`, `—` y `[ ]` | Intenciones sin prefijo resueltas | ✅ |
| BETA-14 | El estilo de autor bloquea o deforma la respuesta | Usar rasgos generales sin ordenar suplantación ni copia literal | Prompt inspeccionado | ✅ |
| BETA-15 | Un fallo de red puede dejar la interfaz bloqueada | Recuperación local y botón habilitado en `finally` | `ECONNRESET` simulado | ✅ |
| BETA-16 | Respuesta HTML podría contaminar la UI | Renderizar el contenido como texto, sin nodos ejecutables | `<img onerror=alert(1)>` inyectado | ✅ |
| BETA-17 | Doble clic puede duplicar turno/gasto | Una solicitud en vuelo bloquea el segundo envío | Proveedor lento simulado | ✅ |
| BETA-18 | Cancelar una generación no detiene la petición real | AbortSignal se traduce a un `requestId` cancelable por IPC y el proceso principal aborta `fetch` | Petición HTTP lenta cancelada en vuelo | ✅ |
| BETA-19 | La tirada carece de presencia visual | D20 animado revela natural, ventaja/desventaja, crítico y fórmula antes de narrar | Suite `rpg-loop` | ✅ |
| BETA-20 | Acceso indirecto a la Mesa | Botón lateral y apertura directa de historias RPG, recordando la última mesa | Suite `rpg-loop` | ✅ |
| BETA-21 | La partida no se aprovecha como manuscrito incremental | Registro de tramos sin duplicados, como crónica fiel o prosa Muse | Dos rangos consecutivos comprobados | ✅ |
| BETA-22 | Falta investigación web seleccionable | Búsqueda multi-proveedor, URL directa, extracción con URL/fecha y selección explícita | Mock integral + bloqueos SSRF/file/30 MB | ✅ |
| BETA-23 | Todo comando puede quedar en deadlock | Cancelación visible, AbortController por turno, timeout de 45 s y `finally` transaccional | Cancelación durante proveedor lento y comando posterior | ✅ |
| BETA-24 | Falta experiencia de mundo según obra/autor | Campaña elige obra, creador, entrada y política de canon; estado y consecuencias persisten | Suite `rpg-loop` | ✅ |
| BETA-25 | PNJ cambian de carácter u obtienen omnisciencia | Ficha, personalidad, conocimiento inicial y memoria por PNJ entran al prompt y se validan por identidad | Ledger epistémico persistente | ✅ |
| BETA-26 | Sugerencias en inglés/no insertables | Idioma por obra y campaña; filtro meta independiente del idioma; párrafo final insertable por defecto | Suite `language` 14/14 | ✅ |
| BETA-27 | Principiante sin saber escribir o dirigir | Sesión cero guiada, roles Jugador/Director, Mentor y panel de facciones, misiones, inventario, relojes, relaciones, pistas y heridas | Suite `campaign-systems` 21/21 | ✅ |
| BETA-28 | Controles ocultos o layout roto | Modales flexibles, cabecera responsive, dashboard 4/2/1 columnas, nombres accesibles y reducción de movimiento | Suite `visual` 14/14 | ✅ |

## Cobertura mecánica del reglamento entregado

### Importación

- 100/100 reglas detectadas.
- 46/46 fórmulas separadas correctamente.
- 125 reglas consecutivas también aceptadas.
- Sin límite fijo de 4.000 caracteres: el fixture real contiene más de 12.000.
- Hash del reglamento y fuentes: una modificación de igual longitud también fuerza recompilación.

### Fórmulas

Con todas las variables requeridas, el motor resuelve **45/46 fórmulas**. La única deliberadamente manual es **Sacrificio Permanente**, porque elegir perder un sentido, brazo, atributo o adquirir una técnica nueva exige consentimiento y arbitraje narrativo; automatizarlo silenciosamente sería incorrecto.

Entre las fórmulas comprobadas:

- PEM y Vida máximos.
- Iniciativa, carga y percepción.
- Ataque, defensa, bloqueo y mitigación.
- Daño melee, distancia, técnica básica y extensión.
- Costes de PEM, recuperación y ocultamiento.
- Destello Negro, Zona, pifia y revelación de técnica.
- Tobari, Dominio, choque y quemadura.
- RCRT, regeneración de maldición y curación de aliado.
- Vida/PEM/daño de enemigos.
- Shikigami.
- XP, puntos de atributo, recompensa monetaria, CD y sinergia de equipo.

### Requisitos y estados comprobados

- Restricción Celestial: PEM 0 y físicos ×2.
- RCRT bloqueada si la ficha no declara el talento raro.
- Curación propia, de aliado y regeneración de maldición usan costes diferentes.
- Dominio bloqueado por grado/control; coste 80%; tres turnos totales; quemadura posterior de tres turnos.
- Ataque físico fallido pierde 5 PEM por desconcentración.
- Llegar a 0 PEM añade agotamiento crítico, salvo Restricción Celestial.
- Arma sin PEM no causa daño permanente a una maldición.
- Extensión aplica `20 + daño extra × 2`.
- Ventaja/desventaja tiran dos D20.
- Pifia aplica la mitad del daño propio.
- Destello Negro aplica ×2,5 y Zona temporal.
- Fatiga reduce físicos 10% tras cinco turnos.

## Hallazgos descubiertos durante esta pasada y corregidos

La primera ejecución adversarial **no quedó en verde**. Encontró cuatro fallos reproducibles y la revisión mecánica encontró otros vacíos:

1. Una reparación JSON podía imponer `Levantas el arma…` porque el detector esperaba inicio de oración normal y no contemplaba comillas/colon JSON.
2. Dos fórmulas de enemigos eran calculables, pero el contador las marcaba erróneamente como no ejecutables.
3. La advertencia de escala de grado buscaba el símbolo `*` después de que la normalización ya lo había retirado.
4. El primer filtro de idioma no cubría suficientemente un diálogo inglés pequeño dentro de narración española.
5. Una excepción lanzada por el puente de IA podía dejar el botón del turno bloqueado.
6. RCRT no exigía que la ficha declarara el talento raro.
7. La pérdida de 5 PEM por ataque físico fallido aún no se aplicaba.
8. No se diferenciaba curación propia, curación de aliado y regeneración de maldición.
9. El coste variable de una Técnica de Extensión no incorporaba el daño extra declarado.
10. Un arma común podía calcular daño permanente contra una maldición.
11. El `AbortSignal` del renderer se intentaba serializar directamente por IPC; ahora se convierte en un identificador de petición y cancelación real en el proceso principal.

Todos fueron corregidos y convertidos en regresiones automáticas.

## Pruebas ejecutadas

```bash
npm test
```

Resultado esperado actual:

```text
core                    49/49
 ingest                  23/23
 generation              25/25
 api                     32/32
 marathon                20/20
 ocr                     17/17
 rpg                     55/55
 rpg-adversarial         70/70
 rpg-loop                36/36
 web                     16/16
 language                14/14
 campaign-systems        21/21
 visual                  14/14
 TOTAL                  392/392
```

También se comprueba:

```bash
node --check main.js
node --check preload.js
node --check renderer/app.js
node --check renderer/rpg-engine.js
git diff --check
npm audit --omit=dev
```

## Límites honestos

- No se usaron credenciales reales del beta tester ni se hicieron cargos a un proveedor externo. Los contratos de API se prueban con servidores/modelos simulados, incluidos truncado, error HTTP, excepción y respuesta hostil.
- La detección lingüística y de agencia es una defensa en profundidad, no una demostración matemática sobre todo texto humano posible. Ante duda, el sistema descarta la salida y conserva la resolución local.
- Las reglas narrativas (tono, secretos, consecuencias, arbitraje) se validan como política de turno y contexto; no todas tienen una operación numérica.
- Sacrificio Permanente permanece manual por diseño y debe ser confirmado por el narrador.
- LoreVinci sigue siendo local y no implementa sincronización multijugador en tiempo real.
- La prueba de empaquetado `npm run dist -- --dir` cargó correctamente la configuración y comenzó a empaquetar Linux, pero este sandbox devolvió `EOF` al descargar el binario oficial de Electron desde GitHub Releases. Es una limitación de red del entorno; el instalador final debe repetirse en CI o en una máquina con acceso a Releases.
- El entorno no dispone de Chromium/Firefox para captura automatizada por píxeles. La aceptación visual se cubre con 14 regresiones estructurales/responsive y una vista previa viva; sigue siendo recomendable una inspección humana final en Windows/macOS/Linux.

## Criterio para repetir la beta humana

1. Crear proyecto **Partida RPG**.
2. Completar ficha, incluida RCRT solo si corresponde.
3. Pegar el fixture completo o cargarlo como fuente.
4. Pulsar **Analizar reglas y fórmulas**: debe mostrar 100 reglas, 46 fórmulas y las contradicciones conocidas.
5. Abrir Mesa RPG y probar una acción natural, una con `//`, diálogo `—` y consulta `[ ]`.
6. Verificar que cada turno enseña resolución local y termina esperando decisión.
7. Enviar 20–30 turnos y confirmar que la lista de capítulos no cambia.
8. Convertir sesión en capítulo manualmente y comprobar que aparece exactamente uno.
9. Repetir con el proveedor/modelo real del beta tester y guardar cualquier salida rechazada solo como descripción del caso, nunca copiando credenciales.
