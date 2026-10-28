# PyInstaller spec for the GhostMind Whisper sidecar (v3.1).
# Build with:  npm run build:sidecar
# Produces a standalone `ghostmind-whisper` binary in sidecar/bin/ so end
# users need NO Python install. The binary speaks the exact same stdio
# JSON-lines protocol as transcribe_sidecar.py run under Python.
# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ('faster_whisper', 'ctranslate2', 'tokenizers', 'onnxruntime'):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception:
        pass

a = Analysis(
    ['transcribe_sidecar.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['mlx_whisper'],  # optional Apple engine; faster-whisper is the bundled default
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ghostmind-whisper',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
