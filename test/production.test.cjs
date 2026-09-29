'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const https=require('node:https');
const {HttpsProxyAgent}=require('https-proxy-agent');
const {createSiteHttp,parseProxy,parseNetwork,hosts}=require('../runtime/site-http.cjs');
test('all fourteen API origins require the proxy; Telegram and private bridge downloads stay direct',async()=>{
  const observed=[];const client=createSiteHttp('http://fixture:secret@127.0.0.1:19299',{adapter:async c=>{observed.push(c);return {data:{},status:200,statusText:'OK',headers:{},config:c};}});
  try{
    assert.equal(hosts.size,14);
    for(const hostname of hosts)await client.post(`https://${hostname}/app/auth/login`,{phone:'synthetic',password:'synthetic'});
    assert.ok(observed.every(c=>c.httpsAgent&&c.proxy===false&&c.maxRedirects===0));
    await client.get('https://api.telegram.org/file/bot-synthetic/photo');assert.equal(observed.at(-1).httpsAgent,undefined);
    await client.get('http://127.0.0.1:8790/file/synthetic');assert.equal(observed.at(-1).httpsAgent,undefined);
    await assert.rejects(()=>client.post('http://api.showpayweb.com/app/auth/login',{}),/original HTTPS/);
    await assert.rejects(()=>client.post('https://unexpected.example/app/auth/login',{}),/configured site list/);
    assert.throws(()=>parseProxy(''),/valid proxy/);
    assert.throws(()=>parseProxy('http://example.com:9001'),/credentials/);
  }finally{client.close();}
});
test('proxy failure is propagated without retrying a direct connection',async()=>{
  let attempts=0;const client=createSiteHttp('http://fixture:secret@127.0.0.1:19299',{adapter:async c=>{attempts++;assert.ok(c.httpsAgent);throw new Error('proxy unavailable');}});
  try{await assert.rejects(()=>client.post('https://api.showpayweb.com/app/auth/login',{}),/proxy unavailable/);assert.equal(attempts,1);}finally{client.close();}
});

test('explicit direct mode uses IPv4 for all sites while preserving destination guards',async()=>{
  const observed=[];const client=createSiteHttp(undefined,{mode:'direct',adapter:async c=>{observed.push(c);return {data:{},status:200,statusText:'OK',headers:{},config:c};}});
  try{
    for(const hostname of hosts){
      await client.post(`https://${hostname}/app/auth/login`,{phone:'synthetic',password:'synthetic'});
      await client.post(`https://${hostname}/app/user/account/wallet`,{ts:1,userId:1});
    }
    assert.equal(observed.length,28);
    assert.ok(observed.every(c=>c.httpsAgent instanceof https.Agent&&!(c.httpsAgent instanceof HttpsProxyAgent)&&c.httpsAgent.options.family===4&&c.proxy===false&&c.maxRedirects===0));
    await assert.rejects(()=>client.post('https://unexpected.example/app/auth/login',{}),/configured site list/);
    await assert.rejects(()=>client.post('http://api.showpayweb.com/app/auth/login',{}),/original HTTPS/);
    await assert.rejects(()=>client.post('https://api.showpayweb.com:444/app/auth/login',{}),/original HTTPS/);
    await assert.rejects(()=>client.post('https://fixture:fixture@api.showpayweb.com/app/auth/login',{}),/original HTTPS/);
    await client.get('https://api.telegram.org/file/bot-synthetic/photo');assert.equal(observed.at(-1).httpsAgent,undefined);
    await client.get('http://127.0.0.1:8790/file/synthetic');assert.equal(observed.at(-1).httpsAgent,undefined);
  }finally{client.close();}
});

test('direct mode must be explicit and proxy configuration is still validated',()=>{
  assert.equal(parseNetwork('direct',undefined).mode,'direct');
  assert.equal(parseNetwork('direct','unused old endpoint').proxyUrl,null);
  assert.throws(()=>parseNetwork(undefined,undefined),/valid proxy/);
  assert.throws(()=>parseNetwork('proxy',undefined),/valid proxy/);
  assert.throws(()=>parseNetwork('direkt',undefined),/SITE_NETWORK_MODE/);
});
test('production adapter reads migrated private data and never starts Telegram',()=>{
  const dir=process.env.BOT_DATA_DIR;
  fs.writeFileSync(path.join(dir,'wallets.json'),JSON.stringify({showpay_9000000000:{siteId:'showpay',phone:'9000000000',password:'fixture',mpin:'001234'}}));
  fs.writeFileSync(path.join(dir,'auth.json'),JSON.stringify([12345,-67890]));
  const adapter=require('../miniapp/lib/adapter.cjs').loadAdapter(process.env.BOT_DIR);
  assert.equal(adapter.accounts().length,1);assert.equal(adapter.accounts()[0].mpin,'001234');assert.deepEqual(adapter.allowedUsers(),[12345]);
});
test('production configuration refuses local trust mode and validates backup files',()=>{
  const env={...process.env};
  try{
    process.env.MINIAPP_MODE='local';process.env.PUBLIC_ORIGIN='https://miniapp.example.com';
    process.env.MINIAPP_DATA_DIR=path.join(process.env.BOT_DATA_DIR,'reports');process.env.MINIAPP_BRIDGE_DIR=path.join(process.env.BOT_DATA_DIR,'bridge');
    const {checkConfig}=require('../runtime/check-config.cjs');assert.throws(checkConfig,/MINIAPP_MODE=telegram/);
    process.env.MINIAPP_MODE='telegram';
    for(const name of ['wallets_backup.json','wallets_backup2.json'])fs.writeFileSync(path.join(process.env.BOT_DATA_DIR,name),'{}');
    assert.equal(checkConfig(),true);
    process.env.SITE_NETWORK_MODE='direct';delete process.env.SITE_PROXY_URL;assert.equal(checkConfig(),true);
    process.env.SITE_NETWORK_MODE='proxy';assert.throws(checkConfig,/valid proxy/);
    process.env.SITE_NETWORK_MODE='direct';
    process.env.PUBLIC_ORIGIN='http://miniapp.example.com';assert.throws(checkConfig,/HTTPS/);
  }finally{for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
test('bot source contains no private inline token or administrator password',()=>{
  const source=fs.readFileSync(path.join(process.env.BOT_DIR,'bot.js'),'utf8');
  assert.ok(!/var (?:BOT_TOKEN|ADMIN_PASSWORD)\s*=\s*['"]/.test(source));
  assert.ok(!/Received message from/.test(source));new vm.Script(source);
});
