"""Retain the room's light contrast without its heavy violet reflection cast."""
import bpy
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parents[1]
image = bpy.data.images.load(str(root / 'public/textures/room_env.hdr'))
pixels = np.empty(len(image.pixels), dtype=np.float32)
image.pixels.foreach_get(pixels)
rgba = pixels.reshape((-1, 4))
luma = rgba[:, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
rgba[:, :3] = rgba[:, :3] * 0.12 + luma[:, None] * 0.88
image.pixels.foreach_set(pixels)
image.filepath_raw = str(root / 'public/textures/room_env-neutral.hdr')
image.file_format = 'HDR'
image.save()
print('Saved neutral room reflections', tuple(image.size))
