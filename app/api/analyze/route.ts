import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/analyze
 * Secure server-side route — Gemini API key never leaves the server.
 * Accepts: { image: string (base64), mimeType: string, question: string }
 * Returns: { success: true, analysis: AnalysisResult }
 */

const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 15;

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

// Models tried in order — 2.0-flash has the highest free-tier quota
const MODEL_CHAIN = [
  "gemini-2.0-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash",
];

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

function is429(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("Too Many Requests") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.includes("free_tier")
  );
}

/** Exponential backoff: 8s → 16s → 32s → 64s */
function backoffMs(attempt: number): number {
  return Math.min(8000 * Math.pow(2, attempt), 64000);
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.trim() === "" || apiKey === "YOUR_API_KEY_HERE") {
      return NextResponse.json(
        { error: "Gemini API key is not configured. Please add GEMINI_API_KEY to your environment." },
        { status: 500 }
      );
    }

    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const rateLimitInfo = rateLimitMap.get(ip) || { count: 0, lastReset: now };

    if (now - rateLimitInfo.lastReset > RATE_LIMIT_WINDOW_MS) {
      rateLimitInfo.count = 1;
      rateLimitInfo.lastReset = now;
    } else {
      rateLimitInfo.count++;
    }
    rateLimitMap.set(ip, rateLimitInfo);

    if (rateLimitInfo.count > MAX_REQUESTS_PER_WINDOW) {
      return NextResponse.json(
        { error: "Too many requests from this IP. Please wait a minute and try again." },
        { status: 429 }
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

    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ];
    if (!allowedMimeTypes.includes(body.mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${body.mimeType}. Please upload an image or PDF.` },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const userPrompt = body.question?.trim()
      ? `The user asks: "${body.question.trim()}"\n\nAnalyze the attached document and answer their specific question, while also providing the complete structured analysis below.`
      : `Analyze the attached document and provide a complete structured analysis.`;

    const contents = [
      { text: SYSTEM_PROMPT },
      { text: userPrompt },
      { inlineData: { mimeType: body.mimeType, data: body.image } },
    ];

    const MAX_RETRIES_PER_MODEL = 3;
    let result;

    // Try each model in the chain; within each, retry with exponential backoff on 429
    outer:
    for (const modelName of MODEL_CHAIN) {
      const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: SAFETY_SETTINGS,
      });

      for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
        try {
          result = await model.generateContent(contents);
          break outer; // success — exit both loops
        } catch (retryErr: unknown) {
          if (is429(retryErr)) {
            if (attempt < MAX_RETRIES_PER_MODEL) {
              const wait = backoffMs(attempt);
              console.warn(`[PaperPilot] ${modelName} rate limited, retrying in ${wait / 1000}s (attempt ${attempt + 1})`);
              await new Promise(res => setTimeout(res, wait));
              continue;
            }
            // Exhausted retries for this model — move to next
            console.warn(`[PaperPilot] ${modelName} exhausted after ${MAX_RETRIES_PER_MODEL} retries, falling back...`);
            break;
          }
          // Non-rate-limit error — fail immediately
          throw retryErr;
        }
      }
    }

    if (!result) {
      return NextResponse.json(
        { error: "All AI models are temporarily overloaded. Please wait 1–2 minutes and try again." },
        { status: 429 }
      );
    }

    const responseText = result.response.text().trim();

    // Parse JSON — strip markdown fences if model adds them
    let analysis;
    try {
      const cleaned = responseText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      analysis = JSON.parse(cleaned);
    } catch {
      // Fallback: wrap raw text in a minimal valid structure
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
    const raw = error instanceof Error ? error.message : "";

    let userMessage = "Something went wrong. Please try again.";
    if (is429(error)) {
      userMessage = "⏳ AI quota limit reached. Please wait 1–2 minutes and try again.";
    } else if (raw.includes("403") || raw.includes("401") || raw.includes("API key")) {
      userMessage = "API authentication failed. Please check your Gemini API key.";
    } else if (raw.includes("SAFETY")) {
      userMessage = "The document content was flagged by safety filters. Please try a different document.";
    } else if (raw.includes("RECITATION")) {
      userMessage = "The AI could not process this document due to content policy. Please try a different document.";
    } else if (raw.includes("ETIMEDOUT") || raw.includes("ECONNRESET") || raw.includes("timeout")) {
      userMessage = "⏱️ The AI took too long to respond. Please try again in a moment.";
    } else if (raw.includes("ENOTFOUND") || raw.includes("ECONNREFUSED")) {
      userMessage = "Network error — unable to reach the AI service. Please check your internet connection.";
    }

    const status = is429(error) ? 429 : 500;
    return NextResponse.json({ error: userMessage }, { status });
  }
}
