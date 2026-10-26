#!/usr/bin/env python3
"""Build sample EPUBs for the test suite into test/samples/."""
import io
import os
import zipfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "samples")
os.makedirs(OUT, exist_ok=True)

# small PNG used as the "new cover" in tests
with open(os.path.join(HERE, "newcover.png"), "wb") as f:
    img = Image.new("RGBA", (40, 64), (4, 120, 87, 255))
    img.save(f, "PNG")

CONTAINER = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"""

CHAPTER = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch 1</title></head>
<body><h1>Chapter One</h1><p>Sample text for testing.</p></body></html>
"""


def cover(color, label):
    img = Image.new("RGB", (600, 960), color)
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 580, 940], outline="white", width=6)
    d.text((60, 460), label, fill="white")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def meta_block(title, author, isbn):
    isbn_xml = (
        f'\n    <dc:identifier opf:scheme="ISBN">{isbn}</dc:identifier>'
        if isbn
        else ""
    )
    return f"""  <metadata>
    <dc:identifier id="uid">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>en</dc:language>{isbn_xml}
  </metadata>"""


def write_epub(name, opf, extra=None, mimetype="application/epub+zip"):
    path = os.path.join(OUT, name)
    with zipfile.ZipFile(path, "w") as z:
        # mimetype first, uncompressed — the EPUB spec rule
        z.writestr("mimetype", mimetype, compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", CONTAINER)
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/chapter1.xhtml", CHAPTER)
        for filename, data in (extra or {}).items():
            z.writestr(filename, data)
    print("wrote", path)


# 1. no cover at all (the Prowlarr special)
write_epub(
    "plain.epub",
    f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid" xml:lang="en">
{meta_block("The Test Book", "A. Tester", "9781234567897")}
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>""",
)

# 2. EPUB3 with a properties="cover-image" cover
write_epub(
    "opf3cover.epub",
    f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid" xml:lang="en">
{meta_block("Covered Book", "B. Sample", None)}
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="oldcover" href="images/old.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>""",
    extra={"OEBPS/images/old.jpg": cover(0x8B, "OLD EPUB3")},
)

# 3. EPUB2 with <meta name="cover"> pointing at a manifest id
write_epub(
    "opf2cover.epub",
    f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0" unique-identifier="uid">
{meta_block("Ancient Cover", "C. Legacy", None)}
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="oldcover" href="old2.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
  <guide><reference type="cover" title="Cover" href="old2.jpg"/></guide>
</package>
""".replace(
        "</metadata>",
        '</metadata>\n  <meta name="cover" content="oldcover"/>',
    ),
    extra={"OEBPS/old2.jpg": cover(0x3A, "OLD EPUB2")},
)

# 4. DRM'd file (idpf content-stream encryption)
write_epub(
    "drm.epub",
    f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid" xml:lang="en">
{meta_block("Locked Down", "D. Ramped", None)}
  <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="ch1"/></spine>
</package>""",
    extra={
        "META-INF/encryption.xml": """<?xml version="1.0" encoding="utf-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.idpf.org/2007/embed/ContentStream"/>
  </EncryptedData>
</encryption>"""
    },
)

# 5. zip that claims to be an epub but has no container.xml
write_epub(
    "broken.epub",
    "",
    mimetype="application/epub+zip",
)
os.remove(os.path.join(OUT, "broken.epub"))
with zipfile.ZipFile(os.path.join(OUT, "broken.epub"), "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("hello.txt", "not really an epub")
print("wrote", os.path.join(OUT, "broken.epub"))

# 6. zip with no mimetype at all
with zipfile.ZipFile(os.path.join(OUT, "notepub.zip"), "w") as z:
    z.writestr("readme.txt", "just a zip")
print("wrote", os.path.join(OUT, "notepub.zip"))

# 7. real-world-ish file with a space in an href and a nested OPF dir
with zipfile.ZipFile(os.path.join(OUT, "spaced hrefs.epub"), "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr(
        "META-INF/container.xml",
        CONTAINER.replace("OEBPS/content.opf", "My Book/content.opf"),
    )
    z.writestr(
        "My Book/content.opf",
        f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid" xml:lang="en">
{meta_block("Spaced Out", "E. Hrefs", None)}
  <manifest>
    <item id="ch1" href="my chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="oldcover" href="art/old cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>""",
    )
    z.writestr("My Book/my chapter.xhtml", CHAPTER)
    z.writestr("My Book/art/old cover.jpg", cover(0x5C, "OLD SPACED"))
print("wrote", os.path.join(OUT, "spaced hrefs.epub"))
