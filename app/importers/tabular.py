"""Local, dependency-free readers. No network, formula evaluation or archive extraction."""
import csv
import decimal
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

MAX_BYTES = 16 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_ROWS = 100000
MAX_COLS = 256
MAX_CELLS = 1000000
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

class InvalidDataset(ValueError):
    def __init__(self, reason, row=None):
        super().__init__(reason)
        self.row = row

def reader_settings(settings=None):
    settings = {} if settings is None else settings
    if not isinstance(settings, dict) or set(settings) - {'delimiter', 'header', 'skip_blank_rows', 'trim_whitespace', 'empty_as_null'}:
        raise InvalidDataset('settings')
    result = {'delimiter': 'auto', 'header': True, 'skip_blank_rows': True,
              'trim_whitespace': False, 'empty_as_null': False, **settings}
    if result['delimiter'] not in ('auto', ',', ';', '\t', '|') or any(type(result[k]) is not bool for k in ('header', 'skip_blank_rows', 'trim_whitespace', 'empty_as_null')):
        raise InvalidDataset('settings')
    return result

def consume_cells(budget, count):
    if budget is not None:
        budget['cells'] += count
        if budget['cells'] > MAX_CELLS:
            raise InvalidDataset('limit')

def check_archive(z):
    infos = z.infolist()
    if len(infos) > 2000 or sum(i.file_size for i in infos) > MAX_EXPANDED:
        raise InvalidDataset('limit')
    if any(i.flag_bits & 1 for i in infos):
        raise InvalidDataset('encrypted')

def xml(z, name):
    raw = z.read(name)
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise InvalidDataset('xml')
    return ET.fromstring(raw)

def xlsx(raw, settings=None, budget=None):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        check_archive(z)
        book = xml(z, 'xl/workbook.xml')
        rels = {r.get('Id'): r.get('Target') for r in xml(z, 'xl/_rels/workbook.xml.rels') if r.get('TargetMode') != 'External'}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [''.join(n.itertext()) if not n.findall('.//' + NS + 't') else ''.join(t.text or '' for t in n.iter(NS + 't')) for n in xml(z, 'xl/sharedStrings.xml')]
        date_styles = set()
        if 'xl/styles.xml' in z.namelist():
            styles = xml(z, 'xl/styles.xml')
            formats = {int(n.get('numFmtId')): n.get('formatCode', '') for n in styles.findall(NS + 'numFmts/' + NS + 'numFmt')}
            for i, n in enumerate(styles.findall(NS + 'cellXfs/' + NS + 'xf')):
                fid = int(n.get('numFmtId', '0'))
                fmt = re.sub(r'"[^"]*"|\\.|\[[^\]]*\]', '', formats.get(fid, ''))
                if fid in set(range(14, 23)) | set(range(45, 48)) or re.search('[dy]', fmt, re.I):
                    date_styles.add(i)
        epoch = dt.datetime(1904, 1, 1) if book.find(NS + 'workbookPr') is not None and book.find(NS + 'workbookPr').get('date1904') in ('1', 'true') else dt.datetime(1899, 12, 30)
        result = []
        for sheet in book.findall(NS + 'sheets/' + NS + 'sheet'):
            target = rels.get(sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'), '')
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            if '..' in pathlib.PurePosixPath(path).parts:
                raise InvalidDataset('xml')
            rows = []
            formulas = 0
            for row in xml(z, path).iter(NS + 'row'):
                values = []
                for cell in row.findall(NS + 'c'):
                    letters = re.match(r'^([A-Z]+)', cell.get('r', ''))
                    if not letters:
                        raise InvalidDataset('shape')
                    col = 0
                    for ch in letters[1]:
                        col = col * 26 + ord(ch) - 64
                    if col > MAX_COLS:
                        raise InvalidDataset('limit')
                    values += [None] * max(0, col - len(values))
                    value = cell.findtext(NS + 'v')
                    kind = cell.get('t')
                    if cell.find(NS + 'f') is not None:
                        formulas += 1
                        if value is None:
                            raise InvalidDataset('formula_cache')
                    if kind == 's' and value is not None:
                        value = shared[int(value)]
                    elif kind == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.iter(NS + 't'))
                    elif kind == 'b' and value is not None:
                        value = '1' if value == '1' else '0'
                    elif kind == 'e':
                        raise InvalidDataset('cell_error')
                    elif value is not None and int(cell.get('s', '0')) in date_styles and kind not in ('str', 'd'):
                        serial = float(value)
                        base = epoch + dt.timedelta(days=1) if epoch.year == 1899 and serial < 60 else epoch
                        value = (base + dt.timedelta(days=serial)).isoformat(sep=' ')
                    values[col - 1] = value
                consume_cells(budget, len(values))
                rows.append(values)
                if len(rows) > MAX_ROWS + 1:
                    raise InvalidDataset('limit')
            if any(any(v not in (None, '') for v in row) for row in rows):
                item = normalize(sheet.get('name', 'Sheet'), rows, formulas, settings, budget)
                item['hidden'] = sheet.get('state', 'visible') != 'visible'
                item['selected_by_default'] = not item['hidden'] and not any(d.get('selected_by_default') for d in result)
                result.append(item)
        return result

def identifier(value, index, used):
    name = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode().lower()
    name = re.sub('[^a-z0-9_]+', '_', name).strip('_')[:54] or 'column_' + str(index + 1)
    if name[0].isdigit():
        name = 'c_' + name
    base = name
    n = 2
    while name in used or name == '_govern_id':
        name = base + '_' + str(n)
        n += 1
    used.add(name)
    return name

def json_text(value):
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + json_text(v) for k, v in value.items()) + '}'
    if isinstance(value, list):
        return '[' + ','.join(json_text(v) for v in value) + ']'
    if isinstance(value, decimal.Decimal):
        return str(value)
    return json.dumps(value, ensure_ascii=False, allow_nan=False)

def normalize(name, rows, formulas=0, settings=None, budget=None):
    settings = reader_settings(settings)
    rows = list(rows)
    leading_blank_rows = 0
    if settings['header'] and settings['skip_blank_rows']:
        while leading_blank_rows < len(rows) and not any(v not in (None, '') for v in rows[leading_blank_rows]):
            leading_blank_rows += 1
        rows = rows[leading_blank_rows:]
    if not rows or (settings['header'] and len(rows) < 2):
        raise InvalidDataset('empty')
    width = len(rows[0]) if settings['header'] else max(map(len, rows))
    source_rows = rows[1:] if settings['header'] else rows
    headings = rows[0] if settings['header'] else ['column_' + str(i + 1) for i in range(width)]
    if not width or width > MAX_COLS or len(source_rows) > MAX_ROWS:
        raise InvalidDataset('limit')
    if width * (len(source_rows) + 1) > MAX_CELLS:
        raise InvalidDataset('limit')
    if any(v is not None and ('\x00' in str(v) or len(str(v).encode('utf-8')) > 1024 * 1024) for v in headings):
        raise InvalidDataset('limit')
    used = set()
    columns = [{'source': str(v or ''), 'name': identifier(v, i, used), 'type': 'LONGTEXT'} for i, v in enumerate(headings)]
    data = []
    blank_rows = leading_blank_rows
    missing_values = 0
    for ordinal, row in enumerate(source_rows, (2 if settings['header'] else 1) + leading_blank_rows):
        if len(row) > width:
            raise InvalidDataset('shape', ordinal)
        if all(v in (None, '') for v in row):
            blank_rows += 1
            if settings['skip_blank_rows']:
                continue
        missing_values += width - len(row)
        consume_cells(budget, width - len(row))
        converted = []
        for v in row + [None] * (width - len(row)):
            if isinstance(v, (list, dict)):
                v = json_text(v)
            elif isinstance(v, bool):
                v = '1' if v else '0'
            elif v is not None:
                v = str(v)
            if isinstance(v, str) and settings['trim_whitespace']:
                v = v.strip()
            if v == '' and settings['empty_as_null']:
                v = None
            if v is not None and ('\x00' in v or len(v.encode('utf-8')) > 1024 * 1024):
                raise InvalidDataset('limit')
            converted.append(v)
        data.append(converted)
    if not data:
        raise InvalidDataset('empty')
    # Keep source values exact. Types are suggestions, never silent coercion.
    for i, column in enumerate(columns):
        vals = [r[i] for r in data if r[i] not in (None, '')]
        if vals and all(re.fullmatch(r'-?(0|[1-9][0-9]*)', v) and -(2**63) <= int(v) < 2**63 for v in vals):
            column['suggestion'] = 'integer'
        elif vals and all(re.fullmatch(r'\d{4}-\d\d-\d\d(?:[ T].*)?', v) for v in vals):
            column['suggestion'] = 'date'
        else:
            column['suggestion'] = 'text'
        column['empty'] = sum(r[i] in (None, '') for r in data)
        column['distinct'] = len(set(r[i] for r in data))
        column['unique'] = len(vals) == len(data) and len(set(vals)) == len(data)
    suggestion = identifier(pathlib.Path(name).stem, 0, set())
    return {'name': name, 'suggested_name': suggestion, 'columns': columns, 'rows': data, 'count': len(data), 'formulas': formulas,
            'duplicate_rows': len(data) - len(set(tuple(r) for r in data)),
            'blank_rows': blank_rows, 'skipped_blank_rows': blank_rows if settings['skip_blank_rows'] else 0,
            'missing_values': missing_values, 'settings': settings}

def read(raw, name, settings=None, budget=None):
    settings = reader_settings(settings)
    ext = pathlib.Path(name).suffix.lower()
    if ext == '.xlsx':
        return xlsx(raw, settings, budget)
    if ext in ('.csv', '.tsv', '.txt'):
        csv.field_size_limit(1024 * 1024)
        text = raw.decode('utf-8-sig')
        try:
            dialect = csv.Sniffer().sniff(text[:65536], delimiters=',;\t|')
        except csv.Error:
            dialect = csv.excel_tab if ext in ('.tsv', '.txt') else csv.excel
        rows = []
        options = {} if settings['delimiter'] == 'auto' else {'delimiter': settings['delimiter']}
        for row in csv.reader(io.StringIO(text, newline=''), dialect, **options):
            if len(rows) > MAX_ROWS or len(row) > MAX_COLS:
                raise InvalidDataset('limit')
            consume_cells(budget, len(row))
            rows.append(row)
        item = normalize(name, rows, settings=settings, budget=budget)
        item['delimiter'] = options.get('delimiter', dialect.delimiter)
        item['selected_by_default'] = True
        return [item]
    if ext == '.json':
        value = json.loads(raw.decode('utf-8-sig'), parse_float=decimal.Decimal, parse_constant=lambda value: (_ for _ in ()).throw(InvalidDataset('json_shape')))
        if not isinstance(value, list) or not value or not all(isinstance(r, dict) for r in value):
            raise InvalidDataset('json_shape')
        keys = list(dict.fromkeys(k for row in value for k in row))
        consume_cells(budget, len(keys) * (len(value) + 1))
        # A JSON object containing only nulls is still a record, not a blank CSV row.
        item = normalize(name, [keys] + [[r.get(k) for k in keys] for r in value], settings={**settings, 'header': True, 'skip_blank_rows': False}, budget=budget)
        item['selected_by_default'] = True
        return [item]
    if ext == '.zip':
        result = []
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            check_archive(z)
            for entry in z.infolist():
                if not entry.is_dir() and pathlib.Path(entry.filename).suffix.lower() in ('.xlsx', '.csv', '.tsv', '.txt', '.json'):
                    if len(result) >= 32:
                        raise InvalidDataset('limit')
                    result.extend(read(z.read(entry), entry.filename, settings, budget))
        if not result:
            raise InvalidDataset('unsupported')
        return result
    raise InvalidDataset('unsupported')

def parse(raw, name, settings=None):
    if len(raw) > MAX_BYTES:
        raise InvalidDataset('limit')
    settings = reader_settings(settings)
    datasets = read(raw, name, settings, {'cells': 0})
    if not datasets or sum(d['count'] for d in datasets) > MAX_ROWS or len(datasets) > 32:
        raise InvalidDataset('limit')
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'settings': settings, 'datasets': datasets}

if __name__ == '__main__':
    try:
        # Linux worker bounds supplement the file/row/column limits.
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
        resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
        settings = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        result = parse(sys.stdin.buffer.read(MAX_BYTES + 1), sys.argv[1], settings)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({'error': str(error) if isinstance(error, InvalidDataset) else 'invalid',
                          'row': getattr(error, 'row', None)}))
        sys.exit(1)
