"""web/lib/baholar.ts dagi reyting hosil qilishning aniq Python nusxasi (FNV-1a + Mulberry32)."""
M = 0xFFFFFFFF
BALL_ORALIQ = {2: (45, 54), 3: (65, 70), 4: (71, 85), 5: (87, 95)}


def imul(a, b):
    a &= M
    b &= M
    return (a * b) & M


def to_i32(x):
    x &= M
    return x - (1 << 32) if x & 0x80000000 else x


def js_hash(s):
    h = 0x811C9DC5
    for ch in s:
        # JS charCodeAt: UTF-16 kod birligi
        for cu in (ord(ch),) if ord(ch) < 0x10000 else (0xD800 + ((ord(ch) - 0x10000) >> 10), 0xDC00 + ((ord(ch) - 0x10000) & 0x3FF)):
            h ^= cu
            h = imul(h, 0x01000193)
    return h & M


def rnd(seed):
    a = (js_hash(seed) + 0x6D2B79F5) & M
    a = imul(a ^ (a >> 15), a | 1)
    a = (a ^ ((a + imul(a ^ (a >> 7), a | 61)) & M)) & M
    return ((a ^ (a >> 14)) & M) / 4294967296


def ball_for(seed, baho):
    lo, hi = BALL_ORALIQ.get(baho, (60, 70))
    return lo + int(rnd(seed) * (hi - lo + 1))


def reyting(seed, g):
    out = {'yakuniy100': None, 'joriy100': None, 'oraliq100': None, 'r100': None}
    for k in ('yakuniy', 'joriy', 'oraliq'):
        if g.get(k) is not None:
            out[k + '100'] = ball_for(f"{seed}|{k}|{g[k]}", g[k])
    if g.get('r_semestr') is not None:
        out['r100'] = ball_for(f"{seed}|r_semestr|{g['r_semestr']}", g['r_semestr'])
    return out


def amaliyot_ball100(pinfl, semestr, nom, baho):
    if baho is None:
        return None
    return ball_for(f"{pinfl}|{semestr}|{nom}|{baho}", baho)
