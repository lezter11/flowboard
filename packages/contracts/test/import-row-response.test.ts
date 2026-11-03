import assert from 'node:assert/strict';
import test from 'node:test';
import { importRowSchema } from '../src/imports.ts';
const normal={rowNumber:2,externalId:'0001',title:'Normal card',description:'Description',status:null,priority:'medium',dueDate:null,assigneeIds:[],outcome:'new',errors:[],cardId:null};
test('Import row contract: invalid raw values remain representable without relaxing valid card fields',()=>{
  for(const patch of [{title:''},{externalId:''},{title:'T'.repeat(201)},{description:'D'.repeat(20_001)},{externalId:'E'.repeat(65)}]){
    assert.equal(importRowSchema.safeParse({...normal,...patch}).success,false);
    assert.equal(importRowSchema.safeParse({...normal,...patch,outcome:'invalid',errors:[{field:'source',code:'INVALID',message:'Correct this source field.'}]}).success,true);
  }
  assert.equal(importRowSchema.safeParse({...normal,title:'',outcome:'invalid',errors:[]}).success,false);
});
test('Import row contract: redaction is explicit and cannot carry private content',()=>{
  const redacted={rowNumber:2,contentRedacted:true,externalId:null,title:null,description:null,status:null,priority:null,dueDate:null,assigneeIds:[],outcome:'created',errors:[],cardId:'card-id'};
  assert.equal(importRowSchema.safeParse(redacted).success,true);
  for(const patch of [{contentRedacted:false},{title:'Private original title'},{externalId:'0001'},{assigneeIds:['private-person']},{errors:[{field:'title',code:'PRIVATE',message:'Private source'}]},{priority:'medium'}])assert.equal(importRowSchema.safeParse({...redacted,...patch}).success,false);
});
