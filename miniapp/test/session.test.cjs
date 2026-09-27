const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {makeServer}=require('../server.cjs');
const {demoAdapter}=require('../lib/adapter.cjs');
const {createMiniappApi}=require('../public/api-client.js');

function fixture(t,port,extra={}){
  let time=Date.now(),cookie='',signIns=0,events=0,app;
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-session-'));
  const options={demo:true,port,dataDir,now:()=>time,commandBot:async(action,owner)=>({owner,stream:'fixture-stream',revision:1,events:action==='event'?++events:events}),...extra};
  const start=async()=>{app=makeServer(options);await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));};
  const stop=()=>new Promise((resolve,reject)=>{app.server.close(error=>error?reject(error):resolve());app.server.closeIdleConnections();});
  t.after(async()=>{
    if(app?.server.listening)await stop();
    const resolved=fs.realpathSync(dataDir),tempRoot=fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved),tempRoot);assert.ok(path.basename(resolved).startsWith('mc-session-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const transport=async(route,config={})=>{
    if(route==='/api/session')signIns++;
    const response=await fetch('http://127.0.0.1:'+port+route,{...config,headers:{...config.headers,Connection:'close',...(cookie?{Cookie:cookie}:{})}});
    const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];
    return response;
  };
  return {start,stop,transport,advance:ms=>time+=ms,now:()=>time,signIns:()=>signIns,events:()=>events};
}
const post=(csrf='')=>({method:'POST',headers:{'X-Miniapp-Request':'1','X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'});

test('active session survives an hour; another tab keeps the same CSRF; idle command reconnects once',async t=>{
  const f=fixture(t,19004);await f.start();const client=createMiniappApi({fetch:f.transport,initData:()=>''});
  const first=await client.connect();const other=createMiniappApi({fetch:f.transport,initData:()=>''});
  assert.equal((await other.connect()).csrf,first.csrf);
  f.advance(1800000);assert.equal((await client.api('bot/state',{})).owner,'local');
  f.advance(1800001);assert.equal((await client.api('bot/state',{})).owner,'local');
  assert.equal(f.signIns(),2);
  const rejected=await f.transport('/api/bot/event',post('wrong'));
  assert.equal(rejected.status,403);assert.equal((await rejected.json()).code,'CSRF_MISMATCH');assert.equal(f.events(),0);
  f.advance(3600000);assert.equal((await client.api('bot/event',{text:'/start'})).events,1);
  assert.equal(f.signIns(),3);assert.equal(f.events(),1);
  // A delayed old tab recovers after another tab replaced an expired cookie.
  await other.api('bot/state',{});assert.equal(f.signIns(),4);
});

test('concurrent expired requests share a sign-in and a server restart recovers without duplicating the command',async t=>{
  const f=fixture(t,19004);await f.start();const client=createMiniappApi({fetch:f.transport,initData:()=>''});
  await client.connect();f.advance(3600000);
  const values=await Promise.all([client.api('bot/state',{}),client.api('bot/event',{text:'/start'}),client.api('bot/state',{})]);
  assert.ok(values.every(v=>v.owner==='local'));assert.equal(f.signIns(),2);assert.equal(f.events(),1);
  await f.stop();await f.start();
  assert.equal((await client.api('bot/event',{text:'/list'})).events,2);assert.equal(f.signIns(),3);
});

function signed(time,user=123){
  const params=new URLSearchParams({auth_date:String(Math.floor(time/1000)),query_id:'session-test',user:JSON.stringify({id:user})});
  const data=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const key=crypto.createHmac('sha256','WebAppData').update('fixture-token').digest();
  params.set('hash',crypto.createHmac('sha256',key).update(data).digest('hex'));return params.toString();
}

test('Telegram renews a valid session, requires fresh auth after idle expiry, and enforces revocation',async t=>{
  let allowed=[123];const adapter=demoAdapter();adapter.token='fixture-token';adapter.allowedUsers=()=>allowed;
  const f=fixture(t,19005,{mode:'telegram',origin:'https://127.0.0.1:19005',adapter});await f.start();
  const initialData=signed(f.now());const client=createMiniappApi({fetch:f.transport,initData:()=>initialData});
  await client.connect();f.advance(600000);
  await client.connect(); // Freshness is required for new auth, not renewal of a valid cookie.
  f.advance(3000000);assert.equal((await client.api('bot/state',{})).owner,'123');
  f.advance(3600000);
  await assert.rejects(client.api('bot/event',{text:'/start'}),{code:'AUTH_REQUIRED'});assert.equal(f.events(),0);
  const attempts=f.signIns();await assert.rejects(client.api('bot/state',{}),{code:'AUTH_REQUIRED'});assert.equal(f.signIns(),attempts);
  const fresh=createMiniappApi({fetch:f.transport,initData:()=>signed(f.now())});await fresh.connect();
  allowed=[];await assert.rejects(fresh.api('bot/event',{text:'/start'}),{code:'ACCESS_REVOKED'});assert.equal(f.events(),0);
  await assert.rejects(createMiniappApi({fetch:f.transport,initData:()=>signed(f.now())}).connect(),{code:'AUTH_REQUIRED'});
});

test('failed verification and cross-origin requests do not keep a session alive',async t=>{
  const f=fixture(t,19004);await f.start();const client=createMiniappApi({fetch:f.transport,initData:()=>''});const {csrf}=await client.connect();
  f.advance(3599000);assert.equal((await f.transport('/api/bot/state',post('bad'))).status,403);
  const cross=post(csrf);cross.headers.Origin='https://other.example';assert.equal((await f.transport('/api/session',cross)).status,403);
  f.advance(1000);const expired=await f.transport('/api/bot/state',post(csrf));assert.equal(expired.status,401);assert.equal((await expired.json()).code,'SESSION_EXPIRED');
});

test('session recovery never retries network failures or unrelated errors, and retries auth only once',async()=>{
  for(const failure of [new Error('network failed'),{status:403,code:'ACCESS_REVOKED'},{status:400,code:'INVALID_INPUT'},{status:401,code:'SESSION_EXPIRED'}]){
    let signIns=0,requests=0;
    const client=createMiniappApi({initData:()=>'',fetch:async route=>{
      if(route==='/api/session'){signIns++;return {ok:true,json:async()=>({csrf:'fixture-csrf'})};}
      requests++;if(failure instanceof Error)throw failure;
      return {ok:false,status:failure.status,json:async()=>({code:failure.code,error:'fixture rejection'})};
    }});
    await client.connect();await assert.rejects(client.api('bot/event',{text:'/start'}));
    assert.equal(requests,failure.code==='SESSION_EXPIRED'?2:1);assert.equal(signIns,failure.code==='SESSION_EXPIRED'?2:1);
  }
});

test('overlapping late 401 responses do not start another refresh after the first refresh finishes',async()=>{
  let signIns=0,releaseLate,lateRequest;const late=new Promise(r=>releaseLate=r),observed=new Promise(r=>lateRequest=r);
  const seen={};const client=createMiniappApi({initData:()=>'',fetch:async route=>{
    if(route==='/api/session'){signIns++;return {ok:true,json:async()=>({csrf:'fixture-'+signIns})};}
    seen[route]=(seen[route]||0)+1;
    if(seen[route]===1){if(route.endsWith('/late')){lateRequest();await late;}else await observed;return {ok:false,status:401,json:async()=>({code:'SESSION_EXPIRED'})};}
    return {ok:true,json:async()=>({ok:true})};
  }});
  await client.connect();const a=client.api('first',{}),b=client.api('late',{});await a;releaseLate();await b;assert.equal(signIns,2);
});
