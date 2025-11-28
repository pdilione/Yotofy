# Yotofy: Spotify to Yoto Sync

This tool automatically syncs a Spotify Playlist to a Yoto-compatible Podcast RSS feed using GitHub Actions.

## Setup Instructions

### 1. Get Spotify Credentials (Required)
To allow the script to read your playlist, you need a free API Key from Spotify.

1.  Go to the **[Spotify Developer Dashboard](https://developer.spotify.com/dashboard)** and log in with your normal Spotify account.
2.  Click the **"Create app"** button.
3.  **App Name**: Enter `Yotofy` (or anything you want).
4.  **App Description**: Enter `Personal sync tool`.
5.  **Redirect URI**: Enter `http://localhost:3000` (This is required by the form but not used by this script).
6.  Check "I understand..." and click **Save**.
7.  Once created, click on the **Settings** button (top right of your app page).
8.  Under **Basic Information**, you will see your **Client ID**.
9.  Click **"View client secret"** to see your **Client Secret**.
    *   *Keep these tabs open, you will need them for the next step.*

### 2. Get Your Playlist ID
1.  Open Spotify (Web or Desktop).
2.  Right-click the playlist you want to sync.
3.  Select **Share** -> **Copy link to playlist**.
4.  The link looks like this: `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...`
5.  The **ID** is the part after `playlist/` and before `?`.
    *   Example ID: `37i9dQZF1DXcBWIGoYBM5M`

### 3. Deploy to GitHub
1.  **Push Code**: Push this entire repository to your GitHub account.
2.  **Add Secrets**:
    *   Go to your GitHub Repo -> **Settings** -> **Secrets and variables** -> **Actions**.
    *   Click **"New repository secret"**.
    *   Add these three secrets:
        *   `SPOTIFY_CLIENT_ID`: (Paste from Step 1)
        *   `SPOTIFY_CLIENT_SECRET`: (Paste from Step 1)
        *   `SPOTIFY_PLAYLIST_ID`: (Paste from Step 2)

### 4. Enable GitHub Pages
1.  Go to **Settings** -> **Pages**.
2.  Under **Build and deployment** -> **Source**, keep it as "Deploy from a branch".
3.  *Note: The `gh-pages` branch will be created automatically after the first successful run. You may need to come back here later to select it.*

### 5. Run the Sync
1.  Go to the **Actions** tab in your GitHub repo.
2.  Select **Yotofy Sync Engine** on the left.
3.  Click **Run workflow** -> **Run workflow**.
4.  Wait for the job to finish (it make take 1-2 minutes to install dependencies).

### 6. Link to Yoto
Once the action completes successfully:

1.  Your Podcast RSS Feed URL will be:
    ```
    https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/podcast.xml
    ```
    *(Replace `<YOUR_GITHUB_USERNAME>` and `<YOUR_REPO_NAME>` with your actual details).*

2.  Open the **Yoto App** on your phone.
3.  Go to **Make Your Own**.
4.  Select a card and tap **Link to a Podcast**.
5.  Paste your RSS URL.

## How it works automatically
*   **Every Hour**: The GitHub Action wakes up automatically.
*   **Checks Spotify**: Looks for new songs in your target playlist.
*   **Downloads Audio**: Finds the best match on YouTube and downloads the audio to the GitHub server.
*   **Updates Feed**: Regenerates `podcast.xml`.
*   **Yoto Updates**: Your physical Yoto card automatically has the new content without you doing anything.

## Troubleshooting

### "Sign in to confirm you’re not a bot" Error
This means YouTube is blocking the GitHub server IP. To fix this, you must "log in" using cookies.

**Step-by-Step Fix:**
1.  Install the **"Get cookies.txt LOCALLY"** extension for Chrome or Firefox.
    *   [Chrome Link](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflccpebjkmnlkj)
2.  Go to **YouTube.com** and make sure you are logged out (or use a throwaway account).
3.  Click the extension icon and click **"Export"** (it downloads a `cookies.txt` file).
4.  Open that file with a text editor (Notepad, TextEdit).
5.  **Select All** text and **Copy**.
6.  Go to your GitHub Repo -> **Settings** -> **Secrets and variables** -> **Actions**.
7.  Click **"New repository secret"**.
8.  **Name**: `YOUTUBE_COOKIES`
9.  **Secret**: Paste the entire text content.
10. Re-run the Workflow.
