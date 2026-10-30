#!/usr/bin/env python3
"""Local folder picker and bounded file bridge; no Docker socket or shell tool access."""
import hashlib, hmac, json, os, queue, secrets, stat, sys, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_FILE=256*1024
SKIP={'node_modules','target','dist','vendor','__pycache__','references','inputs','result.md','auth.json','credentials.json'}
def safe(path):
    return isinstance(path,str) and 0<len(path.encode())<=240 and all(p and not p.startswith('.') and p not in SKIP and '\\' not in p and not any(ord(c)<32 or ord(c)==127 for c in p) and not p.lower().endswith(('.pem','.key','.p12','.pfx')) for p in path.split('/'))
def digest(data):return hashlib.sha256(data).hexdigest()
class Bridge:
    def __init__(self,state,fixture=False):
        self.state=Path(state);self.state.mkdir(parents=True,exist_ok=True,mode=0o700);self.fixture=fixture;self.lock=threading.RLock();self.picking=threading.Lock()
        self.file=self.state/'folders.json'
        self.data=json.loads(self.file.read_text()) if self.file.exists() else {'bridge_id':str(uuid.uuid4()),'folders':{},'snapshots':{}}
        self.save()
    def save(self):
        tmp=self.state/'registry.tmp';tmp.write_text(json.dumps(self.data));tmp.chmod(0o600);tmp.replace(self.file)
    def register(self,path,owner):
        root=Path(path).resolve(strict=True)
        # Selecting a whole disk, home, or the bridge's private state is almost certainly accidental.
        if root==Path('/') or root==Path.home() or root==self.state.resolve() or self.state.resolve().is_relative_to(root):raise ValueError('Choose a project folder, rather than a whole disk or home folder')
        st=root.stat();key=str(uuid.uuid4());self.data['folders'][key]={'path':str(root),'owner':owner,'dev':st.st_dev,'ino':st.st_ino};self.save()
        return {'id':key,'path':str(root),'bridge_id':self.data['bridge_id']}
    def folder(self,b):
        f=self.data['folders'].get(b.get('id'))
        if not f or f['owner']!=b.get('owner') or b.get('bridge_id')!=self.data['bridge_id']:raise ValueError('Folder selection belongs to another user or computer')
        fd=os.open(f['path'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        st=os.fstat(fd)
        if (st.st_dev,st.st_ino)!=(f['dev'],f['ino']):os.close(fd);raise ValueError('Selected folder moved or was replaced; select it again')
        return fd,f
    def parent(self,root,path,create=False):
        if not safe(path):raise ValueError('Unsafe project file path')
        parts=path.split('/');fd=os.dup(root)
        try:
            for p in parts[:-1]:
                if create:
                    try:os.mkdir(p,mode=0o755,dir_fd=fd)
                    except FileExistsError:pass
                nxt=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=nxt
            return fd,parts[-1]
        except:os.close(fd);raise
    def read(self,root,path):
        try:fd,name=self.parent(root,path)
        except FileNotFoundError:return None
        try:
            try:f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
            except FileNotFoundError:return None
            with os.fdopen(f,'rb') as stream:
                st=os.fstat(stream.fileno())
                if not stat.S_ISREG(st.st_mode) or st.st_size>MAX_FILE:raise ValueError('Unsupported file type or size')
                data=stream.read(MAX_FILE+1)
                if len(data)>MAX_FILE or b'\0' in data:raise ValueError('Unsupported file type or size')
                data.decode('utf-8');return data
        finally:os.close(fd)
    def scan(self,root):
        files={};total=0;visited=0
        def walk(fd,prefix='',depth=0):
            nonlocal total,visited
            if depth>8:raise ValueError('Select a smaller project folder: nesting exceeds eight levels')
            with os.scandir(fd) as entries:
                for e in entries:
                    visited+=1
                    if visited>4000:raise ValueError('Select a smaller project folder: too many entries')
                    path=prefix+e.name
                    if not safe(path) or e.is_symlink():continue
                    if e.is_dir(follow_symlinks=False):
                        sub=os.open(e.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                        try:walk(sub,path+'/',depth+1)
                        finally:os.close(sub)
                    elif e.is_file(follow_symlinks=False):
                        try:data=self.read(root,path)
                        except (OSError,ValueError,UnicodeError):continue
                        if data is None:continue
                        total+=len(data)
                        if len(files)>=200 or total>2*1024*1024:raise ValueError('Select a smaller project folder: maximum 200 text files / 2 MiB')
                        files[path]=data
        walk(root);return files
    def handle(self,route,b):
        if route=='/status':return {'ready':True,'bridge_id':self.data['bridge_id'],'platform':sys.platform}
        if route=='/pick':
            if not self.picking.acquire(blocking=False):raise ValueError('Another folder picker is open')
            try:
                if self.fixture:
                    root=self.state/('fixture-'+uuid.uuid4().hex);root.mkdir();(root/'hello.txt').write_text('EXISTING_PROJECT_FILE')
                elif sys.platform=='darwin':
                    selected=self.picker()
                    if not selected:raise ValueError('Folder selection cancelled or unavailable')
                    root=Path(selected)
                else:raise ValueError('Native folder picker currently supports macOS only')
                with self.lock:return self.register(root,b['owner'])
            finally:self.picking.release()
        with self.lock:
            root,f=self.folder(b)
            try:
                if route=='/validate':return {'id':b['id'],'path':f['path'],'bridge_id':self.data['bridge_id']}
                if route=='/snapshot':
                    files=self.scan(root);sid=secrets.token_hex(24)
                    self.data['snapshots'][sid]={'id':b['id'],'owner':b['owner'],'hashes':{p:digest(v) for p,v in files.items()}}
                    # Bounded metadata; an outstanding snapshot can expire and fail safely.
                    while len(self.data['snapshots'])>1000:self.data['snapshots'].pop(next(iter(self.data['snapshots'])))
                    self.save();return {'snapshot_id':sid,'files':[{'path':p,'content':v.decode()} for p,v in sorted(files.items())]}
                if route=='/publish':
                    snap=self.data['snapshots'].get(b.get('snapshot_id'))
                    if not snap or snap['id']!=b['id'] or snap['owner']!=b['owner']:raise ValueError('Project snapshot unavailable')
                    files=b.get('files');total=0;changes={}
                    if not isinstance(files,list) or len(files)>20:raise ValueError('Maximum twenty changed files')
                    for item in files:
                        p=item['path'];v=item['content'].encode();total+=len(v)
                        if not safe(p) or p in changes or len(v)>MAX_FILE or total>1024*1024 or b'\0' in v:raise ValueError('Invalid project output')
                        old=self.read(root,p)
                        if (digest(old) if old is not None else None)!=snap['hashes'].get(p):raise ValueError('Original file changed while agent worked; output retained in task files')
                        changes[p]=v
                    for p,v in changes.items():
                        fd,name=self.parent(root,p,True);temp='.office-'+uuid.uuid4().hex
                        try:
                            # Preserve executable/mode bits of existing regular files.
                            try:mode=stat.S_IMODE(os.stat(name,dir_fd=fd,follow_symlinks=False).st_mode)&0o777
                            except FileNotFoundError:mode=0o644
                            out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode,dir_fd=fd)
                            with os.fdopen(out,'wb') as stream:os.fchmod(stream.fileno(),mode);stream.write(v);stream.flush();os.fsync(stream.fileno())
                            os.replace(temp,name,src_dir_fd=fd,dst_dir_fd=fd)
                        finally:
                            try:os.unlink(temp,dir_fd=fd)
                            except FileNotFoundError:pass
                            os.close(fd)
                    del self.data['snapshots'][b['snapshot_id']];self.save();return {'saved':len(changes)}
                raise ValueError('Unknown bridge request')
            finally:os.close(root)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass # Never log tokens, host paths or file contents.
    def do_POST(self):
        if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+self.server.token):self.reply(403,{'error':'Bridge authorization required'});return
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n<=0 or n>4*1024*1024:raise ValueError('Invalid bridge request size')
            body=json.loads(self.rfile.read(n));result=self.server.bridge.handle(self.path,body);self.reply(200,result)
        except Exception as e:self.reply(400,{'error':str(e) if isinstance(e,ValueError) else 'Local folder operation failed'})
    def reply(self,status,body):
        data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
if __name__=='__main__':
    state=Path(os.environ.get('OFFICE_BRIDGE_STATE',str(Path(__file__).resolve().parents[1]/'.local/project-bridge')))
    fixture=os.environ.get('OFFICE_BRIDGE_FIXTURE')=='1'
    if fixture and os.environ.get('ALLOW_TEST_WORKER')!='1':raise RuntimeError('Fixture bridge requires explicit test opt-in')
    bridge=Bridge(state,fixture)
    token=os.environ.get('PROJECT_BRIDGE_TOKEN') if fixture else (state/'token').read_text().strip()
    if not token or len(token)<24:raise RuntimeError('Bridge token is not configured')
    server=ThreadingHTTPServer(('0.0.0.0' if fixture else '127.0.0.1',18089),Handler);server.bridge=bridge;server.token=token
    if fixture:server.serve_forever()
    else:
        # The native panel runs INSIDE the bridge process on the macOS main thread.
        # An osascript subprocess would not transfer its selected-folder access to Python.
        import tkinter as tk
        from tkinter import filedialog
        window=tk.Tk();window.withdraw();requests=queue.Queue()
        def choose():
            done=threading.Event();result=[];requests.put((done,result))
            if not done.wait(125):raise ValueError('Folder selection timed out')
            return result[0]
        bridge.picker=choose
        def poll():
            try:done,result=requests.get_nowait()
            except queue.Empty:pass
            else:
                try:result.append(filedialog.askdirectory(parent=window,title='Agent Office: Choose the project folder AI may read and edit',mustexist=True))
                except Exception:result.append('')
                finally:done.set()
            window.after(100,poll)
        threading.Thread(target=server.serve_forever,daemon=True).start();window.after(100,poll);window.mainloop()
