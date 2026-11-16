# Dev-only: play a solo game in the emulator with an emulated hand only (ray + pinch), from
# whatever state the page is in, and report every action and whether the game accepted it.
#   python scripts/dev/hands-game.py [max_actions] [gaze]
import json
import subprocess
import sys
import time

MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 30
GAZE = len(sys.argv) > 2 and sys.argv[2] == 'gaze'
CARD_W = 0.07


def cli(*args, payload=None):
    cmd = ['node', 'node_modules/@iwsdk/cli/bin/iwsdk.js', *args]
    if payload is not None:
        cmd += ['--input-json', json.dumps(payload)]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    try:
        return json.loads(out)
    except ValueError:
        return {'raw': out[:300]}


def targets():
    for _ in range(3):
        d = cli('browser', 'run', 'scripts/dev/xr-targets.mjs')
        r = d.get('data', {}).get('result')
        if isinstance(r, dict) and 'screen' in r:
            return r
        time.sleep(1)
    raise SystemExit('no targets: ' + json.dumps(d)[:300])


def pinch(p):
    dev = 'gaze' if GAZE else 'hand-right'
    cli('xr', 'look-at', payload={'device': dev, 'target': {'x': p['x'], 'y': p['y'], 'z': p['z']}})
    cli('xr', 'select', payload={'device': 'hand-right'})


def strip(cards, c):
    """The part of a fanned card that shows: left of the card that overlaps it (any seat direction)."""
    order = sorted(cards, key=lambda k: k['a']['h'])
    i = order.index(c)
    if i == len(order) - 1:
        return c
    nxt = order[i + 1]
    d = [nxt[k] - c[k] for k in 'xyz']
    s = sum(v * v for v in d) ** 0.5 or 1
    off = -CARD_W / 2 + s / 2
    return {k: c[k] + d[j] / s * off for j, k in enumerate('xyz')}


def key(r):
    v = r['view'] or {}
    return (r['screen'], v.get('myTurn'), v.get('hand'), v.get('hasDrawn'), len(r['petals']), json.dumps(v.get('top')))


misses = 0
done = 0
idle = 0
while done < MAX:
    r = targets()
    v = r['view']
    if r['screen'] != 'game' or not v or v['phase'] != 'play':
        print('stop: screen', r['screen'], 'phase', v and v['phase'])
        break
    what = None
    if r['petals']:
        what, at = 'colour %d' % r['petals'][0]['color'], r['petals'][0]
    elif not v['myTurn'] or not r.get('settled', True) or (v['playable'] and not any(c['playable'] for c in r['cards'])):
        idle += 1
        if idle > 40:
            print('stuck waiting for my turn')
            break
        time.sleep(1.2)
        continue
    elif v['playable']:
        plain = [c for c in r['cards'] if c['playable'] and c['kind'] not in ('wild', 'wild4')]
        c = (plain or [c for c in r['cards'] if c['playable']])[0]
        what, at = 'card %s c%s v%s' % (c['kind'], c['color'], c['value']), strip(r['cards'], c)
    elif not v['hasDrawn']:
        what, at = 'deck', r['deck']
    else:
        b = r['dock']['buttons'].get('pass')
        if not b:
            print('no pass button; dock has', list(r['dock']['buttons']))
            break
        what, at = 'pass', b
    idle = 0
    before = key(r)
    pinch(at)
    time.sleep(1.0)
    after = targets()
    ok = key(after) != before
    done += 1
    if not ok:
        misses += 1
    print('%2d %-22s %s  hint: %s' % (done, what, 'ok' if ok else 'NO CHANGE', after['hint']['text']))
print('actions', done, 'misses', misses)
