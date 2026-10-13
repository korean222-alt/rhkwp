import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('lens-consent','1');localStorage.setItem('lens-settings',JSON.stringify({schemaVersion:4,model:'tiny',language:'korean',device:'wasm',snapshotMode:'manual'}));});
 await page.goto('http://127.0.0.1:5175/'); const start=Date.now();
 const chooser=page.waitForEvent('filechooser'); await page.getByRole('button',{name:/파일 가져오기/}).click(); await(await chooser).setFiles('tests/fixtures/korean.wav');
 let finished=false;
 for(let n=0;n<240;n++){
  const done=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('lecturelens-v1');r.onsuccess=()=>resolve(r.result);});const sessions=await new Promise(resolve=>{const r=db.transaction('sessions').objectStore('sessions').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return sessions.some(s=>s.status==='complete'&&s.asrRate>0);});
  if(done){finished=true;break;} await page.waitForTimeout(1000);
 }
 if(!finished)throw Error('Actual ASR did not complete in four minutes');
 const data=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('lecturelens-v1');r.onsuccess=()=>resolve(r.result);});const get=name=>new Promise(resolve=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);});const sessions=await get('sessions'),rows=await get('transcripts'),chunks=await get('chunks');db.close();return {session:sessions[0],transcripts:rows.map(r=>r.text),pcmSamples:chunks.reduce((n,c)=>n+c.samples.length,0)};});
 if(!data.transcripts.some(t=>/[가-힣]/.test(t))||!data.session.asrRate||data.pcmSamples!==0||errors.length)throw Error('Unexpected actual ASR result: '+JSON.stringify({data,errors}));
 await page.locator('.progress-panel').waitFor(); await page.locator('.progress-panel').screenshot({path:'../lecturelens-asr-progress.png'}).catch(()=>{});
 await mkdir('qa-results',{recursive:true}); const report={elapsedMs:Date.now()-start,...data,errors}; await writeFile('qa-results/progress-pipeline.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
}finally{await browser.close();}
