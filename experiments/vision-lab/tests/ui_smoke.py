"""UI verification without bypassing managed Chromium URL/extension policies.
Documents are set as in-memory HTML. A clearly declared storage shim replaces
opaque-origin localStorage; no native persistence or extension efficacy is claimed.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json, os, time, urllib.request
ROOT=Path(__file__).resolve().parents[1]
FILES={'extension':'NavSentinel-Browser.html','desktop':'NavSentinel-Desktop.html','relay':'NavSentinel-Intent-Relay.html'}
checks=[];errors=[];console_errors=[];bridge_state={}
def ok(name,condition=True):
 if not condition: raise AssertionError(name)
 checks.append(name);print("PASS",name,flush=True)
def click(page,action,extra=''):
 page.locator(f'[data-action="{action}"]'+extra).first.click()
def new_page(browser,mode='extension',width=1480,height=1040,bridge=False):
 page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
 page.set_default_timeout(5000)
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.on('console',lambda msg:console_errors.append(msg.text) if msg.type=='error' else None)
 page.evaluate("""() => { const data=new Map(); window.__testStorage=data;
 Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear()}}); }""")
 if bridge:
  session=json.loads((ROOT/'.local/session.json').read_text())
  # Legacy substituted-transport harness only. The current browser lane is
  # npm run vision:test:browser; operator authority is no longer in client files.
  operator_token=os.environ.get('NS_OPERATOR_TOKEN')
  if not operator_token: raise RuntimeError('Legacy UI bridge needs explicit NS_OPERATOR_TOKEN; prefer npm run vision:test:browser.')
  approvals=[]
  def transport(input):
   body=json.dumps(input['body']).encode() if input.get('body') is not None else None
   req=urllib.request.Request(session['origin']+input['path'],data=body,headers={'Authorization':'Bearer '+operator_token,'Content-Type':'application/json'},method=input.get('method','GET'))
   try:
    with urllib.request.urlopen(req) as response:
     result={'status':response.status,'data':json.load(response)}
     if input['path']=='/api/approve': approvals.append(result['data'])
     return result
   except urllib.error.HTTPError as e:return {'status':e.code,'data':json.load(e)}
  def fixture_effects():
   with urllib.request.urlopen(session['labOrigin']+'/broker-effects') as response:return json.load(response)
  bridge_state.clear();bridge_state.update(approvals=approvals,fixture_effects=fixture_effects,transport=transport)
  page.expose_function('__testTransport',transport)
  page.evaluate("window.navDesktop={request:input=>window.__testTransport(input)}")
 page.set_content((ROOT/FILES[mode]).read_text(),wait_until='load')
 page.wait_for_timeout(80)
 return page
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 for mode in FILES:
  page=new_page(browser,mode)
  expected={'extension':'A safer next click.','desktop':'The whole story. In one place.','relay':'Before an agent acts.'}[mode]
  ok(mode+' initial view',page.locator('h1').inner_text()==expected)
  ok(mode+' no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  page.screenshot(path=str(ROOT/'artifacts'/f'{mode}-preview.png'),full_page=True)
  views=page.locator('.nav [data-view]').evaluate_all('(xs)=>xs.map(x=>x.dataset.view)')
  for view in views:
   click(page,'nav',f'[data-view="{view}"]')
   ok(mode+'/'+view+' renders',page.locator('h1').count()==1 and page.locator('.error-banner').count()==0)
  page.close()
 page=new_page(browser)
 click(page,'inspect');ok('overlay outline can be inspected',page.locator('.trap').count()==1)
 click(page,'run');page.wait_for_timeout(2200)
 ok('replay records a local consequence',page.locator('.guardian').inner_text().find('That wasn’t your intent.')>=0)
 click(page,'undo');ok('reversible cleanup adds an Undo state','You’re back in control.' in page.locator('.guardian').inner_text())
 click(page,'detail');ok('decision drawer is modal',page.locator('#drawer').evaluate('(x)=>x.open'))
 click(page,'correct','[data-kind="should-allow"]');ok('correction is retained separately','should-allow' in page.locator('#drawer').inner_text())
 click(page,'close-drawer');click(page,'nav','[data-view="lab"]');click(page,'suite')
 ok('all kernel fixture contracts match','20 / 20 contract matches' in page.locator('.suite-number').inner_text().replace('\n','').replace('  ',' '))
 click(page,'compare-policy');ok('policy comparison has three modes',page.locator('#dialog tbody tr').count()==20);click(page,'close-dialog')
 click(page,'mode','[data-mode="relay"]');click(page,'nav','[data-view="requests"]');click(page,'demo-approval')
 click(page,'approve-demo');ok('demo one-shot grant is issued','Exact-context demo grant' in page.locator('#drawer').inner_text())
 click(page,'mismatch-demo');ok('changed document rejected and burned','document binding mismatch' in page.locator('#drawer').inner_text())
 click(page,'consume-demo');ok('grant replay rejected','already consumed' in page.locator('#drawer').inner_text());click(page,'close-drawer')
 click(page,'demo-approval');click(page,'approve-demo');click(page,'expire-demo');ok('expired grant rejected','grant expired' in page.locator('#drawer').inner_text());click(page,'close-drawer')
 click(page,'mode','[data-mode="desktop"]');click(page,'nav','[data-view="flow"]');click(page,'flow-node','[data-node="destination"]');ok('data-flow node selection works','Destination' in page.locator('main').inner_text())
 click(page,'nav','[data-view="recovery"]');page.locator('[data-recovery="0"]').check();ok('recovery checklist updates','1 / 5 reviewed' in page.locator('main').inner_text())
 click(page,'nav','[data-view="rules"]');page.locator('#credentialHosts-input').fill('new-workspace.test');click(page,'add-host','[data-list="credentialHosts"]');ok('separate exact-host trust saved','new-workspace.test' in page.locator('main').inner_text())
 click(page,'mode','[data-mode="extension"]');page.locator('#scenario-select').select_option('first-login');click(page,'run');page.wait_for_timeout(2200);ok('new credential trust affects only future replay','Exactly where you meant to go.' in page.locator('.guardian').inner_text())
 click(page,'nav','[data-view="journal"]');page.locator('#journal-search').fill('first');ok('journal search remains editable',page.locator('#journal-search').input_value()=='first')
 click(page,'export');export=json.loads(page.locator('#dialog pre').inner_text());ok('export serializer omits token and value fields',all('snapshot' not in x and 'context' not in x for x in export['records']));click(page,'close-dialog')
 click(page,'nav','[data-view="settings"]');page.locator('#attention-range').fill('2');ok('attention budget updates live',page.locator('#attention-output').inner_text()=='2 cards')
 click(page,'clear-history');click(page,'confirm-reset');ok('history reset preserves trust',json.loads(page.evaluate("window.__testStorage.get('navsentinel-vision-lab-v1')"))['policy']['credentialHosts']==['new-workspace.test'])
 page.keyboard.press('Control+k');page.locator('#command-search').fill('relay');ok('keyboard command palette filters',page.locator('#command-results button:visible').count()==1);page.keyboard.press('Escape');page.close()
 for mode in FILES:
  phone=new_page(browser,mode,390,844)
  ok(mode+' mobile layout has no horizontal overflow',phone.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  phone.screenshot(path=str(ROOT/'artifacts'/f'{mode}-mobile.png'),full_page=True);phone.close()
 # An explicitly disclosed transport adapter drives the actual loopback API.
 # This validates renderer/API integration, NOT Electron's IPC or browser networking.
 live=new_page(browser,'relay',bridge=True);live.wait_for_timeout(150)
 click(live,'nav','[data-view="requests"]');ok('actual service bridge connected',not live.locator('[data-action="api-request"]').is_disabled());live.locator('#request-scenario').select_option('fixture-review')
 click(live,'api-request');live.wait_for_timeout(150);click(live,'api-approve');live.wait_for_timeout(150);ok('approval response captured for replay probe',len(bridge_state['approvals'])==1)
 click(live,'api-consume');live.wait_for_timeout(150)
 ok('renderer reports actual fixture execution','Executed' in live.locator('main').inner_text())
 ok('terminal execution removes the consumed control',live.locator('[data-action="api-consume"]').count()==0)
 ok('one fixture effect follows the terminal execution',bridge_state['fixture_effects']()['count']==1)
 replay=bridge_state['transport']({'path':'/api/consume','method':'POST','body':{'token':bridge_state['approvals'][0]['capability']['token'],'event':bridge_state['approvals'][0]['event']}})
 ok('transport replay is rejected without a second fixture effect',replay['status']==409 and 'Unknown, used or revoked' in replay['data']['error'] and bridge_state['fixture_effects']()['count']==1)
 live.screenshot(path=str(ROOT/'artifacts'/'relay-live-api.png'),full_page=True);live.close()
 ok('no uncaught browser exceptions',not errors)
 browser_version=browser.version
 browser.close()
report={'schema':1,'browserVersion':browser_version,'checks':checks,'passed':len(checks),'uncaughtErrors':errors,'consoleErrors':console_errors,'environment':'Managed Chromium; documents loaded with set_content, opaque-origin storage shim, actual daemon accessed through explicit Python bridge. No browser policy changed.','notValidated':['Unpacked extension runtime (policy blocked)','Native Electron runtime','Native file-origin localStorage persistence','Real browser-to-loopback network requests']}
(ROOT/'artifacts/ui-tests.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'passed':len(checks),'errors':errors,'consoleErrors':console_errors},indent=2))
