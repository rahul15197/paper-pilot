import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { question, historyContext } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey && !openRouterKey) {
      return NextResponse.json({ error: "No API keys configured." }, { status: 500 });
    }

    const prompt = `You are an expert document assistant helping a user understand a document.
Here is the AI's analysis of the document so far:
${historyContext}

The user has a follow up question: "${question}"
Answer the question concisely and in simple language.`;

    // Try Gemini First
    if (apiKey) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(prompt);
        return NextResponse.json({ answer: result.response.text() });
      } catch (err: any) {
        console.warn("[PaperPilot Chat] Gemini failed, falling back to OpenRouter...", err.message);
        if (!openRouterKey) throw err; // Fall through to open router if key exists
      }
    }

    // OpenRouter Fallback
    if (openRouterKey) {
      const payload = {
        model: "google/gemini-2.0-flash:free",
        messages: [
          { role: "user", content: prompt }
        ]
      };
      
      const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      
      if (!orRes.ok) throw new Error("OpenRouter Fallback Failed");
      const orData = await orRes.json();
      return NextResponse.json({ answer: orData.choices[0].message.content });
    }

  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to answer" }, { status: 500 });
  }
}
