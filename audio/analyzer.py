import re
from collections import Counter
from typing import List, Dict, Any, Set

ENGLISH_STOPWORDS: Set[str] = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
    'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
    'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot', 'could',
    'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t',
    'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t',
    'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s',
    'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how',
    'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is',
    'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most',
    'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
    'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over',
    'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
    'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their',
    'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they',
    'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through',
    'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d',
    'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when',
    'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom',
    'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d',
    'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
    'like', 'know', 'just', 'going', 'think', 'really', 'yeah', 'want', 'said',
    'say', 'see', 'right', 'also', 'well', 'got', 'get', 'thing', 'things', 'way',
    'people', 'kind', 'much', 'mean', 'take', 'come', 'make', 'us'
}

def preprocess_words(text: str) -> List[str]:
    """Clean text and return list of tokenized lower-case words."""
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', '', text.lower())
    return [w for w in cleaned.split() if w]

def extract_top_keywords(full_text: str, top_n: int = 15) -> List[str]:
    """
    Extract top unigrams and phrases from full text filtering out stopwords.
    """
    words = preprocess_words(full_text)
    
    # 1. Single words (unigrams)
    filtered_unigrams = [w for w in words if w not in ENGLISH_STOPWORDS and len(w) > 2 and not w.isdigit()]
    unigram_counts = Counter(filtered_unigrams)
    
    # 2. Bigrams (2-word phrases)
    bigrams = []
    for i in range(len(words) - 1):
        w1, w2 = words[i], words[i+1]
        if w1 not in ENGLISH_STOPWORDS and w2 not in ENGLISH_STOPWORDS:
            if len(w1) > 2 and len(w2) > 2:
                bigrams.append(f"{w1} {w2}")
    bigram_counts = Counter(bigrams)
    
    results = []
    seen = set()
    
    for phrase, count in bigram_counts.most_common(5):
        if count >= 2:
            results.append(phrase)
            seen.add(phrase)
            
    for word, count in unigram_counts.most_common(top_n):
        if word not in seen and count >= 2:
            results.append(word)
            seen.add(word)
            
    if len(results) < top_n:
        for word, count in unigram_counts.most_common(top_n):
            if word not in seen:
                results.append(word)
                seen.add(word)
                if len(results) >= top_n:
                    break

    return results[:top_n]

def analyze_keywords_and_occurrences(
    segments: List[Dict[str, Any]], 
    custom_keywords: List[str] = None, 
    top_n_auto: int = 15
) -> Dict[str, Any]:
    """
    Analyzes segments for keyword frequencies and returns NUMBERED timestamped occurrences (#1, #2, #3...).
    """
    full_text = " ".join([seg['text'] for seg in segments])
    all_words = preprocess_words(full_text)
    total_word_count = len(all_words)
    
    # Extract auto keywords
    auto_keywords = extract_top_keywords(full_text, top_n=top_n_auto)
    
    # Combine user custom keywords and auto keywords
    combined_keywords = []
    seen_lower = set()
    
    if custom_keywords:
        for kw in custom_keywords:
            kw_clean = kw.strip()
            if kw_clean and kw_clean.lower() not in seen_lower:
                combined_keywords.append({"text": kw_clean, "is_custom": True})
                seen_lower.add(kw_clean.lower())
                
    for kw in auto_keywords:
        if kw.lower() not in seen_lower:
            combined_keywords.append({"text": kw, "is_custom": False})
            seen_lower.add(kw.lower())
            
    keyword_stats = []
    
    for kw_item in combined_keywords:
        kw_text = kw_item["text"]
        is_custom = kw_item["is_custom"]
        
        escaped_kw = re.escape(kw_text)
        pattern = re.compile(r'\b' + escaped_kw + r'\b', re.IGNORECASE)
        
        occurrences = []
        total_freq = 0
        occurrence_counter = 1
        
        for seg_idx, seg in enumerate(segments):
            seg_text = seg['text']
            matches = list(pattern.finditer(seg_text))
            if matches:
                total_freq += len(matches)
                for _ in matches:
                    occurrences.append({
                        "occurrence_num": occurrence_counter,
                        "segment_index": seg_idx,
                        "start": seg['start'],
                        "end": seg['end'],
                        "duration": seg['duration'],
                        "segment_text": seg_text,
                        "keyword": kw_text
                    })
                    occurrence_counter += 1
                
        density = round((total_freq / total_word_count * 100), 2) if total_word_count > 0 else 0
        
        keyword_stats.append({
            "keyword": kw_text,
            "frequency": total_freq,
            "density_percent": density,
            "is_custom": is_custom,
            "occurrences_count": len(occurrences),
            "occurrences": occurrences
        })
        
    # Sort keyword stats: Custom first, then by frequency descending
    keyword_stats.sort(key=lambda x: (not x["is_custom"], -x["frequency"]))
    
    # Collect all occurrences across all keywords and sort chronologically by timestamp
    all_sequential_occurrences = []
    for stat in keyword_stats:
        for occ in stat["occurrences"]:
            all_sequential_occurrences.append({
                "keyword": stat["keyword"],
                "is_custom": stat["is_custom"],
                "occurrence_num": occ["occurrence_num"],
                "total_keyword_occurrences": stat["frequency"],
                "segment_index": occ["segment_index"],
                "start": occ["start"],
                "end": occ["end"],
                "duration": occ["duration"],
                "segment_text": occ["segment_text"]
            })
            
    # Sort chronologically by start timestamp, then segment index
    all_sequential_occurrences.sort(key=lambda x: (x["start"], x["segment_index"]))
    
    # Assign global sequence number (1, 2, 3...)
    for idx, seq_item in enumerate(all_sequential_occurrences, 1):
        seq_item["sequence_num"] = idx
    
    return {
        "total_words": total_word_count,
        "total_segments": len(segments),
        "total_keyword_hits": len(all_sequential_occurrences),
        "auto_keywords": auto_keywords,
        "keyword_stats": keyword_stats,
        "sequential_occurrences": all_sequential_occurrences
    }

