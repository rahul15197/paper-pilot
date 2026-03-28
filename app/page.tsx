'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface ActionItem { step: number; title: string; description: string; isUrgent: boolean; }
interface Deadline { date: string; description: string; consequence: string; }
interface ContactInfo { name: string; role: string; phone?: string; website?: string; }
interface AnalysisResult {
  documentType: string;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  actions: ActionItem[];
  deadlines: Deadline[];
  risks: string[];
  contacts: ContactInfo[];
}

const URGENCY_EMOJI: Record<string, string> = { low: '🟢', medium: '🔵', high: '🟡', critical: '🔴' };
const URGENCY_LABEL: Record<string, string> = { low: 'Low Priority', medium: 'Medium Priority', high: 'High Priority', critical: 'Critical — Act Now' };

function buildSpeechText(a: AnalysisResult): string {
  let t = `Document type: ${a.documentType}. ${a.summary} `;
  if (a.deadlines.length > 0) {
    t += 'Important deadlines: ';
    a.deadlines.forEach(d => { t += `${d.description} by ${d.date}. `; });
  }
  if (a.actions.length > 0) {
    t += 'What you need to do: ';
    a.actions.forEach((ac, i) => { t += `Step ${i + 1}: ${ac.title}. ${ac.description} `; });
  }
  if (a.risks.length > 0) t += 'Warnings: ' + a.risks.join('. ');
  return t;
}

const BackgroundDecorations = () => (
  <div className="bg-decorations" aria-hidden="true">
    <div className="bg-shape bg-shape-1">📄</div>
    <div className="bg-shape bg-shape-2">✈️</div>
    <div className="bg-shape bg-shape-3">🧾</div>
    <div className="bg-shape bg-shape-4">📝</div>
    <div className="bg-shape bg-shape-5">✈️</div>
    <div className="bg-shape bg-shape-6">📃</div>
  </div>
);

export default function Home() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Robust detection for Web Speech API with prefix checks
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const synth = window.speechSynthesis;
    
    // In production/cloud, SpeechRecognition requires HTTPS.
    // Chrome also requires a gesture, but we can check if the API exists first.
    const supported = !!SR && !!synth;
    setVoiceSupported(supported);
    
    if (!SR) {
      console.warn("PaperPilot: SpeechRecognition API not detected or blocked by environment.");
    }
  }, []);

  const handleFile = useCallback((file: File) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    
    if (!isImage && !isPdf) { 
      setError('Please upload an image (JPG, PNG, WebP) or a PDF document.'); 
      return; 
    }
    if (file.size > 10 * 1024 * 1024) { 
      setError('Document too large. Please use a file under 10MB.'); 
      return; 
    }
    setImageFile(file); 
    setAnalysis(null); 
    setError(null);
    
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else if (isPdf) {
      // Use a generic placeholder token for PDF
      setImagePreview('PDF_DOCUMENT_PREVIEW');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const startVoice = () => {
    const SR = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    if (!SR) return;
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); return; }
    const rec = new SR();
    rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => setIsRecording(true);
    rec.onresult = (e: any) => { const t = Array.from(e.results).map((r: any) => r[0].transcript).join(''); setQuestion(t); };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
  };

  const handleAnalyze = async () => {
    if (!imageFile) { setError('Please upload a document image first.'); return; }
    setIsLoading(true); setError(null); setAnalysis(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(imageFile);
      });
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: imageFile.type, question: question.trim() }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (res.status === 429) {
        throw new Error('⏳ AI quota limit reached. Please wait 1–2 minutes, then try again.');
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Analysis failed. Please try again.');
      }
      setAnalysis(data.analysis);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        setError('⏱️ Request timed out. The AI took too long to respond. Please try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleReadAloud = () => {
    if (!analysis) return;
    if (isSpeaking) { window.speechSynthesis.cancel(); setIsSpeaking(false); return; }
    setIsSpeaking(true);
    const utter = new SpeechSynthesisUtterance(buildSpeechText(analysis));
    utter.rate = 0.9;
    utter.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utter);
  };

  const handleCopy = async () => {
    if (!analysis) return;
    await navigator.clipboard.writeText(buildSpeechText(analysis));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setImageFile(null); setImagePreview(null); setQuestion('');
    setAnalysis(null); setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    window.speechSynthesis?.cancel(); setIsSpeaking(false);
  };

  return (
    <div className="app-container">
      <BackgroundDecorations />
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="app-header" role="banner">
        <div className="app-logo">
          <div className="app-logo-icon" aria-hidden="true">✈️</div>
          <span className="app-logo-text">PaperPilot</span>
          <span className="app-logo-tag">Powered by Gemini</span>
        </div>
        <div className="header-actions">
          {analysis && (
            <button className="icon-btn" onClick={handleReset} aria-label="Start over with a new document" title="Start over">🔄</button>
          )}
        </div>
      </header>

      <main id="main-content" className="app-main" role="main">

        {!analysis && (
          <section className="hero-section" aria-labelledby="hero-title">
            <div className="hero-animation-container" aria-hidden="true">
              <div className="hero-folding-scene">
                <div className="hero-paper">📄</div>
                <div className="hero-plane">✈️</div>
              </div>
            </div>
            <h1 id="hero-title" className="hero-brand-name">PaperPilot</h1>
            <h2 className="hero-tagline">
              <span className="hero-title-gradient">Understand Any Document</span>
              <br />in Seconds
            </h2>
            <p className="hero-subtitle">
              Instantly decode complex legal notices, financial statements, and official forms. 
              PaperPilot transforms confusing documents into clear, actionable insights. 
              Works with Voice too.
            </p>
            <button 
              className="hero-scroll-btn stagger-in" 
              onClick={() => document.getElementById('analyze-button')?.scrollIntoView({ behavior: 'smooth' })}
              aria-label="Scroll down to begin document analysis"
            >
              Get Started <span aria-hidden="true">↓</span>
            </button>
          </section>
        )}

        <section className="upload-section" aria-labelledby="upload-label">
          <h2 id="upload-label" className="sr-only">Upload Document</h2>
          <div
            className={`upload-zone${isDragOver ? ' drag-over' : ''}${imagePreview ? ' has-image' : ''}`}
            onClick={() => !imagePreview && fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            role="button"
            tabIndex={0}
            aria-label={imagePreview ? 'Document uploaded. Click to change.' : 'Click or drag to upload a document image'}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              className="upload-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              aria-label="Upload document image or PDF"
              id="document-upload"
            />
            {imagePreview ? (
              <div className="upload-preview-container">
                {imagePreview === 'PDF_DOCUMENT_PREVIEW' ? (
                  <div className="upload-preview" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'var(--color-bg-glass)',border:'1px solid var(--color-border)'}}>
                    <span style={{fontSize:'3rem',marginBottom:'1rem'}} aria-hidden="true">📑</span>
                    <span style={{fontFamily:'var(--font-primary)',fontWeight:600}}>{imageFile?.name}</span>
                    <span style={{fontSize:'0.85rem',color:'var(--color-text-muted)',marginTop:'0.25rem'}}>PDF Document</span>
                  </div>
                ) : (
                  <img src={imagePreview} alt="Preview of uploaded document" className="upload-preview" />
                )}
                <button className="upload-change-btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} aria-label="Change document file">
                  Change File
                </button>
              </div>
            ) : (
              <>
                <span className="upload-icon" aria-hidden="true">📄</span>
                <p className="upload-title">Drop your document here</p>
                <p className="upload-subtitle">or click to browse · PDF, JPG, PNG, WebP up to 10MB</p>
              </>
            )}
          </div>
        </section>

        <section className="question-section" aria-labelledby="question-label">
          <div className="question-card">
            <div className="question-label" id="question-label">
              <span aria-hidden="true">💬</span>
              <label htmlFor="question-input" style={{margin:0}}>What would you like to know?</label>
              <span style={{fontSize:'0.8rem',color:'var(--color-text-muted)',fontWeight:400,marginLeft:'auto'}}>
                Optional — leave blank for full analysis
              </span>
            </div>
            <div className="question-input-row">
              <input
                id="question-input"
                type="text"
                className="question-input"
                placeholder="e.g. What is the deadline? How much do I owe? What should I do first?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                autoComplete="off"
              />
              {voiceSupported && (
                <button
                  className={`voice-btn${isRecording ? ' recording' : ''}`}
                  onClick={startVoice}
                  aria-label={isRecording ? 'Stop voice recording' : 'Ask using your voice'}
                  aria-pressed={isRecording}
                  title={isRecording ? 'Tap to stop' : 'Speak your question'}
                  type="button"
                >
                  <span className="voice-icon" aria-hidden="true">{isRecording ? '🛑' : '🗣️'}</span>
                  <span className="voice-btn-text">{isRecording ? 'Stop Listening' : 'Voice Input'}</span>
                  <span className="voice-btn-tooltip">{isRecording ? 'Tap to stop' : 'Speak your question'}</span>
                </button>
              )}
            </div>

            <button
              className={`analyze-btn${isLoading ? ' loading' : ''}`}
              onClick={handleAnalyze}
              disabled={!imageFile || isLoading}
              aria-busy={isLoading}
              id="analyze-button"
            >
              <span className="btn-shimmer" aria-hidden="true"></span>
              {isLoading ? <><span aria-hidden="true">⚡</span> Analyzing with Gemini AI...</>
                         : <><span aria-hidden="true">🔍</span> Analyze Document</>}
            </button>
          </div>
        </section>

        {isLoading && (
          <div className="loading-container" role="status" aria-live="polite">
            <div className="loading-spinner" aria-hidden="true"></div>
            <p className="loading-text">Gemini is reading your document...</p>
          </div>
        )}

        {error && !isLoading && (
          <div className="error-container" role="alert" aria-live="assertive">
            <div className="error-icon" aria-hidden="true">⚠️</div>
            <p className="error-message">{error}</p>
            <button className="error-retry-btn" onClick={handleAnalyze} disabled={!imageFile}>Try Again</button>
          </div>
        )}

        {analysis && !isLoading && (
          <section ref={resultsRef} className="results-section" aria-labelledby="results-title" aria-live="polite">
            <div className="results-card">
              <header className="results-header">
                <div className="results-header-left">
                  <h2 id="results-title" className="results-doc-type">{analysis.documentType}</h2>
                  <span className={`urgency-badge ${analysis.urgencyLevel}`} aria-label={`Urgency: ${URGENCY_LABEL[analysis.urgencyLevel]}`}>
                    {URGENCY_EMOJI[analysis.urgencyLevel]} {URGENCY_LABEL[analysis.urgencyLevel]}
                  </span>
                </div>
                <div className="results-header-actions">
                  {voiceSupported && (
                    <button className={`icon-btn${isSpeaking ? ' speaking' : ''}`} onClick={handleReadAloud}
                      aria-label={isSpeaking ? 'Stop reading aloud' : 'Read results aloud'} aria-pressed={isSpeaking} title={isSpeaking ? 'Stop' : 'Read aloud'}>
                      {isSpeaking ? '⏸️' : '🔊'}
                    </button>
                  )}
                  <button className="icon-btn" onClick={handleCopy} aria-label={copied ? 'Copied!' : 'Copy to clipboard'} title={copied ? 'Copied!' : 'Copy'}>
                    {copied ? '✅' : '📋'}
                  </button>
                  <button className="icon-btn" onClick={handleReset} aria-label="Analyze a new document" title="New document">🔄</button>
                </div>
              </header>

              <div className="results-body">
                <div className="summary-block stagger-in stagger-delay-1" aria-labelledby="summary-label">
                  <h3 id="summary-label" className="section-title"><span aria-hidden="true">📋</span> What This Document Means</h3>
                  <p>{analysis.summary}</p>
                </div>

                {analysis.deadlines.length > 0 && (
                  <div aria-labelledby="deadlines-label" className="stagger-in stagger-delay-2">
                    <h3 id="deadlines-label" className="section-title"><span aria-hidden="true">📅</span> Important Deadlines</h3>
                    <ul className="deadline-list" style={{listStyle:'none',padding:0}}>
                      {analysis.deadlines.map((d, i) => (
                        <li key={i} className="deadline-item">
                          <span className="deadline-icon" aria-hidden="true">⏰</span>
                          <div>
                            <div className="deadline-date">{d.date}</div>
                            <div className="deadline-desc">{d.description}</div>
                            {d.consequence && <div className="deadline-consequence">⚠️ If missed: {d.consequence}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysis.actions.length > 0 && (
                  <div aria-labelledby="actions-label" className="stagger-in stagger-delay-3">
                    <h3 id="actions-label" className="section-title"><span aria-hidden="true">✅</span> What You Need To Do</h3>
                    <ul className="action-list" style={{listStyle:'none',padding:0}}>
                      {analysis.actions.map((action) => (
                        <li key={action.step} className={`action-item${action.isUrgent ? ' urgent' : ''}`}>
                          <div className="action-step" aria-hidden="true">{action.step}</div>
                          <div className="action-content">
                            <h4>{action.title}{action.isUrgent && <span style={{color:'var(--color-accent-danger)',marginLeft:8,fontSize:'0.8rem'}}>URGENT</span>}</h4>
                            <p>{action.description}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysis.risks.length > 0 && (
                  <div aria-labelledby="risks-label" className="stagger-in stagger-delay-4">
                    <h3 id="risks-label" className="section-title"><span aria-hidden="true">⚠️</span> Important Warnings</h3>
                    <ul className="risk-list" style={{listStyle:'none',padding:0}}>
                      {analysis.risks.map((risk, i) => (
                        <li key={i} className="risk-item">
                          <span className="risk-icon" aria-hidden="true">▶</span>
                          {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysis.contacts.length > 0 && (
                  <div aria-labelledby="contacts-label" className="stagger-in stagger-delay-5">
                    <h3 id="contacts-label" className="section-title"><span aria-hidden="true">📞</span> Who To Contact</h3>
                    <ul className="contact-list" style={{listStyle:'none',padding:0}}>
                      {analysis.contacts.map((c, i) => (
                        <li key={i} className="contact-item">
                          <div className="contact-name">{c.name}</div>
                          <div className="contact-role">{c.role}</div>
                          {c.phone && <a href={`tel:${c.phone}`} className="contact-detail">📞 {c.phone}</a>}
                          {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="contact-detail">🌐 {c.website}</a>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="app-footer" role="contentinfo">
        <p>
          PaperPilot &mdash; Powered by{' '}
          <a href="https://ai.google.dev" target="_blank" rel="noopener noreferrer">Google Gemini AI</a>
          {' '}· For informational purposes only. Always consult a professional for legal or financial advice.
        </p>
      </footer>

      <style>{`
        .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
        .contact-list { display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:var(--space-sm); }
      `}</style>
    </div>
  );
}
