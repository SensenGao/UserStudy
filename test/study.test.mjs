import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStudyServer} from '../server.mjs';

test('balanced assignment, independent blinding, authorization, persistence and media access',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'video-study-test-'));
  const files=['ref.mp4','first.mp4','second.mp4'].map((n,i)=>{const p=path.join(root,n);fs.writeFileSync(p,Buffer.alloc(100,i+1));return p;});
  const manifest={active:true,cases:Array.from({length:50},(_,i)=>({id:'C'+String(i+1).padStart(3,'0'),reference:files[0],first:files[1],second:files[2],duration:121/24}))};
  fs.writeFileSync(path.join(root,'study-manifest.json'),JSON.stringify(manifest));
  let app=createStudyServer({root,port:0});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  let base='http://127.0.0.1:'+app.server.address().port;
  const call=async(url,body,token)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  try{
    const nonces=Array.from({length:5},()=>randomBytes(32).toString('hex'));
    const users=await Promise.all(nonces.map(n=>call('/api/session',{resume_key:n}).then(r=>{assert.equal(r.status,200);return r.data;})));
    assert.equal(new Set(users.map(u=>u.participant_id)).size,5);
    for(const u of users){
      assert.equal(u.trials.length,10);assert.equal(new Set(u.trials.map(t=>t.id)).size,10);
      assert.deepEqual(u.trials.map(t=>t.ordinal),[1,2,3,4,5,6,7,8,9,10]);
      assert.equal(app.db.prepare('SELECT SUM(flip) AS n FROM assignments WHERE participant_id=?').get(u.participant_id).n,5);
      const json=JSON.stringify(u);assert(!json.includes(root));assert(!json.includes('first.mp4'));assert(!json.includes('second.mp4'));assert(!json.includes('C001'));assert(!json.includes('flip'));
    }
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM cases WHERE assignments=1').get().n,50);
    const resumed=(await call('/api/session',{resume_key:nonces[0]})).data;
    assert.equal(resumed.participant_id,users[0].participant_id);assert.deepEqual(resumed.trials.map(t=>t.id),users[0].trials.map(t=>t.id));
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM assignments').get().n,50);
    const trial=users[0].trials[0];
    assert.equal((await call('/api/vote',{assignment_id:trial.id,choice:'A'})).status,401);
    assert.equal((await call('/api/vote',{assignment_id:trial.id,choice:'A'},users[1].token)).status,400);
    assert.equal((await call('/api/vote',{assignment_id:trial.id,choice:'ours'},users[0].token)).status,400);
    assert.equal((await call('/api/vote',{assignment_id:trial.id,choice:'A',elapsed_ms:5000},users[0].token)).status,200);
    assert.equal((await call('/api/vote',{assignment_id:trial.id,choice:'B'},users[0].token)).status,200);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM votes').get().n,1);
    const good=await fetch(base+trial.A,{headers:{Range:'bytes=0-9'}});assert.equal(good.status,206);assert.equal((await good.arrayBuffer()).byteLength,10);
    const forged=await fetch(base+trial.A.replace('sig=','sig=x'));assert.equal(forged.status,403);
    const origin=await fetch(base+'/api/session',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({resume_key:nonces[0]})});assert.equal(origin.status,403);
    for(const route of ['/study-manifest.json','/schema.sql','/study.sqlite','/../server-secret','/api/results'])assert.equal((await fetch(base+route)).status,404);
    await new Promise(r=>app.server.close(r));
    app=createStudyServer({root,port:0});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
    const durable=(await call('/api/session',{resume_key:nonces[0]})).data;
    assert.equal(durable.completed_count,1);assert.equal(durable.trials[0].choice,'B');assert.equal(durable.participant_id,users[0].participant_id);
    await new Promise(r=>app.server.close(r));
    manifest.cases.reverse();fs.writeFileSync(path.join(root,'study-manifest.json'),JSON.stringify(manifest));
    assert.throws(()=>createStudyServer({root,port:0}),/cannot change/);
  }finally{
    if(app.server.listening)await new Promise(r=>app.server.close(r));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
