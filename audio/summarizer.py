"""
summarizer.py  ─  Local NLP Summarization Engine for StudyScribe
=================================================================
Performs fully offline, extractive summarization of timestamped
transcript segments.  No external API key is required.

Pipeline:
  1. chunk_segments()        – splits segments into ~4-min chapters
  2. _extract_chapter_title  – top bigram / word-group heuristic
  3. _summarize_chunk()      – TF-IDF scored extractive summary
  4. _generate_bullets()     – top-N key-point sentences
  5. _extract_key_terms()    – core vocabulary of the chapter
  6. summarize_transcript()  – assembles everything + markdown notes
"""

import re
from collections import Counter
from typing import Any, Dict, List, Tuple

# ──────────────────────────────────────────────────────────────────────────────
# Stop-word list (mirrors analyzer.py for consistency)
# ──────────────────────────────────────────────────────────────────────────────
STOPWORDS = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
    'any', 'are', "aren't", 'as', 'at', 'be', 'because', 'been', 'before', 'being',
    'below', 'between', 'both', 'but', 'by', 'can', "can't", 'cannot', 'could',
    "couldn't", 'did', "didn't", 'do', 'does', "doesn't", 'doing', "don't",
    'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', "hadn't",
    'has', "hasn't", 'have', "haven't", 'having', 'he', "he'd", "he'll", "he's",
    'her', 'here', "here's", 'hers', 'herself', 'him', 'himself', 'his', 'how',
    "how's", 'i', "i'd", "i'll", "i'm", "i've", 'if', 'in', 'into', 'is',
    "isn't", 'it', "it's", 'its', 'itself', "let's", 'me', 'more', 'most',
    "mustn't", 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
    'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over',
    'own', 'same', "shan't", 'she', "she'd", "she'll", "she's", 'should',
    "shouldn't", 'so', 'some', 'such', 'than', 'that', "that's", 'the', 'their',
    'theirs', 'them', 'themselves', 'then', 'there', "there's", 'these', 'they',
    "they'd", "they'll", "they're", "they've", 'this', 'those', 'through',
    'to', 'too', 'under', 'until', 'up', 'very', 'was', "wasn't", 'we', "we'd",
    "we'll", "we're", "we've", 'were', "weren't", 'what', "what's", 'when',
    "when's", 'where', "where's", 'which', 'while', 'who', "who's", 'whom',
    'why', "why's", 'with', "won't", 'would', "wouldn't", 'you', "you'd",
    "you'll", "you're", "you've", 'your', 'yours', 'yourself', 'yourselves',
    'like', 'know', 'just', 'going', 'think', 'really', 'yeah', 'want', 'said',
    'say', 'see', 'right', 'also', 'well', 'got', 'get', 'thing', 'things', 'way',
    'people', 'kind', 'much', 'mean', 'take', 'come', 'make', 'us', 'now', 'one',
    'two', 'three', 'four', 'five', 'actually', 'basically', 'literally', 'gonna',
    'wanna', 'okay', 'ok', 'um', 'uh', 'hey', 'hi', 'hello', 'let', 'go', 'use',
    'using', 'used', 'look', 'looks', 'looking', 'show', 'shows', 'talk', 'today',
    'video', 'channel', 'watch', 'subscribe', 'click', 'here', 'something',
}


# ──────────────────────────────────────────────────────────────────────────────
# Low-level helpers
# ──────────────────────────────────────────────────────────────────────────────

def _tok(text: str) -> List[str]:
    return re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())


def _content(words: List[str]) -> List[str]:
    return [w for w in words if w not in STOPWORDS]


def _split_sentences(text: str) -> List[str]:
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [p.strip() for p in parts if len(p.strip()) > 25]


def _freq_map(text: str) -> Dict[str, float]:
    words = _content(_tok(text))
    if not words:
        return {}
    counts = Counter(words)
    mx = max(counts.values())
    return {w: c / mx for w, c in counts.items()}


def _score_sentences(
    sentences: List[str],
    fm: Dict[str, float],
) -> List[Tuple[float, int, str]]:
    scored = []
    n = len(sentences)
    for i, sent in enumerate(sentences):
        words = _content(_tok(sent))
        if not words:
            scored.append((0.0, i, sent))
            continue
        tf = sum(fm.get(w, 0.0) for w in words) / len(words)
        pos = 1.25 if i < 2 else (1.10 if i >= n - 2 else 1.00)
        wc = len(sent.split())
        length = 1.0 if 10 <= wc <= 45 else 0.80
        scored.append((tf * pos * length, i, sent))
    return sorted(scored, key=lambda x: -x[0])


def _fmt(seconds: float) -> str:
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m:02d}:{s:02d}"


# ──────────────────────────────────────────────────────────────────────────────
# Per-chunk helpers
# ──────────────────────────────────────────────────────────────────────────────

def _chapter_title(text: str, num: int) -> str:
    words = _content(_tok(text))
    if not words:
        return f"Chapter {num}"
    bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)]
    if bigrams:
        top_bg, top_c = Counter(bigrams).most_common(1)[0]
        if top_c >= 2:
            return top_bg.title()
    top = [w for w, _ in Counter(words).most_common(3)]
    return " & ".join(w.title() for w in top[:2]) if top else f"Chapter {num}"


def _summarize_chunk(text: str, n_sents: int = 4) -> str:
    sents = _split_sentences(text)
    if not sents:
        return text[:400].strip() + "..."
    fm = _freq_map(text)
    scored = _score_sentences(sents, fm)
    top = sorted(scored[:n_sents], key=lambda x: x[1])
    result = " ".join(s for _, _, s in top)
    return result if result else text[:400].strip() + "..."


def _bullets(text: str, n: int = 4) -> List[str]:
    sents = _split_sentences(text)
    if not sents:
        return []
    fm = _freq_map(text)
    scored = _score_sentences(sents, fm)
    out: List[str] = []
    seen: set = set()
    for _, _, sent in scored:
        fp = frozenset(_tok(sent)[:5])
        if fp in seen:
            continue
        seen.add(fp)
        clean = sent.strip()
        if not clean.endswith(('.', '!', '?')):
            clean += '.'
        out.append(clean)
        if len(out) >= n:
            break
    return out


def _key_terms(text: str, n: int = 7) -> List[str]:
    words = [w for w in _tok(text) if w not in STOPWORDS and len(w) >= 4]
    return [w for w, _ in Counter(words).most_common(n)]


# ──────────────────────────────────────────────────────────────────────────────
# Chunking
# ──────────────────────────────────────────────────────────────────────────────

def chunk_segments(
    segments: List[Dict[str, Any]],
    chunk_seconds: float = 240.0,
) -> List[Dict[str, Any]]:
    if not segments:
        return []
    chunks: List[Dict] = []
    current: List[Dict] = []
    chunk_start = segments[0]['start']
    for i, seg in enumerate(segments):
        current.append(seg)
        elapsed = seg['start'] - chunk_start
        if elapsed >= chunk_seconds and i < len(segments) - 1:
            last = current[-1]
            chunks.append({
                'start': chunk_start,
                'end': last.get('end', last['start'] + last.get('duration', 0.0)),
                'segments': list(current),
            })
            current = []
            chunk_start = segments[i + 1]['start']
    if current:
        last = current[-1]
        chunks.append({
            'start': chunk_start,
            'end': last.get('end', last['start'] + last.get('duration', 0.0)),
            'segments': current,
        })
    return chunks


# ──────────────────────────────────────────────────────────────────────────────
# Main public function
# ──────────────────────────────────────────────────────────────────────────────

def summarize_transcript(segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Summarize a list of timestamped transcript segments.

    Returns a dict with:
      success, overall_summary, key_takeaways, chapters, notes_markdown
    """
    if not segments:
        return {"success": False, "error": "No segments provided."}

    full_text = " ".join(seg.get('text', '') for seg in segments)
    raw_chunks = chunk_segments(segments, chunk_seconds=240.0)

    chapters: List[Dict] = []
    for i, chunk in enumerate(raw_chunks):
        ctext = " ".join(seg.get('text', '') for seg in chunk['segments'])
        chapters.append({
            "chapter_num": i + 1,
            "start":       chunk["start"],
            "end":         chunk["end"],
            "title":       _chapter_title(ctext, i + 1),
            "timestamp":   _fmt(chunk["start"]),
            "summary":     _summarize_chunk(ctext, n_sents=4),
            "bullets":     _bullets(ctext, n=4),
            "key_terms":   _key_terms(ctext, n=7),
        })

    # Overall summary
    all_sents = _split_sentences(full_text)
    fm_full = _freq_map(full_text)
    scored_all = _score_sentences(all_sents, fm_full)
    top5 = sorted(scored_all[:5], key=lambda x: x[1])
    overall_summary = (
        " ".join(s for _, _, s in top5)
        if top5 else full_text[:500].strip() + "..."
    )

    key_takeaways = [ch["bullets"][0] for ch in chapters if ch["bullets"]]

    return {
        "success":         True,
        "overall_summary": overall_summary,
        "key_takeaways":   key_takeaways,
        "chapters":        chapters,
        "notes_markdown":  _build_notes_md(chapters, overall_summary, key_takeaways),
    }


def _build_notes_md(
    chapters: List[Dict],
    overall: str,
    takeaways: List[str],
) -> str:
    lines: List[str] = [
        "# Study Notes", "",
        "## Overview", "",
        overall, "",
    ]
    if takeaways:
        lines += ["## Key Takeaways", ""]
        for t in takeaways:
            lines.append(f"- {t}")
        lines.append("")
    lines += ["---", "## Chapter Notes", ""]
    for ch in chapters:
        lines += [
            f"### Chapter {ch['chapter_num']}: {ch['title']}  [{ch['timestamp']}]",
            "", ch["summary"], "",
        ]
        if ch["bullets"]:
            lines += ["**Key Points:**", ""]
            for b in ch["bullets"]:
                lines.append(f"- {b}")
            lines.append("")
        if ch["key_terms"]:
            lines.append(f"**Core Terms:** {', '.join(ch['key_terms'])}")
            lines.append("")
        lines += ["---", ""]
    return "\n".join(lines)
