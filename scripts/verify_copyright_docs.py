from pathlib import Path
from zipfile import ZipFile

from docx import Document


BASE = Path(__file__).resolve().parents[1] / "docs" / "copyright"


def main() -> None:
    for path in sorted(BASE.glob("*.docx")):
        doc = Document(path)
        texts = [para.text for para in doc.paragraphs if para.text.strip()]
        print(f"--- {path.name}")
        print(f"paragraphs={len(texts)}")
        with ZipFile(path) as package:
            names = set(package.namelist())
            has_header = any(name.startswith("word/header") for name in names)
            has_footer = any(name.startswith("word/footer") for name in names)
            print(f"docxPackage=ok header={has_header} footer={has_footer}")
        if path.name.startswith("01_") or path.name.startswith("02_"):
            print(f"officialLinePages={len(texts) // 30} linesPerPage=30 remainder={len(texts) % 30}")
        if path.name.startswith("03_"):
            print(f"sourcePages={len(texts) // 50} linesPerPage=50 remainder={len(texts) % 50}")
            print(f"firstSourceLine={texts[0]}")
            print(f"lastSourceLine={texts[-1]}")
        for text in texts[:10]:
            print(text)


if __name__ == "__main__":
    main()
