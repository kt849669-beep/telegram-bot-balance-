'use strict';
const fs=require('node:fs');
const path=require('node:path');
try{
  require('./check-config.cjs').checkConfig();
  for(const folder of [process.env.MINIAPP_DATA_DIR,process.env.MINIAPP_BRIDGE_DIR])fs.mkdirSync(folder,{recursive:true,mode:0o700});
  process.umask(0o077);
  const mode=process.argv[2];
  if(mode==='bot'){
    require('../miniapp/bot-preload.cjs');
    require(path.join(process.env.BOT_DIR,'bot.js'));
  }else if(mode==='miniapp'){
    const app=require('../miniapp/server.cjs').makeServer();
    app.server.listen(app.port,'127.0.0.1',()=>console.log('Mini App ready in Telegram-only mode.'));
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.server.close(()=>process.exit(0)));
  }else throw new Error('Unknown service');
}catch{console.error('Service could not start. Run npm run check:config with the private environment.');process.exitCode=1;}
