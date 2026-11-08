"""Integration suite: ONLY against an empty disposable database; see README.
DIARY_TEST_URL, DIARY_TEST_SETUP_TOKEN, DIARY_TEST_PASSWORD must be set.
"""
import http.cookiejar
import json
import os
import urllib.error
import urllib.request

BASE = os.environ.get('DIARY_TEST_URL', 'http://127.0.0.1:8780')
TOKEN = os.environ['DIARY_TEST_SETUP_TOKEN']
PASSWORD = os.environ['DIARY_TEST_PASSWORD']

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ''
    def call(self, action, data=None, status=200, csrf=True, origin=None, method=None):
        headers = {}
        if data is not None:
            headers = {'Content-Type':'application/json'}
            if csrf: headers['X-CSRF-Token'] = self.csrf
        if origin: headers['Origin'] = origin
        request = urllib.request.Request(BASE+'/api/index.php?action='+action, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        try: response = self.opener.open(request)
        except urllib.error.HTTPError as error: response = error
        body = response.read()
        assert response.status == status, (action, response.status, status, body[:200])
        result = json.loads(body)
        if 'csrf' in result: self.csrf = result['csrf']
        assert 'no-store' in response.headers['Cache-Control']
        return result

admin, visitor = Client(), Client()
admin.call('session');visitor.call('session')
assert visitor.call('entries')['entries'] == {}
entry = {'weight':'75,5','sleep':'8 ч','base':2000,'exercise':500,'meals':[{'group':'Утро','name':'Омлет','kcal':400}], 'garmin':'https://connect.garmin.com/modern/activity/123456789','note':'<img src=x onerror=alert(1)>', 'training':{'distance':'42'}, 'custom':{'preserve':True}}
payload = {'date':'2026-11-07','entry':entry,'published':True,'revision':None}
for action, data in [('save',payload),('delete',{'date':'2026-11-07'}),('import',{'entries':{'2026-11-07':entry}})]:
    visitor.call(action,data,status=401)
visitor.call('export',status=401)
admin.call('setup',{'token':'0'*64,'username':'owner','password':PASSWORD},status=403)
admin.call('setup',{'token':TOKEN,'username':'owner','password':PASSWORD},status=201)
admin.call('setup',{'token':TOKEN,'username':'another','password':PASSWORD},status=409)
admin.call('login',{'username':'owner','password':'wrong-password-long'},status=401)
admin.call('login',{'username':"owner' OR 1=1 --",'password':PASSWORD},status=422)
old_cookie = next(iter(admin.jar)).value
admin.call('login',{'username':'owner','password':PASSWORD})
assert old_cookie != next(iter(admin.jar)).value
cookie = next(iter(admin.jar));assert cookie.has_nonstandard_attr('HttpOnly');assert cookie.get_nonstandard_attr('SameSite') == 'Strict'
admin.call('save',payload,status=403,csrf=False)
admin.call('save',payload,status=403,origin='https://attacker.example')
admin.call('save',payload,status=405,method='GET')
admin.call('save',{**payload,'date':'2026-02-30'},status=422)
admin.call('save',payload)
assert visitor.call('entries')['entries']['2026-11-07']['weight']=='75,5'
assert 'custom' not in visitor.call('entries')['entries']['2026-11-07']
admin.call('save',{**payload,'entry':{**entry,'weight':'74'},'revision':None},status=409)
admin.call('save',{**payload,'entry':{**entry,'weight':'75'},'revision':1,'published':False})
assert visitor.call('entries')['entries']=={}
assert admin.call('entries')['entries']['2026-11-07']['custom']==entry['custom']
admin.call('save',{**payload,'revision':1},status=409)
imp = {'2026-11-07':{**entry,'weight':'1'},'2026-11-05':{**entry,'weight':'76'},'2026-11-09':{**entry,'weight':'75'}}
result = admin.call('import',{'entries':imp});assert result['added']==2;assert result['skipped']==['2026-11-07']
result = admin.call('import',{'entries':imp});assert result['added']==0
assert visitor.call('entries')['entries']=={}
backup=admin.call('export');assert len(backup['entries'])==3;assert backup['entries']['2026-11-07']['weight']=='75';assert backup['entries']['2026-11-07']['training']==entry['training']
admin.call('import',{'entries':{'2026-11-01':entry,'2026-11-02':{'meals':'invalid'}}},status=422)
assert '2026-11-01' not in admin.call('entries')['entries']
admin.call('save',{**payload,'entry':{**entry,'weight':'75'},'published':True,'revision':2})
admin.call('delete',{'date':'2026-11-09','revision':1})
result=admin.call('import',{'entries':{'2026-11-09':entry}});assert result['added']==0
assert '2026-11-09' not in admin.call('entries')['entries']
admin.call('logout',{})
admin.call('delete',{'date':'2026-11-07','revision':3},status=401)
# Always reject wrong login after throttling budget, including new sessions on same address.
for _ in range(10):
    try:
        result=visitor.call('login',{'username':'owner','password':'wrong-password-long'},status=401)
    except AssertionError as exc:
        if "429" not in str(exc): raise
        break
else: raise AssertionError('Rate limit not enforced')
print('PASS API: setup once, password login, session rotation, cookie flags, auth/CSRF/origin/method checks, SQL input rejection, drafts/public reads, conflict detection, import without overwrite, all-or-nothing validation, export, soft deletion, logout, login rate limit.')
