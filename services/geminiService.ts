export const generateYotoIcon = async (playlistName: string, trackNames: string[]): Promise<{ iconGrid: string[], themeColor: string, summary: string }> => {
  try {
    const response = await fetch('/api/yoto-icon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ playlistName, trackNames }),
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.iconGrid) || data.iconGrid.length !== 256) {
      throw new Error('Invalid iconGrid returned from server');
    }

    return data;
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
