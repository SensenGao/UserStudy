import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomInt,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const here=path.dirname(fileURLToPath(import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const shuffle=items=>{for(let i=items.length-1;i>0;i--){const j=randomInt(i+1);[items[i],items[j]]=[items[j],items[i]];}return items;};
const opaque=()=>randomBytes(18).toString('base64url');
const sendJSON=(res,status,data,headers={})=>{const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}).end(body);};
async function bodyJSON(req){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Request too large');}
  return JSON.parse(body||'{}');
}
export function createStudyServer({root,port=8900,allowOrigins=[]}={}){
  if(!root)throw Error('STUDY_PRIVATE_ROOT must point outside the public repository');
  root=path.resolve(root);fs.mkdirSync(root,{recursive:true});
  if(root===here||root.startsWith(here+path.sep))throw Error('Private study data must be outside the public repository');
  const secretFile=path.join(root,'server-secret');
  if(!fs.existsSync(secretFile))fs.writeFileSync(secretFile,randomBytes(48).toString('hex'),{mode:0o600,flag:'wx'});
  const secret=fs.readFileSync(secretFile,'utf8');
  const db=new DatabaseSync(path.join(root,'study.sqlite'));
  db.exec(fs.readFileSync(path.join(here,'schema.sql'),'utf8'));
  const manifestFile=path.join(root,'study-manifest.json');
  let manifest={cases:[],active:false},lastManifest='';
  function refresh(){
    if(!fs.existsSync(manifestFile))return;
    const text=fs.readFileSync(manifestFile,'utf8');if(text===lastManifest)return;
    const incoming=JSON.parse(text);
    if(incoming.cases.length!==50||new Set(incoming.cases.map(c=>c.id)).size!==50)throw Error('Study requires exactly50 unique cases');
    const existing=db.prepare('SELECT COUNT(*) AS n FROM participants').get().n;
    const fingerprint=digest(JSON.stringify(incoming.cases));
    const priorHash=db.prepare("SELECT value FROM settings WHERE key='manifest_hash'").get()?.value;
    if(existing&&priorHash&&priorHash!==fingerprint)throw Error('A live study cannot change its fixed cases');
    db.exec('BEGIN IMMEDIATE');
    try{
      const q=db.prepare('INSERT INTO cases(id,reference_path,first_path,second_path,duration) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET reference_path=excluded.reference_path,first_path=excluded.first_path,second_path=excluded.second_path,duration=excluded.duration');
      for(const c of incoming.cases)q.run(c.id,c.reference,c.first,c.second,c.duration);
      db.prepare("INSERT INTO settings(key,value) VALUES('manifest_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(fingerprint);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    manifest=incoming;lastManifest=text;
  }
  try{refresh();}catch(error){db.close();throw error;}
  function ready(){refresh();return manifest.active&&manifest.cases.length===50&&manifest.cases.every(c=>[c.reference,c.first,c.second].every(p=>fs.existsSync(p)));}
  const hmac=s=>createHmac('sha256',secret).update(s).digest('base64url');
  function participant(req){
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    return token?db.prepare('SELECT id FROM participants WHERE token_hash=?').get(digest(token)):null;
  }
  function mediaURL(assignment,slot){
    const expiry=Math.floor(Date.now()/1000)+86400;
    return `/api/media/${assignment}/${slot}?expires=${expiry}&sig=${hmac(assignment+'|'+slot+'|'+expiry)}`;
  }
  function responseFor(id,token){
    const rows=db.prepare('SELECT a.id,a.ordinal,c.duration,v.choice FROM assignments a JOIN cases c ON c.id=a.case_id LEFT JOIN votes v ON v.assignment_id=a.id WHERE a.participant_id=? ORDER BY a.ordinal').all(id);
    return {participant_id:id,token,trial_count:rows.length,completed_count:rows.filter(r=>r.choice).length,
      trials:rows.map(r=>({id:r.id,ordinal:r.ordinal,duration:r.duration,choice:r.choice??null,
        reference:mediaURL(r.id,'reference'),A:mediaURL(r.id,'A'),B:mediaURL(r.id,'B')}))};
  }
  function session(nonce){
    if(typeof nonce!=='string'||!/^[a-zA-Z0-9_-]{32,160}$/.test(nonce))throw Error('Invalid resume key');
    const token=hmac('session|'+nonce),nh=digest(nonce);
    const prior=db.prepare('SELECT id FROM participants WHERE nonce_hash=?').get(nh);
    if(prior)return responseFor(prior.id,token);
    const id='U-'+randomBytes(6).toString('hex').toUpperCase();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO participants(id,nonce_hash,token_hash) VALUES(?,?,?)').run(id,nh,digest(token));
      // The immediate transaction balances exposures across concurrent participants.
      const rows=db.prepare('SELECT id FROM cases ORDER BY assignments ASC,RANDOM() LIMIT 10').all();
      if(rows.length!==10)throw Error('Ten cases are required');
      shuffle(rows);const flips=shuffle([0,0,0,0,0,1,1,1,1,1]);
      rows.forEach((c,i)=>{
        db.prepare('INSERT INTO assignments(id,participant_id,case_id,ordinal,flip) VALUES(?,?,?,?,?)').run(opaque(),id,c.id,i+1,flips[i]);
        db.prepare('UPDATE cases SET assignments=assignments+1 WHERE id=?').run(c.id);
      });
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return responseFor(id,token);
  }
  function streamFile(req,res,file,type='video/mp4'){
    const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
    const headers={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':type==='video/mp4'?'private,max-age=3600':'no-cache','X-Content-Type-Options':'nosniff'};
    if(req.headers.range){
      const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!m){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
      if(m[1]==='')start=Math.max(0,size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
      if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length']=end-start+1;res.writeHead(status,headers);
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
      const origin=req.headers.origin;
      const own=new Set(allowOrigins);own.add('http://127.0.0.1:'+port);own.add('http://localhost:'+port);
      const forwarded=req.headers['x-forwarded-proto']==='https'?'https':'http';own.add(forwarded+'://'+req.headers.host);
      if(origin&&own.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,HEAD,POST,OPTIONS');}
      if(req.method==='OPTIONS'){res.writeHead(origin&&own.has(origin)?204:403).end();return;}
      if(req.method==='POST'&&origin&&!own.has(origin)){sendJSON(res,403,{error:'Origin not allowed'});return;}
      if(url.pathname==='/api/meta'){sendJSON(res,200,{active:ready(),pair_count:50,trials_per_participant:10});return;}
      if(url.pathname==='/api/session'&&req.method==='POST'){
        if(!ready()){sendJSON(res,503,{error:'The study is being prepared. Please return later.'});return;}
        const b=await bodyJSON(req);sendJSON(res,200,session(b.resume_key));return;
      }
      if(url.pathname==='/api/session'&&req.method==='GET'){
        const p=participant(req);if(!p){sendJSON(res,401,{error:'Session required'});return;}
        sendJSON(res,200,responseFor(p.id));return;
      }
      if(url.pathname==='/api/vote'&&req.method==='POST'){
        const p=participant(req);if(!p){sendJSON(res,401,{error:'Session required'});return;}
        const b=await bodyJSON(req);
        const a=db.prepare('SELECT id FROM assignments WHERE id=? AND participant_id=?').get(b.assignment_id,p.id);
        if(!a||!['A','B'].includes(b.choice)){sendJSON(res,400,{error:'Invalid vote'});return;}
        const elapsed=Math.max(0,Math.min(3600000,Number(b.elapsed_ms)||0));
        db.prepare('INSERT INTO votes(assignment_id,choice,elapsed_ms) VALUES(?,?,?) ON CONFLICT(assignment_id) DO UPDATE SET choice=excluded.choice,elapsed_ms=excluded.elapsed_ms,updated_at=CURRENT_TIMESTAMP').run(a.id,b.choice,elapsed);
        sendJSON(res,200,{saved:true,assignment_id:a.id,choice:b.choice});return;
      }
      const media=/^\/api\/media\/([a-zA-Z0-9_-]+)\/(reference|A|B)$/.exec(url.pathname);
      if(media&&['GET','HEAD'].includes(req.method)){
        const [,id,slot]=media,expiry=Number(url.searchParams.get('expires'));
        if(!Number.isInteger(expiry)||expiry<Math.floor(Date.now()/1000)||!equal(url.searchParams.get('sig'),hmac(id+'|'+slot+'|'+expiry))){res.writeHead(403).end();return;}
        const row=db.prepare('SELECT a.flip,c.reference_path,c.first_path,c.second_path FROM assignments a JOIN cases c ON c.id=a.case_id WHERE a.id=?').get(id);
        if(!row){res.writeHead(404).end();return;}
        const file=slot==='reference'?row.reference_path:((slot==='A')!==!!row.flip?row.first_path:row.second_path);
        streamFile(req,res,file);return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/config.js':'config.js'};
      const name=files[url.pathname];if(!name){res.writeHead(404).end('Not found');return;}
      const type=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
      if(name==='index.html')res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https:; media-src 'self' https:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      streamFile(req,res,path.join(here,name),type);
    }catch(error){console.error('Request failed:',error.message);if(!res.headersSent)sendJSON(res,400,{error:'Request could not be processed'});else res.destroy();}
  });
  server.on('close',()=>db.close());
  return {server,db,ready};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.STUDY_PORT||8900);
  const {server}=createStudyServer({root:process.env.STUDY_PRIVATE_ROOT,port,allowOrigins:['https://sensengao.github.io']});
  server.listen(port,process.env.STUDY_HOST||'127.0.0.1',()=>console.log('Study server: http://127.0.0.1:'+port));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>process.exit(0)));
}
