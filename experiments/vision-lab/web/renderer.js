/* Small shared rendering primitives used by both the scenario and evidence workspaces. */
(() => {
'use strict';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function download(name,data,type='application/json'){
 const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type});
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');
 anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const themes=['forest','paper','midnight'];
let theme='forest';try{const saved=localStorage.getItem('navsentinel-studio-theme-v1');if(themes.includes(saved))theme=saved;}catch{/* Optional local preference. */}
function applyTheme(){document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme==='paper'?'light':'dark';}
function themePicker(){
 const group=document.createElement('div');group.className='theme-picker';group.setAttribute('role','group');group.setAttribute('aria-label','Workspace theme');
 for(const name of themes){const button=document.createElement('button');button.type='button';button.textContent=name[0].toUpperCase()+name.slice(1);button.dataset.themeChoice=name;button.setAttribute('aria-pressed',String(name===theme));button.addEventListener('click',()=>{theme=name;applyTheme();try{localStorage.setItem('navsentinel-studio-theme-v1',theme);}catch{/* Visible session preference still works. */}for(const item of group.children)item.setAttribute('aria-pressed',String(item===button));});group.append(button);}
 return group;
}
applyTheme();globalThis.NSRenderer=Object.freeze({escape,download,themePicker});
})();
