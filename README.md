# LoreVinci

Aplicación de escritorio para escritores: gestiona historias, capítulos, personajes,
notas y colaboración, con un asistente de escritura **Muse AI** integrado.

Construida con **Electron** (funciona en Windows, macOS y Linux). Todos tus datos
(historias, capítulos, personajes, notas) se guardan **localmente** en tu computador,
no en la nube.

## Requisitos

- [Node.js](https://nodejs.org) versión 18 o superior (incluye `npm`).

## Cómo ejecutarla en modo desarrollo

```bash
cd lorevinci-desktop
npm install
npm start
```

Esto abrirá la ventana de la aplicación LoreVinci en tu computador.

## Cómo generar un instalador (.exe / .dmg / .AppImage)

```bash
npm run dist
```

El instalador se generará en la carpeta `dist/`. Debes correr este comando en el
sistema operativo para el cual quieres construir el instalador (por ejemplo, en
Windows para generar el `.exe`, en macOS para el `.dmg`).

## Funcionalidades incluidas

- **Home**: resumen de historias activas, palabras totales, capítulos completados y racha de escritura.
- **My Stories**: crear, abrir y eliminar historias, con portada y progreso.
- **Library**: tus historias organizadas por género.
- **Editor de historia**: lista de capítulos, editor de texto enriquecido (negrita, cursiva, listas, citas, enlaces), outline, notas y elenco de personajes por historia.
- **Muse AI**: asistente flotante dentro del editor que sugiere acciones de personajes, describe escenas, genera outlines o continúa el capítulo, usando el texto y el lore de tu historia como contexto.
- **Characters**: ficha de personajes (rol, descripción, rasgos) por historia.
- **Collab**: exporta una historia como `.json` (para compartir con otro colaborador que la importe) o como `.txt` plano; deja notas para tu equipo.
- **Stats**: palabras totales, capítulos, racha de escritura y actividad de los últimos 14 días.
- **Settings**: nombre de autor/a, configuración de Muse AI (proveedor, modelo, API key) y respaldo/restauración de todos tus datos.

## Configurar Muse AI

Ve a **Settings → Muse AI** e ingresa:

- **URL base**: por defecto `https://api.openai.com/v1` (funciona con cualquier API
  compatible con "Chat Completions" de OpenAI: OpenAI, OpenRouter, Groq, un servidor
  local como LM Studio/Ollama con endpoint compatible, etc.).
- **Modelo**: por ejemplo `gpt-4o-mini`.
- **API Key**: tu clave personal. Se guarda solo en tu computador, en el archivo de
  datos local de la app (nunca se envía a ningún servidor de LoreVinci, porque no existe
  tal servidor: todo corre localmente).

Pulsa "Probar conexión" para verificar que quedó bien configurado.

## Dónde se guardan tus datos

La app guarda un archivo `lorevinci-data.json` en la carpeta de datos de usuario de tu
sistema operativo (gestionada automáticamente por Electron). Puedes hacer respaldo o
restaurar tus datos completos desde **Settings → Datos → Exportar/Importar**.
