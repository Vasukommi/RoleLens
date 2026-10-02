"""Local OCR of selected PDF pages. Rendering and subprocess work have explicit bounds."""

import math
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import pypdfium2 as pdfium

# PDFium is not thread-safe. Legacy HTTP parsing may run in multiple pool threads.
_render_lock = threading.Lock()
MAX_OCR_PIXELS = 6_000_000
MAX_OCR_SECONDS = 120


class OcrError(ValueError):
    pass


def extract_pages(content: bytes, indices: list[int]) -> dict[int, str]:
    executable = shutil.which("tesseract")
    if not executable:
        raise OcrError(
            "Scanned PDFs require local OCR. Install Tesseract and retry the application."
        )
    deadline = time.monotonic() + MAX_OCR_SECONDS
    results = {}
    with tempfile.TemporaryDirectory(prefix="rolelens-ocr-") as directory:
        for index in indices:
            if time.monotonic() >= deadline:
                raise OcrError("OCR exceeded the document time limit. Try a shorter text PDF.")
            image_path = Path(directory) / "page.png"
            with _render_lock, pdfium.PdfDocument(content) as document:
                page = document[index]
                bitmap = None
                image = None
                try:
                    width, height = page.get_size()
                    if not all(math.isfinite(v) and v > 0 for v in (width, height)):
                        raise OcrError("The scanned PDF has invalid page dimensions.")
                    scale = min(2.5, math.sqrt(MAX_OCR_PIXELS / (width * height)))
                    bitmap = page.render(scale=scale)
                    image = bitmap.to_pil()
                    image.save(image_path)
                finally:
                    if image is not None:
                        image.close()
                    if bitmap is not None:
                        bitmap.close()
                    page.close()
            try:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OcrError("OCR exceeded the document time limit. Try a shorter text PDF.")
                result = subprocess.run(
                    [executable, str(image_path), "stdout", "-l", "eng", "--psm", "3"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    timeout=min(25, remaining),
                    check=True,
                    env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                )
                results[index] = result.stdout.decode("utf-8", errors="replace").strip()
            except subprocess.TimeoutExpired as error:
                raise OcrError("OCR timed out on a page. Try exporting a text PDF.") from error
            except (subprocess.CalledProcessError, OSError) as error:
                raise OcrError(
                    "Local OCR failed. Check Tesseract's English language data."
                ) from error
    if not any(results.values()):
        raise OcrError("OCR found no usable text. Upload a readable text PDF or DOCX.")
    return results
