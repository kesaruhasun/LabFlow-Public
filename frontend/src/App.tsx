import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, User, Hash, MapPin, Calendar, CheckCircle2, AlertCircle, Loader2, Download, ArrowRight, X, MessageSquare, Send, ChevronDown, ChevronRight, Image, Phone, Mail } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const VERIFICATION_TOKEN = import.meta.env.VITE_APP_VERIFICATION_TOKEN || 'labflow-app-v1-secret';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{ filename: string, docx: string, pdf: string, ipynb: string, zip: string } | null>(null);

  // Collapsible filename config
  const [showFilenameConfig, setShowFilenameConfig] = useState(false);

  // HMAC challenge token (fetched on page load)
  const [challengeToken, setChallengeToken] = useState('');

  // Feedback State
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [feedbackPhone, setFeedbackPhone] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackScreenshot, setFeedbackScreenshot] = useState<File | null>(null);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  // Fetch challenge token on mount and refresh every 4 minutes (token lives 5 min)
  useEffect(() => {
    const fetchChallenge = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/challenge`);
        const data = await res.json();
        setChallengeToken(data.token || '');
      } catch { /* ignore */ }
    };
    fetchChallenge();
    const id = setInterval(fetchChallenge, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    it_number: '',
    center: 'WD',
    batch: 'B1.G1',
    file_format: 'LabSheet{lab_req}_{it_number}_{center}.IT.{batch}'
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type !== 'application/pdf') {
        setError('Please upload a valid PDF format document.');
        setFile(null);
        return;
      }
      setError(null);
      setFile(selectedFile);
    }
  };

  const removeFile = () => {
    setFile(null);
  };

  const openErrorReport = (errorMsg: string) => {
    setFeedbackMsg(`Error Report:\n${errorMsg}`);
    setFeedbackPhone('');
    setFeedbackEmail('');
    setFeedbackStatus('idle');
    setShowFeedback(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !formData.name || !formData.it_number) {
      setError('Missing required fields.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessData(null);

    const submitData = new FormData();
    submitData.append('file', file);
    submitData.append('name', formData.name);
    submitData.append('it_number', formData.it_number);
    submitData.append('center', formData.center);
    submitData.append('batch', formData.batch);
    submitData.append('file_format', formData.file_format);

    try {
      const response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: {
          'X-App-Verification-Token': VERIFICATION_TOKEN,
          'X-Challenge-Token': challengeToken,
        },
        body: submitData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to generate document');
      }

      const data = await response.json();
      setSuccessData(data);

    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during execution.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackMsg.trim()) return;

    setSendingFeedback(true);
    setFeedbackStatus('idle');

    let screenshotB64: string | null = null;
    if (feedbackScreenshot) {
      screenshotB64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip 'data:image/...;base64,' prefix
          resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(feedbackScreenshot);
      });
    }

    try {
      const response = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Verification-Token': VERIFICATION_TOKEN,
        },
        body: JSON.stringify({
          message: feedbackMsg,
          user: formData.it_number || 'Anonymous',
          phone: feedbackPhone,
          email: feedbackEmail,
          screenshot: screenshotB64
        }),
      });

      if (!response.ok) throw new Error('Failed to send');

      setFeedbackStatus('success');
      setFeedbackMsg('');
      setFeedbackPhone('');
      setFeedbackEmail('');
      setFeedbackScreenshot(null);
      setTimeout(() => setShowFeedback(false), 2000);
    } catch {
      setFeedbackStatus('error');
    } finally {
      setSendingFeedback(false);
    }
  };

  const handleDownload = (b64: string, extension: string) => {
    if (!successData) return;
    const byteCharacters = atob(b64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray]);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${successData.filename}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F9F9F9] flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 selection:bg-[#EAEAEA]">
      <div className="w-full max-w-[600px]">

        {/* Header Section */}
        <div className="mb-10 text-left">
          <div className="inline-flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-widest text-[#888888] uppercase mb-4">
            <span className="w-2 h-2 rounded-full bg-[#5E6AD2]"></span>
            <span>University Department / Faculty</span>
            <span className="px-1.5 py-0.5 rounded-sm bg-[#EAEAEA] text-[#111111]">Term 1</span>
            <span>Module Code & Name</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-[#111111] mb-2">
            LabFlow <span className="text-[#5E6AD2]">AI Generator</span>
          </h1>
          <p className="text-sm text-[#888888]">Instantly generate formatted Word document submissions, Notebooks, and source PDFs for <strong>any Lab Sheet</strong> using AI execution.</p>
        </div>

        {/* Main Application Container */}
        <div className="bg-[#FFFFFF] border border-[#EAEAEA] rounded-xl shadow-sm overflow-hidden">

          <form onSubmit={handleSubmit} className="divide-y divide-[#EAEAEA]">

            {/* File Upload Section */}
            <div className="p-6">
              <label className="block text-xs font-medium text-[#888888] uppercase tracking-wider mb-3">1. Documents</label>
              <div className={`relative border border-[#EAEAEA] rounded-lg transition-colors duration-200 ${file ? 'bg-[#F9F9F9]' : 'bg-white hover:bg-[#F9F9F9] border-dashed'} overflow-hidden`}>
                {!file ? (
                  <>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      disabled={loading}
                    />
                    <div className="py-8 px-4 flex flex-col items-center justify-center text-center">
                      <div className="w-10 h-10 rounded-full bg-[#F3F3F3] border border-[#EAEAEA] flex items-center justify-center mb-3">
                        <Upload className="w-5 h-5 text-[#888888]" />
                      </div>
                      <p className="text-sm font-medium text-[#111111]">Upload Blank Lab Question Sheet PDF</p>
                      <p className="text-xs text-[#888888] mt-1">Drag and drop or click to browse (Do NOT upload pre-answered sheets)</p>
                    </div>
                  </>
                ) : (
                  <div className="py-4 px-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <div className="w-8 h-8 rounded bg-[#5E6AD2]/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-[#5E6AD2]" />
                      </div>
                      <span className="text-sm font-medium text-[#111111] truncate">{file.name}</span>
                    </div>
                    <button type="button" onClick={removeFile} disabled={loading} className="p-1.5 hover:bg-[#EAEAEA] rounded text-[#888888] transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata Section */}
            <div className="p-6">
              <label className="block text-xs font-medium text-[#888888] uppercase tracking-wider mb-4">2. Metadata Variables</label>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1.5 flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-[#888888]" /> Name</label>
                    <input
                      required type="text" name="name" value={formData.name} onChange={handleInputChange} disabled={loading} placeholder="Jane Doe"
                      className="w-full text-sm px-3 py-2 bg-[#F9F9F9] border border-[#EAEAEA] rounded-md focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1.5 flex items-center gap-1.5"><Hash className="w-3.5 h-3.5 text-[#888888]" /> ID Number</label>
                    <input
                      required type="text" name="it_number" value={formData.it_number} onChange={handleInputChange} disabled={loading} placeholder="STU00000"
                      className="w-full text-sm px-3 py-2 bg-[#F9F9F9] border border-[#EAEAEA] rounded-md focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] transition-colors uppercase"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1.5 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-[#888888]" /> Center</label>
                    <select
                      name="center" value={formData.center} onChange={handleInputChange} disabled={loading}
                      className="w-full text-sm px-3 py-2 bg-[#F9F9F9] border border-[#EAEAEA] rounded-md focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] transition-colors appearance-none"
                    >
                      <option value="Main">Main Campus</option>
                      <option value="City">City Campus</option>
                      <option value="Online">Online / Remote</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1.5 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-[#888888]" /> Batch</label>
                    <input
                      type="text" name="batch" value={formData.batch} onChange={handleInputChange} disabled={loading} placeholder="B1.G1"
                      className="w-full text-sm px-3 py-2 bg-[#F9F9F9] border border-[#EAEAEA] rounded-md focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Collapsible Advanced / Filename Config Section */}
            <div className="bg-[#FBFBFB]">
              <button
                type="button"
                onClick={() => setShowFilenameConfig(!showFilenameConfig)}
                className="w-full px-6 py-3 flex items-center justify-between text-xs font-medium text-[#888888] hover:text-[#111111] transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  {showFilenameConfig ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  Advanced — Output Filename Mask
                </span>
                {!showFilenameConfig && <span className="font-mono text-[10px] text-[#AAAAAA] truncate max-w-[240px]">{formData.file_format}</span>}
              </button>
              {showFilenameConfig && (
                <div className="px-6 pb-4">
                  <p className="text-xs text-[#888888] mb-2">Leave as default unless specifically instructed to change.</p>
                  <div className="flex rounded-md shadow-sm">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-[#EAEAEA] bg-[#F3F3F3] text-[#888888] sm:text-xs font-mono">
                      {`>_`}
                    </span>
                    <input
                      type="text" name="file_format" value={formData.file_format} onChange={handleInputChange} disabled={loading}
                      className="flex-1 block w-full min-w-0 rounded-none rounded-r-md sm:text-xs text-[#888888] font-mono px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Error State */}
            {error && (
              <div className="px-6 py-4 bg-red-50 border-t border-red-100">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800 font-medium">{error}</p>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <p className="text-xs text-red-600">Something keeps failing? Help us fix it —</p>
                  <button
                    type="button"
                    onClick={() => openErrorReport(error)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#5E6AD2] hover:underline"
                  >
                    <MessageSquare className="w-3 h-3" /> Send Error Report
                  </button>
                  {error.includes("challenge token") && (
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#5E6AD2] hover:underline border-l border-[#EAEAEA] pl-2"
                    >
                      <ArrowRight className="w-3 h-3 rotate-180" /> Reload Page
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Success State */}
            {successData && (
              <div className="p-6 bg-[#FBFBFB] border-t border-[#EAEAEA]">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#111111]">Generation Successful</p>
                    <p className="text-xs text-[#888888]">Files generated with format: <span className="font-mono text-[#5E6AD2]">{successData.filename}</span></p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <button type="button" onClick={() => handleDownload(successData.docx, 'docx')} className="flex flex-col items-center justify-center p-4 bg-white border border-[#EAEAEA] hover:border-[#5E6AD2] hover:bg-[#F9F9FB] rounded-lg transition-all group active:scale-95">
                    <FileText className="w-6 h-6 text-[#5E6AD2] mb-3 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-semibold text-[#111111] uppercase tracking-wider text-center">DOCX</span>
                  </button>
                  <button type="button" onClick={() => handleDownload(successData.pdf, 'pdf')} className="flex flex-col items-center justify-center p-4 bg-white border border-[#EAEAEA] hover:border-[#5E6AD2] hover:bg-[#F9F9FB] rounded-lg transition-all group active:scale-95">
                    <FileText className="w-6 h-6 text-red-500 mb-3 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-semibold text-[#111111] uppercase tracking-wider text-center">PDF Note</span>
                  </button>
                  <button type="button" onClick={() => handleDownload(successData.ipynb, 'ipynb')} className="flex flex-col items-center justify-center p-4 bg-white border border-[#EAEAEA] hover:border-[#5E6AD2] hover:bg-[#F9F9FB] rounded-lg transition-all group active:scale-95">
                    <FileText className="w-6 h-6 text-orange-500 mb-3 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-semibold text-[#111111] uppercase tracking-wider text-center">IPYNB</span>
                  </button>
                  <button type="button" onClick={() => handleDownload(successData.zip, 'zip')} className="flex flex-col items-center justify-center p-4 bg-white border border-[#EAEAEA] hover:border-[#5E6AD2] hover:bg-[#F9F9FB] rounded-lg transition-all group active:scale-95">
                    <Download className="w-6 h-6 text-[#111111] mb-3 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-semibold text-[#111111] uppercase tracking-wider text-center">ZIP All</span>
                  </button>
                </div>

                <div className="mt-8 pt-6 border-t border-[#EAEAEA] flex justify-center">
                  <button
                    type="button"
                    onClick={() => { setSuccessData(null); setFile(null); }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#111111] text-white text-sm font-medium rounded-md hover:bg-[#222222] transition-colors shadow-sm active:scale-[0.98]"
                  >
                    Start New Submission
                  </button>
                </div>
              </div>
            )}

            {/* Action Footer */}
            {!successData && (
              <div className="p-6 bg-[#F9F9F9] flex justify-end">
                <button
                  type="submit"
                  disabled={loading || !file}
                  className={`relative inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium rounded-md transition-all duration-200 overflow-hidden
                    ${loading || !file
                      ? 'bg-[#EAEAEA] text-[#888888] cursor-not-allowed'
                      : 'bg-[#111111] hover:bg-[#222222] text-white shadow-sm active:scale-[0.98]'
                    }
                  `}
                >
                  {loading ? (
                    <span className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin opacity-70" />
                      <span>Executing Pipeline...</span>
                    </span>
                  ) : (
                    <span className="flex items-center space-x-2">
                      <span>Execute</span>
                      <ArrowRight className="w-4 h-4 opacity-70" />
                    </span>
                  )}
                </button>
              </div>
            )}
          </form>
        </div>

        {/* Footer info & Feedback */}
        <div className="mt-8 flex items-center justify-between text-xs text-[#888888] font-medium px-2">
          <p>Built by <a href="https://kesaru.me" target="_blank" rel="noopener noreferrer" className="text-[#5E6AD2] hover:underline">kesaru.me</a></p>
          <button
            onClick={() => { setShowFeedback(true); setFeedbackStatus('idle'); }}
            className="flex items-center gap-1.5 hover:text-[#111111] transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Feedback
          </button>
        </div>

      </div>

      {/* Feedback Modal */}
      {showFeedback && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-[#EAEAEA] flex items-center justify-between bg-[#FBFBFB]">
              <h3 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#5E6AD2]" />
                Send Feedback to Developer
              </h3>
              <button onClick={() => setShowFeedback(false)} className="text-[#888888] hover:text-[#111111] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSendFeedback} className="p-5">
              <textarea
                value={feedbackMsg}
                onChange={(e) => setFeedbackMsg(e.target.value)}
                placeholder="Found a bug? Have a suggestion? Let me know..."
                className="w-full h-28 text-sm px-3 py-2 bg-[#F9F9F9] border border-[#EAEAEA] rounded-md focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] resize-none mb-3"
                required
              />

              {/* Contact fields */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="relative">
                  <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#AAAAAA]" />
                  <input
                    type="tel"
                    value={feedbackPhone}
                    onChange={(e) => setFeedbackPhone(e.target.value)}
                    placeholder="Phone / WhatsApp"
                    className="w-full text-xs pl-7 pr-3 py-2 bg-[#F9F9F9] border border-[#EAEAEA] rounded-md focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] transition-colors"
                  />
                </div>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#AAAAAA]" />
                  <input
                    type="email"
                    value={feedbackEmail}
                    onChange={(e) => setFeedbackEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="w-full text-xs pl-7 pr-3 py-2 bg-[#F9F9F9] border border-[#EAEAEA] rounded-md focus:outline-none focus:border-[#5E6AD2] focus:ring-1 focus:ring-[#5E6AD2] transition-colors"
                  />
                </div>
              </div>

              {/* Screenshot attachment */}
              <div className="mb-4">
                <input
                  type="file"
                  accept="image/*"
                  ref={screenshotInputRef}
                  className="hidden"
                  onChange={(e) => setFeedbackScreenshot(e.target.files?.[0] || null)}
                />
                {feedbackScreenshot ? (
                  <div className="flex items-center gap-2 text-xs text-[#555555] bg-[#F9F9F9] border border-[#EAEAEA] rounded-md px-3 py-2">
                    <Image className="w-3.5 h-3.5 text-[#5E6AD2]" />
                    <span className="truncate flex-1">{feedbackScreenshot.name}</span>
                    <button type="button" onClick={() => setFeedbackScreenshot(null)} className="text-[#888888] hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => screenshotInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs text-[#888888] hover:text-[#5E6AD2] transition-colors"
                  >
                    <Image className="w-3.5 h-3.5" /> Attach screenshot (optional)
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs">
                  {feedbackStatus === 'success' && <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Sent!</span>}
                  {feedbackStatus === 'error' && <span className="text-red-600 font-medium flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Failed to send</span>}
                </div>
                <button
                  type="submit"
                  disabled={sendingFeedback || !feedbackMsg.trim()}
                  className={`inline-flex items-center justify-center px-4 py-2 text-xs font-medium rounded-md transition-all ${sendingFeedback || !feedbackMsg.trim() ? 'bg-[#EAEAEA] text-[#888888]' : 'bg-[#111111] text-white hover:bg-[#222222]'}`}
                >
                  {sendingFeedback ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3.5 h-3.5 mr-1.5" /> Send</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
