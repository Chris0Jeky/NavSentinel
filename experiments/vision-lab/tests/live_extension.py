"""Run on an unmanaged local test machine; never changes browser/admin policy.
Starts isolated, ephemeral loopback fixtures and compares independent sink counts.
This is sensor-path verification, not a certification of popup UI/hostile-world security.
Requires Node and Python Playwright. CHROMIUM_PATH may select a local test browser.
"""
from pathlib import Path
import json, os, sys, tempfile, subprocess, time, hashlib, urllib.request
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/live-extension-tests.json'
def artifact_hash():
 h=hashlib.sha256()
 for f in sorted((ROOT/'extension').rglob('*')):
  if f.is_file():h.update(str(f.relative_to(ROOT)).encode());h.update(f.read_bytes())
 return h.hexdigest()
def write(report):
 report['extensionTreeSha256']=artifact_hash();OUT.write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
# Respect the environment's existing administrative restrictions.
policy_dir=Path('/etc/chromium/policies/managed')
if policy_dir.exists():
 for f in policy_dir.glob('*.json'):
  try:
   rules=json.loads(f.read_text())
   if '*' in rules.get('URLBlocklist',[]) or '*' in rules.get('ExtensionInstallBlocklist',[]):
    write({'status':'environment-blocked','testsExecuted':0,'reason':'Existing managed Chromium policy blocks URLs and/or extensions. No policy was changed.','evidenceCeiling':'No unpacked-extension efficacy result'});sys.exit(2)
  except (ValueError,OSError):pass
from playwright.sync_api import sync_playwright
results=[];proc=None
with tempfile.TemporaryDirectory(prefix='navsentinel-live-') as directory:
 temp=Path(directory);env={**os.environ,'PORT':'0','LAB_PORT':'0','NS_DATA_DIR':str(temp/'service')}
 log=(temp/'server.log').open('w');proc=subprocess.Popen(['node',str(ROOT/'daemon/server.cjs')],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  for _ in range(100):
   if (temp/'service/session.json').exists():break
   if proc.poll() is not None:raise RuntimeError('Fixture service failed to start')
   time.sleep(.1)
  session=json.loads((temp/'service/session.json').read_text());origin=session['labOrigin']
  def counts():
   with urllib.request.urlopen(origin+'/lab-state') as response:return json.load(response)['counts']
  with sync_playwright() as p:
   options={'headless':True}
   if os.environ.get('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
   baseline=p.chromium.launch(**options)
   extension=str(ROOT/'extension')
   guarded=p.chromium.launch_persistent_context(str(temp/'profile'),**options,args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'],viewport={'width':1200,'height':850})
   worker=guarded.service_workers[0] if guarded.service_workers else guarded.wait_for_event('serviceworker',timeout=15000)
   # Trusted harness activation. Popup permission UX remains a separate manual gate.
   worker.evaluate('async origin=>{await chrome.storage.local.set({enabledOrigins:[origin]});await syncRegistration([origin]);}',origin)
   cases=[('overlay','overlay'),('mismatch','navigation'),('credential','credential'),('benign','navigation'),('benign-form','navigation'),('survivor','credential')]
   for arm in ['baseline','guarded']:
    context=baseline.new_context(viewport={'width':1200,'height':850}) if arm=='baseline' else guarded
    for case,kind in cases:
     page=context.new_page();before=counts()[kind];page.goto(origin+'/?case='+case);page.wait_for_timeout(450)
     if case=='overlay':page.mouse.click(600,425)
     elif case=='mismatch':page.locator('#mismatch').click()
     elif case=='credential':page.locator('#submit').click()
     elif case=='benign':page.locator('#benign-link').click()
     elif case=='benign-form':page.locator('#benign-submit').click()
     else:page.locator('#programmatic').click()
     page.wait_for_timeout(300);delta=counts()[kind]-before
     expected=1 if arm=='baseline' or case in ['benign','benign-form','survivor'] else 0
     intended=case!='overlay' or arm!='guarded' or 'Video playing' in page.locator('#play-state').inner_text()
     results.append({'arm':arm,'case':case,'sink':kind,'arrivals':delta,'expectedArrivals':expected,'intendedEffectObserved':intended,'match':delta==expected and intended,'classification':'expected coverage survivor' if case=='survivor' else 'independent inert sink observation'})
     page.close()
    if arm=='baseline':context.close()
   version=baseline.version;baseline.close();guarded.close()
   write({'status':'pass' if all(r['match'] for r in results) else 'fail','browser':version,'testsExecuted':len(results),'results':results,'evidenceCeiling':'Exact-artifact sensor-path fixtures only. Popup UI, real-world efficacy, OS protection, and independent security audit remain unvalidated.'})
   if not all(r['match'] for r in results):sys.exit(1)
 except Exception as error:
  write({'status':'infrastructure-error','testsExecuted':len(results),'results':results,'error':str(error),'evidenceCeiling':'Incomplete browser verification; no efficacy claim'});sys.exit(2)
 finally:
  if proc and proc.poll() is None:
   proc.terminate()
   try:proc.wait(timeout=6)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
  log.close()
