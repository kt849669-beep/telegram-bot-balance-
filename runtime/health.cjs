'use strict';
const net=require('node:net');
const port=process.argv[2]==='bot'?Number(process.env.MINIAPP_BRIDGE_PORT||8790):Number(process.env.PORT||8787);
const socket=net.connect({host:'127.0.0.1',port});
socket.setTimeout(2500);socket.on('connect',()=>{socket.end();process.exit(0);});
socket.on('timeout',()=>{socket.destroy();process.exit(1);});socket.on('error',()=>process.exit(1));
