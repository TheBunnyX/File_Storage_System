import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Node','Event','MouseEvent','KeyboardEvent','FormData','localStorage']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const mediaListeners=new Set();let drawerViewport=false;
const media = query=>({get matches(){return drawerViewport&&query.includes('max-width: 1024px')},media:query,addEventListener(_,fn){mediaListeners.add(fn)},removeEventListener(_,fn){mediaListeners.delete(fn)}});
globalThis.matchMedia=dom.window.matchMedia=media;
const React=await import('react'), {act}=React, {createRoot}=await import('react-dom/client');
await mkdir('.test-data',{recursive:true});const temp=await mkdtemp(path.resolve('.test-data/ui-'));
for(const folder of ['components','lib','app']) await mkdir(path.join(temp,folder));
for(const file of [...(await readdir('components')).filter(f=>f.endsWith('.tsx')).map(f=>'components/'+f),'app/page.tsx','lib/types.ts','lib/translations.ts']) {
 let code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 code=code.replace(/require\("@\/([^"\n]+)"\)/g,(_,p)=>'require('+JSON.stringify(path.join(temp,p))+')');
 await writeFile(path.join(temp,file.replace(/\.tsx?$/,'.js')),code);
}
const require=createRequire(path.join(temp,'index.js')), Home=require('./app/page.js').default, {PreferencesProvider}=require('./components/preferences.js');
const file=(id,name,bytes,modified)=>({id,name,bytes,modified,created:modified,type:'Document',mime:'text/plain',tags:[],folder:'Research',folderId:1,ownerId:1,ownerName:'UX Tester',permission:'owner',favorite:false,shared:false,deleted:false,url:'/api/files/'+id+'/content',hash:'a'.repeat(64),version:1,excerpt:'Test contents',extractionStatus:'Indexed',size:bytes+' B'});
let state={user:{id:1,name:'UX Tester',email:'ux@example.test'},files:[file(1,'Zebra.txt',200,'2026-01-02'),file(2,'Alpha.txt',100,'2026-01-03'),file(3,'Beta.txt',300,'2026-01-01')],folders:[{id:1,name:'Research',color:'blue',ownerId:1,permission:'owner',count:3,shared:false}],used:600,quota:1048576,maxUpload:1048576,activities:[],preferences:{}};
let mode='ok',pending,requests=[];
globalThis.fetch=async(url,options={})=>{
 requests.push({url,options});
 if(url==='/api/workspace') {if(mode==='pending')return new Promise(resolve=>pending=resolve);if(mode==='timeout')throw new DOMException('Timed out','TimeoutError');if(mode==='unauthorized')return Response.json({error:'Please sign in'},{status:401});return Response.json(state);}
 if(url==='/api/uploads')return Response.json({uploads:[]});
 if(/^\/api\/files\/\d+$/.test(url)){const f=state.files.find(f=>f.id===Number(url.split('/').pop()));return Response.json({file:f,text:'Test contents',activities:[],versions:[],shares:[],inheritedShares:[],scan:{status:'clean',checked:null}});}
 if(/^\/api\/files\/\d+\/(content|preview)/.test(url))return new Response('Test contents',{headers:{'Content-Type':'text/plain'}});
 if(url==='/api/preferences'){Object.assign(state.preferences,JSON.parse(options.body));return Response.json(state.preferences);}
 if(url==='/api/files/bulk'){for(const item of JSON.parse(options.body).items)Object.assign(state.files.find(f=>f.id===item.id),item.changes);return Response.json({ok:true});}
 if(url.startsWith('/api/search'))return Response.json({ids:state.files.filter(f=>f.name.toLowerCase().includes(new URL('http://localhost'+url).searchParams.get('q').toLowerCase())).map(f=>f.id)});
 if(url==='/api/folders'&&options.method==='POST'){const body=JSON.parse(options.body),id=state.folders.length+1;state.folders.push({id,name:body.name,color:body.color,ownerId:1,permission:'owner',count:0,shared:false});return Response.json({id},{status:201});}
 if(/^\/api\/folders\/\d+$/.test(url)&&options.method==='PATCH'){Object.assign(state.folders.find(f=>f.id===Number(url.split('/').pop())),JSON.parse(options.body));return Response.json({ok:true});}
 throw Error('Unexpected request '+url);
};
const root=createRoot(document.querySelector('#root'));let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++};
const text=()=>document.body.textContent;
const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);
const click=async el=>{assert.ok(el,'Control exists');await act(async()=>{el.click()})};
const change=async(el,value)=>{await act(async()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))})};
const names=()=>[...document.querySelectorAll('tbody .file-name')].map(e=>e.textContent.trim());
try {
 mode='pending';await act(async()=>root.render(React.createElement(PreferencesProvider,null,React.createElement(Home))));
 check(document.querySelector('[aria-busy="true"]')&&text().includes('Checking your session'),'Loading skeleton and progress copy');
 await act(async()=>{mode='ok';pending(Response.json(state))});
 check(names().join(',')==='Alpha.txt,Zebra.txt,Beta.txt','Newest first by default');
 const sort=()=>document.querySelector('.sort-select select');
 for(const [value,expected] of [['name-asc','Alpha.txt,Beta.txt,Zebra.txt'],['name-desc','Zebra.txt,Beta.txt,Alpha.txt'],['size-desc','Beta.txt,Zebra.txt,Alpha.txt'],['size-asc','Alpha.txt,Zebra.txt,Beta.txt'],['modified-asc','Beta.txt,Zebra.txt,Alpha.txt']]){await change(sort(),value);check(names().join(',')===expected,'Sort '+value);}
 await act(async()=>await new Promise(r=>setTimeout(r,550)));
 check(state.preferences.sort==='modified-asc','Ordering preference is saved');
 await click(button('Images'));check(names().length===0&&text().includes('No matching files'),'Filtered empty state');
 check(document.querySelector('.active-filters')?.textContent.includes('Images'),'Active filter label');
 await click(document.querySelector('.active-filters button'));check(names().length===3,'Clear all filters restores files');
 await click(button('Advanced search'));const min=document.querySelector('.advanced-fields input[type=number]');await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(min,'1');min.dispatchEvent(new Event('input',{bubbles:true}))});
 check(names().length===0,'Advanced minimum size is applied');await click(document.querySelector('.active-filters button'));check(names().length===3,'Advanced filters clear');
 await click(document.querySelector('.folder-open'));check(document.querySelector('[aria-current=location]')?.textContent==='Research','Folder breadcrumb');
 await click(document.querySelector('.file-breadcrumb button'));check(!document.querySelector('[aria-current=location]'),'Breadcrumb returns to all files');
 await act(async()=>window.dispatchEvent(new Event('offline')));check(text().includes('Offline'),'Offline status');
 await act(async()=>window.dispatchEvent(new Event('online')));check(text().includes('Workspace up to date'),'Reconnect refreshes workspace');
 await click(document.querySelector('tbody input[type=checkbox]'));await click(document.querySelector('.selection-bar button'));
 check(names().length===2&&document.querySelector('.undo-banner'),'Trash action exposes Undo');await click([...document.querySelectorAll('.undo-banner button')].find(b=>b.textContent==='Undo'));check(names().length===3&&!document.querySelector('.undo-banner'),'Undo restores files');
 await click(button('Settings'));await change(document.querySelector('.settings-form select')||document.querySelector('.live-modal select'),'th');
 // Settings uses language as the first appearance selector.
 check(document.querySelector('.live-modal')?.textContent.includes('ภาษา'),'Thai appearance labels');
 await click(document.querySelector('.modal-close'));check(text().includes('จัดเรียงไฟล์'),'Thai workspace controls');
 mode='timeout';await click(document.querySelector('[aria-label="รีเฟรชพื้นที่ทำงาน"]'));check(text().includes('โหลดพื้นที่ทำงานนานเกินไป'),'Timeout shows actionable error');

 const {AuthForm}=require('./components/auth-form.js');let signedIn=false,credentials;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>url==='/api/auth/config'?Response.json({demoAccounts:[{name:'Super',label:'Super Admin',email:'superadmin@nexafile.demo',role:'super_admin',department:'Platform',password:'NexaDemo!2026',description:'Manage demo accounts across departments'},{name:'Department',label:'Admin Department',email:'department.admin@nexafile.demo',role:'department_admin',department:'Product',password:'NexaDemo!2026',description:'Manage demo users in the Product department'},{name:'User',label:'User',email:'user@nexafile.demo',role:'user',department:'Product',password:'NexaDemo!2026',description:'Upload, organize and share your own files'}]}):url==='/api/auth/login'?(credentials=JSON.parse(options.body),Response.json({user:{id:10}})):originalFetch(url,options);
 await act(async()=>root.render(React.createElement(PreferencesProvider,null,React.createElement(AuthForm,{onSuccess:async()=>{signedIn=true}}))));
 check(document.querySelectorAll('.demo-account').length===3,'Login displays three demo roles');
 await click(document.querySelector('.demo-account'));
 check(signedIn&&credentials.email==='superadmin@nexafile.demo','Demo button signs in with selected account');

 globalThis.fetch=originalFetch; mode='ok';
 const switchLanguage=async(code)=>click(document.querySelector('.language-switcher button[lang="'+code+'"]'));
 await act(async()=>root.render(React.createElement(PreferencesProvider,null,React.createElement(Home))));
 await switchLanguage('en');check(text().includes('Files')&&document.documentElement.lang==='en','EN switch updates UI and document language');
 await switchLanguage('th');check(text().includes('โฟลเดอร์')&&document.documentElement.lang==='th','TH switch updates UI and document language');
 check(JSON.parse(localStorage.getItem('nexafile-ui')).language==='th','Language choice survives in local preferences');
 check(state.preferences.language==='th','Language choice saved to account');
 check(document.querySelector('.language-switcher button[lang="th"]').getAttribute('aria-pressed')==='true','Selected language has accessible state');
 const oldName=state.files[0].name;state.files[0].name='Search';
 await click(document.querySelector('[aria-label="รีเฟรชพื้นที่ทำงาน"]'));
 check(names().includes('Search'),'File names stay unchanged in Thai');state.files[0].name=oldName;

 check(!document.querySelector('.sidebar .ai-nav')&&!document.querySelector('.floating-assistant')&&!document.querySelector('.assistant-panel'),'No AI entry points remain in the workspace');
 {const toggle=()=>document.querySelector('.topbar .sidebar-toggle'),aside=()=>document.getElementById('app-sidebar'),ws=()=>document.querySelector('.workspace');
 check(toggle().getAttribute('aria-expanded')==='true'&&toggle().getAttribute('aria-controls')==='app-sidebar'&&toggle().getAttribute('aria-label')==='ปิดเมนู'&&!aside().hasAttribute('inert'),'Desktop sidebar starts expanded with accessible toggle');
 await click(toggle());check(ws().classList.contains('sidebar-collapsed')&&aside().hasAttribute('inert')&&toggle().getAttribute('aria-expanded')==='false'&&toggle().getAttribute('aria-label')==='เปิดเมนู'&&localStorage.getItem('nexafile-sidebar')==='collapsed','Desktop toggle collapses sidebar and remembers it');
 await click(toggle());check(!ws().classList.contains('sidebar-collapsed')&&!aside().hasAttribute('inert')&&localStorage.getItem('nexafile-sidebar')==='expanded','Desktop toggle expands sidebar again');
 drawerViewport=true;await act(async()=>mediaListeners.forEach(fn=>fn()));check(aside().hasAttribute('inert')&&!ws().classList.contains('sidebar-collapsed')&&toggle().getAttribute('aria-expanded')==='false'&&!document.querySelector('.sidebar-scrim'),'Tablet/mobile hides sidebar by default');
 await click(toggle());check(aside().classList.contains('mobile-open')&&!aside().hasAttribute('inert')&&!!document.querySelector('.sidebar-scrim')&&document.querySelector('.main-shell').hasAttribute('inert')&&document.activeElement?.classList.contains('nav-item'),'Drawer opens over content and moves focus into navigation');
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));check(!aside().classList.contains('mobile-open')&&aside().hasAttribute('inert')&&document.activeElement===toggle(),'Escape closes drawer and returns focus to menu button');
 await click(toggle());await click(document.querySelector('.sidebar-scrim'));check(!aside().classList.contains('mobile-open')&&!document.querySelector('.sidebar-scrim'),'Clicking outside closes drawer');
 await click(toggle());await click([...aside().querySelectorAll('.nav-item')][1]);check(!aside().classList.contains('mobile-open'),'Choosing a page closes drawer');await click([...aside().querySelectorAll('.nav-item')][0]);
 drawerViewport=false;await act(async()=>mediaListeners.forEach(fn=>fn()));check(!aside().hasAttribute('inert')&&toggle().getAttribute('aria-expanded')==='true','Returning to desktop restores the sidebar');}
 await click(document.querySelector('tbody .file-name'));await act(async()=>{await new Promise(r=>setTimeout(r,50))});
 {const more=document.querySelector('.suggested-actions .file-actions-button');check(more&&more.type==='button'&&more.getAttribute('aria-haspopup')==='dialog'&&more.textContent.includes('การจัดการเพิ่มเติม'),'More file actions is an accessible single button');
 await click(more);const menu=document.querySelector('.modal .file-menu');check(menu&&menu.textContent.includes('ดาวน์โหลดต้นฉบับ')&&menu.textContent.includes('ย้ายไปถังขยะ'),'More file actions opens the file action menu');
 await click(document.querySelector('.modal [aria-label="ปิดหน้าต่าง"]'));check(!document.querySelector('.modal'),'File action menu closes');
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));}

 await switchLanguage('en');
 {const swatches=()=>[...document.querySelectorAll('.modal .folder-color-picker [role=radio]')],checkedColor=()=>swatches().find(s=>s.getAttribute('aria-checked')==='true')?.getAttribute('aria-label');
 await click(document.querySelector('.folders-section .section-heading .text-button'));
 check(swatches().length===9&&checkedColor()==='Yellow'&&document.querySelector('.modal [role=radiogroup]')?.getAttribute('aria-label')==='Folder color','New folder dialog offers nine colours, yellow selected');
 await click(swatches().find(s=>s.getAttribute('aria-label')==='Teal'));check(checkedColor()==='Teal','Picking a colour selects it');
 await change(document.querySelector('.modal input'),'Plans');await act(async()=>{document.querySelector('.modal form').requestSubmit()});
 check(JSON.parse(requests.filter(r=>r.url==='/api/folders').at(-1).options.body).color==='teal'&&document.querySelector('.folder-shape.teal'),'New folder is created and shown in the chosen colour');
 await click(document.querySelector('[aria-label="Manage folder Research"]'));check(checkedColor()==='Blue','Folder menu shows the current colour');
 await click(swatches().find(s=>s.getAttribute('aria-label')==='Red'));
 const patch=requests.filter(r=>r.url==='/api/folders/1').at(-1);check(patch&&patch.options.method==='PATCH'&&JSON.parse(patch.options.body).color==='red','Folder menu saves the new colour');
 check(checkedColor()==='Red'&&document.querySelector('.modal')&&text().includes('Folder color changed.'),'Colour change keeps the menu open and confirms');
 await click(document.querySelector('.modal [aria-label="Close dialog"]'));
 const research=[...document.querySelectorAll('.folder-open')].find(b=>b.textContent.includes('Research'));check(research?.querySelector('.folder-shape.red'),'Folder card shows the new colour');
 state.folders=state.folders.filter(f=>f.name!=='Plans');Object.assign(state.folders[0],{color:'blue'});await click(document.querySelector('[aria-label="Refresh workspace"]'));}
 {const shortcuts=[...document.querySelectorAll('.feature-icons .feature-icon-button')];
 {const items=[...document.querySelectorAll('.sidebar .nav-item')];check(items.map(b=>b.textContent.trim().replace(/\d+$/,'')).join()==='My Files,Shared,Favorites,Trash'&&items[0].classList.contains('active'),'Sidebar has no Dashboard or Recent item and opens on My Files');}
 check(!document.querySelector('.feature-card')&&shortcuts.map(b=>b.getAttribute('aria-label')).join()==='Content Search,Duplicate Detection,Storage Usage'&&!document.querySelector('.storage-card')&&shortcuts.every(b=>b.type==='button'&&b.title.includes('—')),'Dashboard shortcuts are labelled icon buttons with tooltips');
 await click(shortcuts[0]);check(document.activeElement?.tagName==='INPUT'&&document.activeElement.closest('.topbar'),'Content Search icon focuses the search box');
 await click(shortcuts[1]);check(document.querySelector('.modal')?.textContent.includes('Duplicate files'),'Duplicate Detection icon opens duplicate files');
 await click(document.querySelector('.modal [aria-label="Close dialog"]'));
 check(shortcuts[2].title.includes('600 B of 1.0 MB used')&&shortcuts[2].querySelector('.feature-meter.ok'),'Storage icon shows usage in its tooltip and meter');
 await click(shortcuts[2]);const dialog=document.querySelector('.modal');
 check(dialog?.querySelector('.storage-summary-head')?.textContent.includes('600 B')&&dialog.textContent.includes('free')&&dialog.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='0','Storage dialog leads with used, free and a progress bar');
 check(dialog.textContent.includes('Plenty of space left.')&&dialog.textContent.includes('This space is for your account only.'),'Storage dialog explains the status in plain words');
 check([...dialog.querySelectorAll('.storage-list li')].map(li=>li.querySelector('.storage-name').textContent).join()==='Documents','Storage breakdown lists only types that use space');
 await click(document.querySelector('.modal [aria-label="Close dialog"]'));}
 const previousFiles=state.files;state.files=Array.from({length:121},(_,i)=>file(i+10,'Document '+String(i).padStart(3,'0')+'.txt',100,'2026-01-01'));
 await click(document.querySelector('[aria-label="Refresh workspace"]'));
 check(names().length===50&&text().includes('Page 1 of 3'),'Pagination renders at most fifty file rows');
 await click(button('Next page'));check(names().length===50&&text().includes('Page 2 of 3'),'Next page changes visible file slice');
 await click(button('Next page'));check(names().length===21&&button('Next page').disabled,'Last page has remaining files and disabled next action');
 await click(button('Previous page'));check(text().includes('Page 2 of 3'),'Previous page navigation');
 state.files=previousFiles;await click(document.querySelector('[aria-label="Refresh workspace"]'));
 check(names().length===previousFiles.filter(f=>!f.deleted).length&&!document.querySelector('.file-pagination'),'Pagination clamps safely after file count shrinks');
 await switchLanguage('th');
 const {AdminPanel}=require('./components/admin-panel.js'),{LanguageSwitcher}=require('./components/language-switcher.js');
 const renderAdmin=section=>act(async()=>root.render(React.createElement(PreferencesProvider,null,React.createElement(LanguageSwitcher),React.createElement(AdminPanel,{section}))));
 const adminPosts=[];
 globalThis.fetch=async(url,options={})=>url==='/api/admin'?Response.json({users:[{id:1,name:'UX Tester',email:'ux@example.test',role:'super_admin',self:true,canManage:true,mfa:false,blocked:false,used:1,quota:1048576},{id:2,name:'Reset Member',email:'member@example.test',role:'user',canManage:true,mfa:true,blocked:false,used:1,quota:2097152}],events:[],system:{backups:{enabled:false,intervalMinutes:1440,retain:7},lastBackup:null,disk:{free:1000000,total:2000000},backupDirectory:'test-path',antivirus:{configured:false,required:false}}}):url==='/api/admin/reset-password'?(adminPosts.push(JSON.parse(options.body)),Response.json({ok:true})):originalFetch(url,options);
 await renderAdmin('Overview & services');
 check(text().includes('สถานะบริการ')&&text().includes('การสแกนไวรัส')&&!text().includes('SMTP'),'Admin overview and service names translated without SMTP');
 check(text().includes('ClamAV: ไม่บังคับ')&&!text().includes('OCR'),'Interpolated antivirus help translated and OCR is gone');
 await renderAdmin('Members');check(text().includes('บทบาท / ความปลอดภัย')&&text().includes('ผู้ดูแลระบบสูงสุด'),'Admin member labels and role translated');
 const editButtons=()=>[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='แก้ไข');
 await click(editButtons()[0]);check(!button('ตั้งรหัสผ่านใหม่'),'Admin cannot reset their own password from Members');
 await click(editButtons()[1]);check(document.querySelector('.member-editor [name=quota]').value==='2'&&document.querySelector('.member-editor h3').textContent==='Reset Member','Switching members reloads the editor values');check(!!button('ตั้งรหัสผ่านใหม่')&&text().includes('ปิดการยืนยันสองขั้นตอนด้วย'),'Admin reset password form shown in Thai with 2FA option');
 {const resetForm=button('ตั้งรหัสผ่านใหม่').closest('form');resetForm.querySelector('[name=password]').value='admin-set-password-1';resetForm.querySelector('[name=confirm]').value='admin-set-password-2';await click(button('ตั้งรหัสผ่านใหม่'));check(adminPosts.length===0&&text().includes('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน'),'Mismatched admin reset passwords are rejected locally');
 resetForm.querySelector('[name=confirm]').value='admin-set-password-1';resetForm.querySelector('[name=resetMfa]').checked=true;await click(button('ตั้งรหัสผ่านใหม่'));check(adminPosts.length===1&&adminPosts[0].id===2&&adminPosts[0].password==='admin-set-password-1'&&adminPosts[0].resetMfa===true,'Admin reset password posts member id, password and 2FA choice');check(text().includes('ตั้งรหัสผ่านใหม่แล้ว'),'Admin reset success message translated');}
 await switchLanguage('en');check(text().includes('Role / security')&&text().includes('Super Admin'),'Admin switches back to EN');
 await act(async()=>root.render(React.createElement(PreferencesProvider,null,React.createElement(AuthForm,{onSuccess:async()=>{}}))));
 await switchLanguage('th');check(text().includes('ยินดีต้อนรับกลับ'),'Login is translated');await switchLanguage('en');check(text().includes('Welcome back.'),'Login switches back to EN');
 console.log(`PASS: ${checks} UI checks in an isolated DOM (mocked API; no real account or files).`);
} finally {await act(async()=>root.unmount());dom.window.close();}
