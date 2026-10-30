import { clientKey, windowBucketsFor } from '../../../../apps/api/src/services/rate-limit.ts';
const path='/api/v1/projects/project-a/invitations';
const result=['198.51.100.10','198.51.100.11'].map(ip=>({ip,bucket:windowBucketsFor('POST',path),key:clientKey(new Headers({'cf-connecting-ip':ip}))}));
console.log(JSON.stringify({route:path,actorsOnDifferentSourceIps:result,perActorOrPerProjectCounter:false}));
