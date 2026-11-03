import assert from 'node:assert/strict';
import test from 'node:test';
import { importTestDatabaseUrl } from './support/import-database.ts';

test('Import test database requires an explicit isolated URL and refuses default/shared ports without connecting', () => {
  const keys=['FLOWBOARD_IMPORT_TEST_DATABASE_URL','DATABASE_URL'] as const;
  const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    for(const key of keys)delete process.env[key];
    assert.throws(()=>importTestDatabaseUrl());
    for(const port of ['',':55432',':55479']){
      process.env['DATABASE_URL']=`postgres://flowboard_harness:synthetic@127.0.0.1${port}/flowboard_harness`;
      assert.throws(()=>importTestDatabaseUrl(),`Default/shared port ${port} must never be used implicitly`);
    }
    for(const port of ['5432','55931']){
      const explicit=`postgres://flowboard_harness:synthetic@127.0.0.1:${port}/flowboard_import_test`;
      process.env['FLOWBOARD_IMPORT_TEST_DATABASE_URL']=explicit;
      assert.equal(importTestDatabaseUrl(),explicit);
    }
    for(const bad of ['postgres://flowboard_harness:synthetic@remote.example:55931/flowboard_import_test','postgres://other:synthetic@127.0.0.1:55931/flowboard_import_test','postgres://flowboard_harness:synthetic@127.0.0.1:55931/live','postgres://flowboard_harness:synthetic@127.0.0.1:55931/flowboard_import_test?options=unsafe']){
      process.env['FLOWBOARD_IMPORT_TEST_DATABASE_URL']=bad;assert.throws(()=>importTestDatabaseUrl());
    }
  }finally{for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}}
});
