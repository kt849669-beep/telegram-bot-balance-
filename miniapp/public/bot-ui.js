'use strict';
const $=s=>document.querySelector(s);
const specs=[['start','👋','Main menu'],['add','➕','Naya data daalein'],['scan','🔍','14 sites ek sath check'],['ocr','📸','Photo / PDF se scan'],['check','👁️','Saved list check'],['edit','✏️','Entry update'],['balance','💰','Sabhi saved balances'],['password','🔑','Password aur MPIN'],['list','📋','Saved entries ki list'],['restart','🔄','Reset / Restart']];
const state={revision:-1,messages:[],busy:[],step:null,polling:false,sending:false,notice:null};
let toastTimer;
function toast(s){$('#notice').textContent=s;$('#notice').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#notice').hidden=true,4000);}
const sessionClient=createMiniappApi();
const api=(route,body)=>sessionClient.api(route,body,'POST');
function appendText(container,text,markdown){
  if(!markdown){container.textContent=text;return;}
  const pattern=/`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;let last=0,match;
  while((match=pattern.exec(text))){container.append(document.createTextNode(text.slice(last,match.index)));let el;if(match[1]!==undefined){const value=match[1];el=document.createElement('button');el.type='button';el.className='copy-code';el.textContent=value;el.title='Tap to copy';el.onclick=()=>navigator.clipboard.writeText(value).then(()=>toast('Copy ho gaya')).catch(()=>toast('Copy ke liye text select karein.'));}else{el=document.createElement(match[2]!==undefined?'strong':'em');el.textContent=match[2]??match[3];}container.append(el);last=pattern.lastIndex;}
  container.append(document.createTextNode(text.slice(last)));
}
function bottom(){const chat=$('#chat-scroll');chat.scrollTop=chat.scrollHeight;}
function apply(data,force=false){
  if(data.stream!==state.stream){state.stream=data.stream;state.revision=-1;}
  if(data.revision<state.revision)return;
  state.busy=data.busy||[];state.step=data.step||null;
  const hints={add_phone:'Mobile number bhejein',add_password:'Pin / Code bhejein',awaiting_scan_phone:'Mobile number bhejein',awaiting_scan_password:'Pin / Code bhejein',get_password:'Mobile number ya kam se kam 4 digit bhejein',edit_num:'Naya mobile number bhejein',edit_pass:'Naya Pin / Code bhejein',waiting_ocr_file:'＋ se photo ya PDF upload karein',waiting_click:'Upar site ka button chunein',ocr_confirm:'Scan Karo ya Cancel chunein'};
  $('#step-hint').textContent=hints[state.step]||'';$('#message-input').type=['add_password','awaiting_scan_password','edit_pass'].includes(state.step)?'password':'text';
  $('#busy-status').hidden=!state.busy.length;$('#busy-status').textContent=state.busy.map(f=>'/'+f.command).join(', ')+' chal raha hai…';
  if(data.unchanged)return;
  state.revision=data.revision;state.messages=data.messages||[];
  const chat=$('#chat-scroll');const near=chat.scrollHeight-chat.scrollTop-chat.clientHeight<100;
  const fragment=document.createDocumentFragment();const busy=new Set(state.busy.map(x=>x.id));
  for(const m of state.messages){const article=document.createElement('article');article.className='message '+m.role;article.dataset.messageId=m.id;
    if(m.role==='bot'){const sender=document.createElement('div');sender.className='sender';sender.textContent='MASTER CONTROL';article.append(sender);}
    const bubble=document.createElement('div');bubble.className='bubble';const text=document.createElement('div');text.className='message-text';appendText(text,m.text,m.parseMode==='Markdown');bubble.append(text);article.append(bubble);
    if(m.buttons?.length){const keys=document.createElement('div');keys.className='keyboard';for(const row of m.buttons){const line=document.createElement('div');line.className='keyboard-row';for(const b of row){const el=document.createElement('button');el.type='button';el.className='callback-button';el.textContent=b.text;el.disabled=busy.has(m.flowId);el.onclick=()=>send({action:b.id});line.append(el);}keys.append(line);}bubble.append(keys);}
    const stamp=document.createElement('span');stamp.className='time';stamp.textContent=new Date(m.createdAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});article.append(stamp);fragment.append(article);
  }
  $('#messages').replaceChildren(fragment);if(force||near)requestAnimationFrame(bottom);
  if(data.notice)toast(data.notice);
}
async function send(event){if(state.sending)return;state.sending=true;try{apply(await api('bot/event',event),true);await poll(true);}catch(e){toast(e.message);}finally{state.sending=false;}}
async function poll(force=false){if(state.polling)return;state.polling=true;try{apply(await api('bot/state',{stream:state.stream,revision:state.revision}),force);$('#connection').textContent='Online · same bot commands';}catch(e){$('#connection').textContent='Connection unavailable';if(force)toast(e.message);}finally{state.polling=false;}}
function menu(){document.body.classList.toggle('menu-open');}
for(const [command,symbol,label] of specs){const b=document.createElement('button');b.type='button';b.dataset.command=command;const icon=document.createElement('span');icon.className='symbol';icon.textContent=symbol;const info=document.createElement('span');const name=document.createElement('strong');name.textContent='/'+command;const desc=document.createElement('small');desc.textContent=label;info.append(name,desc);b.append(icon,info);b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));document.body.classList.remove('menu-open');send({text:'/'+command});};$('#command-menu').append(b);}
$('#message-form').addEventListener('submit',async e=>{e.preventDefault();const field=$('#message-input');const text=field.value.trim();if(!text||state.sending)return;field.value='';await send({text});});
$('#toggle-menu').onclick=menu;$('#show-commands').onclick=()=>{if(innerWidth<=600)menu();else $('#command-menu button').focus();};$('#scroll-bottom').onclick=bottom;
document.addEventListener('click',e=>{if(document.body.classList.contains('menu-open')&&!e.target.closest('aside,#toggle-menu,#show-commands'))document.body.classList.remove('menu-open');});
$('#attach-file').onclick=()=>$('#file-input').click();
$('#file-input').addEventListener('change',async e=>{const files=[...e.target.files];if(files.length>10){toast('Ek baar mein 10 files tak bhejein.');return;}$('#attach-file').disabled=true;try{for(const file of files){if(!file.size||file.size>8*1024*1024)throw new Error('Har file 8 MB se chhoti honi chahiye.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));await send({file:{name:file.name,mime:file.type||'text/plain',base64:btoa(binary)}});}}catch(err){toast(err.message);}finally{$('#attach-file').disabled=false;e.target.value='';}});
async function boot(){try{const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();if(tg?.isVersionAtLeast('6.1')){tg.setHeaderColor('#ffffff');tg.setBackgroundColor('#ffffff');}const session=await sessionClient.connect();$('#mode').textContent=session.demo?'Demo · sample accounts':session.mode==='local'?'Local · connected to bot':'Telegram · connected';$('#workspace-tag').textContent=session.demo?'DEMO':'MINI APP';await poll(true);setInterval(()=>{if(!document.hidden)void poll();},1200);}catch(e){$('#connection').textContent='Not connected';toast(e.message);}}
void boot();
