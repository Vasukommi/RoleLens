import shutil
import subprocess
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw, ImageFont

from rolelens import documents, ocr
from rolelens.documents import DocumentError, parse_resume


def test_scanned_pdf_reports_missing_local_engine(monkeypatch):
    monkeypatch.setattr(ocr.shutil, "which", lambda _name: None)
    with pytest.raises(ocr.OcrError, match="Install Tesseract"):
        ocr.extract_pages(b"not rendered", [0])


def test_hybrid_pdf_preserves_native_pages_and_marks_ocr(monkeypatch):
    native = "Built Python APIs with FastAPI and maintained production services."
    recovered = "Designed PostgreSQL tables and optimized database indexes."
    reader = SimpleNamespace(
        is_encrypted=False,
        pages=[
            SimpleNamespace(extract_text=lambda: native),
            SimpleNamespace(extract_text=lambda: ""),
        ],
    )
    monkeypatch.setattr(documents, "PdfReader", lambda _stream: reader)

    def extract(_content, indices):
        assert indices == [1]
        return {1: recovered}

    monkeypatch.setattr(documents, "extract_pages", extract)
    result = parse_resume("mixed.pdf", b"synthetic placeholder")
    assert result.text == f"{native}\n\n{recovered}"
    assert result.extraction_method == "mixed"
    assert all(passage.text in result.text for passage in result.passages)


def test_ocr_failure_never_becomes_a_model_assessment(monkeypatch):
    monkeypatch.setattr(
        documents,
        "PdfReader",
        lambda _stream: SimpleNamespace(
            is_encrypted=False, pages=[SimpleNamespace(extract_text=lambda: "")]
        ),
    )

    def failed(_content, _indices):
        raise ocr.OcrError("OCR timed out on a page.")

    monkeypatch.setattr(documents, "extract_pages", failed)
    with pytest.raises(DocumentError, match="OCR timed out"):
        parse_resume("scan.pdf", b"synthetic placeholder")


@pytest.mark.skipif(not shutil.which("tesseract"), reason="Local OCR binary not installed")
def test_real_ocr_recovers_text_from_an_image_pdf():
    image = Image.new("RGB", (1400, 600), "white")
    font_path = next(
        (
            path
            for path in [
                Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
                Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            ]
            if path.exists()
        ),
        None,
    )
    if font_path is None:
        pytest.skip("No suitable system font installed")
    font = ImageFont.truetype(str(font_path), 42)
    ImageDraw.Draw(image).multiline_text(
        (60, 90),
        "FICTIONAL DEMO RESUME\nBuilt Python APIs using FastAPI.\nOptimized PostgreSQL queries.",
        font=font,
        fill="black",
        spacing=24,
    )
    buffer = BytesIO()
    image.save(buffer, format="PDF", resolution=144)
    image.close()
    result = parse_resume("fictional-image.pdf", buffer.getvalue())
    assert result.extraction_method == "ocr"
    assert "Python" in result.text
    assert "PostgreSQL" in result.text


def test_ocr_timeout_is_bounded_and_sanitized(monkeypatch):
    class Page:
        def get_size(self):
            return (10_000, 10_000)

        def render(self, *, scale):
            assert 10_000 * 10_000 * scale * scale <= ocr.MAX_OCR_PIXELS + 1
            return SimpleNamespace(
                to_pil=lambda: Image.new("RGB", (10, 10), "white"), close=lambda: None
            )

        def close(self):
            pass

    class Document:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def __getitem__(self, _index):
            return Page()

    def timed_out(command, **kwargs):
        assert kwargs["timeout"] <= 25
        assert kwargs["stderr"] == subprocess.DEVNULL
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr(ocr.shutil, "which", lambda _name: "/synthetic/tesseract")
    monkeypatch.setattr(ocr.pdfium, "PdfDocument", lambda _content: Document())
    monkeypatch.setattr(ocr.subprocess, "run", timed_out)
    with pytest.raises(ocr.OcrError, match="OCR timed out"):
        ocr.extract_pages(b"synthetic", [0])
