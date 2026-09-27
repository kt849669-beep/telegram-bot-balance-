'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {BotMirror}=require('./bot-mirror.cjs');
const {sharedWallets}=require('./shared-wallets.cjs');
function demoCommands(botDir=process.env.BOT_DIR||path.join(os.homedir(),'Desktop','New folder (2)')){
  let rows={};const sites=['olapay','showpay','swiftwallet','toppay','rswallet','smartwallet'];
  sites.forEach((site,i)=>rows[site+'_900000000'+Math.floor(i/2)]={siteId:site,phone:'900000000'+Math.floor(i/2),password:'DemoOnly!',mpin:'001234',userId:7001+i});
  const clone=x=>JSON.parse(JSON.stringify(x));const files=new Map();
  const mirror=new BotMirror({source:fs.readFileSync(path.join(botDir,'bot.js'),'utf8'),botDir,store:sharedWallets(()=>clone(rows),v=>{rows=clone(v);}),registerFile:(input,id)=>{if(input){const key=String(files.size+1);files.set(key,Buffer.from(input.base64,'base64'));return key;}return new URL('https://demo.invalid/'+id);},requireOverride:name=>{
    if(name==='axios')return {post:async(url,body)=>{await new Promise(r=>setTimeout(r,200));return url.endsWith('/login')?{data:{code:200,data:{userId:7001,sessionKey:'demo-session',loginToken:'demo-login'}}}:{data:{code:200,data:{xtoken:1250}}};},get:async url=>({data:files.get(new URL(url).pathname.slice(1))})};
    if(name==='tesseract.js')return {createWorker:async()=>({recognize:async()=>({data:{text:'9000000099 DemoOnly! MPIN: 001234'}}),terminate:async()=>{}})};
  }});
  const invoke=async(route,owner,event)=>{if(route==='event')return mirror.send(owner,event);if(!mirror.workspace(owner).messages.length)await mirror.send(owner,{text:'/start'});return mirror.snapshot(owner);};
  invoke.dispose=()=>mirror.dispose();return invoke;
}
module.exports={demoCommands};
