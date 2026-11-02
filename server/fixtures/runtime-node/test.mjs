import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './server.mjs';
let server,base;
before(async()=>{server=createApp();await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
test('home serves a Russia travel page',async()=>{const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);assert.match(await r.text(),/Explore Russia/);});
test('unknown routes return 404',async()=>assert.equal((await fetch(base+'/missing')).status,404));
test('write methods are rejected',async()=>assert.equal((await fetch(base,{method:'POST'})).status,405));
