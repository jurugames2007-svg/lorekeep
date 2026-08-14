# Evaluación — What If de Dragon Ball Z, 30 capítulos

## El libro creado

| | |
|---|---|
| Título | Dragon Ball Z: Sin Leyenda Dorada |
| Premisa | Kakarotto nace sin el gen de la transformación legendaria |
| Regla inquebrantable | Goku NUNCA puede transformarse en Super Saiyajin |
| Fuentes | 5 PDFs (canon, derivado, what-if, fichas, cronología) |
| Personajes | 5, con variante "What If" y límites de conocimiento |
| Estilo | Dragon Ball Z (Toriyama) · 3ª limitada · ágil · fidelidad alta |
| Estructura | 3 arcos de 10 capítulos |

## Resultado

| Métrica | Valor |
|---|---|
| Capítulos | **30 / 30** |
| Palabras | 24.391 (media 813) |
| Escaletas | 30 |
| Continuaciones por truncado | 4 |
| Prompt medio | 30.999 chars (~8.600 tokens) |
| Memoria cap.1 → cap.30 | 92 → 16.530 chars |

## Fallos inyectados y recuperación

| Fallo | Veces | Resultado |
|---|---|---|
| Truncado por tokens | 4 | 4/4 continuados y cosidos |
| JSON de escaleta roto | 3 | Siguió sin escaleta, no bloqueó |
| Caída de red | 2 | Generador local cubrió el hueco |
| Fuga del asistente | 3 | 3/3 marcadas "Revisar" |

## Veredicto: 9/9

- 30 capítulos completos
- Ninguno cortado a media frase
- Todos los truncados recuperados
- Fugas detectadas por la auditoría
- Red absorbida sin perder capítulos
- Escaletas rotas no bloquearon
- Memoria narrativa creciente
- Canon presente en los 30
- Trazabilidad completa

## Verificación del prompt (capítulo 31, tras 30 escritos)

30.820 chars de system + 725 de user. Presentes: la regla "Goku NUNCA Super
Saiyajin", el límite Kaio-Ken x20, el canon etiquetado, el documento What If,
el verso alterno, las muestras de voz, la referencia a Toriyama, el lore base,
el outline de 3 arcos y la memoria desde el Cap 1 hasta el Cap 30.

## Limitación de esta prueba

Sin API key ni salida a internet en el entorno, el modelo fue **simulado**. Esto
valida el motor (contexto, memoria, recuperación, auditoría), **no** la calidad
literaria, que depende del modelo real que conectes.
