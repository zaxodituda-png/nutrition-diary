"""Read-only summary permissions plus FIT lifecycle; isolated *_test DB after api.py."""
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
BASE = os.environ.get('DIARY_TEST_URL', 'http://127.0.0.1:8780')
assert urllib.parse.urlparse(BASE).hostname in ('127.0.0.1', 'localhost', '::1')
ROOT = Path(__file__).resolve().parents[1]
PHP = os.environ.get('DIARY_TEST_PHP', 'php')
class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf = self.call('session')['csrf']
    def call(self, action, data=None, status=200):
        request = urllib.request.Request(BASE+'/api/index.php?action='+action,
            data=None if data is None else json.dumps(data).encode(),
            headers={'Content-Type':'application/json', 'X-CSRF-Token':self.csrf if hasattr(self,'csrf') else ''})
        try: response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error: response = error
        result = json.load(response)
        assert response.status == status, (action, response.status, result)
        if 'csrf' in result: self.csrf = result['csrf']
        return result

def inspect(extra=''):
    code = '''require $argv[1];if(!str_ends_with(config()['db']['name'],'_test'))exit(1);
    $s=db()->query("SELECT e.entry_date,e.revision,e.published,e.deleted_at,t.data FROM diary_entries e LEFT JOIN training_sessions t USING(entry_date) WHERE e.entry_date BETWEEN '2033-01-01' AND '2033-01-31' ORDER BY e.entry_date");$rows=$s->fetchAll();
    $s=db()->query("SELECT h.entry_date,h.revision,h.action,h.published,t.data FROM entry_history h LEFT JOIN training_history t USING(entry_date,revision) WHERE h.entry_date BETWEEN '2033-01-01' AND '2033-01-31' ORDER BY h.entry_date,h.revision");$history=$s->fetchAll();
    ''' + extra + '''echo json_encode(['rows'=>$rows,'history'=>$history],JSON_THROW_ON_ERROR);'''
    return json.loads(subprocess.check_output([PHP, '-r', code, str(ROOT/'private/bootstrap.php')]))
assert inspect()['rows'] == [], 'Clean disposable test DB required'
a, v = Client(), Client()
a.call('login', {'username':'owner','password':os.environ['DIARY_TEST_PASSWORD']})
entry = {'weight':'75,5','sleep':'7 ч 15 мин','base':2000,'exercise':500,'meals':[],'note':'Synthetic analytics fixture'}
training = {'format':'diary-fit','version':2,'startTime':1893499200,
    'summary':{'distanceKm':0.004,'movingSeconds':4,'avgSpeedKmh':3.6,'maxSpeedKmh':3.6,'avgHeartRate':130,'maxHeartRate':130,'avgPower':0,'maxPower':0},
    'samples':[[0,3.6,130,0,0,0],[4,3.6,130,0,0,0]],'timing':{'source':'session-timer','timerSeconds':4}}
legacy = copy.deepcopy(training);legacy['version']=1;legacy.pop('timing');legacy['summary']['elapsedSeconds']=legacy['summary'].pop('movingSeconds');legacy['samples']=[row[:5] for row in legacy['samples']]
def save(day, revision=None, published=True, **extra):
    return a.call('save', {'date':f'2033-01-{day:02}','entry':entry,'revision':revision,'published':published,**extra})
for d in [2,4,5,10]: save(d, published=d!=4, training=training)
save(3,training=legacy)
zero=copy.deepcopy(training);zero['summary']={key:0 if key in ('distanceKm','movingSeconds') else None for key in zero['summary']};zero['samples']=[];zero['timing']['timerSeconds']=0
save(6,training=zero);save(7)
a.call('delete',{'date':'2033-01-05','revision':1})
query='training-summaries&end=2033-01-09'
before=inspect();public=v.call(query);private=a.call(query)
assert public['start']=='2033-01-03' and public['end']=='2033-01-09'
assert public['trainingSummaries']=={'2033-01-03':{'distanceKm':0.004,'movingSeconds':None},'2033-01-06':{'distanceKm':0,'movingSeconds':0}}
assert set(private['trainingSummaries'])=={'2033-01-03','2033-01-04','2033-01-06'}
assert private['trainingSummaries']['2033-01-04']=={'distanceKm':0.004,'movingSeconds':4}
assert len(json.dumps(private))<600
assert inspect()==before, 'Read endpoint must not mutate revisions/history'
for end in ['','2033-02-30','2033-1-9','not-a-date','2033-01-09%27%20OR%201=1']:
    v.call('training-summaries&end='+end,status=422)
v.call(query,{},405)
# Manual physical DELETE correctly fails due to FK; website soft-delete must still work.
inspect('''db()->beginTransaction();try{db()->exec("DELETE FROM diary_entries WHERE entry_date='2033-01-04'");throw new RuntimeException('FK unexpectedly absent');}catch(PDOException $e){if(($e->errorInfo[1]??0)!==1451)throw $e;}finally{db()->rollBack();}''')
# Edit, replace FIT, remove, reattach, delete, recreate, then edit again.
save(4,1,False);replacement=copy.deepcopy(training);replacement['summary']['distanceKm']=0.008
save(4,2,False,training=replacement);assert a.call(query)['trainingSummaries']['2033-01-04']['distanceKm']==0.008
save(4,3,False,training=None);assert '2033-01-04' not in a.call(query)['trainingSummaries']
save(4,4,False,training=training)
a.call('delete',{'date':'2033-01-04','revision':5})
assert '2033-01-04' not in a.call('entries')['entries']
save(4,published=False)
a.call('training&date=2033-01-04',status=404)
assert '2033-01-04' not in a.call(query)['trainingSummaries']
assert '2033-01-04' not in v.call('entries')['entries']
save(4,7,False,training=training)
a.call('save',{'date':'2033-01-04','entry':entry,'revision':7,'published':True,'training':None},409)
after=inspect();history=[r for r in after['history'] if r['entry_date']=='2033-01-04']
assert [r['revision'] for r in history]==list(range(1,8))
assert [json.loads(r['data']) if r['data'] else None for r in history]==[training,training,replacement,None,training,training,None]
row=next(r for r in after['rows'] if r['entry_date']=='2033-01-04')
assert row['revision']==8 and row['published']==0 and row['deleted_at'] is None
assert [r for r in before['rows'] if r['entry_date']!='2033-01-04']==[r for r in after['rows'] if r['entry_date']!='2033-01-04']
assert [r for r in before['history'] if r['entry_date']!='2033-01-04']==[r for r in after['history'] if r['entry_date']!='2033-01-04']
print('PASS weekly API/lifecycle: scalar-only range, zero/legacy handling, public/admin/deleted isolation, validation, read-only revisions, physical DELETE FK1451 vs successful soft-delete, FIT replacement/removal/recreation, draft preservation, stale conflict, exact history and other-date isolation.')
