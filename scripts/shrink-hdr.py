"""Downsample a Radiance .hdr (RGBE) environment map by an exact box filter in linear light.

    python scripts/shrink-hdr.py public/textures/room_env-neutral.hdr public/textures/room_env-small.hdr 512

The game's image-based lighting only needs a small map: the renderer blurs it into a few
low-resolution levels anyway, and a 2048x1024 map costs a 5.8 MB download and a long filtering
stall on a headset. Averaging whole blocks of pixels in linear floating point keeps the light's
colour and total energy the same (a general image scaler shifted the colour by about 10%).
Needs numpy. The width must divide the source width.
"""
import sys

import numpy as np


def read_hdr(path):
    data = open(path, 'rb').read()
    pos = 0
    if not data.startswith(b'#?'):
        raise SystemExit('not a Radiance HDR file')
    while True:
        end = data.index(b'\n', pos)
        line = data[pos:end]
        pos = end + 1
        if line == b'':
            break
    end = data.index(b'\n', pos)
    size = data[pos:end].split()
    pos = end + 1
    if size[0] != b'-Y' or size[2] != b'+X':
        raise SystemExit('unsupported orientation: ' + data[pos:end].decode())
    h, w = int(size[1]), int(size[3])
    rgbe = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        if not (data[pos] == 2 and data[pos + 1] == 2 and (data[pos + 2] << 8 | data[pos + 3]) == w):
            raise SystemExit('only run-length encoded scanlines are supported')
        pos += 4
        for c in range(4):
            x = 0
            while x < w:
                n = data[pos]
                pos += 1
                if n > 128:
                    n -= 128
                    rgbe[y, x:x + n, c] = data[pos]
                    pos += 1
                else:
                    rgbe[y, x:x + n, c] = np.frombuffer(data, np.uint8, n, pos)
                    pos += n
                x += n
    scale = np.ldexp(1.0, rgbe[..., 3].astype(np.int32) - 136)
    scale[rgbe[..., 3] == 0] = 0
    return rgbe[..., :3].astype(np.float64) * scale[..., None]


def write_hdr(path, rgb):
    h, w, _ = rgb.shape
    peak = rgb.max(axis=2)
    exp = np.zeros((h, w), np.int32)
    lit = peak > 1e-32
    exp[lit] = np.floor(np.log2(peak[lit])).astype(np.int32) + 1
    mant = np.zeros((h, w, 3), np.float64)
    mant[lit] = rgb[lit] / np.ldexp(1.0, exp[lit])[:, None] * 256.0
    rgbe = np.zeros((h, w, 4), np.uint8)
    rgbe[..., :3] = np.clip(np.floor(mant), 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(lit, exp + 128, 0).astype(np.uint8)
    out = bytearray(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {h} +X {w}\n'.encode())
    for y in range(h):
        out += bytes((2, 2, w >> 8, w & 255))
        for c in range(4):
            row = rgbe[y, :, c].tobytes()
            for x in range(0, w, 128):
                chunk = row[x:x + 128]
                out.append(len(chunk))
                out += chunk
    open(path, 'wb').write(out)


def main():
    src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
    rgb = read_hdr(src)
    h, w, _ = rgb.shape
    if w % width:
        raise SystemExit(f'{width} does not divide the source width {w}')
    k = w // width
    small = rgb.reshape(h // k, k, width, k, 3).mean(axis=(1, 3))
    write_hdr(dst, small)
    back = read_hdr(dst)
    print(f'{w}x{h} -> {width}x{h // k}')
    print('mean RGB before', np.round(rgb.mean(axis=(0, 1)), 4), 'after', np.round(back.mean(axis=(0, 1)), 4))


main()
