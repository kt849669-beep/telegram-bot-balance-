'use strict';
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const {createRequire}=require('node:module');

const commands=['start','add','scan','ocr','check','edit','balance','password','list','restart'];
class BotMirror {
  constructor({source,botDir,store,registerFile,resetNative=()=>{},requireOverride,fastTimers=false}){
    this.source=source;this.botDir=botDir;this.store=store;this.registerFile=registerFile;this.resetNative=resetNative;this.requireOverride=requireOverride;this.fastTimers=fastTimers;this.workspaces=new Map();this.sequence=0;
  }
  workspace(owner){
    let w=this.workspaces.get(owner);
    if(!w){w={owner,stream:crypto.randomUUID(),messages:[],flows:new Map(),actions:new Map(),active:null,revision:0,lastUse:Date.now(),notice:null};this.workspaces.set(owner,w);}
    w.lastUse=Date.now();return w;
  }
  emit(w,flow,text,extra={},editId){
    const clean=flow.clean(String(text??''));
    let msg=editId?w.messages.find(m=>m.id===editId):null;
    if(!msg){msg={id:++this.sequence,role:'bot',flowId:flow.id,createdAt:new Date().toISOString()};w.messages.push(msg);}
    for(const [id,a] of w.actions)if(a.messageId===msg.id)w.actions.delete(id);
    msg.text=clean;msg.buttons=(extra?.reply_markup?.inline_keyboard||[]).map(row=>row.filter(b=>b.callback_data).map(b=>{const id=crypto.randomUUID();w.actions.set(id,{flowId:flow.id,data:b.callback_data,messageId:msg.id});return {id,text:String(b.text)};}));
    msg.parseMode=extra?.parse_mode||null;
    while(w.messages.length>250){const dropped=w.messages.shift();for(const [id,a] of w.actions)if(a.messageId===dropped.id)w.actions.delete(id);}
    w.revision++;return {message_id:msg.id,chat:{id:flow.chatId,type:'private'},text:clean};
  }
  newFlow(w,command){
    const projectRequire=createRequire(path.join(this.botDir,'bot.js'));
    const real=projectRequire('telegraf');
    const flow={id:crypto.randomUUID(),command,chatId:2000000000+(++this.sequence),active:0,timers:new Set(),clean:s=>s};
    class UiBot extends real.Telegraf{
      constructor(...args){super(...args);this.skipAuthorization=true;}
      use(...fn){if(this.skipAuthorization){this.skipAuthorization=false;return this;}return super.use(...fn);}
      action(trigger,...handlers){const t=Object.prototype.toString.call(trigger)==='[object RegExp]'?new RegExp(trigger.source,trigger.flags):trigger;return super.action(t,...handlers);}
      launch(){return Promise.resolve();}
      stop(){}
    }
    const track=p=>{flow.active++;w.revision++;return Promise.resolve(p).finally(()=>{flow.active--;w.revision++;});};
    const wrappedTimeout=(fn,ms,...args)=>{let timer;timer=setTimeout(()=>{flow.timers.delete(timer);w.revision++;try{const p=fn(...args);if(p?.catch)p.catch(()=>this.emit(w,flow,'⚠️ Kuch error aaya, dobara try karo.'));}catch{this.emit(w,flow,'⚠️ Kuch error aaya, dobara try karo.');}},this.fastTimers?Math.min(ms,5):ms);flow.timers.add(timer);return timer;};
    const sandbox={Buffer,URL,console:{log(){},warn(){},error(){}},__dirname:this.botDir,process:{once(){}},setTimeout:wrappedTimeout,clearTimeout:timer=>{flow.timers.delete(timer);clearTimeout(timer);},__track:track,__load:this.store.load,__save:this.store.save,exports:{},require:name=>{
      if(name==='telegraf')return {Telegraf:UiBot,Markup:real.Markup};
      if(this.requireOverride){const override=this.requireOverride(name);if(override!==undefined)return override;}
      return projectRequire(name);
    }};
    vm.runInNewContext(this.source+`\nloadWallets=__load;saveWallets=__save;
      const baseSplit=splitAndSend;splitAndSend=(...args)=>__track(baseSplit(...args));
      const basePhotos=processBulkPhotos;processBulkPhotos=(...args)=>__track(basePhotos(...args));
      exports.engine={bot,step:id=>userState[id]?.step||null,reset:()=>{userState={};},secrets:[BOT_TOKEN,ADMIN_PASSWORD]};`,sandbox,{filename:'original-bot-in-miniapp.cjs',timeout:5000});
    const api=sandbox.exports.engine;
    const privateValues=new Set(api.secrets.filter(Boolean));
    for(const r of Object.values(this.store.load()))for(const k of ['loginToken','sessionKey'])if(typeof r[k]==='string'&&r[k].length>=8)privateValues.add(r[k]);
    flow.clean=s=>{for(const secret of privateValues)s=s.split(secret).join('[hidden]');return s.replace(/\b\d{6,15}:[A-Za-z0-9_-]{20,}\b/g,'[hidden]');};
    const info={id:1,is_bot:true,first_name:'Master Control',username:'MasterControlMiniAppBot'};
    const transport={
      sendMessage:async(chat,text,extra)=>this.emit(w,flow,text,extra),
      editMessageText:async(chat,id,inline,text,extra)=>this.emit(w,flow,text,extra,id),
      answerCbQuery:async(id,text)=>{if(text){w.notice=flow.clean(text);w.revision++;}return true;},
      getFileLink:async id=>this.registerFile(null,id),
    };
    flow.step=()=>api.step(flow.chatId);flow.reset=api.reset;flow.busy=()=>flow.active>0||flow.timers.size>0;
    flow.dispatch=async update=>{
      const ctx=new real.Context(update,transport,info);
      await track(api.bot.middleware()(ctx,async()=>{})).catch(error=>{
        const allowed=['Naya number pehle se saved hai. Update cancel hua.','Data save nahi hua. Dobara try karein.'];
        this.emit(w,flow,allowed.includes(error.message)?'❌ '+error.message:'⚠️ Kuch error aaya, dobara try karo.');
      });
    };
    flow.dispose=()=>{for(const t of flow.timers)clearTimeout(t);flow.timers.clear();api.reset();};
    w.flows.set(flow.id,flow);return flow;
  }
  message(flow,text,extra={}){return {update_id:++this.sequence,message:{message_id:++this.sequence,date:Math.floor(Date.now()/1000),chat:{id:flow.chatId,type:'private'},from:{id:flow.chatId,is_bot:false,first_name:'Mini App'},...(text!==undefined?{text}:{}),...extra}};}
  async send(owner,event){
    const w=this.workspace(owner);
    let flow;
    if(event.action){
      const action=w.actions.get(event.action);if(!action)throw new Error('Button expired. Command dobara kholein.');
      flow=w.flows.get(action.flowId);if(!flow)throw new Error('Command dobara kholein.');
      if(flow.busy()){w.notice='⏳ Pichla command abhi chal raha hai. Isi mein count hoga.';w.revision++;return this.snapshot(owner);}
      w.active=flow.id;
      const callback={update_id:++this.sequence,callback_query:{id:crypto.randomUUID(),from:{id:flow.chatId,is_bot:false,first_name:'Mini App'},chat_instance:'miniapp',data:action.data,message:{message_id:action.messageId,date:Math.floor(Date.now()/1000),chat:{id:flow.chatId,type:'private'},text:''}}};
      void flow.dispatch(callback).then(()=>{if(action.data==='confirm_restart'){for(const f of w.flows.values())f.reset();this.resetNative();}});
    }else if(event.file){
      flow=w.flows.get(w.active);
      if(!flow||flow.command!=='ocr'){flow=this.newFlow(w,'ocr');w.active=flow.id;await flow.dispatch(this.message(flow,'/ocr',{entities:[{type:'bot_command',offset:0,length:4}]}));}
      const fileId=this.registerFile(event.file);
      const extra=event.file.mime.startsWith('image/')&&!event.file.asDocument?{photo:[{file_id:fileId,file_unique_id:fileId,width:800,height:800}]}:{document:{file_id:fileId,file_unique_id:fileId,file_name:event.file.name||'upload',mime_type:event.file.mime}};
      w.messages.push({id:++this.sequence,role:'user',text:event.file.mime.startsWith('image/')?'📸 Photo':'📄 PDF / Document',buttons:[],createdAt:new Date().toISOString()});w.revision++;
      void flow.dispatch(this.message(flow,undefined,extra));
    }else{
      const text=String(event.text||'').trim();if(!text||text.length>4096)throw new Error('Valid message bhejein.');
      const command=/^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
      if(command){
        if(!commands.includes(command))throw new Error('Menu se command select karein.');
        flow=[...w.flows.values()].find(f=>f.command===command&&f.busy());
        if(flow){w.notice='⏳ Pichla /'+command+' abhi chal raha hai. Isi mein count hoga.';w.revision++;return this.snapshot(owner);}
        if([...w.flows.values()].filter(f=>f.busy()).length>=5)throw new Error('Pehle se 5 commands chal rahe hain.');
        flow=this.newFlow(w,command);w.active=flow.id;
      }else{
        flow=w.flows.get(w.active);if(!flow)throw new Error('Pehle menu se command select karein.');
        if(flow.busy())throw new Error('⏳ Pichla step complete hone dein.');
      }
      const sensitive=['add_password','awaiting_scan_password','edit_pass'].includes(flow.step());
      w.messages.push({id:++this.sequence,role:'user',text:sensitive?'••••••••':text,buttons:[],createdAt:new Date().toISOString()});w.revision++;
      const normalized=command?'/'+command:text;
      void flow.dispatch(this.message(flow,normalized,command?{entities:[{type:'bot_command',offset:0,length:normalized.length}]}:{}));
    }
    return this.snapshot(owner);
  }
  snapshot(owner){const w=this.workspace(owner);const active=w.flows.get(w.active);const notice=w.notice;w.notice=null;return {stream:w.stream,revision:w.revision,messages:w.messages,notice,step:active?.step()||null,busy:[...w.flows.values()].filter(f=>f.busy()).map(f=>({id:f.id,command:f.command})),commands};}
  cleanup(){for(const [owner,w] of this.workspaces){if(Date.now()-w.lastUse>3600000&&![...w.flows.values()].some(f=>f.busy())){for(const f of w.flows.values())f.dispose();this.workspaces.delete(owner);}else{for(const [id,f] of w.flows)if(!f.busy()&&id!==w.active&&!w.messages.some(m=>m.flowId===id)){f.dispose();w.flows.delete(id);}}}}
  dispose(){for(const w of this.workspaces.values())for(const f of w.flows.values())f.dispose();this.workspaces.clear();}
}
module.exports={BotMirror,commands};
