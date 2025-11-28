# Yotofy: Spotify to Yoto Sync

This tool automatically syncs a Spotify Playlist to a Yoto-compatible Podcast RSS feed using GitHub Actions.

## Setup Instructions

### 1. Prerequisites
*   A **Spotify Developer Account** (Free). Create an app in the [Spotify Dashboard](https://developer.spotify.com/dashboard) to get a Client ID and Secret.
*   A **Spotify Playlist**. Make sure it is "Public" or "Shared". Copy the ID from the URL.

### 2. Deployment
1.  **Rename File**: Ensure `backend/sync_script.txt` is renamed to `backend/sync.py`.
2.  **Push Code**: Push this entire repository to GitHub.
3.  **Add Secrets**:
    *   Go to your GitHub Repo -> **Settings** -> **Secrets and variables** -> **Actions**.
    *   Add the following Repository Secrets:
        *   `SPOTIFY_CLIENT_ID`
        *   `SPOTIFY_CLIENT_SECRET`
        *   `SPOTIFY_PLAYLIST_ID` (The ID part of your playlist URL)

### 3. Activation
1.  Go to the **Actions** tab in your GitHub repo.
2.  Select **Yotofy Sync Engine** on the left.
3.  Click **Run workflow**.
4.  Once finished, a new branch named `gh-pages` will be created.

### 4. Connect Yoto
1.  Your Podcast RSS Feed URL will be:
    `https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/podcast.xml`
2.  Open the **Yoto App** -> **Make Your Own** -> **Link to a Podcast**.
3.  Paste the URL above.

## How it works
*   **Every Hour**: The GitHub Action wakes up.
*   **Checks Spotify**: Looks for new songs in your playlist.
*   **Downloads Audio**: Finds the best match on YouTube and downloads the audio.
*   **Updates Feed**: Regenerates `podcast.xml`.
*   **Yoto Updates**: Your physical card automatically plays the new content.
