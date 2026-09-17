'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// One typed request bridge. No filesystem, shell, eval, raw IPC, or token exposure.
contextBridge.exposeInMainWorld('navDesktop',Object.freeze({request:input=>ipcRenderer.invoke('ns:request',{path:input?.path,method:input?.method,body:input?.body})}));
