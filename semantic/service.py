import json,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from sentence_transformers import SentenceTransformer
import torch
torch.set_num_threads(2)
model=SentenceTransformer('/models/office-embedding',local_files_only=True)
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,status,body):
  data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_GET(self):self.send(200,{'ready':True,'model':'paraphrase-multilingual-MiniLM-L12-v2','dimension':384})
 def do_POST(self):
  try:
   n=int(self.headers.get('Content-Length','0'))
   if self.path!='/embed' or n<1 or n>1048576:return self.send(400,{'error':'Invalid request'})
   texts=json.loads(self.rfile.read(n))['texts']
   if not isinstance(texts,list) or not 1<=len(texts)<=32 or any(not isinstance(t,str) or len(t)>8000 for t in texts):return self.send(400,{'error':'Invalid text batch'})
   with lock:v=model.encode(texts,normalize_embeddings=True).tolist()
   self.send(200,{'vectors':v})
  except Exception:self.send(500,{'error':'Embedding unavailable'})
ThreadingHTTPServer(('0.0.0.0',8090),Handler).serve_forever()
