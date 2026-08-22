// Integración first-class con OmniRoute: detección, auto-routing por tarea,
// headers de compresión/sesión y telemetría de la ruta real.
const fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const {reporter,ROOT,makeApp,makeSeed}=require('./harness');
const R=reporter('omniroute'),ok=R.ok;

(async()=>{
  const handlers={};const ipcMain={handle:(n,f)=>handlers[n]=f,on(){}};const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lv-omni-'));
  const app={isPackaged:false,getPath:()=>userData,whenReady:()=>({then:()=>({})}),on(){}};const BW=function(){return{setMenuBarVisibility(){},loadFile(){},webContents:{openDevTools(){}}}};BW.getAllWindows=()=>[];
  const originalLoad=Module._load,originalFetch=global.fetch;Module._load=function(r){if(r==='electron')return{app,BrowserWindow:BW,ipcMain,dialog:{},shell:{}};return originalLoad.apply(this,arguments)};
  const requests=[];let requireKey=false;
  global.fetch=async(url,opts={})=>{
    requests.push({url:String(url),opts});
    if(String(url).endsWith('/models')){
      if(requireKey&&!opts.headers.Authorization)return new Response('unauthorized',{status:401});
      return new Response(JSON.stringify({data:[{id:'provider/model-a'},{id:'provider/model-b'}]}),{status:200,headers:{'Content-Type':'application/json','X-OmniRoute-Version':'3.8.50'}});
    }
    if(String(url).endsWith('/chat/completions'))return new Response(JSON.stringify({model:'provider/model-a',choices:[{message:{content:'Respuesta enrutada'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}),{status:200,headers:{'Content-Type':'application/json','X-OmniRoute-Decision':'strategy=auto; provider=free-a; latency_ms=42','X-OmniRoute-Provider':'free-a','X-OmniRoute-Model':'provider/model-a','X-OmniRoute-Latency-Ms':'42','X-OmniRoute-Response-Cost':'0.0000000000','X-OmniRoute-Cache-Hit':'false','X-OmniRoute-Fallback-Attempts':'1','X-OmniRoute-Compression':'off; source=request-header','X-OmniRoute-Version':'3.8.50','X-OmniRoute-Request-Id':'omni-req-1'}});
    return new Response('not found',{status:404});
  };
  require(path.join(ROOT,'main.js'));Module._load=originalLoad;
  const status=handlers['ai:omnirouteStatus'],generate=handlers['ai:generate'],verify=handlers['ai:verify'];
  ok('handler OmniRoute registrado',typeof status==='function');
  let res=await status(null,{baseUrl:'http://localhost:20128/v1',apiKey:''});
  ok('detecta gateway y catálogo sin key',res.ok&&res.modelCount===2&&res.version==='3.8.50');
  ok('modelo virtual auto queda disponible',res.autoAvailable===true&&res.dashboardUrl==='http://localhost:20128');
  const verified=await verify(null,{baseUrl:'http://localhost:20128/v1',apiKey:'',model:'auto/smart'});
  ok('verificación acepta auto/* aunque sea virtual',verified.ok&&verified.steps.find(s=>s.id==='model').ok);
  res=await generate(null,{baseUrl:'http://localhost:20128/v1',apiKey:'',model:'auto/smart',messages:[{role:'user',content:'hola'}],task:'rpg',compression:'off',sessionId:'lorevinci-story',requestId:'req-test'});
  ok('generación local OmniRoute funciona sin key',res.ok&&res.text==='Respuesta enrutada');
  const chatReq=requests.find(x=>x.url.endsWith('/chat/completions')&&x.opts.headers['X-LoreVinci-Task']==='rpg');
  ok('envía tarea, sesión, compresión y request id',chatReq.opts.headers['X-LoreVinci-Task']==='rpg'&&chatReq.opts.headers['X-OmniRoute-Session-Id']==='lorevinci-story'&&chatReq.opts.headers['X-OmniRoute-Compression']==='off'&&chatReq.opts.headers['X-Request-Id']==='req-test');
  ok('captura proveedor/modelo/latencia/fallback/coste',res.route.provider==='free-a'&&res.route.model==='provider/model-a'&&res.route.latencyMs===42&&res.route.fallbackAttempts===1&&res.route.responseCost==='0.0000000000');
  ok('captura decisión y versión de OmniRoute',/strategy=auto/.test(res.route.decision)&&res.route.version==='3.8.50');
  requireKey=true;res=await status(null,{baseUrl:'http://localhost:20128/v1',apiKey:''});
  ok('401 explica dónde crear key del gateway',!res.ok&&/Dashboard.*API Keys/.test(res.error));
  global.fetch=originalFetch;fs.rmSync(userData,{recursive:true,force:true});

  // Renderer/UI
  const seed=makeSeed();seed.settings.ai.omniroute={enabled:false,routes:{},compression:'off'};
  const routedCalls=[],opened=[];
  const ui=makeApp({seed,bridge:{
    omniRouteStatus:async()=>({ok:true,baseUrl:'http://localhost:20128/v1',dashboardUrl:'http://localhost:20128',latencyMs:9,modelCount:2,models:['provider/a','provider/b'],autoAvailable:true,version:'3.8.50'}),
    aiGenerate:async p=>{routedCalls.push(p);return{ok:true,text:'ok',route:{provider:'provider-a',model:'model-a',latencyMs:33,fallbackAttempts:0,responseCost:'0.0000000000',decision:'strategy=auto'}}},
    openExternal:async url=>{opened.push(url);return{ok:true}}
  }});
  await new Promise(r=>setTimeout(r,2600));const w=ui.w,d=w.document,probe=w.__probe;
  probe('showView("settings")');await probe('detectAndUseOmniRoute()');
  ok('un clic configura endpoint y modelo auto',probe('DATA.settings.ai.provider')==='omniroute'&&probe('DATA.settings.ai.baseUrl')==='http://localhost:20128/v1'&&probe('DATA.settings.ai.model')==='auto');
  ok('panel muestra versión, modelos y latencia',/v3.8.50/.test(d.getElementById('omnirouteStatusBadge').textContent)&&/2 modelos.*9 ms/.test(d.getElementById('omnirouteStatusText').textContent));
  await probe(`generateWithRouting('rpg',{baseUrl:DATA.settings.ai.baseUrl,apiKey:'',model:'fallback',messages:[{role:'user',content:'x'}],maxTokens:20})`);
  ok('perfil RPG usa auto/smart',routedCalls[0].model==='auto/smart'&&routedCalls[0].task==='rpg');
  ok('routing añade compresión y afinidad de sesión',routedCalls[0].compression==='off'&&/^lorevinci-/.test(routedCalls[0].sessionId));
  ok('telemetría visible después de la llamada',/proveedor provider-a.*modelo model-a.*33 ms/.test(d.getElementById('omnirouteLastRoute').textContent));
  d.getElementById('omniRouteRpg').value='auto/fast';d.getElementById('omniRouteRpg').dispatchEvent(new w.Event('change',{bubbles:true}));
  await probe(`generateWithRouting('rpg',{baseUrl:DATA.settings.ai.baseUrl,apiKey:'',model:'fallback',messages:[]})`);
  ok('perfil por tarea se puede cambiar',routedCalls[1].model==='auto/fast');
  probe(`DATA.settings.ai.baseUrl='https://api.openai.com/v1';DATA.settings.ai.provider='openai';ensureOmniRouteSettings().enabled=false;`);
  await probe(`generateWithRouting('rpg',{baseUrl:DATA.settings.ai.baseUrl,apiKey:'x',model:'direct-model',messages:[]})`);
  ok('conexión directa permanece disponible',routedCalls[2].model==='direct-model'&&!routedCalls[2].compression);
  d.getElementById('openOmniRouteDashboardBtn').click();await new Promise(r=>setTimeout(r,0));
  ok('dashboard se abre explícitamente',opened.includes('http://localhost:20128'));
  R.done();
})().catch(err=>{console.error(err);process.exit(1)});
