#!/usr/bin/env python3
import os, pathlib, stat, sys, zipfile

archive, destination = sys.argv[1], pathlib.Path(sys.argv[2]).resolve()
max_files, max_uncompressed = 50000, 2 * 1024 * 1024 * 1024

def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)

try:
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if not entries or len(entries) > max_files:
            fail("الأرشيف فاضي أو فيه ملفات أكتر من المسموح.")
        total = 0
        for entry in entries:
            name = entry.filename.replace("\\", "/")
            path = pathlib.PurePosixPath(name)
            mode = entry.external_attr >> 16
            if path.is_absolute() or any(part in ("..", "") for part in path.parts):
                fail("الأرشيف فيه مسار ملف غير آمن.")
            if stat.S_ISLNK(mode):
                fail("الأرشيف يحتوي على روابط رمزية غير مسموح بها.")
            total += entry.file_size
            if total > max_uncompressed:
                fail("حجم الملفات بعد فك الضغط أكبر من المسموح.")
        destination.mkdir(parents=True, exist_ok=True)
        for entry in entries:
            target = (destination / entry.filename).resolve()
            if destination not in target.parents and target != destination:
                fail("مسار ملف خارج مجلد المشروع.")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(entry) as source, open(target, "xb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
except zipfile.BadZipFile:
    fail("ملف ZIP تالف أو غير صالح.")
