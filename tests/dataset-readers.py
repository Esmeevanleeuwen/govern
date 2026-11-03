"""Run with python3 tests/dataset-readers.py. Fixtures are generated locally."""
import importlib.util
import io
import pathlib
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('tabular', pathlib.Path(__file__).parents[1] / 'app/importers/tabular.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Readers(unittest.TestCase):
    def test_csv(self):
        d = m.parse('ID;Naam;Naam\r\n001;"a;b";é\r\n002;"twee\nregels";\r\n'.encode(), 'test.csv')['datasets'][0]
        self.assertEqual(d['count'], 2)
        self.assertEqual([c['name'] for c in d['columns']], ['id', 'naam', 'naam_2'])
        self.assertEqual(d['rows'][0], ['001', 'a;b', 'é'])
        self.assertEqual(d['rows'][1][1], 'twee\nregels')
        self.assertEqual(d['columns'][0]['suggestion'], 'text')
    def test_json_exact(self):
        d = m.parse(b'[{"id":9007199254740993,"value":null},{"id":"001","value":""}]', 'test.json')['datasets'][0]
        self.assertEqual(d['rows'], [['9007199254740993', None], ['001', '']])
    def test_nested_json_exact(self):
        d = m.parse(b'[{"nested":{"id":9007199254740993,"value":0.1234567890123456789}}]', 'test.json')['datasets'][0]
        self.assertEqual(d['rows'][0][0], '{"id":9007199254740993,"value":0.1234567890123456789}')
    def test_duplicate_rows(self):
        d = m.parse(b'a,b\n1,2\n1,2\n', 'a.csv')['datasets'][0]
        self.assertEqual(d['duplicate_rows'], 1)
        self.assertFalse(d['columns'][0]['unique'])
    def test_invalid_shapes(self):
        for raw, name in [(b'{"a":1}', 'a.json'), (b'a,b\n1,2,3', 'a.csv'), (b'a,b', 'a.csv'), (b'x', 'a.exe'), (b'a\n\xff', 'a.csv')]:
            with self.assertRaises((ValueError, UnicodeError)):
                m.parse(raw, name)
    def test_limit(self):
        with self.assertRaises(m.InvalidDataset):
            m.parse(b'a' * (m.MAX_BYTES + 1), 'a.csv')
        with self.assertRaises(m.InvalidDataset):
            m.normalize('x', [['c'] * 257, ['v'] * 257])
    def test_zip_no_extraction(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            z.writestr('../../table.csv', 'id,name\n1,one\n')
        self.assertEqual(m.parse(out.getvalue(), 'bundle.zip')['datasets'][0]['count'], 1)
    def test_xlsx_sparse_dates_and_formulas(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            z.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>')
            z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
            z.writestr('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>')
            z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>ID</t></is></c><c r="B1" t="inlineStr"><is><t>Blank</t></is></c><c r="C1" t="inlineStr"><is><t>Date</t></is></c></row><row><c r="A2"><f>1+1</f><v>2</v></c><c r="C2" s="1"><v>36526</v></c></row></sheetData></worksheet>')
        d = m.parse(out.getvalue(), 'book.xlsx')['datasets'][0]
        self.assertEqual(d['rows'], [['2', None, '2000-01-01 00:00:00']])
        self.assertEqual(d['formulas'], 1)
    def test_archive_expansion_limit(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('a.csv', 'a' * 100)
        with zipfile.ZipFile(io.BytesIO(out.getvalue())) as z:
            old = m.MAX_EXPANDED
            try:
                m.MAX_EXPANDED = 99
                with self.assertRaises(m.InvalidDataset):
                    m.check_archive(z)
            finally:
                m.MAX_EXPANDED = old

if __name__ == '__main__':
    unittest.main()
