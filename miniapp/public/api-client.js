'use strict';
(function(root){
  function createMiniappApi(options={}){
    const transport=options.fetch||((...args)=>root.fetch(...args));
    const initData=options.initData||(()=>root.Telegram?.WebApp?.initData||'');
    let csrf='',generation=0,refreshing=null,authFailure=null;
    async function request(route,body,method){
      const response=await transport('/api/'+route,{method,credentials:'same-origin',headers:{'X-Miniapp-Request':'1','X-CSRF-Token':csrf,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const value=await response.json();
      if(!response.ok){const error=new Error(value.error||'Request complete nahi hua.');error.status=response.status;error.code=value.code;throw error;}
      return value;
    }
    function connect(){
      if(refreshing)return refreshing;
      if(authFailure)return Promise.reject(authFailure);
      refreshing=request('session',{initData:initData()},'POST').then(value=>{
        csrf=value.csrf;generation++;return value;
      }).catch(error=>{
        if(['AUTH_REQUIRED','ACCESS_REVOKED'].includes(error.code))authFailure=error;
        throw error;
      }).finally(()=>{refreshing=null;});
      return refreshing;
    }
    async function api(route,body,method=body===undefined?'GET':'POST'){
      if(route==='session')return connect();
      if(authFailure)throw authFailure;
      if(refreshing)await refreshing;
      const attemptedGeneration=generation;
      try{return await request(route,body,method);}catch(error){
        if(error.code==='ACCESS_REVOKED')authFailure=error;
        // Only these pre-handler rejections are safe to replay. Never retry a
        // timeout/network failure: a command may already have been processed.
        if(!((error.status===401&&error.code==='SESSION_EXPIRED')||(error.status===403&&error.code==='CSRF_MISMATCH')))throw error;
        if(generation===attemptedGeneration)await connect();
        return request(route,body,method);
      }
    }
    return {api,connect};
  }
  if(typeof module==='object'&&module.exports)module.exports={createMiniappApi};
  else root.createMiniappApi=createMiniappApi;
})(globalThis);
