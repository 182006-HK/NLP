import re
import urllib.request
import json
from typing import List, Dict, Any, Optional
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound, VideoUnavailable

def extract_video_id(url_or_id: str) -> Optional[str]:
    """
    Extract 11-character YouTube video ID from various URL formats or return raw ID.
    """
    url_or_id = url_or_id.strip()
    if len(url_or_id) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', url_or_id):
        return url_or_id
    
    patterns = [
        r'(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[\&\?\/]|$)',
        r'youtu\.be\/([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/embed\/([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
            
    return None

def fetch_video_metadata(video_id: str) -> Dict[str, Any]:
    """
    Fetch video title, author, thumbnail using YouTube oEmbed API.
    """
    oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    req = urllib.request.Request(
        oembed_url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            return {
                "video_id": video_id,
                "title": data.get("title", f"YouTube Video ({video_id})"),
                "author": data.get("author_name", "YouTube Channel"),
                "thumbnail": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
                "thumbnail_fallback": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
            }
    except Exception:
        return {
            "video_id": video_id,
            "title": f"YouTube Video ({video_id})",
            "author": "YouTube Channel",
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
            "thumbnail_fallback": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
        }

def get_youtube_transcript(video_id: str) -> Dict[str, Any]:
    """
    Fetches transcript segments with start times, duration, and text.
    Handles YouTubeTranscriptApi 1.2+ instance methods and language fallbacks.
    """
    api = YouTubeTranscriptApi()
    raw_data = None
    
    # 1. Try direct fetch
    try:
        raw_data = api.fetch(video_id)
    except Exception:
        pass
        
    # 2. If direct fetch failed, try listing transcripts and pick English / first available
    if not raw_data:
        try:
            transcript_list = api.list(video_id)
            target_transcript = None
            
            # Prefer English, then English auto-gen, then any language
            for tr in transcript_list:
                lang = getattr(tr, 'language_code', '')
                if lang.startswith('en'):
                    target_transcript = tr
                    break
                    
            if not target_transcript:
                for tr in transcript_list:
                    target_transcript = tr
                    break
                    
            if target_transcript:
                raw_data = target_transcript.fetch()
        except Exception:
            pass

    if not raw_data:
        return {
            "success": False,
            "error": "Transcripts are disabled or unavailable for this video. Please try another YouTube video with captions/subtitles."
        }

    segments = []
    full_text_parts = []
    total_duration = 0.0
    
    for item in raw_data:
        if isinstance(item, dict):
            start = float(item.get('start', 0.0))
            duration = float(item.get('duration', 0.0))
            text = str(item.get('text', '')).strip()
        else:
            start = float(getattr(item, 'start', 0.0))
            duration = float(getattr(item, 'duration', 0.0))
            text = str(getattr(item, 'text', '')).strip()
            
        # Clean up line breaks in segment text
        text = text.replace('\n', ' ')
        if text:
            segments.append({
                "start": round(start, 2),
                "end": round(start + duration, 2),
                "duration": round(duration, 2),
                "text": text
            })
            full_text_parts.append(text)
            total_duration = max(total_duration, start + duration)
            
    full_text = " ".join(full_text_parts)
    
    return {
        "success": True,
        "video_id": video_id,
        "segments": segments,
        "full_text": full_text,
        "duration": round(total_duration, 2),
        "segment_count": len(segments)
    }
