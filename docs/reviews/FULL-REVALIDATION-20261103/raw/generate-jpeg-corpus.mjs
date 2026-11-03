import fs from 'node:fs/promises';
import {execFileSync}from'node:child_process';
import sharp from'sharp';
const directory=await fs.mkdtemp('/private/tmp/flowboard-jpeg-corpus-');
const width=63,height=47;
const rgb=Buffer.alloc(width*height*3);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*3;rgb[p]=(x*37+y*11)%256;rgb[p+1]=(x*13+y*79)%256;rgb[p+2]=(x*x+y*53)%256;}
const ppm=Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]);
const input=directory+'/pattern.ppm';await fs.writeFile(input,ppm);
await fs.writeFile(directory+'/sequential.scans','0; 1,2;\n');
await fs.writeFile(directory+'/custom.scans','0,1,2:0 0 0 1; 0:1 8 0 1; 0:9 63 0 1; 1:1 63 0 1; 2:1 63 0 1; 0,1,2:0 0 1 0; 0:1 63 1 0; 1:1 63 1 0; 2:1 63 1 0;\n');
const records=[];
try{
  const cases=[
    ['baseline-420',['-sample','2x2,1x1,1x1']],['baseline-422',['-sample','2x1,1x1,1x1']],['baseline-444',['-sample','1x1,1x1,1x1']],
    ['baseline-411',['-sample','4x1,1x1,1x1']],['baseline-31',['-sample','3x1,1x1,1x1']],
    ['grayscale',['-grayscale']],['grayscale-restart',['-grayscale','-restart','1B']],
    ['baseline-restart',['-sample','1x1,1x1,1x1','-restart','1B']],['baseline-restart-partial',['-restart','5B']],
    ['progressive-420',['-progressive']],['progressive-444',['-progressive','-sample','1x1,1x1,1x1']],
    ['progressive-restart',['-progressive','-sample','1x1,1x1,1x1','-restart','1B']],['progressive-restart-partial',['-progressive','-restart','5B']],
    ['sequential-partial-interleave',['-scans',directory+'/sequential.scans']],['custom-spectral-refinement',['-scans',directory+'/custom.scans']],['custom-refinement-restart',['-scans',directory+'/custom.scans','-restart','1B']]
  ];
  for(const[name,options]of cases){const bytes=execFileSync('/opt/homebrew/bin/cjpeg',['-quality','82','-optimize',...options,input]);await sharp(bytes,{failOn:'warning'}).png().toBuffer();records.push({name,width,height,data:bytes.toString('base64'),generator:['cjpeg3.2.0','-quality82','-optimize',...options.map(v=>v.startsWith(directory)?v.slice(directory.length+1):v)]});}
  await fs.writeFile(directory+'/single.pgm',Buffer.concat([Buffer.from('P5\n1 1\n255\n'),Buffer.from([128])]));
  for(const progressive of[false,true]){const options=['-grayscale','-optimize',...(progressive?['-progressive']:[])];const bytes=execFileSync('/opt/homebrew/bin/cjpeg',[...options,directory+'/single.pgm']);records.push({name:'grayscale-single-'+(progressive?'progressive':'baseline'),width:1,height:1,data:bytes.toString('base64'),generator:['cjpeg3.2.0',...options]});}
  for(const progressive of[false,true]){const bytes=await sharp(rgb,{raw:{width,height,channels:3}}).toColourspace('cmyk').jpeg({quality:82,progressive,chromaSubsampling:'4:4:4'}).toBuffer();records.push({name:'cmyk-'+(progressive?'progressive':'baseline'),width,height,data:bytes.toString('base64'),generator:['sharp0.35.5','cmyk','quality82','444',progressive?'progressive':'baseline']});}
  await fs.writeFile(new URL('../../../../apps/api/test/support/jpeg-corpus.json',import.meta.url),JSON.stringify({purpose:'Synthetic genuine JPEG corpus, offline cjpeg3.2.0/sharp0.35.5 generation; no runtime CLI dependency.',records},null,2)+'\n');console.log(records.map(r=>({name:r.name,bytes:Buffer.from(r.data,'base64').length})));
}finally{await fs.rm(directory,{recursive:true,force:true});}
