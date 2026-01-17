import { GoogleGenAI, Modality, Type } from "@google/genai";
import { ImageSize } from "../types";

// Helper to check API Key
const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables.");
  }
  return new GoogleGenAI({ apiKey });
};

// 1. Text Extraction (for Reader)
export const extractTextFromDocument = async (
  fileBase64: string,
  mimeType: string
): Promise<{ text: string; language: string }> => {
  const ai = getAI();
  
  // We use Flash 3 to "read" the document first
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: fileBase64,
          },
        },
        {
          text: `Extract all legible text from this document. 
                 Also detect the primary language (return 'es' for Spanish, 'en' for English, or others). 
                 Return ONLY JSON in this format: { "text": "extracted text...", "language": "es" }`,
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          language: { type: Type.STRING },
        },
      },
    },
  });

  const resultText = response.text;
  if (!resultText) throw new Error("No text extracted.");
  return JSON.parse(resultText);
};

// 2. TTS Generation
export const generateSpeech = async (text: string, voiceName: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) {
    throw new Error("Failed to generate speech audio.");
  }
  return audioData;
};

// 3. Audio Transcription
export const transcribeAudio = async (audioBase64: string, mimeType: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: audioBase64,
          },
        },
        {
          text: "Please transcribe this audio accurately.",
        },
      ],
    },
  });

  return response.text || "Transcription failed.";
};

// 4. Image Analysis
export const analyzeImage = async (imageBase64: string, mimeType: string, prompt: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBase64,
          },
        },
        {
          text: prompt || "Analyze this image in detail.",
        },
      ],
    },
  });

  return response.text || "Analysis failed.";
};

// 5. Image Generation
export const generateImage = async (prompt: string, size: ImageSize): Promise<string> => {
  const ai = getAI();
  
  // Note: Only gemini-3-pro-image-preview supports imageSize config
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        imageSize: size,
      },
    },
  });

  // Extract image
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }
  
  throw new Error("No image generated.");
};

export const getLiveClient = () => {
    return getAI();
}
