'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const Module=require('node:module');
const {sharedWallets}=require('./shared-wallets.cjs');
const {BotMirror}=require('./bot-mirror.cjs');

function attach(native){
  const botDir=native.botDir;
  const folder=process.env.MINIAPP_BRIDGE_DIR||path.join(require('node:os').homedir(),'AppData','Local','MasterControlMiniApp','bridge');
  fs.mkdirSync(folder,{recursive:true});const key=crypto.randomBytes(32).toString('hex');
  const port=Number(process.env.MINIAPP_BRIDGE_PORT||8790);const files=new Map();
  const store=sharedWallets(native.load,native.save);native.setStore(store.load,store.save);
  const source=fs.readFileSync(path.join(botDir,'bot.js'),'utf8');
  const registerFile=(input,id)=>{
    if(input){const buffer=Buffer.from(input.base64,'base64');if([...files.values()].reduce((n,f)=>n+f.buffer.length,0)+buffer.length>64*1024*1024)throw new Error('Upload queue full');const fileId=crypto.randomBytes(24).toString('hex');files.set(fileId,{buffer,mime:input.mime,createdAt:Date.now()});return fileId;}
    if(!files.has(id))throw new Error('Upload expired');return new URL(`http://127.0.0.1:${port}/file/${id}`);
  };
  const mirror=new BotMirror({source,botDir,store,registerFile,resetNative:native.reset});
  const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    if(req.headers.host!==`127.0.0.1:${port}`)return reply(res,403,{error:'Forbidden'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(req.method==='GET'&&url.pathname.startsWith('/file/')){const id=url.pathname.slice(6);const file=files.get(id);if(!file)return reply(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'no-store'});return res.end(file.buffer,()=>{file.buffer.fill(0);files.delete(id);});}
    const provided=Buffer.from(req.headers['x-bridge-key']||'');const expected=Buffer.from(key);
    if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,expected))return reply(res,403,{error:'Forbidden'});
    try{
      if(req.method!=='POST')return reply(res,405,{error:'Method not allowed'});
      const chunks=[];let n=0;for await(const chunk of req){n+=chunk.length;if(n>12*1024*1024)throw new Error('Too large');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(typeof body.owner!=='string'||body.owner.length>80)throw new Error('Invalid owner');
      if(url.pathname==='/snapshot'){const w=mirror.workspace(body.owner);if(!w.messages.length)await mirror.send(body.owner,{text:'/start'});return reply(res,200,mirror.snapshot(body.owner));}
      if(url.pathname==='/event')return reply(res,200,await mirror.send(body.owner,body.event||{}));
      return reply(res,404,{error:'Not found'});
    }catch(error){const permitted=['Button expired. Command dobara kholein.','Command dobara kholein.','Valid message bhejein.','Menu se command select karein.','Pehle se 5 commands chal rahe hain.','Pehle menu se command select karein.','⏳ Pichla step complete hone dein.'];return reply(res,400,{error:permitted.includes(error.message)?error.message:'Bot request complete nahi hua. Dobara try karein.'});}
  });
  server.listen(port,'127.0.0.1',()=>fs.writeFileSync(path.join(folder,'connection.json'),JSON.stringify({key,port,pid:process.pid}),{mode:0o600}));
  server.on('error',()=>fs.writeFileSync(path.join(folder,'status.json'),JSON.stringify({ready:false})));
  const sweep=setInterval(()=>{mirror.cleanup();for(const [id,file] of files)if(Date.now()-file.createdAt>1800000){file.buffer.fill(0);files.delete(id);}},60000);sweep.unref();
}
function install(){
  const target=path.resolve(process.env.BOT_DIR||process.cwd(),'bot.js');
  const compile=Module.prototype._compile;
  Module.prototype._compile=function(content,filename){
    if(path.resolve(filename)!==target)return compile.call(this,content,filename);
    Module.prototype._compile=compile;
    const extension=`\nrequire(${JSON.stringify(__filename)}).attach({botDir:__dirname,load:loadWallets,save:saveWallets,setStore:(read,write)=>{loadWallets=read;saveWallets=write;},reset:()=>{userState={};}});`;
    return compile.call(this,content+extension,filename);
  };
}
module.exports={attach,install};
