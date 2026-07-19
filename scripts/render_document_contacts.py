from __future__ import annotations

import argparse
import math
from pathlib import Path

from pdf2image import convert_from_path
from PIL import Image, ImageDraw


POPPLER = Path("C:/Users/bxw00/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin")


def render(pdf_path: Path, output_dir: Path) -> None:
    target = output_dir / pdf_path.stem
    target.mkdir(parents=True, exist_ok=True)
    pages = convert_from_path(str(pdf_path), dpi=90, poppler_path=str(POPPLER), fmt="png")
    for index, page in enumerate(pages, 1):
        page.save(target / f"page-{index:03d}.png")

    batch_size = 20
    for batch_index in range(math.ceil(len(pages) / batch_size)):
        batch = pages[batch_index * batch_size : (batch_index + 1) * batch_size]
        thumb_width = 210
        thumb_height = 297
        columns = 4
        rows = math.ceil(len(batch) / columns)
        sheet = Image.new("RGB", (columns * thumb_width, rows * (thumb_height + 24)), "white")
        draw = ImageDraw.Draw(sheet)
        for index, page in enumerate(batch):
            thumb = page.copy()
            thumb.thumbnail((thumb_width - 8, thumb_height - 8))
            x = (index % columns) * thumb_width + (thumb_width - thumb.width) // 2
            y = (index // columns) * (thumb_height + 24)
            sheet.paste(thumb, (x, y))
            page_no = batch_index * batch_size + index + 1
            draw.text((x + 4, y + thumb_height + 2), f"page {page_no}", fill="black")
        sheet.save(target / f"contact-{batch_index + 1:02d}.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("pdfs", nargs="+", type=Path)
    args = parser.parse_args()
    for pdf in args.pdfs:
        render(pdf.resolve(), args.output_dir.resolve())


if __name__ == "__main__":
    main()
