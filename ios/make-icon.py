"""Use macOS sips to preserve the existing icon without extra dependencies."""
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent
dest = root / 'Coach/Assets.xcassets/AppIcon.appiconset'
dest.mkdir(parents=True, exist_ok=True)
subprocess.run(['sips', '-z', '1024', '1024', str(root.parent / 'icon-512.png'), '--out', str(dest / 'icon.png')], check=True)
(dest / 'Contents.json').write_text(json.dumps({'images': [{'filename': 'icon.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}], 'info': {'author': 'xcode', 'version': 1}}))
