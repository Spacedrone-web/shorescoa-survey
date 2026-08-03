@"
import re
path = r'D:\shorescoa-survey\src\pages\index.astro'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
content = re.sub(r'(<input[^>]+id=.arrival_date.[^>]+) required', r'\1', content)
content = re.sub(r'(<input[^>]+id=.departure_date.[^>]+) required', r'\1', content)
content = re.sub(r'(<input[^>]+id=.unit_number.[^>]+) required', r'\1', content)
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
print('Done - 3 fields made optional')
"@ | Out-File D:\fix_fields.py -Encoding UTF8
