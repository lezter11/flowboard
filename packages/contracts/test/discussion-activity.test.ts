import assert from 'node:assert/strict';
import test from 'node:test';
import {postCommentInputSchema,editCommentInputSchema,activityFeedQuerySchema,projectActivityQuerySchema,cardActivityQuerySchema,notificationQuerySchema} from '../src/discussion.ts';

test('discussion spans use UTF16, normalize trim once, and refuse split/removed characters',()=>{
  const input={body:'  😀 @Ada 🚀  ',mentions:[{userId:'person',start:5,end:12}]};
  const parsed=postCommentInputSchema.parse(input);
  assert.deepEqual(parsed,{body:'😀 @Ada 🚀',mentions:[{userId:'person',start:3,end:10}]});
  assert.deepEqual(postCommentInputSchema.parse(parsed),parsed,'route and adapter revalidation remains idempotent');
  for(const [body,start,end] of [['  @Ada  ',0,6],['😀 @Ada',1,7],['@Ada 🚀',0,6],['@Ada',0,20]]as const)
    assert.equal(postCommentInputSchema.safeParse({body,mentions:[{userId:'person',start,end}]}).success,false);
  assert.deepEqual(editCommentInputSchema.parse({...input,expectedVersion:1}),{...parsed,expectedVersion:1});
  assert.equal(postCommentInputSchema.safeParse({body:' '.repeat(5)}).success,false);
  assert.equal(postCommentInputSchema.safeParse({body:'x'.repeat(10001)}).success,false);
});
test('activity bounds validate calendar/ranges, preserve date-only midnight and normalize offset instants',()=>{
  const valid=activityFeedQuerySchema.parse({fromDate:'2024-02-29',toDate:'2024-02-29T23:00:00+02:00',limit:'100'});
  assert.equal(valid.fromDate,'2024-02-29');assert.equal(valid.toDate,'2024-02-29T21:00:00.000Z');assert.equal(valid.limit,100);
  assert.equal(cardActivityQuerySchema.parse({}).limit,50);
  for(const input of [{fromDate:'2023-02-29'},{fromDate:'0000-01-01'},{toDate:'2026-04-31'},{fromDate:'2026-01-01T01:00:00'},{fromDate:'2026-01-02',toDate:'2026-01-01'},{limit:'1x'},{limit:'0'},{cursor:'x'.repeat(4097)},{extra:'ignored'}])assert.equal(activityFeedQuerySchema.safeParse(input).success,false,JSON.stringify(input));
  assert.equal(cardActivityQuerySchema.safeParse({fromDate:'2026-01-01'}).success,false);
  assert.equal(projectActivityQuerySchema.safeParse({projectId:'ignored'}).success,false);
  assert.equal(projectActivityQuerySchema.safeParse({fromDate:'2026-01-02',toDate:'2026-01-01'}).success,false);
});

test('notification query uses explicit boolean text and bounds rather than truthy coercion',()=>{
  assert.deepEqual(notificationQuerySchema.parse({}),{limit:50,unreadOnly:false});
  assert.equal(notificationQuerySchema.parse({unreadOnly:'false',limit:'100'}).unreadOnly,false);
  assert.equal(notificationQuerySchema.parse({unreadOnly:'true'}).unreadOnly,true);
  for(const input of [{unreadOnly:'yes'},{unreadOnly:''},{limit:'101'},{limit:'0'},{limit:'1x'},{cursor:''},{cursor:'x'.repeat(4097)},{other:'ignored'}])assert.equal(notificationQuerySchema.safeParse(input).success,false);
});
