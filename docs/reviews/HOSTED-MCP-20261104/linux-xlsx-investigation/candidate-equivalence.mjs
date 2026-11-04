import assert from 'node:assert/strict';
const valid=n=>n===9||n===10||n===13||(n>=0x20&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff);
const pattern=/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;
let scalars=0;for(let n=0;n<=0x10ffff;n++){assert.equal(!pattern.test(String.fromCodePoint(n)),valid(n),'code point '+n);scalars++;}
let random=20261104;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};let strings=0;
for(let i=0;i<5000;i++){let s='';for(let j=0;j<40;j++)s+=String.fromCharCode(next()&65535);assert.equal(!pattern.test(s),[...s].every(ch=>valid(ch.codePointAt(0))));strings++;}
const cap=655360,markupCap=50000;
function baseline(s,count){let segment=0;for(let i=0;i<s.length;i++){if(s.charCodeAt(i)===60){if(++count>markupCap)return {ok:false,count};segment=0;}else if(++segment>cap)return {ok:false,count};}return {ok:true,count};}
function candidate(s,count){let previous=-1;for(let i=s.indexOf('<');i!==-1;i=s.indexOf('<',previous+1)){if(i-previous-1>cap)return {ok:false,count};if(++count>markupCap)return {ok:false,count};previous=i;}if(s.length-previous-1>cap)return {ok:false,count};return {ok:true,count};}
let structural=0;const tests=['','<','x','<><><>','\ud800<\udc00','x'.repeat(cap-1),'x'.repeat(cap),'x'.repeat(cap+1),'<'+ 'x'.repeat(cap),'<'+ 'x'.repeat(cap+1),'x'.repeat(cap+1)+'<','<'.repeat(markupCap),'<'.repeat(markupCap+1)];for(let i=0;i<1000;i++){let s='';for(let j=0;j<200;j++)s+=next()%9===0?'<':String.fromCharCode(next()&65535);tests.push(s);}for(const s of tests)for(const count of [0,1,49999,50000]){assert.deepEqual(candidate(s,count),baseline(s,count));structural++;}
console.log(JSON.stringify({scalars,randomUtf16Strings:strings,structuralCases:structural,ok:true,limits:{cap,markupCap}}));
