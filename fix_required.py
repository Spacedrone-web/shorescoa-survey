Set-Content "D:\fix_required.py" -Encoding UTF8 -Value 'import re
path = r"D:\shorescoa-survey\src\pages\index.astro"
with open(path, "r", encoding="utf-8-sig") as f:
    content = f.read()
content = re.sub(r"(id=\"arrival_date\"[^>]*?) required", r"\1", content)
content = re.sub(r"(id=\"departure_date\"[^>]*?) required", r"\1", content)
content = re.sub(r"(id=\"unit_number\"[^>]*?) required", r"\1", content)
with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(content)
print("Done - 3 fields made optional")'
