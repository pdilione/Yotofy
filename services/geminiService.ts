import { GoogleGenAI, Type } from "@google/genai";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateYotoIcon = async (playlistName: string, trackNames: string[]): Promise<{ iconGrid: string[], themeColor: string, summary: string }> => {
  try {
    const ai = getAiClient();
    const prompt = `
      You are a pixel art generator for a children's audio player called Yoto.
      
      Task: Create a 16x16 pixel art icon that represents a playlist named "${playlistName}".
      The playlist contains these songs: ${trackNames.slice(0, 10).join(", ")}...
      
      Return a JSON object with:
      1. 'iconGrid': An array of exactly 256 strings (16x16 flattened), where each string is a 6-digit HEX color code (e.g., "#FF0000"). Use "#000000" for off/black pixels. The design should be simple, iconic, and recognizable at low resolution.
      2. 'themeColor': A single HEX color code that compliments the icon, to be used as the card background.
      3. 'summary': A short, fun, 1-sentence description of this playlist for a child.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            iconGrid: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "256 hex codes representing 16x16 grid"
            },
            themeColor: { type: Type.STRING },
            summary: { type: Type.STRING }
          },
          required: ["iconGrid", "themeColor", "summary"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Error generating icon:", error);
    // Fallback simple smiley face pattern
    const black = "#000000";
    const orange = "#FF6D00";
    const fallbackGrid = new Array(256).fill(black);
    // Simple eyes
    fallbackGrid[3 * 16 + 4] = orange;
    fallbackGrid[3 * 16 + 11] = orange;
    // Simple smile
    for(let i=4; i<=11; i++) fallbackGrid[11 * 16 + i] = orange;
    fallbackGrid[10 * 16 + 3] = orange;
    fallbackGrid[10 * 16 + 12] = orange;

    return {
      iconGrid: fallbackGrid,
      themeColor: "#FF6D00",
      summary: "A cool playlist ready for your ears!"
    };
  }
};
