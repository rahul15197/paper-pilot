import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/analyze
 * Secure server-side route — Gemini API key never leaves the server.
 * Accepts: { image: string (base64), mimeType: string, question: string }
 * Returns: { success: true, analysis: AnalysisResult }
 */

const SYSTEM_PROMPT = `You are PaperPilot — a warm, expert document assistant helping everyday people understand confusing official documents. You analyze government notices, tax forms, legal letters, insurance papers, utility bills, court summons, medical reports, and any other complex document.

YOUR GOAL: Translate confusing official language into clear, simple, actionable guidance that ANYONE can follow — a child, an elderly person, or someone unfamiliar with bureaucratic language.

RULES:
1. Be warm, reassuring, and never condescending.
2. NEVER fabricate information. If text is unclear or cut off, say so.
3. Always highlight deadlines and amounts prominently.
4. Recommend professional consultation for serious legal/medical matters.
5. Respond in the same language the user asks in. Default: English.

RESPOND ONLY IN THIS EXACT JSON FORMAT (no markdown, no code fences):
{
  "documentType": "Specific type, e.g. 'Property Tax Notice', 'Electricity Bill', 'Legal Summons'",
  "urgencyLevel": "low | medium | high | critical",
  "summary": "2-3 sentences in plain English. What is this document and what does it mean for me right now?",
  "actions": [
    {
      "step": 1,
      "title": "Short action title (max 8 words)",
      "description": "Clear, friendly instruction of what to do. Include amounts, dates, or specific details visible in the document.",
      "isUrgent": false
    }
  ],
  "deadlines": [
    {
      "date": "Human-readable date, e.g. 'April 15, 2025'",
      "description": "What must be done by this date",
      "consequence": "What happens if missed"
    }
  ],
  "risks": ["Plain language warning about a penalty, risk, or important consideration"],
  "contacts": [
    {
      "name": "Office or person name from the document",
      "role": "Their department or role",
      "phone": "Phone number if visible",
      "website": "Website if visible"
    }
  ]
}`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.trim() === "" || apiKey === "YOUR_API_KEY_HERE") {
      return NextResponse.json(
        { error: "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env.local file." },
        { status: 500 }
      );
    }

    let body: { image: string; mimeType: string; question: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    if (!body.image || !body.mimeType) {
      return NextResponse.json(
        { error: "Missing required fields: image (base64) and mimeType." },
        { status: 400 }
      );
    }

    // Validate mime type
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowedMimeTypes.includes(body.mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${body.mimeType}. Please upload a JPG, PNG, or WebP image.` },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    });

    const userPrompt = body.question?.trim()
      ? `The user asks: "${body.question.trim()}"\n\nAnalyze the attached document image and answer their specific question, while also providing the complete structured analysis below.`
      : `Analyze the attached document image and provide a complete structured analysis.`;

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: userPrompt },
      {
        inlineData: {
          mimeType: body.mimeType,
          data: body.image,
        },
      },
    ]);

    const responseText = result.response.text().trim();

    // Parse JSON — strip markdown fences if present
    let analysis;
    try {
      const cleaned = responseText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      analysis = JSON.parse(cleaned);
    } catch {
      // Fallback: return the raw text wrapped in a safe structure
      analysis = {
        documentType: "Document",
        urgencyLevel: "medium",
        summary: responseText,
        actions: [],
        deadlines: [],
        risks: [],
        contacts: [],
      };
    }

    return NextResponse.json({ success: true, analysis });
  } catch (error: unknown) {
    console.error("[PaperPilot] Analysis error:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
