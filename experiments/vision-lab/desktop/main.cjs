'use strict';
const {app,BrowserWindow,ipcMain,session,dialog}=require('electron');
const path=require('node:path');const {createService}=require('../daemon/server.cjs');
const {validateRequest}=require('./bridge.cjs');
// Overrides isolate automated native tests and deliberate parallel lab sessions.
if(process.env.NS_DESKTOP_DATA_DIR)app.setPath('userData',path.resolve(process.env.NS_DESKTOP_DATA_DIR));
let win=null,service=null,closing=false;
app.enableSandbox();
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{win?.show();win?.focus();});
 app.whenReady().then(async()=>{
  // Fixed loopback origin preserves browser storage across native launches.
  // The standalone daemon must be stopped before starting this owned instance.
  service=await createService({port:Number(process.env.NS_DESKTOP_PORT??4318),labPort:Number(process.env.NS_DESKTOP_LAB_PORT??4319),dataDir:path.join(app.getPath('userData'),'broker'),quiet:true});
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({width:1480,height:990,minWidth:720,minHeight:620,title:'NavSentinel · Desktop Lab',backgroundColor:'#101511',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,nodeIntegrationInWorker:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const guardNavigation=(event,url)=>{let valid=false;try{const u=new URL(url);valid=u.origin===service.origin&&['/','/web/index.html'].includes(u.pathname);}catch{}if(!valid)event.preventDefault();};
  win.webContents.on('will-navigate',guardNavigation);win.webContents.on('will-redirect',guardNavigation);
  ipcMain.handle('ns:request',async(event,input)=>{
   if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Unexpected IPC sender');
   if(new URL(event.senderFrame.url).origin!==service.origin)throw Error('Unexpected sender origin');
   const request=validateRequest(input),payload=request.body;
   const response=await fetch(service.origin+request.path,{method:request.method,headers:{Authorization:`Bearer ${service.adminToken}`,...(payload?{'Content-Type':'application/json'}:{})},body:payload,redirect:'error',signal:AbortSignal.timeout(5000)});
   return {status:response.status,data:await response.json()};
  });
  await win.loadURL(service.origin+'/?mode=desktop');if(process.env.NS_DESKTOP_HIDDEN!=='1')win.show();
 }).catch(async error=>{dialog.showErrorBox('NavSentinel could not start',`${error.message}\n\nStop the standalone daemon before opening the native shell. Ports 4318 and 4319 must be free.`);if(service)await service.close();app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{if(closing||!service)return;event.preventDefault();closing=true;service.close().finally(()=>app.quit());});
}
