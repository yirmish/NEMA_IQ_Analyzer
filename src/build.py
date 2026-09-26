"""Build the single-file NEMA IQ Analyzer: inline profiles.js, core.js, report.js and ui.js into template.html.

profiles.js is generated from scanner_profiles.json (the editable profile database) so that the HTML works offline
without loading any file."""
import json, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda n: open(os.path.join(here, n), encoding="utf-8").read()
# scanner_profiles.json lives next to build.py (development) or one level up (distribution folder with src/)
prof_path = next(p for p in (os.path.join(here, "scanner_profiles.json"), os.path.join(os.path.dirname(here), "scanner_profiles.json")) if os.path.exists(p))
root = os.path.dirname(prof_path)
db = json.loads(open(prof_path, encoding="utf-8").read())
profiles_js = "// generated from scanner_profiles.json by build.py - edit the JSON, not this file\n" + \
              "(function (G) { G.NEMA_PROFILES = " + json.dumps(db, ensure_ascii=False, indent=0) + "; })(typeof globalThis !== 'undefined' ? globalThis : this);\n"
open(os.path.join(here, "profiles.js"), "w", encoding="utf-8", newline="\n").write(profiles_js)
tpl = rd("template.html")
core, rep, ui = rd("core.js"), rd("report.js"), rd("ui.js")
for name, js in (("profiles", profiles_js), ("core", core), ("report", rep), ("ui", ui)):
    assert "</script" not in js.lower(), f"{name} contains a closing script tag"
version = re.search(r"N\.VERSION = '([^']+)'", core).group(1)
html = (tpl.replace("/*PROFILES*/", profiles_js).replace("/*CORE*/", core).replace("/*REPORT*/", rep).replace("/*UI*/", ui)
           .replace("/*VERSION*/", version))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "NEMA_IQ_Analyzer.html")
open(out, "w", encoding="utf-8", newline="\n").write(html)
print(out, len(html.encode("utf-8")), "bytes, version", version, "|", len(db.get("profiles", [])), "profiles")
