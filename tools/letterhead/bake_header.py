#!/usr/bin/env python3
"""Draws the contact lines (the email, and the phone from LETTERHEAD_PHONE, kept out of this public repository) into the top right
of header.jpg and writes the result where asked, for make_doc.cjs's LETTERHEAD_HEADER. Usage: bake_header.py out.jpg"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]
im = Image.open(os.path.join(here, 'header.jpg')).convert('RGB')
font = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Regular.otf', 26)
d = ImageDraw.Draw(im)
lines = ['mark@mark1apps.co.uk'] + ([os.environ['LETTERHEAD_PHONE']] if os.environ.get('LETTERHEAD_PHONE') else [])
y = 96
for t in lines:
    w = d.textlength(t, font=font)
    d.text((im.width - 120 - w, y), t, font=font, fill=(75, 91, 107))
    y += 36
im.save(out, quality=92)
print('baked', out)
