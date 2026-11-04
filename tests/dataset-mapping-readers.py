"""Reader settings and exact-value contracts for the unified dataset flow."""
import importlib.util
import io
import pathlib
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('tabular', pathlib.Path(__file__).parents[1] / 'app/importers/tabular.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MappingReaders(unittest.TestCase):
    def test_settings_preserve_and_reparse(self):
        raw = b'\npostal;name\n00123; a \n;\n00234;\n'
        d = m.parse(raw, 'Contacts export.csv')['datasets'][0]
        self.assertEqual(d['rows'], [['00123', ' a '], ['00234', '']])
        self.assertEqual(d['skipped_blank_rows'], 2)
        self.assertEqual(d['suggested_name'], 'contacts_export')
        d2 = m.parse(raw, 'a.csv', {'delimiter': ';', 'trim_whitespace': True, 'empty_as_null': True})['datasets'][0]
        self.assertEqual(d2['rows'], [['00123', 'a'], ['00234', None]])
    def test_no_header_and_blank_rows(self):
        d = m.parse(b'001,A\n,\n002,B', 'a.csv', {'header': False, 'skip_blank_rows': False})['datasets'][0]
        self.assertEqual([c['name'] for c in d['columns']], ['column_1', 'column_2'])
        self.assertEqual(d['count'], 3)
        self.assertEqual(d['rows'][1], ['', ''])
        self.assertEqual(d['skipped_blank_rows'], 0)
        with self.assertRaises(m.InvalidDataset):
            m.parse(b'a,b\n,\n\n', 'empty.csv')
    def test_json_null_rows_and_nested_values(self):
        d = m.parse(b'[{"a":null},{"b":{"x":0.1234567890123456789}},{"a":""}]', 'a.json')['datasets'][0]
        self.assertEqual(d['count'], 3)
        self.assertEqual(d['rows'][0], [None, None])
        self.assertEqual(d['rows'][1][1], '{"x":0.1234567890123456789}')
        self.assertEqual(d['rows'][2], ['', None])
    def test_row_location_and_settings_are_strict(self):
        with self.assertRaises(m.InvalidDataset) as error:
            m.parse(b'a,b\n1,2\n3,4,5\n', 'a.csv', {'delimiter': ','})
        self.assertEqual(error.exception.row, 3)
        for settings in ({'header': 1}, {'delimiter': '||'}, {'surprise': True}):
            with self.assertRaises(m.InvalidDataset):
                m.parse(b'a\nb', 'a.csv', settings)
    def test_first_visible_sheet_is_default(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hidden" state="hidden" r:id="r1"/><sheet name="Visible" r:id="r2"/><sheet name="Other" r:id="r3"/></sheets></workbook>')
            z.writestr('xl/_rels/workbook.xml.rels', '<Relationships>' + ''.join('<Relationship Id="r%d" Target="worksheets/sheet%d.xml"/>' % (i, i) for i in (1, 2, 3)) + '</Relationships>')
            for i in (1, 2, 3):
                z.writestr('xl/worksheets/sheet%d.xml' % i, '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>A</t></is></c></row></sheetData></worksheet>')
        datasets = m.parse(archive.getvalue(), 'book.xlsx')['datasets']
        self.assertEqual([d['selected_by_default'] for d in datasets], [False, True, False])
        self.assertTrue(datasets[0]['hidden'])
    def test_combined_cell_limit_including_archive_members(self):
        old = m.MAX_CELLS
        try:
            m.MAX_CELLS = 7
            # Each member is valid in isolation; the combined source is not.
            self.assertEqual(m.parse(b'a,b\n1,2', 'a.csv')['datasets'][0]['count'], 1)
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('a.csv', 'a,b\n1,2')
                z.writestr('b.csv', 'a,b\n3,4')
            with self.assertRaises(m.InvalidDataset):
                m.parse(archive.getvalue(), 'files.zip')
            with self.assertRaises(m.InvalidDataset):
                m.parse(b'a,b,c,d\n1,2,3,4', 'a.csv')
        finally:
            m.MAX_CELLS = old

if __name__ == '__main__':
    unittest.main()
