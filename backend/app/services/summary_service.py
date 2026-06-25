import google.generativeai as genai
from app.config import GEMINI_API_KEY
from app.models.segment import Segment

genai.configure(api_key=GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-1.5-flash")


def summarize(segments: list[Segment]) -> str:
    """Generate a Mongolian summary of the video using translated segment texts."""
    text = " ".join(
        seg.translated_text or seg.text
        for seg in segments
        if (seg.translated_text or seg.text).strip()
    )
    if not text:
        return ""

    prompt = (
        "Дараах видеоны агуулгыг монгол хэлээр товч тайлбарлана уу. "
        "3-5 өгүүлбэрт багтаана уу.\n\n" + text[:8000]
    )
    response = _model.generate_content(prompt)
    return response.text.strip()
