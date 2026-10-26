import os
import shutil
import tempfile
import json
from typing import List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from scraper import extract_video_id, fetch_video_metadata, get_youtube_transcript
from analyzer import analyze_keywords_and_occurrences
from transcriber import transcribe_audio_file
from summarizer import summarize_transcript

app = FastAPI(
    title="VideoPulse - Audio/Video Keyword Scraper & Analyzer API",
    description="Extracts transcripts from YouTube videos and uploaded media files, detects top keywords, computes exact frequencies with numbered occurrence tracking (#1, #2, #3), and maps timestamps.",
    version="2.0.0"
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

class ScrapeRequest(BaseModel):
    url: str
    custom_keywords: Optional[List[str]] = []

class AnalyzeRequest(BaseModel):
    segments: List[dict]
    custom_keywords: List[str]

class SummarizeRequest(BaseModel):
    segments: List[dict]

@app.post("/api/scrape")
async def scrape_video(request: ScrapeRequest):
    video_id = extract_video_id(request.url)
    if not video_id:
        raise HTTPException(
            status_code=400, 
            detail="Invalid YouTube URL or Video ID. Please provide a valid YouTube link (e.g., https://www.youtube.com/watch?v=... or https://youtu.be/...)."
        )
        
    metadata = fetch_video_metadata(video_id)
    transcript_res = get_youtube_transcript(video_id)
    
    if not transcript_res["success"]:
        return {
            "success": False,
            "metadata": metadata,
            "error": transcript_res.get("error", "Failed to retrieve transcript.")
        }
        
    segments = transcript_res["segments"]
    custom_kws = request.custom_keywords or []
    
    analysis = analyze_keywords_and_occurrences(
        segments=segments, 
        custom_keywords=custom_kws, 
        top_n_auto=15
    )
    
    return {
        "success": True,
        "is_uploaded": False,
        "metadata": metadata,
        "duration": transcript_res["duration"],
        "full_text": transcript_res["full_text"],
        "segment_count": transcript_res["segment_count"],
        "segments": segments,
        "analysis": analysis
    }

@app.post("/api/upload")
async def upload_media_file(
    file: UploadFile = File(...),
    custom_keywords: Optional[str] = Form("[]")
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected for upload.")
        
    ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.mov', '.mkv', '.avi', '.ogg']
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Unsupported file format '{ext}'. Allowed: {', '.join(allowed_exts)}")
        
    temp_path = os.path.join(UPLOADS_DIR, f"upload_{os.urandom(6).hex()}{ext}")
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Transcribe audio file
        trans_res = transcribe_audio_file(temp_path)
        
        if not trans_res["success"]:
            return {
                "success": False,
                "error": trans_res.get("error", "Failed to transcribe uploaded file.")
            }
            
        parsed_custom_kws = []
        if custom_keywords:
            try:
                parsed_custom_kws = json.loads(custom_keywords)
            except Exception:
                parsed_custom_kws = [k.strip() for k in custom_keywords.split(',') if k.strip()]
                
        segments = trans_res["segments"]
        analysis = analyze_keywords_and_occurrences(
            segments=segments,
            custom_keywords=parsed_custom_kws,
            top_n_auto=15
        )
        
        # Public URL for uploaded file playback
        file_relative_url = f"/uploads/{os.path.basename(temp_path)}"
        
        metadata = {
            "title": file.filename,
            "author": "Uploaded File",
            "media_url": file_relative_url,
            "is_video": ext in ['.mp4', '.webm', '.mov', '.mkv', '.avi']
        }
        
        return {
            "success": True,
            "is_uploaded": True,
            "metadata": metadata,
            "duration": trans_res["duration"],
            "full_text": trans_res["full_text"],
            "segment_count": trans_res["segment_count"],
            "segments": segments,
            "analysis": analysis
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File processing error: {str(e)}")

@app.post("/api/summarize")
async def summarize_video(request: SummarizeRequest):
    """Generate chapter summaries, study notes, and key takeaways from transcript segments."""
    if not request.segments:
        raise HTTPException(status_code=400, detail="Segments list cannot be empty.")
    result = summarize_transcript(request.segments)
    return result

@app.post("/api/analyze-custom")
async def analyze_custom_keywords(request: AnalyzeRequest):
    if not request.segments:
        raise HTTPException(status_code=400, detail="Segments list cannot be empty.")
        
    analysis = analyze_keywords_and_occurrences(
        segments=request.segments, 
        custom_keywords=request.custom_keywords, 
        top_n_auto=15
    )
    return {
        "success": True,
        "analysis": analysis
    }

# Mount static and uploads directory
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

@app.get("/")
async def read_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Audio/Video Scraper API running."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
