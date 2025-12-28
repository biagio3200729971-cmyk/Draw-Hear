
import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysis } from "../types";

export async function analyzeDrawing(canvasDataUrl: string): Promise<AIAnalysis> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  // fix: Use gemini-3-flash-preview for general analysis tasks
  const model = 'gemini-3-flash-preview';

  const base64Data = canvasDataUrl.split(',')[1];

  const response = await ai.models.generateContent({
    model,
    // fix: Use standard structure for multi-part contents
    contents: {
      parts: [
        { inlineData: { data: base64Data, mimeType: "image/png" } },
        { text: "Analyze this drawing and provide a poetic title, description, and mood in JSON." }
      ]
    },
    config: {
      // fix: Move persona and detailed instructions to systemInstruction
      systemInstruction: `Analyze this drawing. It is a visual composition created by a user on a musical canvas. 
      Each stroke corresponds to a sound. Based on the shapes, density, and flow, provide:
      1. A poetic Title for this 'symphony'.
      2. A short, dreamy Description (1-2 sentences).
      3. A one-word Mood.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          mood: { type: Type.STRING }
        },
        required: ["title", "description", "mood"]
      }
    }
  });

  try {
    // fix: Directly access the .text property
    const jsonStr = response.text || "{}";
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return {
      title: "Silent Echoes",
      description: "A mysterious composition of strokes that dance in the void.",
      mood: "Ethereal"
    };
  }
}
