const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI('AIzaSyC9zK93VvoORw_0QF1IDNIGYw-JOREIVDY');
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// 1x1 red pixel PNG — minimal valid image
const minPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

const systemPrompt = `You are PaperPilot. Respond ONLY with valid JSON, no markdown code fences, no extra text. Use this format: {"documentType":"string","urgencyLevel":"low","summary":"string","actions":[],"deadlines":[],"risks":[],"contacts":[]}`;

(async () => {
  console.log('=== PaperPilot Gemini API Integration Test ===\n');

  // --- Test 1: Text-only ---
  try {
    console.log('Test 1: Text API connectivity...');
    const r = await model.generateContent('Say exactly the word: PAPERPILOT_OK');
    console.log('  Result:', r.response.text().trim());
    console.log('  Status: PASS\n');
  } catch (e) {
    console.log('  Status: FAIL -', e.message.substring(0, 120), '\n');
  }

  await new Promise(r => setTimeout(r, 3000));

  // --- Test 2: Vision with structured output ---
  try {
    console.log('Test 2: Vision + JSON structured output...');
    const r = await model.generateContent([
      { text: systemPrompt },
      { text: 'Analyze this image and return the structured JSON.' },
      { inlineData: { mimeType: 'image/png', data: minPng } }
    ]);
    const raw = r.response.text().trim();
    console.log('  Raw response:', raw.substring(0, 200));
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    console.log('  Parsed OK:', JSON.stringify(parsed));
    console.log('  Status: PASS\n');
  } catch (e) {
    console.log('  Status: FAIL -', e.message.substring(0, 180), '\n');
  }

  await new Promise(r => setTimeout(r, 3000));

  // --- Test 3: Real government document simulation ---
  try {
    console.log('Test 3: Government document analysis (IRS-style notice)...');
    const r = await model.generateContent([
      { text: systemPrompt },
      { text: `Analyze this government document text and return the JSON analysis:
      
      DEPARTMENT OF THE TREASURY - INTERNAL REVENUE SERVICE
      Notice CP2000 | Tax Year: 2023 | Notice Date: March 15, 2024
      Amount Due: $2,456.78 | Due Date: April 30, 2024
      
      We received information from third parties that differs from what you reported.
      You may owe additional tax, interest, and penalties.
      
      If you AGREE: Pay $2,456.78 by April 30, 2024
      If you DISAGREE: Complete and return the response form by April 30, 2024
      
      Questions? Call 1-800-829-8310 | Visit: irs.gov/cp2000` },
      { inlineData: { mimeType: 'image/png', data: minPng } }
    ]);
    const raw = r.response.text().trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    console.log('  Document Type:', parsed.documentType);
    console.log('  Urgency Level:', parsed.urgencyLevel);
    console.log('  Summary:', parsed.summary);
    console.log('  Actions:', parsed.actions.length, 'items');
    console.log('  Deadlines:', parsed.deadlines.length, 'items');
    console.log('  Risks:', parsed.risks.length, 'items');
    console.log('  Contacts:', parsed.contacts.length, 'items');
    console.log('  Status: PASS\n');
    console.log('  Full JSON:');
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log('  Status: FAIL -', e.message.substring(0, 250), '\n');
  }

  console.log('=== Test Complete ===');
})();
