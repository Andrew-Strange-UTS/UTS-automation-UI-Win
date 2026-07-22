#!/usr/bin/env python3
"""Generate an Excel .xlsx (and .csv) from docs/feature-uat.md.

Parses the numbered feature-walkthrough tables (Step / Expected result /
Pass/Fail / Notes) and produces a spreadsheet a tester can fill in: a Section
column, a frozen bold header, sensible column widths, and a Pass / Fail / N/A
dropdown on the Pass/Fail column. Uses only the Python standard library
(zipfile + hand-written OOXML), so it needs no third-party packages.

Run:  python3 scripts/uat_to_xlsx.py
Out:  docs/feature-uat.xlsx, docs/feature-uat.csv
"""

import csv
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "docs", "feature-uat.md")
OUT_XLSX = os.path.join(ROOT, "docs", "feature-uat.xlsx")
OUT_CSV = os.path.join(ROOT, "docs", "feature-uat.csv")

HEADERS = ["#", "Section", "Step / Function", "Expected Result", "Pass/Fail", "Notes"]


def strip_md(text):
    """Reduce inline markdown to plain text for a spreadsheet cell."""
    text = text.replace("**", "").replace("`", "")
    # Links [label](url) -> label
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text.strip()


def parse(md_path):
    """Return a list of (section, step, expected) rows from the step tables."""
    rows = []
    section = ""
    in_table = False
    with open(md_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            heading = re.match(r"^##\s+(.*)$", line)
            if heading:
                section = strip_md(heading.group(1))
                in_table = False
                continue
            if line.startswith("|"):
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                # Header row of a step table: start capturing after it.
                if any("Pass/Fail" in c for c in cells):
                    in_table = True
                    continue
                # Separator row like |---|---|
                if set("".join(cells).replace("-", "").replace(":", "")) <= set(""):
                    continue
                if in_table and len(cells) >= 2:
                    step = strip_md(cells[0])
                    expected = strip_md(cells[1])
                    if step:
                        rows.append((section, step, expected))
            else:
                in_table = False
    return rows


def xml_escape(s):
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def col_letter(idx):
    """0-based column index to a spreadsheet letter (A, B, ...)."""
    letters = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def cell_xml(ref, value, style):
    return (
        f'<c r="{ref}" s="{style}" t="inlineStr">'
        f"<is><t xml:space=\"preserve\">{xml_escape(value)}</t></is></c>"
    )


def build_sheet(data_rows):
    # Style ids (see styles.xml below): 1 header, 2 body-wrap, 3 section-bold.
    lines = []
    lines.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    lines.append(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    )
    # Freeze the header row.
    lines.append(
        "<sheetViews><sheetView workbookViewId=\"0\">"
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        "</sheetView></sheetViews>"
    )
    # Column widths.
    widths = [5, 26, 52, 60, 12, 30]
    cols = "".join(
        f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>'
        for i, w in enumerate(widths)
    )
    lines.append(f"<cols>{cols}</cols>")

    lines.append("<sheetData>")
    # Header row.
    header_cells = "".join(
        cell_xml(f"{col_letter(i)}1", h, 1) for i, h in enumerate(HEADERS)
    )
    lines.append(f'<row r="1">{header_cells}</row>')

    r = 2
    for n, (section, step, expected) in enumerate(data_rows, start=1):
        values = [str(n), section, step, expected, "", ""]
        cells = "".join(
            cell_xml(f"{col_letter(i)}{r}", v, 2) for i, v in enumerate(values)
        )
        lines.append(f'<row r="{r}">{cells}</row>')
        r += 1
    lines.append("</sheetData>")

    # Pass/Fail dropdown over the used range in column E.
    last = r - 1
    lines.append(
        '<dataValidations count="1">'
        f'<dataValidation type="list" allowBlank="1" showInputMessage="1" '
        f'showErrorMessage="1" sqref="E2:E{last}">'
        '<formula1>"Pass,Fail,N/A"</formula1></dataValidation>'
        "</dataValidations>"
    )
    lines.append("</worksheet>")
    return "".join(lines)


STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFB4423A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

WORKBOOK = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Feature UAT" sheetId="1" r:id="rId1"/></sheets>
</workbook>"""

WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""


def write_xlsx(path, data_rows):
    sheet = build_sheet(data_rows)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("xl/workbook.xml", WORKBOOK)
        z.writestr("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
        z.writestr("xl/styles.xml", STYLES)
        z.writestr("xl/worksheets/sheet1.xml", sheet)


def write_csv(path, data_rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(HEADERS)
        for n, (section, step, expected) in enumerate(data_rows, start=1):
            w.writerow([n, section, step, expected, "", ""])


def main():
    rows = parse(SRC)
    write_xlsx(OUT_XLSX, rows)
    write_csv(OUT_CSV, rows)
    print(f"Parsed {len(rows)} steps from {os.path.relpath(SRC, ROOT)}")
    print(f"Wrote {os.path.relpath(OUT_XLSX, ROOT)} and {os.path.relpath(OUT_CSV, ROOT)}")


if __name__ == "__main__":
    main()
