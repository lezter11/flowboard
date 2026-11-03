import pg from 'pg';
import fs from 'node:fs/promises';
const summary=JSON.parse(await fs.readFile(new URL('../raw/browser-product-03/import-preview-summary.json',import.meta.url),'utf8'));
const admin=new pg.Pool({connectionString:process.env.FLOWBOARD_UI_TEST_DATABASE_URL,max:1});
const schemas=await admin.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name ~ '^browser_[0-9a-f]{32}$'");
const cleaned=[];
try{for(const {schema_name} of schemas.rows){const exists=await admin.query('SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2',[schema_name,'card_imports']);if(!exists.rowCount)continue;const own=await admin.query(`SELECT 1 FROM "${schema_name}".card_imports WHERE id=$1`,[summary.id]);if(own.rowCount){await admin.query(`DROP SCHEMA "${schema_name}" CASCADE`);cleaned.push(schema_name);}}console.log(JSON.stringify({kind:'cleanup of crashed diagnostic only; exact own synthetic batch match',cleaned}));}finally{await admin.end();}
