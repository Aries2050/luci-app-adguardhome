#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read a .lmo file and dump translations for verification."""
import struct
import sys


def sfh_hash(data: bytes) -> int:
    length = len(data)
    if length <= 0:
        return 0
    h = length
    rem = length & 3
    length >>= 2
    i = 0

    def get16(d, off):
        return d[off] | (d[off + 1] << 8)

    while length > 0:
        h += get16(data, i)
        h &= 0xFFFFFFFF
        tmp = (get16(data, i + 2) << 11) ^ h
        h = ((h << 16) ^ tmp) & 0xFFFFFFFF
        i += 4
        h += h >> 11
        h &= 0xFFFFFFFF
        length -= 1

    if rem == 3:
        h += get16(data, i)
        h &= 0xFFFFFFFF
        h ^= h << 16
        h &= 0xFFFFFFFF
        h ^= data[i + 2] << 18
        h &= 0xFFFFFFFF
        h += h >> 11
        h &= 0xFFFFFFFF
    elif rem == 2:
        h += get16(data, i)
        h &= 0xFFFFFFFF
        h ^= h << 11
        h &= 0xFFFFFFFF
        h += h >> 17
        h &= 0xFFFFFFFF
    elif rem == 1:
        h += data[i]
        h &= 0xFFFFFFFF
        h ^= h << 10
        h &= 0xFFFFFFFF
        h += h >> 1
        h &= 0xFFFFFFFF

    h &= 0xFFFFFFFF
    h ^= h << 3
    h &= 0xFFFFFFFF
    h += h >> 5
    h &= 0xFFFFFFFF
    h ^= h << 4
    h &= 0xFFFFFFFF
    h += h >> 17
    h &= 0xFFFFFFFF
    h ^= h << 25
    h &= 0xFFFFFFFF
    h += h >> 6
    return h & 0xFFFFFFFF


def read_lmo(path):
    with open(path, 'rb') as f:
        data = f.read()
    idx_offset = struct.unpack('>I', data[-4:])[0]
    index = []
    pos = idx_offset
    while pos + 16 <= len(data) - 4:
        key_id, val_id, offset, length = struct.unpack('>IIII', data[pos:pos+16])
        index.append((key_id, val_id, offset, length))
        pos += 16
    return data, index


def lmo_canon_hash(key: str) -> int:
    """Mirror runtime lmo_canon_hash (collapse whitespace, strip edges)."""
    if not key:
        return 0
    out = []
    prev = ' '
    for c in key:
        if c.isspace():
            if not prev.isspace():
                out.append(' ')
        else:
            out.append(c)
        prev = c
    while out and out[-1].isspace():
        out.pop()
    return sfh_hash(''.join(out).encode('utf-8'))


def lookup(data, index, key):
    kh = lmo_canon_hash(key)  # 与运行时 lmo_translate_ctxt 一致
    for key_id, val_id, offset, length in index:
        if key_id == kh:
            return data[offset:offset+length].decode('utf-8', 'replace')
    return None


if __name__ == '__main__':
    data, index = read_lmo(sys.argv[1])
    print(f"index entries: {len(index)}, idx_offset={struct.unpack('>I', data[-4:])[0]}")
    for k in ['Overview', 'Enable', 'Configuration', 'AdGuard Home', 'Tools', 'Logs']:
        print(f"  {k!r} -> {lookup(data, index, k)!r}")
