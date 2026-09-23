// Prueba integral de escaneo de hardware (dxdiag / CPU / GPU) y optimización local-first sin APIs.
'use strict';

const fs = require('fs');
const path = require('path');
const { makeApp, makeSeed, reporter } = require('./harness');

const R = reporter('hardware-scan');

async function testHardwareScanning() {
  const seed = makeSeed();
  const app = makeApp({ seed });
  const { w, errors } = app;
  const d = w.document;
  const ok = R.ok;
  const probe = w.__probe;

  await new Promise((resolve) => setTimeout(resolve, 2600));

  // 1. Verificación del puente systemScanHardware
  ok('el puente lorevinci expone systemScanHardware', typeof w.lorevinci.systemScanHardware === 'function');

  const scanRes = await w.lorevinci.systemScanHardware();
  ok('systemScanHardware devuelve resultado exitoso', scanRes && scanRes.ok === true);
  ok('detecta núcleos de CPU válidos', typeof scanRes.specs.cpuCores === 'number' && scanRes.specs.cpuCores >= 1);
  ok('detecta memoria RAM del sistema', typeof scanRes.specs.totalRamGb === 'number' && scanRes.specs.totalRamGb > 0);
  ok('detecta información de GPU o acelerador', typeof scanRes.specs.gpuName === 'string' && scanRes.specs.gpuName.length > 0);
  ok('recomienda un modelo local específico', typeof scanRes.recommendation.model === 'string' && scanRes.recommendation.model.length > 0);
  ok('recomienda un nivel de cuantización (GGUF)', typeof scanRes.recommendation.quantization === 'string');
  ok('recomienda un perfil de hardware local', ['cpu-light', 'balanced', 'pro-gpu', 'extreme-gpu'].includes(scanRes.recommendation.tier));
  ok('la recomendación es 100% local sin APIs externas', scanRes.recommendation.localOnly === true);

  // 2. Elementos visuales en la vista de Ajustes
  probe('showView("settings")');
  const card = d.getElementById('hardwareArchitectureCard');
  ok('tarjeta de arquitectura de hardware está presente', Boolean(card));
  const cpuVal = d.getElementById('diagCpuCores');
  ok('diagnóstico muestra núcleos de CPU', cpuVal && cpuVal.textContent !== '-');
  const ramVal = d.getElementById('diagRamGb');
  ok('diagnóstico muestra RAM', ramVal && ramVal.textContent !== '-');
  const gpuVal = d.getElementById('diagGpuName');
  ok('diagnóstico muestra GPU detectada', gpuVal && gpuVal.textContent !== '-');
  const optModelVal = d.getElementById('diagOptimalModel');
  ok('diagnóstico muestra modelo local óptimo', optModelVal && /qwen|llama|phi/i.test(optModelVal.textContent));

  // 3. Botón de Re-escaneo de Hardware (dxdiag)
  const reScanBtn = d.getElementById('reScanHardwareBtn');
  ok('botón de re-escaneo de hardware existe y tiene texto accesible', Boolean(reScanBtn) && /Re-escanear/i.test(reScanBtn.textContent));
  reScanBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  ok('re-escaneo actualiza el diagnóstico en el DOM', d.getElementById('detectedHardwareBadge').textContent.length > 0);

  // 4. Botón de Aplicar Optimización Local Automática
  const autoOptBtn = d.getElementById('autoOptimizeHardwareBtn');
  ok('botón de optimización local existe', Boolean(autoOptBtn));
  autoOptBtn.click();
  const currentSettings = probe('DATA.settings');
  ok('aplicar optimización establece preset local llamacpp', currentSettings.ai.providerPreset === 'llamacpp');
  ok('aplicar optimización apunta a endpoint local en localhost:8080', currentSettings.ai.baseUrl.includes('localhost:8080'));
  ok('marca hardwareAutoConfigured como verdadero', currentSettings.hardwareAutoConfigured === true);

  // 5. Presupuesto adaptativo según el perfil
  probe('DATA.settings.ai.baseUrl = "http://localhost:8080/v1"');
  probe('DATA.settings.hardwareProfile = "cpu-light"');
  const budgetCpu = probe('computePromptBudget("qwen2.5-3b-instruct")');
  ok('perfil cpu-light acota ventana local para no saturar memoria', budgetCpu.windowTokens <= 4096);

  // 6. Verificación de la carpeta OS y WindowsAgentArena
  const osPath = path.join(__dirname, '..', 'OS');
  ok('carpeta OS existe en la raíz de lorekeep', fs.existsSync(osPath));
  ok('OS contiene README.md de WindowsAgentArena', fs.existsSync(path.join(osPath, 'README.md')));
  ok('OS contiene requirements.txt', fs.existsSync(path.join(osPath, 'requirements.txt')));
  ok('OS contiene directorio src/win-arena-container', fs.existsSync(path.join(osPath, 'src', 'win-arena-container')));
  ok('OS contiene Dockerfile-WinArena', fs.existsSync(path.join(osPath, 'src', 'win-arena-container', 'Dockerfile-WinArena')));
  ok('OS contiene scripts de ejecución local (run-local.sh)', fs.existsSync(path.join(osPath, 'scripts', 'run-local.sh')));

  // 7. Ausencia de errores de ejecución en el DOM
  const cleanErrors = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
  ok('sin errores de ejecución en escaneo y arquitectura', cleanErrors.length === 0, cleanErrors.join(' | '));

  w.close();
  R.done();
}

testHardwareScanning().catch((err) => R.crash(err));
