'use strict';

function isTemporaryError(message, httpStatus) {
  const text=String(message||'');
  if([401,403].includes(httpStatus)||/password|credential|mpin|incorrect|invalid pin|locked|blocked|remaining|attempt|captcha|cloudflare|not (?:exist|found|registered)|冻结|锁|剩余|密码/i.test(text))return false;
  return httpStatus===429||/try again|later|busy|timeout|timed out|too many requests|ECONN|ETIMEDOUT|ENOTFOUND|socket|稍后|频繁/i.test(text);
}

function retryAt(response, now=Date.now()) {
  const value=response?.headers?.['retry-after'];
  if(value===undefined||value===null||value==='')return 0;
  const seconds=Number(value),until=Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Date.parse(String(value));
  return Number.isFinite(until)&&until>now?until:0;
}

function createBalanceRetry({gapMs=8000,concurrency=3,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if(!Number.isFinite(gapMs)||gapMs<0||!Number.isInteger(concurrency)||concurrency<1)throw new Error('Invalid retry limits');
  const siteTails=new Map(),nextStart=new Map(),waiters=[];let active=0;
  const key=row=>row.wKey||row.siteId+'_'+row.phone;
  async function gate(fn) {
    if(active>=concurrency)await new Promise(resolve=>waiters.push(resolve));else active++;
    try{return await fn();}finally{const next=waiters.shift();if(next)next();else active--;}
  }
  async function scheduled(siteId,notBefore,cancelled,fn) {
    const previous=siteTails.get(siteId)||Promise.resolve();let release;
    const held=new Promise(resolve=>{release=resolve;});siteTails.set(siteId,held);
    await previous;
    try{
      const due=Math.max(notBefore,nextStart.get(siteId)||0);
      while(now()<due&&!cancelled())await sleep(Math.min(1000,due-now()));
      if(cancelled())return null;
      return await gate(async()=>{
        if(cancelled())return null;
        nextStart.set(siteId,now()+gapMs);
        return fn();
      });
    }finally{release();if(siteTails.get(siteId)===held)siteTails.delete(siteId);}
  }
  async function run({entries,results,check,isCancelled=()=>false,onProgress=()=>{}}) {
    const entryByKey=new Map(entries.map(row=>[key(row),row]));
    const pending=[...new Map(results.filter(r=>!r.success&&r.retryable===true&&isTemporaryError(r.errMsg,r.httpStatus)&&entryByKey.has(key(r))).map(r=>[key(r),r])).values()];
    const replacements=new Map(),rechecked=[];
    const notBefore=now()+gapMs;
    await Promise.all(pending.map(async failed=>{
      const row=entryByKey.get(key(failed));
      const result=await scheduled(row.siteId,Math.max(notBefore,failed.retryAt||0),isCancelled,async()=>{
        let value;
        try{value=await check(row);}catch{value={success:false,errMsg:'Check complete nahi hua. Dobara check karein.',retryable:false};}
        return {...value,siteId:row.siteId,phone:row.phone,wKey:key(row)};
      });
      if(!result)return;
      replacements.set(key(failed),result);rechecked.push(result);
      await onProgress(rechecked.length,pending.length,result);
    }));
    return {results:results.map(r=>replacements.get(key(r))||r),rechecked,pendingCount:pending.length,cancelled:isCancelled()};
  }
  return {run};
}

// Native Telegram and the Mini App command bridge share these retry limits.
const balanceRetry=createBalanceRetry();
module.exports={isTemporaryError,retryAt,createBalanceRetry,retryTemporaryBalances:options=>balanceRetry.run(options)};
