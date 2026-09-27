'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
function botClient(folder=process.env.MINIAPP_BRIDGE_DIR||path.join(os.homedir(),'AppData','Local','MasterControlMiniApp','bridge')){
  return async(route,owner,event)=>{
    let connection;try{connection=JSON.parse(fs.readFileSync(path.join(folder,'connection.json'),'utf8'));}catch{throw new Error('Bot bridge ready nahi hai. Bot ko bridge launcher se restart karein.');}
    if(!Number.isInteger(connection.port)||connection.port<1024||connection.port>65535)throw new Error('Bot bridge configuration invalid');
    const r=await fetch(`http://127.0.0.1:${connection.port}/${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Key':connection.key},body:JSON.stringify({owner,event}),signal:AbortSignal.timeout(20000)});
    const result=await r.json();if(!r.ok)throw new Error(result.error||'Bot request failed');return result;
  };
}
module.exports={botClient};
