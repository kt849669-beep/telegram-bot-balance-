'use strict';
const fs = require('node:fs');
const path = require('node:path');
function dayOf(time) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time)); }
class Ledger {
  constructor(dir) { fs.mkdirSync(dir,{recursive:true}); this.file=path.join(dir,'balance-history.jsonl'); this.entries=[]; if(fs.existsSync(this.file)) { for(const line of fs.readFileSync(this.file,'utf8').split('\n').filter(Boolean)) { try { const r=JSON.parse(line); if(typeof r.id==='string' && Number.isFinite(r.balance) && Number.isFinite(Date.parse(r.at))) this.entries.push(r); } catch {} } } }
  add(id,balance,at=new Date().toISOString()) { const r={id,balance,at}; fs.appendFileSync(this.file,JSON.stringify(r)+'\n'); this.entries.push(r); return r; }
  latest(id) { return this.entries.findLast(r=>r.id===id); }
  history(id) { return this.entries.filter(r=>r.id===id).slice(-100).reverse(); }
  report(day=dayOf(Date.now())) {
    const today=new Map(),before=new Map();
    for(const r of this.entries) { const d=dayOf(r.at); if(d===day) today.set(r.id,r); else if(d<day) before.set(r.id,r); }
    return [...today.values()].map(r=>({id:r.id,current:r.balance,previous:before.get(r.id)?.balance??null,change:before.has(r.id)?r.balance-before.get(r.id).balance:null,at:r.at}));
  }
}
module.exports = {Ledger,dayOf};
