"""Disposable *_test DB only; after api.py, reset the TEST auth_limits budget first."""
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
BASE=os.environ.get('DIARY_TEST_URL','http://127.0.0.1:8780')
assert urllib.parse.urlparse(BASE).hostname in ('127.0.0.1','localhost','::1')
ROOT=Path(__file__).resolve().parents[1]
PHP=os.environ.get('DIARY_TEST_PHP','php')

def state():
    code='''require $argv[1];if(!str_ends_with(config()['db']['name'],'_test'))exit(1);$s=db()->prepare('SELECT revision,data FROM training_history WHERE entry_date=? ORDER BY revision');$s->execute(['2031-01-01']);echo json_encode($s->fetchAll(),JSON_THROW_ON_ERROR);'''
    return json.loads(subprocess.check_output([PHP,'-r',code,str(ROOT/'private/bootstrap.php')]))
assert state()==[], 'Use a fresh disposable DB'
class Client:
    def __init__(self):
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf=self.call('session')['csrf']
    def call(self,action,data=None,status=200,csrf=True):
        headers={'Content-Type':'application/json'}
        if data is not None and csrf:headers['X-CSRF-Token']=self.csrf
        request=urllib.request.Request(BASE+'/api/index.php?action='+action,data=json.dumps(data).encode() if data is not None else None,headers=headers)
        try:r=self.opener.open(request,timeout=30)
        except urllib.error.HTTPError as e:r=e
        result=json.load(r);assert r.status==status,(action,r.status,result)
        if 'csrf' in result:self.csrf=result['csrf']
        return result
admin,visitor=Client(),Client()
admin.call('login',{'username':'owner','password':os.environ['DIARY_TEST_PASSWORD']})
training={'format':'diary-fit','version':1,'startTime':1893499200,'summary':{'distanceKm':0.6,'elapsedSeconds':60,'avgSpeedKmh':72,'maxSpeedKmh':90,'avgHeartRate':155,'maxHeartRate':170,'avgPower':220,'maxPower':500},'samples':[[0,36,150,0,0],[1,39.6,None,201,91],[3,43.2,152,None,92],[7,46.8,153,203,None],[60,50.4,154,204,94]]}
entry={'weight':'75','sleep':'8 ч','base':2000,'exercise':500,'meals':[{'group':'Утро','name':'Омлет','kcal':400}],'note':'FIT fixture'}
def save(revision,**extra):
    body={'date':'2031-01-01','entry':entry,'published':False,'revision':revision,**extra}
    return admin.call('save',body)
visitor.call('save',{'date':'2031-01-01','entry':entry,'published':True,'revision':None,'training':training},401)
admin.call('save',{'date':'2031-01-01','entry':entry,'published':False,'revision':None,'training':training},403,False)
for invalid in [{**training,'latitude':1},{**training,'samples':[[0,1,2,3,4],[0,2,3,4,5]]},{**training,'samples':[[0,'<script>',2,3,4]]}]:
    admin.call('save',{'date':'2031-01-01','entry':entry,'published':False,'revision':None,'training':invalid},422)
save(None,training=training)
assert admin.call('training&date=2031-01-01')['training']==training
assert admin.call('entries')['trainingDates']['2031-01-01'] is True
assert '2031-01-01' not in visitor.call('entries')['trainingDates']
visitor.call('training&date=2031-01-01',status=404)
save(1) # Old clients omitting training keep it.
assert admin.call('training&date=2031-01-01')['training']==training
replacement=copy.deepcopy(training);replacement['summary']['avgPower']=230
save(2,training=replacement)
admin.call('delete',{'date':'2031-01-01','revision':3})
admin.call('training&date=2031-01-01',status=404)
visitor.call('training&date=2031-01-01',status=404)
save(None) # Recreate without carrying over the deleted session.
admin.call('training&date=2031-01-01',status=404)
save(5,training=training)
save(6,training=None)
admin.call('training&date=2031-01-01',status=404)
save(7,training=training,published=True)
assert visitor.call('training&date=2031-01-01')['training']==training
admin.call('save',{'date':'2031-01-01','entry':entry,'published':True,'revision':7,'training':None},409)
assert visitor.call('training&date=2031-01-01')['training']==training
history=state();assert [row['revision'] for row in history]==list(range(1,8))
expected=[training,training,replacement,replacement,None,training,None]
assert [json.loads(row['data']) if row['data'] else None for row in history]==expected
export=admin.call('export');assert export['training']['2031-01-01']==training
assert export['entries']['2031-01-01']==entry
result=admin.call('import',{'entries':{'2031-01-02':entry},'training':{'2031-01-02':export['training']['2031-01-01']}});assert result['added']==1
assert admin.call('training&date=2031-01-02')['training']==training
visitor.call('training&date=2031-01-02',status=404)
result=admin.call('import',{'entries':{'2031-01-02':entry},'training':{'2031-01-02':replacement}});assert result['added']==0
assert admin.call('training&date=2031-01-02')['training']==training
admin.call('import',{'entries':{'2031-01-03':entry}})
admin.call('training&date=2031-01-03',status=404)
admin.call('import',{'entries':{'2031-01-04':entry,'2031-01-05':entry},'training':{'2031-01-04':training,'2031-01-05':{'format':'bad'}}},422)
assert '2031-01-04' not in admin.call('entries')['entries']
# New moving-time payloads allow pause-edge duplicates only across segment boundaries.
moving={'format':'diary-fit','version':2,'startTime':1893499200,'summary':{'distanceKm':0.004,'movingSeconds':4,'avgSpeedKmh':3.6,'maxSpeedKmh':3.6,'avgHeartRate':130,'maxHeartRate':130,'avgPower':0,'maxPower':0},'samples':[[0,3.6,130,0,0,0],[1,3.6,130,0,0,0],[2,3.6,130,0,0,0],[2,3.6,130,0,0,1],[3,3.6,130,0,0,1],[4,3.6,130,0,0,1]],'timing':{'source':'recording-gaps','timerSeconds':4}}
admin.call('save',{'date':'2031-01-06','entry':entry,'published':True,'revision':None,'training':moving})
assert visitor.call('training&date=2031-01-06')['training']==moving
assert 'elapsedSeconds' not in visitor.call('training&date=2031-01-06')['training']['summary']
for invalid in [dict(moving,timing={'source':'recording-gaps','timerSeconds':5}),dict(moving,samples=moving['samples'][:3]+[[2,3.6,130,0,0,0]]),dict(moving,summary={**moving['summary'],'elapsedSeconds':9})]:
    admin.call('save',{'date':'2031-01-06','entry':entry,'published':True,'revision':1,'training':invalid},422)
assert visitor.call('training&date=2031-01-06')['training']==moving
admin.call('import',{'entries':{'2031-01-07':entry},'training':{'2031-01-07':moving}})
assert admin.call('export')['training']['2031-01-07']==moving
assert admin.call('export')['training']['2031-01-01']==training # v1 backup data preserved verbatim.
print('PASS FIT API: auth/CSRF, GPS and malformed-data rejection, draft/public read isolation, persistence/replacement/removal, old-client compatibility, soft-delete/recreate, exact training history, revisions, JSON export/import without overwrites, atomic validation.')
