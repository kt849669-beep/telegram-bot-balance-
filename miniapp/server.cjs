'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {loadAdapter,demoAdapter}=require('./lib/adapter.cjs');
const {validateTelegram}=require('./lib/auth.cjs');
const {Ledger,dayOf}=require('./lib/ledger.cjs');
const {Jobs}=require('./lib/jobs.cjs');
const {botClient}=require('./lib/bot-client.cjs');
const {demoCommands}=require('./lib/demo-commands.cjs');

const mask=v=>String(v||'').length>4?String(v).slice(0,2)+'••••'+String(v).slice(-2):'••••';
function makeServer(options={}) {
  const demo=options.demo??process.argv.includes('--demo');
  const mode=options.mode||process.env.MINIAPP_MODE||'local';
  if(!['local','telegram'].includes(mode))throw new Error('Invalid Mini App mode');
  const port=options.port??Number(process.env.PORT||8787);
  const origin=options.origin||process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
  if(mode==='telegram'&&!origin.startsWith('https://'))throw new Error('Telegram mode requires PUBLIC_ORIGIN=https://your-domain');
  const adapter=options.adapter||(demo?demoAdapter():loadAdapter(process.env.BOT_DIR||path.join(os.homedir(),'Desktop','New folder (2)')));
  const ledger=options.ledger||new Ledger(options.dataDir||process.env.MINIAPP_DATA_DIR||path.join(os.homedir(),'AppData','Local','MasterControlMiniApp',demo?'demo':'live'));
  const jobs=new Jobs(adapter,ledger,options.jobOptions);
  const commandBot=options.commandBot||(demo?demoCommands():botClient());
  const sessions=new Map(),uploads=new Map(),rates=new Map();
  const now=options.now||Date.now;
  const originURL=new URL(origin),staticDir=path.join(__dirname,'public');
  const cookieName='mc_'+crypto.createHash('sha256').update(origin).digest('hex').slice(0,12);
  const sessionId=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const renew=(res,sid,session)=>{
    session.expires=now()+3600000;
    res.setHeader('Set-Cookie',`${cookieName}=${sid}; HttpOnly; SameSite=${mode==='telegram'?'None':'Strict'}; Path=/; Max-Age=3600${mode==='telegram'?'; Secure':''}`);
  };
  if(mode==='local'&&(originURL.protocol!=='http:'||originURL.hostname!=='127.0.0.1'))throw new Error('Local mode must use http://127.0.0.1');
  const siteNames=Object.fromEntries(adapter.sites.map(s=>[s.id,s.name]));
  const balanceFor=r=>ledger.latest(r.id)?.balance??(Number.isFinite(r.lastBal)?r.lastBal:null);
  const safeRow=r=>({id:r.id,phone:mask(r.phone),userId:mask(r.userId),siteId:r.siteId,siteName:siteNames[r.siteId],balance:balanceFor(r),checkedAt:ledger.latest(r.id)?.at||null,hasMpin:/^\d{6}$/.test(r.mpin||'')});
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  async function readJSON(req){let length=0;const chunks=[];for await(const c of req){length+=c.length;if(length>12*1024*1024)throw new Error('Request too large');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new Error('Invalid request');}}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'self'");
    if(req.headers.host!==originURL.host)return send(res,403,{error:'Host not allowed'});
    if(mode==='local'&&(req.headers['x-forwarded-for']||req.headers['x-forwarded-host']||req.headers.forwarded))return send(res,403,{error:'Local mode does not accept proxy access'});
    const url=new URL(req.url,origin);
    if(!url.pathname.startsWith('/api/')){
      if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
      const files={'/':'bot-index.html','/dashboard':'dashboard.html','/app.js':'app.js','/api-client.js':'api-client.js','/styles.css':'styles.css','/bot-ui.js':'bot-ui.js','/bot-ui.css':'bot-ui.css'};
      const file=files[url.pathname];if(!file)return send(res,404,{error:'Not found'});
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
      return fs.createReadStream(path.join(staticDir,file)).pipe(res);
    }
    try{
      if(req.headers.origin&&req.headers.origin!==origin)return send(res,403,{error:'Origin not allowed'});
      if(req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'Cross-site request blocked'});
      if(req.headers['x-miniapp-request']!=='1')return send(res,403,{error:'Use the dashboard'});
      if(req.method==='POST'&&!(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'JSON required'});
      if(url.pathname==='/api/session'&&req.method==='POST'){
        const time=now();for(const [key,value] of sessions)if(value.expires<=time)sessions.delete(key);
        const ip=req.socket.remoteAddress;const rate=rates.get(ip)||{n:0,at:time};if(time-rate.at>60000){rate.n=0;rate.at=time;}rates.set(ip,rate);if(++rate.n>30)return send(res,429,{error:'Please wait before signing in again'});
        const data=await readJSON(req);
        const sid=sessionId(req),existing=sessions.get(sid);
        const allowed=mode==='telegram'?adapter.allowedUsers():[];
        const user=mode==='local'?{id:'local'}:validateTelegram(data.initData,adapter.token,allowed,now());
        if(existing){
          if(mode==='telegram'&&!allowed.includes(Number(existing.owner))){sessions.delete(sid);return send(res,403,{code:'ACCESS_REVOKED',error:'Bot access has been revoked'});}
          // Do not let an old tab adopt a different Telegram account's cookie.
          if(mode==='telegram'&&req.headers['x-csrf-token']&&req.headers['x-csrf-token']!==existing.csrf)return send(res,401,{code:'AUTH_REQUIRED',error:'Telegram se Mini App dobara kholein.'});
          if(!user||user.id===existing.owner){renew(res,sid,existing);return send(res,200,{csrf:existing.csrf,mode,demo});}
        }
        if(!user)return send(res,401,{code:'AUTH_REQUIRED',error:'Telegram se Mini App dobara kholein, apne authorized bot account se.'});
        if(sessions.size>=500)return send(res,503,{error:'Session limit reached'});
        const newSid=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
        const created={owner:user.id,csrf};sessions.set(newSid,created);renew(res,newSid,created);
        return send(res,200,{csrf,mode,demo});
      }
      const sid=sessionId(req);
      const session=sessions.get(sid);
      if(!session||session.expires<=now()){sessions.delete(sid);return send(res,401,{code:'SESSION_EXPIRED',error:'Session ended. Reconnecting…'});}
      if(req.headers['x-csrf-token']!==session.csrf)return send(res,403,{code:'CSRF_MISMATCH',error:'Request verification failed'});
      // Recheck the bot's allowlist, so revoking an account also revokes existing sessions.
      if(mode==='telegram'&&!adapter.allowedUsers().includes(Number(session.owner))){sessions.delete(sid);return send(res,403,{code:'ACCESS_REVOKED',error:'Bot access has been revoked'});}
      const body=req.method==='POST'?await readJSON(req):{};
      renew(res,sid,session);
      if(url.pathname==='/api/bot/state'&&req.method==='POST'){
        const state=await commandBot('snapshot',session.owner);
        if(body.stream===state.stream&&body.revision===state.revision)return send(res,200,{unchanged:true,stream:state.stream,revision:state.revision,busy:state.busy,step:state.step});
        return send(res,200,state);
      }
      if(url.pathname==='/api/bot/event'&&req.method==='POST'){
        const event={};
        if(typeof body.text==='string')event.text=body.text;
        else if(typeof body.action==='string'&&/^[a-f0-9-]{36}$/i.test(body.action))event.action=body.action;
        else if(body.file){const f=body.file;if(!['application/pdf','image/png','image/jpeg','text/plain'].includes(f.mime)||typeof f.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)||Buffer.from(f.base64,'base64').length>8*1024*1024)return send(res,400,{error:'Choose a JPG, PNG, PDF or TXT under 8 MB'});event.file={mime:f.mime,base64:f.base64,name:String(f.name||'upload').slice(0,150),asDocument:!!f.asDocument};}
        else return send(res,400,{error:'Message ya command bhejein.'});
        return send(res,200,await commandBot('event',session.owner,event));
      }
      if(url.pathname==='/api/overview'&&req.method==='GET'){
        const rows=adapter.accounts();const known=rows.map(balanceFor).filter(x=>x!==null);const latest=ledger.entries.at(-1)?.at||null;
        return send(res,200,{total:rows.length,numbers:new Set(rows.map(r=>r.phone)).size,sites:adapter.sites,knownBalances:known.length,totalBalance:known.reduce((a,b)=>a+b,0),lastCheck:latest,mode,demo,features:{siteHistory:false,siteScreenshots:false,uploadSaveViaBot:true},jobs:jobs.list(session.owner)});
      }
      if(url.pathname==='/api/accounts/search'&&req.method==='POST'){
        const q=String(body.query||'').trim().slice(0,80);let rows=adapter.accounts().filter(r=>(!q||r.phone.includes(q)||String(r.userId||'').includes(q))&&(!body.siteId||r.siteId===body.siteId));
        rows.sort((a,b)=>(balanceFor(b)??-1)-(balanceFor(a)??-1));const total=rows.length;const offset=Math.max(0,Number(body.offset)||0);
        return send(res,200,{total,rows:rows.slice(offset,offset+50).map(safeRow)});
      }
      if(url.pathname==='/api/account/reveal'&&req.method==='POST'){
        const row=adapter.accounts().find(r=>r.id===body.id);if(!row)return send(res,404,{error:'Account not found'});
        return send(res,200,{phone:row.phone,userId:row.userId,password:row.password,mpin:/^\d{6}$/.test(row.mpin||'')?row.mpin:null});
      }
      if(url.pathname==='/api/history'&&req.method==='POST')return send(res,200,{rows:ledger.history(String(body.id)),kind:'balance-observations'});
      if(url.pathname==='/api/jobs'&&req.method==='GET')return send(res,200,{jobs:jobs.list(session.owner)});
      if(url.pathname==='/api/jobs'&&req.method==='POST'){
        let rows=adapter.accounts();let kind=body.kind;
        if(kind==='account'){rows=rows.filter(r=>r.id===body.id);}
        else if(/^top-(10|50|100)$/.test(kind)){rows=rows.filter(r=>balanceFor(r)!==null).sort((a,b)=>balanceFor(b)-balanceFor(a)).slice(0,Number(kind.split('-')[1]));}
        else if(kind!=='all')return send(res,400,{error:'Invalid check type'});
        return send(res,202,jobs.start(session.owner,kind,rows));
      }
      if(url.pathname==='/api/report'&&req.method==='POST'){
        const day=body.day||dayOf(Date.now());if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return send(res,400,{error:'Invalid date'});
        const accounts=new Map(adapter.accounts().map(r=>[r.id,safeRow(r)]));
        const rows=ledger.report(day).filter(r=>accounts.has(r.id)).map(r=>({...accounts.get(r.id),...r}));
        return send(res,200,{day,rows,compared:rows.filter(r=>r.previous!==null).length,change:rows.reduce((sum,r)=>sum+(r.change??0),0)});
      }
      if(url.pathname==='/api/upload/preview'&&req.method==='POST'){
        if(uploads.has(session.owner))return send(res,409,{error:'A file is already being read'});
        if(!['application/pdf','image/png','image/jpeg','text/plain'].includes(body.mime))return send(res,415,{error:'Choose a PDF, JPG, PNG or text file'});
        if(typeof body.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))return send(res,400,{error:'Invalid file'});
        const buffer=Buffer.from(body.base64,'base64');if(!buffer.length||buffer.length>8*1024*1024)return send(res,400,{error:'File must be under 8 MB'});
        uploads.set(session.owner,true);
        try {const rows=await adapter.extract(buffer,body.mime);return send(res,200,{rows:rows.map(r=>({phone:mask(r.phone),hasPassword:!!r.password,mpinStatus:r.mpinConflict?'conflict':/^\d{6}$/.test(r.mpin||'')?'found':'missing'})),saveViaBot:true});}finally{uploads.delete(session.owner);buffer.fill(0);}
      }
      return send(res,404,{error:'Not found'});
    }catch(error){
      // Do not serialize third-party errors: they can include credentials or request headers.
      const safe=['No accounts available for this check','Five checks are already running','Request too large','Invalid request'].includes(error.message)?error.message:'This request could not be completed. Please try again.';
      return send(res,400,{error:safe});
    }
  });
  server.requestTimeout=45000;server.headersTimeout=15000;
  server.on('close',()=>commandBot.dispose?.());
  return {server,adapter,ledger,jobs,port,origin};
}
if(require.main===module){try{const app=makeServer();app.server.listen(app.port,'127.0.0.1',()=>console.log(`Master Control ready: ${app.origin}`));}catch{console.error('Mini App could not start. Check BOT_DIR and configuration.');process.exitCode=1;}}
module.exports={makeServer};
