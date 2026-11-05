"""TEST ONLY. Deterministic provider response; this does not transcribe speech."""
import json, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
    calls=0
    mode='normal'
    delay=0
    lock=threading.Lock()
    def log_message(self,*args):pass
    def send_json(self,status,value):
        data=json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path=='/stats':self.send_json(200,{'fixture':True,'calls':Handler.calls,'mode':Handler.mode})
        else:self.send_json(404,{'error':'fixture route missing'})
    def do_POST(self):
        size=int(self.headers.get('Content-Length',0))
        body=self.rfile.read(min(size,2200000))
        if self.path=='/control':
            value=json.loads(body or b'{}');Handler.mode=value.get('mode','normal');Handler.delay=float(value.get('delay',0));self.send_json(200,{'fixture':True});return
        if self.path!='/v1/audio/transcriptions':self.send_json(404,{'error':'fixture route missing'});return
        with Handler.lock:Handler.calls+=1
        if size>2200000 or b'RIFF' not in body or 'multipart/form-data' not in self.headers.get('Content-Type',''):
            self.send_json(422,{'error':'fixture requires WAV multipart'});return
        if Handler.delay:time.sleep(min(Handler.delay,15))
        if Handler.mode=='error':self.send_json(503,{'error':'fixture unavailable'});return
        if Handler.mode=='invalid':self.send_json(200,{'wrong':'fixture invalid'});return
        self.send_json(200,{'text':'' if Handler.mode=='empty' else 'Ik wil een afsprakenplatform voor coaches met een agenda en een klantomgeving.'})
ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
