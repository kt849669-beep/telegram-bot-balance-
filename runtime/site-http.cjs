'use strict';
const axios=require('axios');
const https=require('node:https');
const {HttpsProxyAgent}=require('https-proxy-agent');
const hosts=new Set(['api.app-olapay.com','api.swiftwallet-app.com','api.toppay-web.com','api.rswallet-api.com','api.sharkpay-app.com','api.smartwallet-app.com','api.paysetu-app.com','api.showpayweb.com','api.atg-game.com','api.penguinpay-app.com','api.aidpay-api.com','api.opay-app.com','api.millerpay-app.com','api.mobiuspe-app.com']);
function parseProxy(value){
  let url;try{url=new URL(value);}catch{throw new Error('SITE_PROXY_URL must contain a valid proxy endpoint');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||!url.port||!url.username||!url.password)throw new Error('SITE_PROXY_URL must include host, port and credentials');
  return url;
}
function parseNetwork(mode,proxyValue){
  mode=mode||'proxy';
  if(!['proxy','direct'].includes(mode))throw new Error('SITE_NETWORK_MODE must be proxy or direct');
  return {mode,proxyUrl:mode==='proxy'?parseProxy(proxyValue):null};
}
function createSiteHttp(proxyValue,options={}){
  const network=parseNetwork(options.mode,proxyValue);
  const agent=network.mode==='proxy'?new HttpsProxyAgent(network.proxyUrl,{timeout:20000}):new https.Agent({family:4});
  const client=axios.create({proxy:false,maxRedirects:0,...(options.adapter?{adapter:options.adapter}:{})});
  client.interceptors.request.use(config=>{
    const destination=new URL(config.url,config.baseURL);
    config.proxy=false;config.maxRedirects=0;
    if(hosts.has(destination.hostname)){
      if(destination.protocol!=='https:'||destination.username||destination.password||destination.port)throw new Error('Site API requires its original HTTPS origin');
      // The explicit network mode applies to every site. Proxy mode never falls back to direct.
      config.httpsAgent=agent;
    }else if(config.method!=='get'){
      throw new Error('API destination is not in the configured site list');
    }else if(destination.protocol!=='https:'&&!(destination.protocol==='http:'&&destination.hostname==='127.0.0.1')){
      throw new Error('File downloads require HTTPS or the private loopback bridge');
    }
    return config;
  });
  client.close=()=>agent.destroy();
  return client;
}
let client;
const getClient=()=>client||(client=createSiteHttp(process.env.SITE_PROXY_URL,{mode:process.env.SITE_NETWORK_MODE}));
module.exports={get:(...args)=>getClient().get(...args),post:(...args)=>getClient().post(...args),createSiteHttp,parseProxy,parseNetwork,hosts};
