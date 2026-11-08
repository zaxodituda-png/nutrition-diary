"""Regression suite on a disposable *_test database after tests/api.py. No production use."""
import concurrent.futures
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get('DIARY_TEST_URL', 'http://127.0.0.1:8780')
assert urllib.parse.urlparse(BASE).hostname in ('localhost', '127.0.0.1', '::1'), 'Loopback test URL required'
PASSWORD = os.environ['DIARY_TEST_PASSWORD']
PHP = os.environ.get('DIARY_TEST_PHP', 'php')
INSPECTOR = str(Path(__file__).with_name('restore-state.php'))

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = self.call('session')[1]['csrf']
    def call(self, action, data=None, expected=200, csrf=True):
        headers = {'Content-Type': 'application/json'}
        if data is not None and csrf:
            headers['X-CSRF-Token'] = self.csrf
        req = urllib.request.Request(BASE + '/api/index.php?action=' + action,
            data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            response = self.opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        result = json.load(response)
        if expected is not None:
            assert response.status == expected, (action, response.status, result)
        if 'csrf' in result:
            self.csrf = result['csrf']
        return response.status, result
    def login(self):
        self.call('login', {'username': 'owner', 'password': PASSWORD})


def inspect(date):
    return json.loads(subprocess.check_output([PHP, INSPECTOR, date]))


def save(client, date, entry, revision=None, published=False, expected=200):
    return client.call('save', {'date': date, 'entry': entry, 'revision': revision,
                               'published': published}, expected)

entry = {'weight': '76', 'sleep': '8 ч', 'base': 2000, 'exercise': 500,
         'meals': [{'group': 'Утро', 'name': 'Омлет', 'kcal': 400}],
         'garmin': '', 'note': 'Original', 'legacy': {'keep_in_history': True}}
replacement = {**entry, 'weight': '75,5', 'note': 'Recreated draft'}
del replacement['legacy']
date = '2030-01-01'
assert inspect(date)['row'] is False, 'Use a clean disposable test database'
admin, visitor = Client(), Client()
admin.login()
# An unused date gets revision 1; a normal edit increments and preserves metadata.
save(admin, date, entry, published=True)
created = inspect(date)['row']
assert created['revision'] == 1 and created['deleted_at'] is None
save(admin, date, {**entry, 'note': 'Active edit'}, revision=1, published=True)
assert inspect(date)['row']['revision'] == 2
save(admin, date, replacement, revision=1, expected=409)
save(admin, date, replacement, revision=None, expected=409)
admin.call('delete', {'date': date, 'revision': 2})
deleted = inspect(date)
assert deleted['row']['revision'] == 3 and deleted['row']['deleted_at'] is not None
assert date not in admin.call('entries')[1]['entries']
# Protect the tombstone from stale edits/deletes, even if someone guesses its revision.
save(admin, date, replacement, revision=2, expected=409)
save(admin, date, replacement, revision=3, expected=409)
admin.call('delete', {'date': date, 'revision': 3}, expected=409)
visitor.call('save', {'date': date, 'entry': replacement, 'revision': None, 'published': True}, expected=401)
admin.call('save', {'date': date, 'entry': replacement, 'revision': None, 'published': False}, expected=403, csrf=False)
save(admin, date, {**replacement, 'meals': 'invalid'}, expected=422)
assert inspect(date) == deleted, 'Rejected requests must leave row/history unchanged'
# Restore the same row, advancing its version and obeying the explicit draft status.
save(admin, date, replacement, published=False)
restored = inspect(date)
row = restored['row']
assert row['revision'] == 4 and row['deleted_at'] is None and row['published'] == 0
assert row['created_at'] == created['created_at']
assert json.loads(row['payload']) == replacement, 'Do not merge deleted fields into a new payload'
assert date not in visitor.call('entries')[1]['entries']
assert admin.call('entries')[1]['revisions'][date] == 4
assert [h['revision'] for h in restored['history']] == [1, 2, 3]
assert [h['action'] for h in restored['history']] == ['edit', 'delete', 'restore']
assert restored['history'][:-1] == deleted['history']
assert restored['history'][-1]['payload'] == deleted['row']['payload']
assert restored['history'][-1]['published'] == 0
assert all(h['admin_id'] > 0 for h in restored['history'])
# Old and duplicate create requests still conflict once the row is active.
save(admin, date, entry, revision=2, expected=409)
save(admin, date, entry, expected=409)
save(admin, date, {**replacement, 'note': 'After restore'}, revision=4, published=True)
assert visitor.call('entries')[1]['entries'][date]['note'] == 'After restore'
# A second cycle must keep monotonic revisions and unique history versions.
admin.call('delete', {'date': date, 'revision': 5})
save(admin, date, replacement, published=True)
state = inspect(date)
assert state['row']['revision'] == 7 and state['row']['published'] == 1
assert [h['revision'] for h in state['history']] == list(range(1, 7))
assert [h['action'] for h in state['history']] == ['edit', 'delete', 'restore', 'edit', 'delete', 'restore']
# Two independent admin sessions race to restore one deleted row. Exactly one wins.
race = '2030-01-02'
save(admin, race, entry)
admin.call('delete', {'date': race, 'revision': 1})
left, right = Client(), Client()
left.login(); right.login()
barrier = threading.Barrier(2)
def compete(client, note):
    barrier.wait(timeout=10)
    return save(client, race, {**replacement, 'note': note}, published=False, expected=None)[0]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures = [pool.submit(compete, left, 'Left'), pool.submit(compete, right, 'Right')]
    assert sorted(f.result() for f in futures) == [200, 409]
state = inspect(race)
assert state['row']['revision'] == 3 and state['row']['deleted_at'] is None and state['row']['published'] == 0
assert [h['revision'] for h in state['history']] == [1, 2]
assert [h['action'] for h in state['history']] == ['delete', 'restore']
assert json.loads(state['row']['payload'])['note'] in ('Left', 'Right')
assert race not in visitor.call('entries')[1]['entries']
print('PASS restore: unused/active saves, stale and duplicate revisions, delete/recreate cycles, draft/public behavior, exact payload and history, monotonic versions, auth/CSRF/validation, concurrent restoration (one 200 and one 409).')
