const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {sharedWallets}=require('../lib/shared-wallets.cjs');
const {BotMirror}=require('../lib/bot-mirror.cjs');
const {spawn}=require('node:child_process');
const clone=v=>JSON.parse(JSON.stringify(v));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const botDir=process.env.BOT_DIR||path.join(os.homedir(),'Desktop','New folder (2)');
test('preload starts an authenticated bridge without rewriting the bot source',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-bridge-'));const filename=path.join(dir,'bot.js');const fixture='function loadWallets(){return {};} function saveWallets(data){} var userState={};';fs.writeFileSync(filename,fixture);
  const child=spawn(process.execPath,['-r',path.resolve(__dirname,'../bot-preload.cjs'),filename],{cwd:dir,env:{...process.env,BOT_DIR:dir,MINIAPP_BRIDGE_DIR:dir,MINIAPP_BRIDGE_PORT:'19003'},stdio:'ignore',windowsHide:true});t.after(()=>child.kill());
  const file=path.join(dir,'connection.json');for(let i=0;i<120&&!fs.existsSync(file);i++)await sleep(25);assert.ok(fs.existsSync(file),'Bridge should publish private connection metadata');const c=JSON.parse(fs.readFileSync(file));assert.equal(fs.readFileSync(filename,'utf8'),fixture);
  let r=await fetch('http://127.0.0.1:19003/no-route',{method:'POST',body:'{}'});assert.equal(r.status,403);
  r=await fetch('http://127.0.0.1:19003/no-route',{method:'POST',headers:{'X-Bridge-Key':c.key,'Content-Type':'application/json'},body:JSON.stringify({owner:'fixture'})});assert.equal(r.status,404);
});
test('shared writes preserve newer edits, MPIN and new accounts across slow checks',()=>{
  let data={s_9000000000:{siteId:'s',phone:'9000000000',password:'old',mpin:'001234',sessionKey:'old'}};
  const store=sharedWallets(()=>clone(data),v=>{data=clone(v);});
  const slow=store.load(),edit=store.load();edit.s_9000000000.password='new';store.save(edit);
  const added=store.load();added.s_9000000001={siteId:'s',phone:'9000000001',password:'second'};store.save(added);
  slow.s_9000000000.sessionKey='fresh';store.save(slow);
  assert.equal(data.s_9000000000.password,'new');assert.equal(data.s_9000000000.mpin,'001234');assert.ok(data.s_9000000001);assert.equal(data.s_9000000000.sessionKey,'fresh');
});
test('mobile rename preserves concurrent field updates and refuses collisions',()=>{
  let data={s_9000000000:{siteId:'s',phone:'9000000000',password:'old',mpin:'001234'}};
  const store=sharedWallets(()=>clone(data),v=>{data=clone(v);});const rename=store.load();const edit=store.load();edit.s_9000000000.password='new';store.save(edit);
  rename.s_9000000009=rename.s_9000000000;rename.s_9000000009.phone='9000000009';delete rename.s_9000000000;store.save(rename);assert.equal(data.s_9000000009.password,'new');assert.equal(data.s_9000000009.mpin,'001234');assert.ok(!data.s_9000000000);
  const collision=store.load();collision.s_9000000001={siteId:'s',phone:'9000000001',password:'another'};store.save(collision);const attempt=store.load();attempt.s_9000000001=attempt.s_9000000009;attempt.s_9000000001.phone='9000000001';delete attempt.s_9000000009;assert.throws(()=>store.save(attempt));assert.equal(data.s_9000000001.password,'another');
});
test('original bot commands, keyboards, saves, MPIN, OCR and reset run unchanged with UI transport',{skip:!fs.existsSync(path.join(botDir,'bot.js'))},async t=>{
  let data={olapay_9000000000:{siteId:'olapay',phone:'9000000000',password:'DemoOld',mpin:'001234',userId:42,sessionKey:'private-fixture-session',loginToken:'private-fixture-token'},showpay_9000000000:{siteId:'showpay',phone:'9000000000',password:'DemoOld',mpin:'001234',userId:43}};
  const store=sharedWallets(()=>clone(data),v=>{data=clone(v);});const files=new Map();let resets=0;
  const mirror=new BotMirror({source:fs.readFileSync(path.join(botDir,'bot.js'),'utf8'),botDir,store,fastTimers:true,resetNative:()=>resets++,registerFile:(input,id)=>{if(input){const key=String(files.size+1);files.set(key,Buffer.from(input.base64,'base64'));return key;}return new URL('https://fixture.invalid/'+id);},requireOverride:name=>{
    if(name==='axios'||name==='../runtime/site-http.cjs')return {post:async(url,body)=>{await sleep(8);return url.endsWith('/login')?{data:{code:200,data:{userId:7001,sessionKey:'private-fixture-session',loginToken:'private-fixture-token'}}}:{data:{code:200,data:{xtoken:52}}};},get:async url=>({data:files.get(new URL(url).pathname.slice(1))})};
    if(name==='tesseract.js')return {createWorker:async()=>({recognize:async()=>({data:{text:'9000000088 DemoPhoto MPIN: 000888'}}),terminate:async()=>{}})};
  }});t.after(()=>mirror.dispose());
  const owner='fixture';const done=async()=>{for(let i=0;i<600;i++){if(!mirror.snapshot(owner).busy.length)return;await sleep(5);}throw new Error('Fixture flow timed out');};
  const send=async text=>{await mirror.send(owner,{text});await done();return mirror.snapshot(owner);};
  const latest=()=>mirror.snapshot(owner).messages.filter(m=>m.role==='bot').at(-1);
  const click=async label=>{const msg=[...mirror.snapshot(owner).messages].reverse().find(m=>m.buttons?.flat().some(b=>b.text===label));assert.ok(msg,'Expected keyboard label');const b=msg.buttons.flat().find(b=>b.text===label);await mirror.send(owner,{action:b.id});await done();};
  await send('/start');assert.match(latest().text,/Master Control Panel \(14 Sites\)/);assert.match(latest().text,/\/add/);
  await send('/list');assert.equal(latest().text,'📋 *Saved Data (2):*\n\n1. *OlaPay* — `9000000000`\n2. *ShowPay* — `9000000000`\n');
  await send('/check');assert.equal(latest().text,'Kaunsa check karna hai?');await click('📱 9000000000');await click('🌐 OlaPay');assert.ok(data.olapay_9000000000.userId===7001);
  await send('/password');await send('0000');assert.match(latest().text,/`DemoOld`/);assert.match(latest().text,/`001234`/);assert.ok(!latest().text.includes('private-fixture'));
  await send('/add');assert.equal(latest().text,'➕ *Naya Mobile number bhejo:*');await send('9000000099');assert.equal(latest().text,'🔒 *Ab Pin / Code bhejo:*');await send('DemoAdd');assert.equal(mirror.snapshot(owner).messages.filter(m=>m.role==='user').at(-1).text,'••••••••');await click('🌐 OlaPay');assert.equal(data.olapay_9000000099.password,'DemoAdd');
  await send('/edit');await click('✏️ 9000000000');await click('🔒 Pin/Code Update');await send('DemoNew');assert.equal(data.olapay_9000000000.password,'DemoNew');assert.equal(data.showpay_9000000000.password,'DemoNew');assert.equal(data.olapay_9000000000.mpin,'001234');
  await send('/scan');await send('9000000077');await send('DemoScan');assert.equal(Object.values(data).filter(r=>r.phone==='9000000077').length,14);
  await send('/ocr');await mirror.send(owner,{file:{mime:'text/plain',name:'synthetic.txt',base64:Buffer.from('9000000066 DemoDoc MPIN: 000666').toString('base64')}});await done();assert.match(latest().text,/000666/);await click('✅ Scan Karo (14 Sites Each)');assert.equal(Object.values(data).filter(r=>r.phone==='9000000066'&&r.mpin==='000666').length,14);
  await send('/ocr');await mirror.send(owner,{file:{mime:'image/png',name:'synthetic.png',base64:Buffer.from('synthetic stub image').toString('base64')}});await done();assert.equal(Object.values(data).filter(r=>r.phone==='9000000088'&&r.mpin==='000888').length,14);
  await mirror.send(owner,{text:'/balance'});const repeat=await mirror.send(owner,{text:'/balance'});assert.match(repeat.notice,/Pichla/);await done();assert.ok(mirror.snapshot(owner).messages.some(m=>m.text.includes('accounts check ho gaye')));
  await send('/restart');await click('❌ Nahi, Cancel');assert.equal(latest().text,'❌ Restart cancel kar diya gaya.');await send('/restart');await click('✅ Haan, Restart Karo');assert.equal(resets,1);assert.match(latest().text,/Successfully Reset/);
  data=Object.fromEntries(Array.from({length:140},(_,i)=>{const phone=String(9000001000+i);return ['olapay_'+phone,{siteId:'olapay',phone,password:'SyntheticOnly'}];}));
  await send('/list');const w=mirror.workspace(owner);const pieces=w.messages.filter(m=>m.role==='bot'&&m.flowId===w.active);assert.ok(pieces.length>1);assert.match(pieces.map(m=>m.text).join('\n'),/140\. \*OlaPay\* — `9000001139`/);
  await send('/check');const ownButton=latest().buttons[0][0].id;await assert.rejects(()=>mirror.send('another-user',{action:ownButton}),/expired/);
});
