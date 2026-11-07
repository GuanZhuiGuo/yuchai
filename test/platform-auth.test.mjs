import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApplication, ALLOWED_PLAN_IDS } from '../server.mjs';
const planId=[...ALLOWED_PLAN_IDS][0];

test('platform auth, durable exercise recovery and cross-user denial protect real HTTP routes',async t=>{
 const context=new AsyncLocalStorage();const records=new Map([[500,{id:500,planId,roleId:7,name:'fixture',dialogueMode:'text',ownerUserId:'A',ending:false,ended:false}]]);const calls=[];let legacyCalls=0;
 const respond=(status,data)=>new Response(JSON.stringify(status===200?{code:0,data}:{error:{code:'exercise_not_owned',message:'该练习不属于当前平台账户'}}),{status});
 const platform={
  async protect(req,res){const uid=req.headers.cookie?.replace('fixture=','');if(!uid){res.writeHead(401);res.end('{}');return false}req.platformAuth={user_id:uid};return true},
  async protectUpgrade(req){const uid=req.headers.cookie?.replace('fixture=','');if(!uid)return null;req.platformAuth={user_id:uid};return req.platformAuth},
  withRequest(req,fn){return context.run(req.platformAuth,fn)},currentActor(){return context.getStore()},
  async externalFetch(path,init={}){const uid=context.getStore()?.user_id;calls.push({uid,path});const id=Number(path.match(/(?:resources|exercise)\/(\d+)/)?.[1]);const record=records.get(id);
   if(path.startsWith('resources/'))return record?.ownerUserId===uid?respond(200,record):respond(403,{});
   if(path.includes('/detail'))return record?.ownerUserId===uid?respond(200,{exercise_id:id,plan_id:planId,user_id:1,status:'running',name:record.name}):respond(403,{});
   if(path==='getSparringPlanDetail')return respond(200,{name:'fixture-plan',status:'active',role:[{id:7,name:'fixture-role'}],dialogue_mode_info:{sparring_role_type:'text'}});
   if(path==='startSparringExercise'){const body=JSON.parse(init.body);const id=501;records.set(id,{id,planId:body.plan_id,roleId:body.role_id,name:'new',dialogueMode:'text',ownerUserId:uid,ending:false,ended:false});return respond(200,{exercise_id:id,status:'running',name:'new'})}
   if(path==='getStudentPracticeInfo')return respond(200,{pending_practice_list:[]});
   if(path==='getExerciseHistory'){const mine=[...records.values()].filter(r=>r.ownerUserId===uid);return respond(200,{list:mine.map(r=>({exercise_id:r.id,plan_id:r.planId,role_id:r.roleId,name:r.name})),total:mine.length})}
   throw Error('Unexpected fixture operation '+path)
  }
 };
 async function open(){const app=createApplication({platformAdapter:platform,upstreamFetch:async()=>{legacyCalls++;throw Error('must not call legacy provider')}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');return {app,origin:`http://127.0.0.1:${app.server.address().port}`}}
 let running=await open();t.after(()=>running.app.close());
 const get=(path,user='A')=>fetch(running.origin+path,{headers:user?{Cookie:'fixture='+user}:{}});
 assert.equal((await get('/api/plans',null)).status,401);assert.equal(calls.length,0);
 assert.equal((await get('/api/exercises/500')).status,200);
 assert.equal((await get('/api/exercises/500','B')).status,403);
 const bHistory=await get('/api/history','B').then(r=>r.json());assert.deepEqual(bHistory.list,[]);
 const created=await fetch(running.origin+'/api/exercises',{method:'POST',headers:{Cookie:'fixture=A',Origin:running.origin,'Content-Type':'application/json'},body:JSON.stringify({planId,roleId:7})});assert.equal(created.status,201);
 assert.equal(records.get(501).ownerUserId,'A');
 await running.app.close();running=await open();
 const recovered=await get('/api/exercises/501').then(r=>r.json());assert.equal(recovered.id,501);assert.equal(recovered.dialogueMode,'text');
 assert.equal((await get('/api/exercises/501','B')).status,403);assert.equal(legacyCalls,0);
 const rejectedUpgrade=user=>new Promise((resolve,reject)=>{const client=new WebSocket(running.origin.replace('http:','ws:')+'/api/voice/500',{headers:{Origin:running.origin,...(user?{Cookie:'fixture='+user}:{})}});client.once('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode)});client.once('open',()=>{client.close();reject(Error('Unauthorized WebSocket opened'))});client.once('error',reject)});
 assert.equal(await rejectedUpgrade(null),401);assert.equal(await rejectedUpgrade('B'),403);
});
