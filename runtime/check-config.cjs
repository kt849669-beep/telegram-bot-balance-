'use strict';
const fs=require('node:fs');
const path=require('node:path');
function checkConfig(){
  const config=require('./config.cjs');
  if(!/^\d+:[A-Za-z0-9_-]+$/.test(config.botToken))throw new Error('BOT_TOKEN format is invalid');
  if(!config.adminPassword)throw new Error('ADMIN_PASSWORD is required');
  require('./site-http.cjs').parseNetwork(process.env.SITE_NETWORK_MODE,process.env.SITE_PROXY_URL);
  if(process.env.MINIAPP_MODE!=='telegram')throw new Error('Production requires MINIAPP_MODE=telegram');
  let origin;try{origin=new URL(process.env.PUBLIC_ORIGIN);}catch{throw new Error('PUBLIC_ORIGIN is required');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('PUBLIC_ORIGIN must be an HTTPS origin');
  for(const name of ['BOT_DIR','MINIAPP_DATA_DIR','MINIAPP_BRIDGE_DIR'])if(!process.env[name]||!path.isAbsolute(process.env[name]))throw new Error(`${name} must be an absolute path`);
  const read=name=>JSON.parse(fs.readFileSync(path.join(config.dataDir,name),'utf8'));
  const wallets=read('wallets.json'),auth=read('auth.json');
  if(!wallets||Array.isArray(wallets)||typeof wallets!=='object')throw new Error('Account data must be an object');
  if(!Array.isArray(auth)||!auth.some(n=>Number.isSafeInteger(n)&&n>0))throw new Error('At least one authorized Telegram user is required');
  for(const backup of ['wallets_backup.json','wallets_backup2.json']){const value=read(backup);if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Invalid account backup');}
  return true;
}
if(require.main===module){try{checkConfig();console.log('Production configuration and data validated; no credentials displayed.');}catch(e){console.error(e.code==='ENOENT'?'Required private data file is missing.':/^(Missing |BOT_|ADMIN_|SITE_|Production |PUBLIC_|MINIAPP_|Account |At least |Invalid account)/.test(e.message)?e.message:'Configuration validation failed.');process.exitCode=1;}}
module.exports={checkConfig};
