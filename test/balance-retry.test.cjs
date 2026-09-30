'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {isTemporaryError,retryAt,createBalanceRetry}=require('../runtime/balance-retry.cjs');
const {BotMirror}=require('../miniapp/lib/bot-mirror.cjs');
const {sharedWallets}=require('../miniapp/lib/shared-wallets.cjs');
const clone=v=>structuredClone(v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const row=(siteId,phone)=>({siteId,phone,wKey:siteId+'_'+phone});
const temporary=r=>({...r,success:false,retryable:true,errMsg:'Please try again later',httpStatus:200});

test('temporary errors exclude credentials, account warnings and access challenges',()=>{
  for(const message of ['Please try again later','Timeout','ECONNRESET','server busy'])assert.equal(isTemporaryError(message,200),true);
  assert.equal(isTemporaryError('Request failed',429),true);
  for(const message of ['Password incorrect, try again later','2 attempts remaining, try again later','Account locked','Cloudflare challenge','CAPTCHA required','Account not found'])assert.equal(isTemporaryError(message,200),false);
  assert.equal(isTemporaryError('Try again later',403),false);
  assert.equal(isTemporaryError('Try again later',401),false);
  const now=Date.parse('2026-01-01T00:00:00Z');
  assert.equal(retryAt({headers:{'retry-after':'20'}},now),now+20000);
  assert.equal(retryAt({headers:{'retry-after':'Thu, 01 Jan 2026 00:01:00 GMT'}},now),now+60000);
  for(const value of ['invalid','-1','0'])assert.equal(retryAt({headers:{'retry-after':value}},now),0);
});

test('one deferred pass retries only temporary failures and preserves result order',async()=>{
  const entries=['1','2','3','4'].map(p=>row('site',p));
  const results=[{...entries[0],success:true,bal:10},temporary(entries[1]),{...temporary(entries[2]),errMsg:'Password invalid; try again later'},temporary(entries[3])];
  const calls=[];const runner=createBalanceRetry({gapMs:0});
  const final=await runner.run({entries,results,check:async r=>{calls.push(r.phone);return r.phone==='2'?{success:true,bal:20}:temporary(r);}});
  assert.deepEqual(calls,['2','4']);assert.equal(final.rechecked.length,2);
  assert.deepEqual(final.results.map(r=>r.phone),['1','2','3','4']);
  assert.deepEqual(final.results.map(r=>r.success),[true,true,false,false]);
  assert.equal(final.results[0],results[0]);assert.equal(final.results[2],results[2]);
});

test('same-site retry spacing and Retry-After are respected',async()=>{
  let clock=0;const starts=[];const entries=['1','2'].map(p=>row('a',p));
  const results=entries.map(temporary);results[0].retryAt=12000;
  const runner=createBalanceRetry({now:()=>clock,sleep:async ms=>{clock+=ms;}});
  await runner.run({entries,results,check:async r=>{starts.push(clock);return {success:true,bal:1};}});
  assert.deepEqual(starts,[12000,20000]);
});

test('overlapping command runs share global and per-site retry limits',async()=>{
  const runner=createBalanceRetry({gapMs:0,concurrency:3});
  let active=0,maxActive=0;const perSite=new Map();
  const check=async r=>{active++;maxActive=Math.max(maxActive,active);assert.ok(!perSite.get(r.siteId));perSite.set(r.siteId,true);await sleep(10);perSite.delete(r.siteId);active--;return {success:true,bal:1};};
  const first=['a','b','c','d'].map(s=>row(s,'1')),second=['a','b','c','d'].map(s=>row(s,'2'));
  const results=await Promise.all([first,second].map(entries=>runner.run({entries,results:entries.map(temporary),check})));
  assert.equal(maxActive,3);assert.equal(results.reduce((n,r)=>n+r.rechecked.length,0),8);
});

test('cancelling while queued prevents further account requests',async()=>{
  let clock=0,cancelled=false,calls=0;
  const runner=createBalanceRetry({now:()=>clock,sleep:async ms=>{clock+=ms;cancelled=true;}});
  const entries=[row('a','1'),row('a','2')];
  const final=await runner.run({entries,results:entries.map(temporary),isCancelled:()=>cancelled,check:async()=>{calls++;return {success:true,bal:1};}});
  assert.equal(calls,0);assert.equal(final.cancelled,true);assert.equal(final.rechecked.length,0);
});

function fixture(t,data,post,{gapMs=0}={}){
  let saved=clone(data);const output=[];
  const runner=createBalanceRetry({gapMs});
  const botDir=process.env.BOT_DIR||path.resolve(__dirname,'../bot');
  const store=sharedWallets(()=>clone(saved),v=>{saved=clone(v);});
  const mirror=new BotMirror({source:fs.readFileSync(path.join(botDir,'bot.js'),'utf8'),botDir,fastTimers:true,store,registerFile(){throw new Error('No files');},requireOverride:name=>{
    if(name==='../runtime/site-http.cjs')return {post};
    if(name==='../runtime/balance-retry.cjs')return {isTemporaryError,retryAt,retryTemporaryBalances:options=>runner.run(options)};
  }});
  const emit=mirror.emit.bind(mirror);
  mirror.emit=(w,f,text,extra,id)=>{assert.ok(String(text).length<=4096,'Telegram message size');output.push(String(text));return emit(w,f,text,extra,id);};
  t.after(()=>mirror.dispose());
  return {mirror,output,get data(){return saved;},async done(){for(let i=0;i<1000;i++){if(!mirror.snapshot('fixture').busy.length)return;await sleep(5);}throw new Error('Balance fixture timed out');}};
}
const account=i=>({siteId:'olapay',phone:String(9000000000+i),password:'synthetic-password',mpin:'001234',sessionKey:'old-synthetic-session'});
const ok=(data)=>({status:200,headers:{},data:{code:200,data}});
const fail=message=>({status:200,headers:{},data:{code:500,message}});

test('balance sends the first full report before deferred retries and merges the final result',async t=>{
  const data=Object.fromEntries(Array.from({length:6},(_,n)=>{const a=account(n+1);return ['olapay_'+a.phone,a];}));
  const calls=new Map();let firstDone=0;
  const f=fixture(t,data,async(url,body)=>{
    if(url.endsWith('/login')){
      const id=Number(body.phone.slice(-1)),count=(calls.get(id)||0)+1;calls.set(id,count);
      if(count===1)firstDone++;
      else{assert.equal(firstDone,6);assert.ok(f.output.some(s=>s.includes('*Failed (5):*')),'All first-pass lists must precede retry');}
      await sleep(2);
      if(id===4)return fail('Password incorrect; try again later');
      if(id===5)return fail('Account not found');
      if((id===2&&count===1)||id===6)return fail('Please try again later');
      return ok({userId:id,sessionKey:'new-synthetic-session',loginToken:'new-synthetic-token'});
    }
    if(body.userId===3&&calls.get(3)===1)return fail('Please try again later');
    return ok({xtoken:75});
  });
  await f.mirror.send('fixture',{text:'/balance'});
  assert.match((await f.mirror.send('fixture',{text:'/balance'})).notice,/Pichla/);
  await f.done();
  assert.deepEqual([...calls].sort(([a],[b])=>a-b),[[1,1],[2,2],[3,2],[4,1],[5,1],[6,2]]);
  assert.ok(f.output.some(s=>s.includes('*Pehla result*')&&s.includes('1/6 accounts')));
  assert.ok(f.output.some(s=>s.includes('Final result: 3/6')&&s.includes('3 failed')));
  const finalList=f.output.find(s=>s.includes('*Dobara check ka result:*'));
  for(const id of [2,3,6])assert.ok(finalList.includes(account(id).phone));
  for(const id of [1,4,5])assert.ok(!finalList.includes(account(id).phone));
  assert.equal(Object.keys(f.data).length,6);assert.ok(Object.values(f.data).every(r=>r.mpin==='001234'&&r.password==='synthetic-password'));
  assert.ok(!f.output.join('\n').includes('synthetic-password'));assert.ok(!f.output.join('\n').includes('synthetic-token'));assert.ok(!f.output.join('\n').includes('synthetic-session'));
});

test('a password edited while waiting is used for retry and a later edit is preserved',async t=>{
  const a=account(1),key='olapay_'+a.phone;let logins=0;
  const f=fixture(t,{[key]:a},async(url,body)=>{
    if(url.endsWith('/login')){
      logins++;
      if(logins===1){f.data[key].password='edited-before-retry';return fail('Please try again later');}
      assert.equal(body.password,'edited-before-retry');
      f.data[key].password='edited-during-retry';
      return ok({userId:1,sessionKey:'stale-synthetic-session',loginToken:'stale-synthetic-token'});
    }
    return ok({xtoken:25});
  });
  await f.mirror.send('fixture',{text:'/balance'});await f.done();
  assert.equal(logins,2);assert.equal(f.data[key].password,'edited-during-retry');
  assert.equal(f.data[key].sessionKey,'old-synthetic-session');assert.equal(f.data[key].mpin,'001234');
});

test('large first-pass high-balance reports still complete before retry',async t=>{
  const data=Object.fromEntries(Array.from({length:90},(_,n)=>{const a=account(n+1);return ['olapay_'+a.phone,a];}));
  const last=account(90).phone;let lastCalls=0;
  const f=fixture(t,data,async(url,body)=>{
    if(url.endsWith('/login')){
      if(body.phone===last&&++lastCalls===1)return fail('Please try again later');
      return ok({userId:Number(body.phone.slice(-3)),sessionKey:'fixture-session',loginToken:'fixture-token'});
    }
    return ok({xtoken:2000});
  });
  await f.mirror.send('fixture',{text:'/balance'});await f.done();
  assert.equal(lastCalls,2);assert.ok(f.output.some(s=>s.includes('Final result: 90/90')));
});

test('a fully successful balance check keeps the original report without a retry phase',async t=>{
  const a=account(1);let logins=0;
  const f=fixture(t,{['olapay_'+a.phone]:a},async url=>{if(url.endsWith('/login')){logins++;return ok({userId:1,sessionKey:'fixture-session',loginToken:'fixture-token'});}return ok({xtoken:5});});
  await f.mirror.send('fixture',{text:'/balance'});await f.done();
  assert.equal(logins,1);assert.ok(f.output.includes('✅ *1/1 accounts check ho gaye!*'));
  assert.ok(!f.output.some(s=>s.includes('Dobara check')||s.includes('Final result:')));
});
