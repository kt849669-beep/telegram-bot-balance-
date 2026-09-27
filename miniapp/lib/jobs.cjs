'use strict';
const crypto = require('node:crypto');
class Gate {
  constructor(limit=4){this.limit=limit;this.active=0;this.waiters=[];}
  async run(fn){if(this.active>=this.limit) await new Promise(r=>this.waiters.push(r));else this.active++;try{return await fn();}finally{const next=this.waiters.shift();if(next)next();else this.active--;}}
}
class Jobs {
  constructor(adapter,ledger,{pause=1500}={}){this.adapter=adapter;this.ledger=ledger;this.pause=pause;this.jobs=new Map();this.active=new Map();this.gate=new Gate(4);this.siteGates=new Map();this.inflight=new Map();}
  list(owner){return [...this.jobs.values()].filter(j=>j.owner===owner).slice(-30).reverse().map(j=>this.view(j));}
  view(j){const {key,owner,...safe}=j;return safe;}
  start(owner,kind,rows){
    if(!rows.length)throw new Error('No accounts available for this check');
    const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
    const key=owner+':'+kind+(kind==='account'?':'+unique[0].id:'');
    const existing=this.active.get(key);if(existing){existing.repeatClicks++;return {job:this.view(existing),reused:true};}
    if([...this.active.values()].filter(j=>j.owner===owner).length>=5)throw new Error('Five checks are already running');
    const j={id:crypto.randomUUID(),owner,key,kind,status:'running',phase:'first-pass',total:unique.length,checked:0,completed:0,failed:0,retryPending:0,repeatClicks:0,createdAt:new Date().toISOString(),results:[]};
    this.jobs.set(j.id,j);this.active.set(key,j);
    void this.run(j,unique).catch(()=>{j.status='failed';j.phase='finished';}).finally(()=>{j.finishedAt=new Date().toISOString();this.active.delete(key); if(this.jobs.size>100)for(const [id,old] of this.jobs){if(old.status!=='running'){this.jobs.delete(id);if(this.jobs.size<=100)break;}}});
    return {job:this.view(j),reused:false};
  }
  async check(row){
    // Shared across different commands, so overlapping account checks use the same in-flight request.
    const key=row.id+':'+crypto.createHash('sha256').update(row.password||'').digest('hex');
    if(this.inflight.has(key))return this.inflight.get(key);
    if(!this.siteGates.has(row.siteId))this.siteGates.set(row.siteId,new Gate(2));
    const promise=this.siteGates.get(row.siteId).run(()=>this.gate.run(async()=>{
      let r;try{r=await this.adapter.check(row);}catch{r={success:false,retryable:true,error:'Temporary site error'};}
      if(r.success && Number.isFinite(r.balance)){try{this.ledger.add(row.id,r.balance);return {success:true,balance:r.balance};}catch{return {success:false,retryable:false,error:'History could not be saved'};}}
      return {success:false,retryable:!!r.retryable,error:r.retryable?'Temporary site error':'Login or balance unavailable'};
    })).finally(()=>this.inflight.delete(key));
    this.inflight.set(key,promise);return promise;
  }
  finish(j,row,r){j.results.push({id:row.id,siteId:row.siteId,phoneLabel:row.phone?row.phone.slice(0,2)+'••••'+row.phone.slice(-2):'Account',...r});if(r.success)j.completed++;else j.failed++;}
  async run(j,rows){
    const retry=[];
    await Promise.all(rows.map(async row=>{const r=await this.check(row);j.checked++;if(!r.success&&r.retryable){retry.push(row);j.retryPending++;}else this.finish(j,row,r);}));
    if(retry.length){j.phase='retry-pass';await new Promise(r=>setTimeout(r,this.pause));await Promise.all(retry.map(async row=>{const r=await this.check(row);j.retryPending--;this.finish(j,row,r);}));}
    j.status='completed';j.phase='finished';
  }
}
module.exports={Jobs,Gate};
