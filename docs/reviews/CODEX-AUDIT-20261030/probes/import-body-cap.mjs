import { createApp } from '../../../../apps/api/src/http/app.ts';
const app=createApp();
const payload=new Uint8Array(1024*1024+1);
const response=await app.request('http://localhost/api/v1/boards/board-a/card-imports',{method:'POST',headers:{'content-type':'application/octet-stream'},body:payload});
const body=await response.json();
console.log(JSON.stringify({requestBytes:payload.byteLength,status:response.status,errorCode:body?.error?.code,limitBytes:1024*1024}));
