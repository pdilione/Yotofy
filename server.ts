import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = '0.0.0.0';

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.post('/api/yoto-icon', async (req, res) => {
    try {
      const { playlistName, trackNames } = req.body as {
        playlistName?: string;
        trackNames?: string[];
      };

      if (!playlistName) {
        return res.status(400).json({ error: 'playlistName is required' });
      }

      const ai = getAiClient();
      const tracksPreview = Array.isArray(trackNames)
        ? trackNames.slice(0, 10).join(', ')
        : '';

      const prompt = `
        You are a pixel art generator for a children's audio player called Yoto.
        
        Task: Create a 16x16 pixel art icon that represents a playlist named "${playlistName}".
        The playlist contains these songs: ${tracksPreview}...
        
        Return a JSON object with:
        1. 'iconGrid': An array of exactly 256 strings (16x16 flattened), where each string is a 6-digit HEX color code (e.g., "#FF0000"). Use "#000000" for off/black pixels. The design should be simple, iconic, and recognizable at low resolution.
        2. 'themeColor': A single HEX color code that compliments the icon, to be used as the card background.
        3. 'summary': A short, fun, 1-sentence description of this playlist for a child.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              iconGrid: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '256 hex codes representing 16x16 grid',
              },
              themeColor: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ['iconGrid', 'themeColor', 'summary'],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('No response from Gemini');
      }

      const data = JSON.parse(text);
      return res.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate icon';
      console.error('Error generating Yoto icon:', error);
      return res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Yotofy server running on http://${HOST}:${PORT}`);
  });
}

startServer();
