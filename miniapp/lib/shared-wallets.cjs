'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Both Telegram and the Mini App save through one process. Merge only fields a
// command changed, so a slow balance check cannot undo a newer password/MPIN edit.
function sharedWallets(read,write){
  const baselines=new WeakMap();
  function load(){const data=read();baselines.set(data,{value:clone(data),refs:new Map(Object.entries(data).map(([k,v])=>[v,k]))});return data;}
  function save(data){
    if(!data||!Object.keys(data).length)return;
    const baseline=baselines.get(data)||{value:{},refs:new Map()};
    const latest=read();const merged=clone(latest);const renamed=new Set();
    for(const [key,row] of Object.entries(data)){
      const originalKey=baseline.refs.get(row);
      const oldKey=originalKey&&originalKey!==key&&!Object.hasOwn(data,originalKey)?originalKey:key;
      const old=baseline.value[oldKey];
      if(oldKey!==key){
        if(Object.hasOwn(latest,key)&&!Object.hasOwn(baseline.value,key))throw new Error('Naya number pehle se saved hai. Update cancel hua.');
        if(Object.hasOwn(baseline.value,key))throw new Error('Naya number pehle se saved hai. Update cancel hua.');
        renamed.add(oldKey);
      }
      const result={...(latest[oldKey]||latest[key]||{})};
      if(!old)Object.assign(result,row);
      else for(const field of new Set([...Object.keys(old),...Object.keys(row)])){
        if(!same(row[field],old[field])){
          if(Object.hasOwn(row,field))result[field]=row[field];else delete result[field];
        }
      }
      merged[key]=result;
    }
    for(const old of renamed)delete merged[old];
    // There is no delete command. Missing keys in stale snapshots stay intact.
    write(merged);
    const actual=read();if(!same(actual,merged))throw new Error('Data save nahi hua. Dobara try karein.');
    baselines.set(data,{value:clone(data),refs:new Map(Object.entries(data).map(([k,v])=>[v,k]))});
  }
  return {load,save};
}
module.exports={sharedWallets};
