'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { generateICS } from './lib/utils';
// @ts-ignore
import html2canvas from 'html2canvas';
// @ts-ignore
import jsPDF from 'jspdf';

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

interface HistoryItem {
  id: string;
  timestamp: number;
  result: AnalysisResult;
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

const MAX_QUOTA = 10;

export default function Dashboard() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<{role: string, text: string}[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  
  // Features State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  // const [isDarkMode, setIsDarkMode] = useState(true); // Removed as per request (Dark only)
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // Load History & Quota on mount
    const savedHistory = localStorage.getItem('paperpilot_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));
    
    // Quota resets based on date (simple tracking)
    const today = new Date().toISOString().split('T')[0];
    const savedQuotaDate = localStorage.getItem('paperpilot_quota_date');
    if (savedQuotaDate !== today) {
      localStorage.setItem('paperpilot_quota_date', today);
      localStorage.setItem('paperpilot_quota_used', '0');
    } else {
      setQuotaUsed(parseInt(localStorage.getItem('paperpilot_quota_used') || '0', 10));
    }

    // const savedTheme = localStorage.getItem('paperpilot_theme');
    // if (savedTheme) setIsDarkMode(savedTheme === 'dark');

    setIsMounted(true);

    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const saveToHistory = (result: AnalysisResult) => {
    const newItem: HistoryItem = { id: Date.now().toString(), timestamp: Date.now(), result };
    const newHistory = [newItem, ...history].slice(0, 10); // Keep last 10
    setHistory(newHistory);
    localStorage.setItem('paperpilot_history', JSON.stringify(newHistory));
    
    const newQuota = quotaUsed + 1;
    setQuotaUsed(newQuota);
    localStorage.setItem('paperpilot_quota_used', newQuota.toString());
  };

  // toggleTheme removed (Dark only)

  // Always ensure dark mode on mount
  useEffect(() => {
    if (isMounted && typeof document !== 'undefined') {
      document.documentElement.classList.remove('light');
    }
  }, [isMounted]);

  const handleFile = useCallback((file: File) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    
    if (!isImage && !isPdf) { setError('Please upload an image or PDF.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('File under 10MB please.'); return; }
    
    setImageFile(file); 
    setAnalysis(null); 
    setError(null);
    setQuestion(''); // Clear initial optional question on new file
    setChatMessages([]);
    setIsSidebarOpen(false); // Close sidebar on mobile after selecting

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (isImage) {
      const objectUrl = URL.createObjectURL(file);
      previewUrlRef.current = objectUrl;
      setImagePreview(objectUrl);
    } else if (isPdf) {
      setImagePreview('PDF_DOCUMENT_PREVIEW');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleAnalyze = async () => {
    if (!imageFile) return;
    setIsLoading(true); setError(null); setAnalysis(null); setChatMessages([]);
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
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setAnalysis(data.analysis);
      saveToHistory(data.analysis);
      
      // Seed initial chat
      if (question.trim()) {
         setChatMessages([{role: 'user', text: question.trim()}, {role: 'assistant', text: "Here is your analysis based on your question."}]);
         setQuestion(''); // clear it
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChatSend = async () => {
    if (!chatQuestion.trim() || !analysis) return;
    const q = chatQuestion.trim();
    setChatQuestion('');
    setChatMessages(prev => [...prev, {role: 'user', text: q}]);
    setIsChatLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, historyContext: JSON.stringify(analysis) })
      });
      const data = await res.json();
      if (data.answer) {
        setChatMessages(prev => [...prev, {role: 'assistant', text: data.answer}]);
      } else {
        throw new Error("No answer returned");
      }
    } catch (e) {
      setChatMessages(prev => [...prev, {role: 'assistant', text: "Sorry, I couldn't process that right now."}]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleVoiceInput = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support native voice input. Please type your message.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setChatQuestion(prev => prev ? prev + ' ' + transcript : transcript);
    };
    recognition.onerror = (e: any) => console.error("Speech err:", e);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setAnalysis(item.result);
    setImagePreview(null);
    setImageFile(null);
    setChatMessages([]);
    if (typeof window !== 'undefined' && window.innerWidth < 900) setIsSidebarOpen(false);
  };

  const handleExportPDF = async () => {
    if (!resultsRef.current || !analysis) return;
    try {
      const el = resultsRef.current;
      // Backup styles
      const originalBg = el.style.backgroundColor;
      const originalColor = el.style.color;
      
      // Force exact dark theme colors for canvas capture to fix contrast issue
      el.style.backgroundColor = '#0a0e1a';
      el.style.color = '#ffffff';

      // Inject strict branding specifically for the PDF
      const brandEl = document.createElement('div');
      brandEl.innerHTML = '<h2 style="color: #06b6d4; text-align: center; margin-bottom: 24px; font-family: sans-serif; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px;">✈️ PaperPilot Pro Analysis</h2>';
      el.insertBefore(brandEl, el.firstChild);

      const canvas = await html2canvas(el, { 
        scale: 2, 
        backgroundColor: '#0a0e1a',
        width: el.scrollWidth,
        height: el.scrollHeight
      });
      
      // Revert styles
      el.removeChild(brandEl);
      el.style.backgroundColor = originalBg;
      el.style.color = originalColor;

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      // Only scale if the height exceeds A4 page height (this is a simple PDF approach)
      const finalWidth = pdfHeight > pdf.internal.pageSize.getHeight() ? pdf.internal.pageSize.getHeight() * (pdfWidth / pdfHeight) : pdfWidth;
      const finalHeight = pdfHeight > pdf.internal.pageSize.getHeight() ? pdf.internal.pageSize.getHeight() : pdfHeight;
      pdf.addImage(imgData, 'PNG', 0, 0, finalWidth, finalHeight);
      pdf.save(`PaperPilot_${analysis.documentType.replace(/\s+/g,'_')}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Failed to generate PDF');
    }
  };

  return (
    <div className="dashboard-layout">
      {/* Dynamic Multi-color Background with 3D Objects */}
      <div className="app-bg">
        <div className="floating-obj obj-1 obj-sphere"></div>
        <div className="floating-obj obj-2 obj-cube"></div>
        <div className="floating-obj obj-3 obj-sphere"></div>
        <div className="floating-obj obj-4 obj-cube"></div>
        <div className="floating-obj obj-5 obj-sphere"></div>
      </div>

      {/* SVG Filters & Definitions */}
      <svg width="0" height="0" className="sr-only">
        <defs>
          <linearGradient id="cyan-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop stopColor="#06b6d4" offset="0%" />
            <stop stopColor="#3b82f6" offset="100%" />
          </linearGradient>
        </defs>
      </svg>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={() => setIsSidebarOpen(false)} style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:40}}></div>}

      {/* Sidebar */}
      <aside className={`dashboard-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="dashboard-sidebar-header">
          <div className="app-logo">
            <div className="app-logo-icon">✈️</div>
            <span className="app-logo-text">PaperPilot Pro</span>
          </div>
        </div>
        
        <div className="dashboard-sidebar-content">
          <h3 style={{fontSize:'0.8rem', textTransform:'uppercase', color:'var(--color-text-muted)', marginBottom:'12px', letterSpacing:'1px'}}>Analysis History</h3>
          {history.length === 0 ? (
            <p style={{fontSize:'0.85rem', color:'var(--color-text-muted)'}}>No past documents.</p>
          ) : (
            history.map(item => (
              <button key={item.id} className={`history-item ${analysis === item.result ? 'active' : ''}`} onClick={() => loadHistoryItem(item)}>
                <div className="history-item-title">{item.result.documentType}</div>
                <div className="history-item-date">{new Date(item.timestamp).toLocaleDateString()} at {new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
              </button>
            ))
          )}
        </div>

        <div className="dashboard-sidebar-footer">
          <div>Usage Quota (Daily Free Tier)</div>
          <div className="quota-bar-container">
            <div className="quota-bar-fill" style={{width: `${(quotaUsed / MAX_QUOTA) * 100}%`}}></div>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', marginTop:'4px'}}>
            <span>{quotaUsed} used</span>
            <span>{MAX_QUOTA} total</span>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="dashboard-main">
        {/* Header */}
        <header className="dashboard-header">
          <div style={{display:'flex', alignItems:'center', gap:'16px'}}>
            <button className="icon-btn mobile-menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)} aria-label="Toggle Menu">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
            <div className="app-logo-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width: '24px', height: '24px', color: 'var(--color-accent-primary)'}}>
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              <h2 style={{fontFamily:'var(--font-primary)', fontSize:'1.1rem', margin:0, fontWeight: 700}}>
                PaperPilot
              </h2>
              <div className="gemini-pill">Powered by Gemini</div>
            </div>
          </div>
          
          <div className="header-actions">
            {/* Theme Toggle Button with Tooltip */}
            {/* Theme Toggle Removed - Locked to Dark Mode */}

            {analysis && (
              <>
                <button className="icon-btn" onClick={handleExportPDF} title="Export as PDF">🖨️</button>
                <button className="icon-btn" onClick={() => {
                   if (navigator.share) navigator.share({title: 'PaperPilot Analysis', text: buildSpeechText(analysis) });
                }} title="Share Analysis">📤</button>
              </>
            )}
            
            {/* New Button - Only visible when an analysis is being viewed */}
            {analysis && (
              <button className="hero-scroll-btn" onClick={() => { setImageFile(null); setImagePreview(null); setAnalysis(null); setIsSidebarOpen(false); }}>
                <span>+ New</span>
              </button>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div className="dashboard-content-area">
          {!analysis && !isLoading && (
            <div className="hero-landing-container">
              {/* Paper Airplane Sky - Outside the dashed box to prevent clipping */}
              <div className="airplane-sky">
                <div className="airplane-animation-wrapper">
                  <svg className="airplane-icon" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13" />
                    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </div>
              </div>

              {/* Marketing Copy from Image 2 */}
              <div className="hero-marketing-content">
                <h1 className="hero-title">PaperPilot</h1>
                <h2 className="hero-subtitle">Understand Any Document in Seconds</h2>
                <p className="hero-description">
                  Instantly decode complex legal notices, financial statements, and official forms. 
                  PaperPilot transforms confusing documents into clear, actionable insights. 
                  Works with Voice too.
                </p>
                <button className="get-started-btn" onClick={() => fileInputRef.current?.click()}>
                  Upload Document
                </button>
              </div>

              {/* Upload Zone - Relocated to bottom */}
              <div
                className={`upload-zone${isDragOver ? ' drag-over' : ''}${imagePreview ? ' has-image' : ''}`}
                onClick={() => !imagePreview && fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
              >
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="upload-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                {imagePreview ? (
                  <div className="upload-preview-container">
                    <button 
                      className="upload-change-btn" 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setImageFile(null); 
                        setImagePreview(null); 
                        setQuestion('');
                      }} 
                      title="Remove document"
                    >
                      ✕
                    </button>
                    {imagePreview === 'PDF_DOCUMENT_PREVIEW' ? <div className="upload-preview pdf-preview">📑 PDF Document</div> : <img src={imagePreview} className="upload-preview" alt="Document" />}
                    <div style={{marginTop:'16px', display:'flex', gap:'8px', flexDirection:'column'}}>
                       <input type="text" className="question-input" placeholder="Optional context or question..." value={question} onChange={e => setQuestion(e.target.value)} />
                       <button className="analyze-btn" onClick={(e) => { e.stopPropagation(); handleAnalyze(); }}>Analyze Document</button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-minimal-content">
                    <span style={{fontSize: '2rem', marginBottom: '8px', opacity: 0.6}}>📄</span>
                    <div style={{fontSize: '1.1rem', fontWeight: 600}}>Drop your document here</div>
                    <div style={{fontSize: '0.85rem', opacity: 0.5}}>or click to browse — PDF, JPG, PNG, WebP up to 10MB</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isLoading && (
            <div className="loading-container">
              <div className="scanning-document-box">
                {imagePreview && imagePreview !== 'PDF_DOCUMENT_PREVIEW' ? (
                  <img src={imagePreview} alt="Document" className="scanning-preview" />
                ) : (
                  <div className="scanning-placeholder">📄</div>
                )}
                <div className="scanning-line"></div>
              </div>
              <div className="loading-spinner"></div>
              <p className="loading-text">Gemini is reading your document...</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="error-container" style={{margin:'24px'}}>
              <p className="error-message">{error}</p>
              <button className="error-retry-btn" onClick={() => setError(null)}>Try Again</button>
            </div>
          )}

          {analysis && !isLoading && (
             <div className="split-view">
               <div className="split-left">
                 {imagePreview ? (
                   <div className="document-viewer">
                     {imagePreview === 'PDF_DOCUMENT_PREVIEW' ? (
                       <div style={{textAlign:'center', color:'var(--color-text-muted)'}}>
                         <div style={{fontSize:'4rem'}}>📑</div>
                         <p>PDF Preview available only during upload.</p>
                       </div>
                     ) : (
                        <img src={imagePreview} className="document-image" alt="Scanned Document" />
                     )}
                   </div>
                 ) : (
                   <div style={{display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--color-text-muted)', padding:'24px', textAlign:'center'}}>
                      <p>Image preview unavailable for history documents.</p>
                   </div>
                 )}
               </div>

               <div className="split-right">
                  <div className="analysis-scroll-area" ref={resultsRef} style={{padding: '32px', color: '#fff'}}>
                     <div style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'24px'}}>
                        <span className={`urgency-badge ${analysis.urgencyLevel}`}>{URGENCY_EMOJI[analysis.urgencyLevel]} {URGENCY_LABEL[analysis.urgencyLevel]}</span>
                     </div>

                     <div className="summary-block" style={{marginBottom:'24px'}}>
                        <h3 className="section-title">📋 Summary</h3>
                        <p>{analysis.summary}</p>
                     </div>

                     {analysis.deadlines.length > 0 && (
                        <div style={{marginBottom:'24px'}}>
                          <h3 className="section-title">📅 Deadlines</h3>
                          <ul className="deadline-list">
                            {analysis.deadlines.map((d, i) => (
                              <li key={i} className="deadline-item" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                <div>
                                  <div className="deadline-date">{d.date}</div>
                                  <div className="deadline-desc">{d.description}</div>
                                </div>
                                <button className="icon-btn" style={{minWidth:'40px'}} title="Add to Calendar" onClick={() => generateICS(d)}>📅</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                     )}

                     {analysis.actions.length > 0 && (
                        <div style={{marginBottom:'24px', paddingBottom:'24px', borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                          <h3 className="section-title">✅ Required Actions</h3>
                          <ul className="action-list">
                            {analysis.actions.map((act) => (
                              <li key={act.step} className={`action-item${act.isUrgent ? ' urgent' : ''}`}>
                                <div className="action-step">{act.step}</div>
                                <div className="action-content">
                                  <h4>{act.title}{act.isUrgent && <span className="urgent-tag">URGENT</span>}</h4>
                                  <p>{act.description}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                     )}
                     
                     {/* Chat Messages */}
                     {chatMessages.length > 0 && (
                       <div className="chat-messages-area" style={{marginBottom:'24px'}}>
                         <h3 className="section-title" style={{fontSize:'0.9rem', color:'var(--color-text-muted)'}}>Conversation History</h3>
                         {chatMessages.map((msg, idx) => (
                            <div key={idx} style={{
                              background: msg.role === 'user' ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.05)',
                              padding: '12px',
                              borderRadius: '8px',
                              marginBottom: '8px',
                              marginLeft: msg.role === 'user' ? '24px' : '0',
                              marginRight: msg.role === 'assistant' ? '24px' : '0',
                              border: msg.role === 'user' ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid transparent'
                            }}>
                               <div style={{fontSize:'0.75rem', color:'var(--color-text-muted)', marginBottom:'4px'}}>{msg.role === 'user' ? 'You' : 'PaperPilot'}</div>
                               <div style={{fontSize:'0.95rem'}}>{msg.text}</div>
                            </div>
                         ))}
                         {isChatLoading && (
                           <div style={{padding:'12px', fontSize:'0.9rem', color:'var(--color-text-muted)'}}>Piloting response...</div>
                         )}
                       </div>
                     )}
                  </div>

                  <div className="chat-input-container">
                     <div className="chat-input-box">
                       <input 
                         type="text" 
                         placeholder="Ask a follow-up question..." 
                         value={chatQuestion}
                         onChange={(e) => setChatQuestion(e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && handleChatSend()}
                         disabled={isChatLoading || isListening}
                       />
                       <button className="icon-btn" onClick={handleVoiceInput} style={{minWidth: '36px', height: '36px', margin: '0 4px', background: isListening ? 'rgba(239,68,68,0.2)' : 'transparent', color: isListening ? '#ef4444' : 'inherit'}} title="Voice Input">
                         🎤
                       </button>
                       <button className="chat-send-btn" onClick={handleChatSend} disabled={isChatLoading || !chatQuestion.trim()}>↑</button>
                     </div>
                  </div>
               </div>
             </div>
          )}
        </div>
      </main>
    </div>
  );
}
