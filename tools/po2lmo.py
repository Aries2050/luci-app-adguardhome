#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PO -> LMO compiler (LuCI translation format), pure Python.
Mirrors openwrt/luci modules/luci-base/src/po2lmo.c
Usage: po2lmo.py input.po output.lmo
"""
import struct
import sys


def sfh_hash(data: bytes) -> int:
    """Super Fast Hash (luci sfh_hash)."""
    length = len(data)
    if length <= 0:
        return 0
    h = length
    rem = length & 3
    length >>= 2
    i = 0

    def get16(d, off):
        # little-endian 16-bit read
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


def lmo_canon_hash(key: str) -> int:
    """Mirror template_lmo.c lmo_canon_hash(str, len, NULL, 0, -1).
    Collapses runs of whitespace to a single space and strips leading/trailing
    whitespace, then hashes with sfh_hash. The runtime lookup (template_lmo.c
    lmo_translate_ctxt) hashes keys this way, so keys with trailing whitespace
    (e.g. 'Showing last ') must be compiled with this same canonical hash."""
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


def unescape(s: str) -> str:
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == '\\' and i + 1 < n:
            nxt = s[i + 1]
            if nxt == '"':
                out.append('"'); i += 2; continue
            if nxt == '\\':
                out.append('\\'); i += 2; continue
            if nxt == 'n':
                out.append('\n'); i += 2; continue
            if nxt == 't':
                out.append('\t'); i += 2; continue
            out.append(nxt); i += 2; continue
        out.append(c)
        i += 1
    return ''.join(out)


def po_str(s: str) -> str:
    """Strip surrounding quotes from a PO string literal and unescape.
    Only lstrip the leading whitespace; trailing whitespace inside the
    quotes is significant (e.g. 'Showing last ')."""
    s = s.lstrip()
    if len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        s = s[1:-1]
    return unescape(s)


def parse_po(path: str):
    entries = []
    cur_id = None
    cur_val = None
    id_parts = []
    val_parts = []

    def flush():
        nonlocal cur_id, cur_val, id_parts, val_parts
        if cur_id is not None and cur_val is not None and cur_val != '':
            entries.append((cur_id, cur_val))
        cur_id = cur_val = None
        id_parts = []
        val_parts = []

    with open(path, encoding='utf-8') as f:
        for raw in f:
            line = raw.rstrip('\n')
            s = line.strip()
            if s.startswith('msgid "'):
                flush()
                cur_id = po_str(s[len('msgid'):])
                id_parts = [cur_id]
            elif s.startswith('msgstr "'):
                cur_val = po_str(s[len('msgstr'):])
                val_parts = [cur_val]
            elif s.startswith('"'):
                content = po_str(s)
                if cur_val is not None:
                    val_parts.append(content)
                    cur_val = ''.join(val_parts)
                elif cur_id is not None:
                    id_parts.append(content)
                    cur_id = ''.join(id_parts)
    flush()
    return entries


def main():
    if len(sys.argv) != 3:
        print("Usage: po2lmo.py input.po output.lmo")
        sys.exit(1)
    entries = parse_po(sys.argv[1])
    payload = b''
    index = []  # (key_id, val_id, offset, length)
    for key, val in entries:
        vb = val.encode('utf-8')
        key_id = lmo_canon_hash(key)  # 与解析端 lmo_canon_hash 一致（压缩/去首尾空白）
        val_id = 1  # plural_num + 1 (non-plural)
        offset = len(payload)
        length = len(vb)
        payload += vb
        payload += b'\x00' * ((4 - (length % 4)) % 4)
        index.append((key_id, val_id, offset, length))
    index.sort(key=lambda e: e[0])
    idx_offset = len(payload)
    out = bytearray(payload)
    for key_id, val_id, offset, length in index:
        out += struct.pack('>IIII', key_id, val_id, offset, length)
    out += struct.pack('>I', idx_offset)
    with open(sys.argv[2], 'wb') as f:
        f.write(bytes(out))
    print(f"Wrote {len(out)} bytes, {len(index)} entries -> {sys.argv[2]}")


if __name__ == '__main__':
    main()
