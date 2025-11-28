import os
import sys
import json
import logging
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import yt_dlp
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import formatdate

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
# This defaults to localhost but will be overridden by the GitHub Pages URL in production
PUBLIC_URL = os.environ.get('PUBLIC_URL', 'http://localhost:8000')
AUDIO_DIR = 'public/audio'

def ensure_dir(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

def get_spotify_client():
    client_id = os.environ.get('SPOTIFY_CLIENT_ID')
    client_secret = os.environ.get('SPOTIFY_CLIENT_SECRET')
    if not client_id or not client_secret:
        logger.error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET")
        sys.exit(1)
    return spotipy.Spotify(auth_manager=SpotifyClientCredentials(client_id=client_id, client_secret=client_secret))

def download_audio(query, filename):
    output_path = os.path.join(AUDIO_DIR, filename)
    
    # Check if file already exists to avoid re-downloading
    if os.path.exists(output_path):
        logger.info(f"File exists, skipping download: {filename}")
        return True

    # yt-dlp configuration for audio extraction
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_path,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'quiet': True,
        'no_warnings': True,
        # 'cookiefile': 'cookies.txt', # Uncomment if you provide cookies in the repo
    }
    
    logger.info(f"Downloading: {query}")
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"ytsearch1:{query}"])
        return True
    except Exception as e:
        logger.error(f"Failed to download {query}: {e}")
        return False

def generate_rss(playlist_meta, tracks):
    rss = ET.Element('rss', version='2.0')
    channel = ET.SubElement(rss, 'channel')
    
    ET.SubElement(channel, 'title').text = playlist_meta['name']
    ET.SubElement(channel, 'description').text = playlist_meta['description']
    ET.SubElement(channel, 'link').text = PUBLIC_URL
    
    # Podcast Image
    image = ET.SubElement(channel, 'image')
    ET.SubElement(image, 'url').text = playlist_meta['images'][0]['url'] if playlist_meta['images'] else ''
    ET.SubElement(image, 'title').text = playlist_meta['name']

    # Generate Items
    for track in tracks:
        item = ET.SubElement(channel, 'item')
        track_info = track['track']
        if not track_info: continue

        track_name = track_info['name']
        artist_name = track_info['artists'][0]['name']
        track_id = track_info['id']
        
        # We assume the file is named by ID, but yt-dlp might append extension. 
        # For simplicity in this script, we assume strict MP3 naming.
        filename = f"{track_id}.mp3"
        file_url = f"{PUBLIC_URL}/audio/{filename}"
        
        ET.SubElement(item, 'title').text = track_name
        ET.SubElement(item, 'description').text = f"Artist: {artist_name}"
        ET.SubElement(item, 'enclosure', url=file_url, type='audio/mpeg')
        ET.SubElement(item, 'guid').text = track_id
        ET.SubElement(item, 'pubDate').text = formatdate(datetime.now().timestamp())

    # Write RSS to file
    tree = ET.ElementTree(rss)
    ET.indent(tree, space="\t", level=0)
    
    output_file = 'public/podcast.xml'
    tree.write(output_file, encoding='utf-8', xml_declaration=True)
    logger.info(f"Generated RSS feed at {output_file}")

def main():
    playlist_id = os.environ.get('SPOTIFY_PLAYLIST_ID')
    if not playlist_id:
        logger.error("Missing SPOTIFY_PLAYLIST_ID environment variable")
        sys.exit(1)

    ensure_dir(AUDIO_DIR)
    
    sp = get_spotify_client()
    
    try:
        logger.info(f"Fetching playlist: {playlist_id}")
        results = sp.playlist(playlist_id)
        playlist_meta = {
            'name': results['name'],
            'description': results['description'],
            'images': results['images']
        }
        tracks = results['tracks']['items']
        
        logger.info(f"Found {len(tracks)} tracks. Starting sync...")

        for item in tracks:
            track = item['track']
            if not track: continue
            
            # Search query: "Artist - Title audio"
            query = f"{track['name']} {track['artists'][0]['name']} audio"
            filename = f"{track['id']}.mp3"
            
            download_audio(query, filename)

        generate_rss(playlist_meta, tracks)
        logger.info("Sync complete. Ready to deploy.")

    except Exception as e:
        logger.error(f"Critical Sync Failure: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()