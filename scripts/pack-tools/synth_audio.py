"""
Genera la música y los efectos de sonido del paquete «Halloween infantil».
Todo el audio se sintetiza aquí (sin muestras externas), por lo que es original y libre de derechos (CC0).

Uso: python3 scripts/pack-tools/synth_audio.py <carpeta_salida>
Genera WAV; el script build-pack los convierte a OGG con ffmpeg.
"""
import sys, os, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(31)


def t_axis(d):
    return np.arange(int(SR * d)) / SR


def env_adsr(n, a=0.01, d=0.1, s=0.6, r=0.2):
    e = np.ones(n) * s
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    A = max(A, 1)
    e[:A] = np.linspace(0, 1, A)
    e[A:A + D] = np.linspace(1, s, len(e[A:A + D]))
    if R > 0 and R < n:
        e[-R:] *= np.linspace(1, 0, R)
    return e


def note_freq(n):
    # n: semitonos respecto a La4 (440 Hz)
    return 440.0 * 2 ** (n / 12)


def celesta(f, d, vel=1.0):
    t = t_axis(d)
    tone = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6)
            + 0.18 * np.sin(2 * np.pi * 4.01 * f * t) * np.exp(-t * 10))
    return tone * np.exp(-t * 3.2) * vel * env_adsr(len(t), 0.003, 0.05, 1.0, 0.05)


def pluck_bass(f, d, vel=1.0):
    t = t_axis(d)
    tone = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) + 0.1 * np.sin(2 * np.pi * 3 * f * t)
    return tone * np.exp(-t * 5) * vel * env_adsr(len(t), 0.005, 0.05, 1.0, 0.04)


def organ_pad(fs, d, vel=1.0):
    t = t_axis(d)
    out = np.zeros_like(t)
    for f in fs:
        vib = 1 + 0.003 * np.sin(2 * np.pi * 5 * t)
        out += np.sin(2 * np.pi * f * vib * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return out / len(fs) * vel * env_adsr(len(t), 0.25, 0.3, 0.8, 0.4)


def tick(d=0.06, vel=1.0):
    t = t_axis(d)
    return rng.standard_normal(len(t)) * np.exp(-t * 80) * vel


def mix_into(buf, sig, at):
    i = int(at * SR)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]


def normalize(x, peak=0.89):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    data = (x * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def music():
    """«Marcha de los fantasmitas»: compás 6/8, Re menor, 4 compases × 4 = 16 compases, ~24 s, en bucle perfecto."""
    bpm = 120  # negras con puntillo por minuto → 2 pulsos por compás
    beat = 60 / bpm  # duración de un pulso (negra con puntillo)
    eighth = beat / 3
    bar = beat * 2
    bars = 16
    total = bar * bars
    buf = np.zeros(int(SR * total) + SR)
    # Progresión: Dm Bb C A  (x4) con variación en la última vuelta
    D, F, A, Bb, C, E, G, Cs = -7, -4, 0, 1, 3, -5, -2, 4  # semitonos respecto a La4
    chords = [(D, F, A), (Bb - 12, D, F), (C - 12, E, G), (A - 12, Cs, E)]
    bass_roots = [D - 24, Bb - 36, C - 24, A - 36]
    # melodía (en corcheas, 6 por compás); None = silencio
    mel = [
        [A, None, A, Bb, A, G], [F, None, D, F, None, None], [E, None, E, F, E, D], [Cs, None, E, A, None, None],
        [A, None, A, C + 12, Bb, A], [Bb, None, F, D, None, None], [G, None, A, Bb, A, G], [A, None, None, None, None, None],
        [D + 12, None, C + 12, Bb, A, G], [F, None, A, D + 12, None, None], [C + 12, None, Bb, A, G, F], [E, None, G, Cs + 12, None, None],
        [D + 12, None, A, F, A, D + 12], [Bb, None, D + 12, F + 12, None, D + 12], [E + 12, None, D + 12, C + 12, Bb, G], [A, None, Cs + 12, D + 12, None, None],
    ]
    for b in range(bars):
        t0 = b * bar
        ch = chords[b % 4]
        root = bass_roots[b % 4]
        # bajo: tónica y quinta en los pulsos
        mix_into(buf, pluck_bass(note_freq(root), beat * 0.95, 0.55), t0)
        mix_into(buf, pluck_bass(note_freq(root + 7), beat * 0.95, 0.45), t0 + beat)
        # acompañamiento: acordes en corcheas 2-3 y 5-6 (oom-pa-pa)
        for k in (1, 2, 4, 5):
            for n in ch:
                mix_into(buf, celesta(note_freq(n - 12), eighth * 1.2, 0.09), t0 + k * eighth)
        # pad suave
        mix_into(buf, organ_pad([note_freq(n - 12) for n in ch], bar, 0.10), t0)
        # percusión ligera
        for k in range(6):
            mix_into(buf, tick(0.05, 0.10 if k % 3 else 0.2), t0 + k * eighth)
        # melodía
        for k, n in enumerate(mel[b]):
            if n is None:
                continue
            # duración: hasta la siguiente nota
            length = 1
            while k + length < 6 and mel[b][k + length] is None:
                length += 1
            mix_into(buf, celesta(note_freq(n + 12), eighth * length * 1.1 + 0.25, 0.55), t0 + k * eighth)
    # El bucle: las colas que se salen del final se suman al principio.
    n = int(SR * total)
    tail = buf[n:]
    buf = buf[:n]
    buf[: len(tail)] += tail
    return normalize(buf, 0.8)


def boo():
    d = 1.6
    t = t_axis(d)
    f = 420 * np.exp(-t * 0.6) + 140
    vib = 1 + 0.03 * np.sin(2 * np.pi * 6 * t)
    phase = 2 * np.pi * np.cumsum(f * vib) / SR
    x = np.sin(phase) + 0.25 * np.sin(2 * phase) + 0.05 * rng.standard_normal(len(t))
    return normalize(x * env_adsr(len(t), 0.15, 0.2, 0.8, 0.6), 0.8)


def boing():
    d = 0.9
    t = t_axis(d)
    f = 180 + 260 * np.exp(-t * 4) * (1 + 0.35 * np.sin(2 * np.pi * 14 * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) * np.exp(-t * 3.5)
    return normalize(x * env_adsr(len(t), 0.003, 0.05, 1, 0.1), 0.85)


def pop():
    d = 0.25
    t = t_axis(d)
    f = 900 * np.exp(-t * 25) + 300
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) * np.exp(-t * 22) + 0.3 * rng.standard_normal(len(t)) * np.exp(-t * 120)
    return normalize(x, 0.85)


def sparkle():
    d = 2.2
    buf = np.zeros(int(SR * d))
    notes = [0, 4, 7, 12, 16, 19, 24, 28, 31, 36]
    for k, n in enumerate(notes):
        mix_into(buf, celesta(note_freq(n + 3 + 12), 1.0, 0.6 - k * 0.03), k * 0.09)
    for k in range(18):
        mix_into(buf, celesta(note_freq(int(rng.integers(24, 40))), 0.5, 0.15), 0.4 + rng.random() * 1.4)
    return normalize(buf, 0.8)


def flutter():
    d = 1.4
    t = t_axis(d)
    noise = rng.standard_normal(len(t))
    # filtro paso bajo simple
    y = np.zeros_like(noise)
    a = 0.12
    for i in range(1, len(noise)):
        y[i] = y[i - 1] + a * (noise[i] - y[i - 1])
    flaps = (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 11 * t))) * np.exp(-((t - 0.7) ** 2) / 0.18)
    return normalize(y * flaps, 0.7)


def chime():
    d = 2.6
    buf = np.zeros(int(SR * d))
    mix_into(buf, celesta(note_freq(7), 2.0, 1.0), 0)  # ding
    mix_into(buf, celesta(note_freq(3), 2.0, 0.9), 0.55)  # dong
    return normalize(buf, 0.8)


def whoosh():
    d = 1.2
    t = t_axis(d)
    noise = rng.standard_normal(len(t))
    y = np.zeros_like(noise)
    for i in range(1, len(noise)):
        a = 0.02 + 0.25 * np.sin(np.pi * t[i] / d)
        y[i] = y[i - 1] + a * (noise[i] - y[i - 1])
    return normalize(y * np.sin(np.pi * t / d) ** 2, 0.7)


def giggle():
    d = 1.3
    buf = np.zeros(int(SR * d))
    for k in range(5):
        tt = t_axis(0.16)
        f = 700 + 120 * np.sin(np.pi * tt / 0.16) - k * 25
        phase = 2 * np.pi * np.cumsum(f) / SR
        s = (np.sin(phase) + 0.4 * np.sin(2 * phase)) * np.sin(np.pi * tt / 0.16) ** 2
        mix_into(buf, s * (1 - k * 0.12), 0.05 + k * 0.2)
    return normalize(buf, 0.75)


def thunder():
    """Trueno: chasquido inicial + retumbo grave que se aleja."""
    d = 5.5
    t = t_axis(d)
    noise = rng.standard_normal(len(t))
    # filtro paso bajo de un polo con frecuencia que baja con el tiempo
    y = np.zeros_like(noise)
    for i in range(1, len(noise)):
        a = 0.02 + 0.25 * np.exp(-t[i] * 3.0)
        y[i] = y[i - 1] + a * (noise[i] - y[i - 1])
    crack = noise * np.exp(-t * 18) * 0.6
    rumble_env = (1 - np.exp(-t * 12)) * np.exp(-t * 0.7) * (0.7 + 0.3 * np.sin(2 * np.pi * 1.3 * t + 1) * np.sin(2 * np.pi * 0.37 * t))
    x = crack + y * rumble_env * 3.0
    return normalize(x * env_adsr(len(t), 0.002, 0.05, 1.0, 0.8), 0.9)


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    items = {
        'musica-marcha-fantasmitas': music(),
        'boo': boo(),
        'boing': boing(),
        'pop': pop(),
        'destello-magico': sparkle(),
        'aleteo': flutter(),
        'campanilla': chime(),
        'whoosh': whoosh(),
        'risita': giggle(),
        'trueno': thunder(),
    }
    for name, x in items.items():
        write_wav(os.path.join(out, f'{name}.wav'), x)
        print(f'{name}.wav {len(x) / SR:.2f}s')


if __name__ == '__main__':
    main()
