#!/usr/bin/python3
"""Verify public demo access without Cookie, credentials or new exercises."""
import base64
import http.client
import json
import os
from pathlib import Path

origin = Path('/var/lib/yuchai-tunnel/public-url').read_text().strip().removesuffix('/yuchai-training/')
checks = []
def request(path, *, method='GET', body=None, browser_origin=None, websocket=False):
    headers = {'Host': origin.removeprefix('https://')}
    if browser_origin:
        headers['Origin'] = browser_origin
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if websocket:
        headers.update({'Upgrade': 'websocket', 'Connection': 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': base64.b64encode(os.urandom(16)).decode()})
    conn = http.client.HTTPConnection('127.0.0.1', 5320, timeout=20)
    try:
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        raw = response.read()
        try:
            data = json.loads(raw)
        except ValueError:
            data = None
        return response.status, data, response.getheader('Location')
    finally:
        conn.close()

for name, path, options, expected in [
    ('public page', '/yuchai-training/', {}, 200),
    ('public health', '/yuchai-training/api/health', {}, 200),
    ('public live plans', '/yuchai-training/api/plans', {}, 200),
    ('valid Origin reaches body validation without login', '/yuchai-training/api/exercises', {'method': 'POST', 'body': '{}', 'browser_origin': origin}, 400),
    ('invalid Origin refused', '/yuchai-training/api/exercises', {'method': 'POST', 'body': '{}', 'browser_origin': 'https://invalid.example'}, 403),
    ('public WebSocket reaches unknown exercise validation', '/yuchai-training/api/voice/999999', {'browser_origin': origin, 'websocket': True}, 403),
    ('invalid WebSocket Origin', '/yuchai-training/api/voice/999999', {'browser_origin': 'https://invalid.example', 'websocket': True}, 403),
    ('old login link returns to training centre', '/login?next=/yuchai-training/', {}, 302),
    ('private auth endpoint', '/internal/yuchai-auth', {}, 404),
    ('unrelated admin endpoint', '/admin', {}, 404),
]:
    status, data, location = request(path, **options)
    result = {'check': name, 'status': status, 'passed': status == expected}
    if 'WebSocket' in name and data:
        result['message'] = data.get('error', {}).get('message', '')
        if name.startswith('public WebSocket'):
            result['passed'] = result['passed'] and '仅可操作本次服务启动后' in result['message']
        if name.startswith('invalid WebSocket'):
            result['passed'] = result['passed'] and '来源不被允许' in result['message']
    if name == 'public live plans' and data:
        result['planIds'] = [p['id'] for p in data.get('plans', [])]
        result['passed'] = result['passed'] and sorted(result['planIds']) == [47, 49, 71, 72, 73, 74, 75, 76]
    if name.startswith('old login'):
        result['location'] = location
        result['passed'] = result['passed'] and location == '/yuchai-training/'
    checks.append(result)
print(json.dumps({'checks': checks, 'sentCookie': False, 'createdPortalSessions': 0, 'createdExercises': 0}, ensure_ascii=False, indent=2))
if not all(check['passed'] for check in checks):
    raise SystemExit(1)
