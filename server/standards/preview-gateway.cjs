// Trusted Runner gateway. Never executes project source or mounts project files.
const http = require('node:http');
const expected = process.env.PREVIEW_HOST;
const hop = ['connection','proxy-connection','keep-alive','upgrade','trailer','transfer-encoding','proxy-authorization'];
const server = http.createServer((req,res)=>{
 if(req.headers.host!==expected){res.writeHead(421,{'Content-Type':'text/plain'});res.end('Use the unique preview .localhost address shown in Office.');return;}
 if(req.method==='CONNECT'||Number(req.headers['content-length']||0)>1048576){res.writeHead(413);res.end();return;}
 const headers={...req.headers};for(const key of hop)delete headers[key];
 if(headers.cookie){headers.cookie=headers.cookie.split(';').filter(s=>s.split('=')[0].trim()!=='office_session').join('; ');if(!headers.cookie)delete headers.cookie;}
 let bytes=0;const deadline=setTimeout(()=>{upstream.destroy();res.destroy();},15000);
 const upstream=http.request({hostname:'app',port:3000,path:req.url,method:req.method,headers},reply=>{
  const out={...reply.headers};for(const key of hop)delete out[key];
  if(out['set-cookie'])out['set-cookie']=out['set-cookie'].filter(s=>s.split('=')[0].trim()!=='office_session').map(s=>s.split(';').filter(p=>!p.trim().toLowerCase().startsWith('domain=')).join(';'));
  res.writeHead(reply.statusCode||502,out);let received=0;reply.on('data',chunk=>{received+=chunk.length;if(received>10485760){reply.destroy();res.destroy();}});reply.pipe(res);reply.on('end',()=>clearTimeout(deadline));
 });
 upstream.on('error',()=>{clearTimeout(deadline);if(!res.headersSent)res.writeHead(502);res.end('Preview application unavailable');});
 req.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576){upstream.destroy();req.destroy();}});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
server.maxConnections=64;server.headersTimeout=5000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
server.on('upgrade',(_req,socket)=>socket.destroy());server.listen(3000,'0.0.0.0');
