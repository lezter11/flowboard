import sharp from'sharp';import fs from'node:fs/promises';import{validateJpegEntropy}from'../../../../apps/api/src/services/jpeg-entropy.ts';
const width=5000,height=4000,raw=Buffer.alloc(width*height*3);let state=19790621;
for(let p=0;p<raw.length;p+=3){state^=state<<13;state^=state>>>17;state^=state<<5;raw[p]=state&255;raw[p+1]=(state>>>8)&255;raw[p+2]=(state>>>16)&255;}
const results=[];
for(const kind of['rgb444','cmyk444']){
 let bytes,quality;
 for(const q of[30,20,10,5]){let source=sharp(raw,{raw:{width,height,channels:3}});if(kind==='cmyk444')source=source.toColourspace('cmyk');bytes=await source.jpeg({progressive:true,chromaSubsampling:'4:4:4',quality:q}).toBuffer();if(bytes.length<=10*1024*1024){quality=q;break;}}
 const record={kind,width,height,quality,inputBytes:bytes.length};try{record.metrics=await validateJpegEntropy(bytes);record.accepted=true;}catch(error){record.accepted=false;record.code=error.code;record.message=error.message;}
 results.push(record);
}
await fs.writeFile(new URL('./jpeg-complexity-probe.json',import.meta.url),JSON.stringify({purpose:'Deterministic20MP textured valid-input resource probe; local Node, not hosted CPU proof.',results},null,2)+'\n');console.log(results);
