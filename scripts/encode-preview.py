"""Encode the captured live browser frames without changing their timing."""
import json
import subprocess
import os
import shutil
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
folder = root / '.tmp/v4-motion-frames'
data = json.loads((folder / 'timeline.json').read_text())
frames = data['frames']
if len(frames) < 3:
    raise SystemExit('Not enough live frames to encode')
lines = ['ffconcat version 1.0']
for i, frame in enumerate(frames):
    lines.append(f"file '{frame['file']}'")
    dt = frames[i + 1]['timestamp'] - frame['timestamp'] if i + 1 < len(frames) else 1 / 30
    lines.append(f'duration {max(0.001, dt):.9f}')
lines.append(f"file '{frames[-1]['file']}'")
concat = folder / 'capture.ffconcat'
concat.write_text('\n'.join(lines) + '\n')
width, height = Image.open(folder / frames[0]['file']).size
bounds, viewport = data['bounds'], data['viewport']
sx, sy = width / viewport['width'], height / viewport['height']
x, y = int(bounds['x'] * sx) // 2 * 2, int(bounds['y'] * sy) // 2 * 2
w, h = int(bounds['width'] * sx) // 2 * 2, int(bounds['height'] * sy) // 2 * 2
crop = f'crop={w}:{h}:{x}:{y}'
out = root / 'artifacts'
video = out / 'afterhours-live-preview.mp4'
ffmpeg = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
if not ffmpeg:
    raise SystemExit('Optional preview export needs FFmpeg on PATH (or set FFMPEG to its full executable path).')
subprocess.run([ffmpeg, '-y', '-hide_banner', '-loglevel', 'warning', '-f', 'concat', '-safe', '0', '-i', str(concat), '-vf', crop + ',fps=30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(video)], check=True)
times = {stage['name']: stage.get('timestamp', frames[min(stage['frame'], len(frames) - 1)]['timestamp']) - frames[0]['timestamp'] for stage in data.get('stages', [])}
stills = {'menu-still':'v4-menu-final.png', 'gameplay-still':'v4-gameplay-final.png', 'draw-four-still':'v4-draw-four.png', 'victory-still':'v4-victory.png', 'defeat-still':'v4-defeat.png'}
for stage in data.get('stages', []):
    if stage['name'] not in stills: continue
    timestamp = stage.get('timestamp', frames[min(stage['frame'],len(frames)-1)]['timestamp']) + 0.04
    chosen = min(frames, key=lambda f: abs(f['timestamp']-timestamp))
    im = Image.open(folder / chosen['file']);im.crop((x,y,x+w,y+h)).save(out / stills[stage['name']])
def gif(name, start, duration):
    filters = '[0:v]fps=12,scale=600:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a'
    subprocess.run([ffmpeg, '-y', '-hide_banner', '-loglevel', 'warning', '-ss', str(start), '-t', str(duration), '-i', str(video), '-filter_complex', filters, '-loop', '0', str(out / name)], check=True)
gif('afterhours-menu-motion.gif', 0, min(7.5, times.get('gameplay', 7.5)))
if 'draw-four' in times:
    start = max(0, times.get('draw-four-still', times['draw-four']) - 0.3)
    gif('afterhours-effects-motion.gif', start, 4.5)
(out / 'v4-motion-proof.json').write_text(json.dumps({**json.loads((folder / 'proof.json').read_text()), 'frames': len(frames), 'durationSeconds': frames[-1]['timestamp'] - frames[0]['timestamp'], 'stagesSeconds': times, 'effectsUsePreparedLegalScenarios': True}, indent=2))
print(json.dumps({'video': str(video), 'frames': len(frames), 'seconds': frames[-1]['timestamp'] - frames[0]['timestamp'], 'stages': times}, indent=2))
