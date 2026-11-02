import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export function createApp(){return createServer((req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
 if(req.url==='/__cookie-check'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({cookies_received:!!req.headers.cookie}));return;}
 if(req.url==='/__build-proof'){try{res.end(readFileSync(new URL('./build-proof.txt',import.meta.url)));}catch{res.writeHead(404);res.end();}return;}
 if(req.url==='/__set-cookie'){res.writeHead(200,{'Set-Cookie':['office_session=forbidden; Domain=localhost; Path=/','app_session=allowed; Domain=localhost; Path=/']});res.end('cookies');return;}
 if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?'':readFileSync(new URL('./home.html',import.meta.url)));return;}
 res.writeHead(404);res.end('Not found');
});}
if(process.argv[1]===fileURLToPath(import.meta.url))createApp().listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0');
