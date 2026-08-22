# Integración LoreVinci ↔ OmniRoute

**OmniRoute auditado:** 3.8.50 (`release/v3.8.50`)  
**Repositorio:** https://github.com/diegosouzapw/OmniRoute  
**Licencia declarada:** MIT

## Decisión de arquitectura

LoreVinci **no copia, vende, instala ni ejecuta OmniRoute internamente**. Lo trata como un gateway OpenAI-compatible opcional administrado por el usuario:

```text
LoreVinci → http://localhost:20128/v1 → OmniRoute → proveedor seleccionado
```

La conexión directa de LoreVinci sigue funcionando. Si OmniRoute está apagado, el usuario puede volver a OpenAI, OpenRouter, Groq, Ollama, LM Studio o un endpoint personalizado.

## Instalación independiente

```bash
npm install -g omniroute
omniroute
```

Dashboard: `http://localhost:20128`  
API: `http://localhost:20128/v1`  
Modelo virtual recomendado: `auto`

Algunas instalaciones exigen crear una API key de acceso **al gateway local** desde el dashboard de OmniRoute. Esa key no es necesariamente una credencial del proveedor upstream.

## Routing por tarea

| Tarea LoreVinci | Perfil predeterminado |
|---|---|
| Mesa RPG | `auto/smart` |
| Capítulos y crónica | `auto/smart` |
| Muse y sugerencias | `auto/fast` |
| Escaleta | `auto` |
| Investigación/resumen | `auto/cheap` |
| Reparación de salida | `auto/fast` |

Los perfiles son editables. También se puede elegir compresión `off`, `default` o `engine:rtk`. LoreVinci usa `off` inicialmente para no alterar canon, reglas o muestras de estilo sin consentimiento.

## Headers enviados

Solo cuando la URL se reconoce como OmniRoute:

- `X-Request-Id`
- `X-OmniRoute-Session-Id`
- `X-OmniRoute-Compression`
- `X-LoreVinci-Task` (metadato local; un gateway desconocido puede ignorarlo)

## Telemetría leída

LoreVinci interpreta, si están presentes:

- `X-OmniRoute-Decision`
- `X-OmniRoute-Provider`
- `X-OmniRoute-Model`
- `X-OmniRoute-Latency-Ms`
- `X-OmniRoute-Response-Cost`
- `X-OmniRoute-Cache-Hit`
- `X-OmniRoute-Fallback-Attempts`
- `X-OmniRoute-Compression`
- `X-OmniRoute-Version`
- `X-OmniRoute-Request-Id`

LoreVinci no calcula ni promete por sí mismo las cuotas gratuitas. Presenta la ruta que OmniRoute reporta.

## Seguridad y límites

- Las credenciales upstream permanecen bajo administración de OmniRoute.
- LoreVinci solo guarda la key que el usuario escriba en Ajustes, como en cualquier endpoint compatible.
- La integración no habilita automáticamente proveedores, OAuth, cookies ni conectores no oficiales.
- Algunos conectores descritos por OmniRoute son no-auth, web-cookie, reverse-engineered o tienen advertencias de términos. El usuario debe revisarlos en el dashboard.
- “Gratis” depende de cuotas y condiciones de terceros; no es una garantía de LoreVinci.
- La detección consulta `/v1/models`; la verificación final realiza una generación mínima real.

## Validación

La suite `tests/omniroute.test.js` comprueba detección, `auto/*`, generación sin key local, headers, telemetría, 401 accionable, configuración con un clic, perfiles por tarea, conexión directa de respaldo y apertura explícita del dashboard.
