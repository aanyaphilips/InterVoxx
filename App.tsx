import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Camera, Check, ChevronRight, CircleAlert, Clock3, FileCheck2, FileText, Info, LockKeyhole, Mic, MicOff, MonitorOff, RotateCcw, ShieldCheck, UserCheck, Volume2, VolumeX, Wifi, XCircle } from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient();

type Candidate = { fullName: string; email: string; pursuing: string; resumeFile: string; company: string; field: string; managerName: string };
type InterviewResult = { question: string; answer: string; correctness: number; confidence: number; vocabulary: number; communication: number; duration: number };
type Report = { candidate: Candidate; results: InterviewResult[]; score: number; qualified: boolean; terminated?: boolean };
type ShortlistedEntry = { candidate: Candidate; score: number; qualifiedAt: string; report: Report };
type SpeechRecognitionInstance = { continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance };

const CANDIDATE_KEY = 'intervox-candidate';
const REPORT_KEY = 'intervox-report';
const SHORTLIST_KEY = 'intervox-shortlisted';
const emptyCandidate: Candidate = { fullName: '', email: '', pursuing: '', resumeFile: '', company: '', field: '', managerName: '' };

function readStorage<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

type ResumeScan = { approved: boolean; detail: string; evidence: string[] };

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 < bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    if (fileName !== 'word/document.xml') {
      offset += 45 + fileNameLength + extraLength + commentLength;
      continue;
    }
    const localView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const localNameLength = localView.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = localView.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const xml = compression === 0
      ? new TextDecoder().decode(compressed)
      : await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    return xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  return '';
}

async function scanResumeFile(file: File): Promise<ResumeScan> {
  const suffix = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  const allowedSuffix = ['.pdf', '.doc', '.docx', '.txt', '.md'].includes(suffix);
  const acceptedSize = file.size > 500 && file.size < 8 * 1024 * 1024;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder('latin1').decode(bytes.slice(0, 16));
  const rawSample = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 2_000_000))).toLowerCase();
  const signature = suffix === '.pdf' ? header.startsWith('%PDF-')
    : suffix === '.docx' ? header.startsWith('PK') && rawSample.includes('word/document.xml')
      : suffix === '.doc' ? header.startsWith('\u0000\u0001\u0014\u0000')
        : true;
  let readable = '';
  if (['.txt', '.md'].includes(suffix)) readable = await file.text();
  if (suffix === '.docx' && signature) readable = await extractDocxText(bytes);
  const signalText = `${file.name} ${readable} ${rawSample}`;
  const sectionTerms = ['experience', 'education', 'skills', 'projects', 'summary', 'certification', 'contact'];
  const sectionHits = sectionTerms.filter((term) => signalText.includes(term)).length;
  const hasContact = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(signalText) || /(?:\+?\d[\d\s().-]{7,}\d)/.test(signalText);
  const suspicious = /(sample resume|test resume|lorem ipsum|replace this|your name here|john doe)/i.test(signalText);
  const evidence = [
    allowedSuffix ? 'supported document type' : 'unsupported document type',
    acceptedSize ? 'file size is within range' : 'file size is outside range',
    signature ? 'document signature is valid' : 'document signature is invalid',
    `${sectionHits} resume sections detected`,
    hasContact ? 'contact signal detected' : 'contact signal missing',
  ];
  const approved = allowedSuffix && acceptedSize && signature && sectionHits >= 2 && hasContact && !suspicious;
  return {
    approved,
    evidence,
    detail: approved
      ? 'Authenticity screen passed: document structure, resume sections, and contact signals are consistent.'
      : 'Authenticity screen failed: the file is missing a valid document signal, resume structure, or contact evidence.',
  };
}

function Header() {
  return <header className="topbar">
    <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark"><Volume2 size={16} strokeWidth={2.5} /></span><span className="brand-name">InterVox</span></Link>
    <div className="topbar-right"><Link href="/shortlisted" className="shortlist-link" data-testid="link-shortlisted"><UserCheck size={14} /> shortlisted</Link><div className="header-note"><span className="signal-dot" /> private assessment room</div></div>
  </header>;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="app-shell"><Header />{children}</div>;
}

function Home() {
  return <Shell><main className="page">
    <section className="hero-grid">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-line" /> candidate room / 01</div>
        <h1>Let your <em>voice</em> do the work.</h1>
        <p className="hero-lede">InterVox is a short, structured interview that gives you room to explain what you know — clearly, in your own words. A transparent screening signal for people, not a verdict from a machine.</p>
        <div className="hero-actions">
          <Link href="/onboarding" className="button button-primary" data-testid="link-begin"><span>Enter the interview room</span><ChevronRight size={17} /></Link>
          <a className="button button-secondary" href="#how-it-works" data-testid="link-learn"><Info size={16} /> How it works</a>
        </div>
      </div>
      <div className="hero-card" aria-label="InterVox interview room preview">
        <div className="hero-card-top"><span className="room-label">InterVox / room 04</span><span className="room-number">V-24—07</span></div>
        <div className="voice-orbit"><span className="orbit-ring one" /><span className="orbit-ring two" /><span className="voice-core"><Mic size={31} strokeWidth={1.7} /></span></div>
        <div className="hero-card-copy"><h3>A fairer first signal.</h3><p>Four questions. Your voice. One useful summary for the people who may meet you next.</p></div>
      </div>
    </section>
    <section id="how-it-works" className="feature-strip" aria-label="How the assessment works">
      <div className="feature"><ShieldCheck className="feature-icon" size={23} /><h4>Clear from the start</h4><p>You will know what is recorded, why it is used, and where human judgment begins.</p></div>
      <div className="feature"><Mic className="feature-icon" size={23} /><h4>Answer in your voice</h4><p>Speak naturally or type. We look for the substance and shape of your response.</p></div>
      <div className="feature"><FileCheck2 className="feature-icon" size={23} /><h4>A signal, not a sentence</h4><p>Your report is assistive screening. Final hiring decisions remain with people.</p></div>
    </section>
    <div className="trust-band"><span><LockKeyhole size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} /> Nothing leaves this prototype.</span><span><strong>Before you begin:</strong> upload a verifiable resume, allow camera + microphone, and keep this tab in view.</span></div>
  </main></Shell>;
}

 function Onboarding() {
  const [candidate, setCandidate] = useState<Candidate>(() => readStorage(CANDIDATE_KEY, emptyCandidate));
  const [errors, setErrors] = useState<Partial<Record<keyof Candidate | 'resume', string>>>({});
  const [screening, setScreening] = useState<'idle' | 'checking' | 'approved' | 'rejected'>('idle');
  const [screenProgress, setScreenProgress] = useState(0);
  const [screenDetail, setScreenDetail] = useState('');
  const [, setLocation] = useLocation();

  const update = (key: keyof Candidate, value: string) => {
    setCandidate((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, resume: key === 'resumeFile' ? undefined : current.resume }));
  };

  const inspectResume = async (file: File) => {
    update('resumeFile', file.name);
    setScreening('checking'); setScreenProgress(15); setScreenDetail('Checking document integrity and resume signals…');
    const timer = window.setInterval(() => setScreenProgress((current) => Math.min(88, current + 14)), 140);
    let scan: ResumeScan;
    try {
      scan = await scanResumeFile(file);
    } catch {
      scan = { approved: false, detail: 'The file could not be read safely.', evidence: ['read failed'] };
    }
    window.setTimeout(() => {
      window.clearInterval(timer);
      setScreenProgress(100);
      setScreening(scan.approved ? 'approved' : 'rejected');
      setScreenDetail(`${scan.detail} ${scan.evidence.join(' · ')}`);
      if (!scan.approved) setErrors((current) => ({ ...current, resume: 'This resume did not pass the authenticity screen. Upload a real, readable resume with contact and experience details.' }));
    }, 900);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void inspectResume(file); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    (['fullName', 'email', 'pursuing', 'company', 'field', 'managerName'] as const).forEach((key) => { if (!candidate[key].trim()) next[key] = 'This field is required.'; });
    if (!candidate.resumeFile) next.resume = 'Upload your resume to continue.';
    else if (screening === 'rejected' || screening === 'checking') next.resume = screening === 'checking' ? 'Resume screening is still in progress.' : 'Please upload an eligible resume.';
    if (candidate.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length === 0) { localStorage.setItem(CANDIDATE_KEY, JSON.stringify(candidate)); setLocation('/interview'); }
  };

  return <Shell><main className="page"><div className="step-layout">
    <div className="step-header"><div><div className="eyebrow"><span className="eyebrow-line" /> candidate profile</div><h1>Before we begin.</h1></div><div className="step-count">01 / 03 — about you</div></div>
    <div className="progress-line"><span style={{ width: '33%' }} /></div>
    <div className="form-shell">
      <form className="panel" onSubmit={submit} noValidate>
        <h3>Your context matters.</h3><p className="panel-intro">This gives the questions a little shape. Only the fields marked with an asterisk are required.</p>
        {Object.keys(errors).some((key) => errors[key as keyof typeof errors]) && <div className="error-banner" role="alert" data-testid="status-form-error"><CircleAlert size={17} /> Please check the highlighted fields before entering the room.</div>}
        <div className="form-grid">
          <Field label="Full name" required error={errors.fullName}><input data-testid="input-full-name" value={candidate.fullName} onChange={(e) => update('fullName', e.target.value)} placeholder="e.g. Samira Okafor" /></Field>
          <Field label="Email address" required error={errors.email}><input data-testid="input-email" type="email" value={candidate.email} onChange={(e) => update('email', e.target.value)} placeholder="you@example.com" /></Field>
          <Field label="What are you pursuing?" required error={errors.pursuing}><input data-testid="input-pursuing" value={candidate.pursuing} onChange={(e) => update('pursuing', e.target.value)} placeholder="e.g. Product design internship" /></Field>
          <Field label="Company" required error={errors.company}><input data-testid="input-company" value={candidate.company} onChange={(e) => update('company', e.target.value)} placeholder="e.g. Northstar Labs" /></Field>
          <Field label="Field / discipline" required error={errors.field}><input data-testid="input-field" value={candidate.field} onChange={(e) => update('field', e.target.value)} placeholder="e.g. Climate technology" /></Field>
          <Field label="Hiring manager name" required error={errors.managerName}><input data-testid="input-manager" value={candidate.managerName} onChange={(e) => update('managerName', e.target.value)} placeholder="e.g. Jordan Lee" /></Field>
          <div className="field full"><label htmlFor="resume-file">Resume <span className="required">*</span></label>
            <div className="upload-box"><FileText size={21} color="hsl(var(--primary))" /><div><label className="upload-action" htmlFor="resume-file" data-testid="label-upload-resume">{candidate.resumeFile ? 'Replace resume' : 'Choose a resume'}</label><input id="resume-file" data-testid="input-resume" type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={onFile} /><div className="upload-meta">{candidate.resumeFile || 'PDF, DOCX, or TXT · up to 8 MB'}</div></div></div>
            {errors.resume && <span className="field-error" data-testid="error-resume">{errors.resume}</span>}
          </div>
        </div>
         {screening !== 'idle' && <div className="screening-box" data-testid="status-resume-screening"><div className="screening-head"><span className="screening-status">{screening === 'checking' ? <Clock3 size={15} /> : screening === 'approved' ? <Check size={15} /> : <XCircle size={15} />} {screening === 'checking' ? 'Authenticity screen running' : screening === 'approved' ? 'Resume accepted' : 'Resume rejected'}</span><span>{screenProgress}%</span></div><div className="mini-progress"><span style={{ width: `${screenProgress}%` }} /></div><p className="screening-detail">{screenDetail} This is an automated authenticity screen, not a forensic guarantee.</p></div>}
        <div className="form-actions"><Link href="/" className="button button-secondary" data-testid="link-back-home">Back</Link><button className="button button-primary" type="submit" data-testid="button-continue-interview">Continue to device check <ChevronRight size={16} /></button></div>
      </form>
      <aside className="side-note"><h3>A focused room, with clear rules.</h3><div className="rule-list"><div className="rule"><ShieldCheck size={16} /><span>AI will ask and transcribe. It will not make a final hiring decision.</span></div><div className="rule"><Camera size={16} /><span>Camera and microphone are required so your answer can be heard and seen in context.</span></div><div className="rule"><MonitorOff size={16} /><span>Switching tabs after the interview begins ends the session immediately.</span></div><div className="rule"><LockKeyhole size={16} /><span>This prototype keeps your profile and answers in this browser only.</span></div></div></aside>
       </div>
       </div></main></Shell>;
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return <div className="field"><label>{label} {required && <span className="required">*</span>}</label>{children}{error && <span className="field-error">{error}</span>}</div>;
}

const makeQuestions = (candidate: Candidate) => [
  `Give us a concise introduction, and tell us why ${candidate.pursuing || 'this opportunity'} is the right next step for you.`,
  `What draws you to ${candidate.company || 'this company'} and the ${candidate.field || 'field'}? Be specific about the problem you want to work on.`,
  `Imagine you are already in this role and a project is blocked by an unclear requirement. Walk us through what you would do first, and why.`,
  `Looking back at a recent piece of work, what would you keep, what would you change, and what did it teach you?`,
];

function scoreAnswer(answer: string, questionIndex: number): InterviewResult {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const length = words.length;
  const normalized = answer.toLowerCase();
  const conceptGroups = [
    [['experience', 'worked', 'built', 'project'], ['learn', 'learned', 'skill', 'strength'], ['goal', 'next step', 'role', 'opportunity']],
    [['company', 'team', 'mission', 'culture'], ['problem', 'challenge', 'need', 'customer'], ['impact', 'help', 'improve', 'field']],
    [['clarify', 'ask', 'question', 'understand'], ['requirement', 'scope', 'context', 'acceptance'], ['stakeholder', 'communicate', 'plan', 'document']],
    [['change', 'improve', 'different', 'keep'], ['lesson', 'learned', 'teach', 'insight'], ['result', 'outcome', 'feedback', 'reflect']],
  ][questionIndex];
  const conceptHits = conceptGroups.filter((group) => group.some((term) => normalized.includes(term))).length;
  const fillerCount = (normalized.match(/\b(um|uh|like|you know|sort of|kind of)\b/g) || []).length;
  const hedgeCount = (normalized.match(/\b(maybe|probably|i guess|not sure|i think)\b/g) || []).length;
  const structureSignals = Number(/[.!?]/.test(answer)) + Number(/\b(first|then|because|therefore|finally|so that)\b/.test(normalized));
  const uniqueRatio = length ? new Set(words.map((word) => word.toLowerCase().replace(/[^\w]/g, ''))).size / length : 0;
  const brevityPenalty = length < 12 ? 17 : 0;
  const repetitionPenalty = uniqueRatio < .55 ? 10 : 0;
  const correctness = Math.max(15, Math.min(96, 25 + conceptHits * 15 + Math.min(18, Math.floor(length / 5)) + structureSignals * 4 - brevityPenalty - hedgeCount * 3));
  const confidence = Math.max(25, Math.min(94, 43 + Math.min(34, Math.floor(length / 2)) - fillerCount * 5 - hedgeCount * 3));
  const vocabulary = Math.max(25, Math.min(94, 35 + Math.round(uniqueRatio * 48) + Math.min(10, conceptHits * 3) - repetitionPenalty));
  const communication = Math.max(25, Math.min(95, 40 + Math.min(27, Math.floor(length / 3)) + structureSignals * 7 - fillerCount * 4 - (length > 75 ? 5 : 0)));
  return { question: '', answer: answer.trim(), correctness, confidence, vocabulary, communication, duration: Math.max(18, Math.round(length * 1.8)) };
}

function Interview() {
  const candidate = readStorage<Candidate>(CANDIDATE_KEY, emptyCandidate);
  const questions = makeQuestions(candidate);
  const [started, setStarted] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [answers, setAnswers] = useState<InterviewResult[]>([]);
  const [camera, setCamera] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [microphone, setMicrophone] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [terminated, setTerminated] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const startedRef = useRef(false);
  const [, setLocation] = useLocation();

  const stopStream = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  const checkPermissions = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('denied'); setMicrophone('denied'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream; setCamera('granted'); setMicrophone('granted');
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCamera('denied'); setMicrophone('denied');
    }
  };
  useEffect(() => {
    void checkPermissions();
    const recognitionConstructor = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!recognitionConstructor) setRecognitionSupported(false);
    return () => { stopStream(); window.speechSynthesis?.cancel(); recognitionRef.current?.stop(); };
  }, []);
  useEffect(() => {
    if (camera === 'granted' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [camera]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && startedRef.current) { stopStream(); recognitionRef.current?.stop(); setTerminated(true); setStarted(false); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const speak = () => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(questions[questionIndex]);
    utterance.rate = .95; utterance.onstart = () => setSpeaking(true); utterance.onend = () => setSpeaking(false); window.speechSynthesis.speak(utterance);
  };
  const begin = () => {
    if (camera !== 'granted' || microphone !== 'granted') return;
    setStarted(true); startedRef.current = true; window.setTimeout(speak, 250);
  };
  const toggleListening = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const recognitionConstructor = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!recognitionConstructor) { setRecognitionSupported(false); return; }
    const recognition = new recognitionConstructor(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
    recognition.onresult = (event) => { let transcript = ''; for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript; setAnswer(transcript); };
    recognition.onend = () => setListening(false); recognition.onerror = () => setListening(false); recognitionRef.current = recognition; recognition.start(); setListening(true);
  };
  const next = () => {
    if (!answer.trim()) return;
    const result = scoreAnswer(answer, questionIndex); result.question = questions[questionIndex];
    const nextAnswers = [...answers, result]; setAnswers(nextAnswers); setAnswer('');
    if (questionIndex < questions.length - 1) { setQuestionIndex((value) => value + 1); window.setTimeout(speak, 250); }
    else {
      const score = Math.round(nextAnswers.reduce((sum, item) => sum + (item.correctness + item.confidence + item.vocabulary + item.communication) / 4, 0) / nextAnswers.length);
      const report: Report = { candidate, results: nextAnswers, score, qualified: score >= 62 };
      localStorage.setItem(REPORT_KEY, JSON.stringify(report)); stopStream(); setLocation('/report');
      if (report.qualified) {
        const current = readStorage<ShortlistedEntry[]>(SHORTLIST_KEY, []);
        const entry: ShortlistedEntry = { candidate, score, qualifiedAt: new Date().toISOString(), report };
        const withoutDuplicate = current.filter((item) => item.candidate.email !== candidate.email);
        localStorage.setItem(SHORTLIST_KEY, JSON.stringify([entry, ...withoutDuplicate]));
      }
    }
  };
  if (terminated) return <Shell><main className="page"><div className="termination"><div className="termination-icon"><MonitorOff size={34} /></div><div className="eyebrow" style={{ justifyContent: 'center' }}><span className="eyebrow-line" /> session ended <span className="eyebrow-line" /></div><h1>This room is closed.</h1><p>InterVox detected that the interview tab lost focus. To keep every candidate's session consistent, this attempt cannot be resumed.</p><div className="panel"><strong>What happens next</strong><span className="muted" style={{ fontSize: '.82rem' }}>Your partial answers were not submitted as a report. You can restart the prototype and begin a fresh session.</span></div><div className="hero-actions" style={{ justifyContent: 'center' }}><Link href="/onboarding" className="button button-primary" data-testid="link-restart-terminated"><RotateCcw size={16} /> Start a new session</Link><Link href="/" className="button button-secondary" data-testid="link-terminated-home">Return home</Link></div></div></main></Shell>;
  return <Shell><main className="page"><div className="interview-layout">
    <div className="interview-top"><div><div className="eyebrow"><span className="eyebrow-line" /> live interview</div><h1>Take your time.</h1></div><div className="interview-top-meta"><span className="live-pill"><i /> in room</span><span>question {questionIndex + 1} of {questions.length}</span></div></div>
    <div className="progress-line"><span style={{ width: `${((questionIndex + (answer.trim() ? .35 : 0)) / questions.length) * 100}%` }} /></div>
    <div className="interview-grid">
       <div className="camera-panel">{camera === 'granted' ? <><video ref={videoRef} className="camera-video" autoPlay muted playsInline aria-label="Your live camera self-view" /><div className="self-view-label"><Camera size={13} /> self view</div></> : <div className="camera-placeholder"><div><Camera size={35} /><h3>{camera === 'checking' ? 'Checking your camera' : 'Camera and microphone required'}</h3><p>{camera === 'checking' ? 'Your browser will ask for both permissions.' : 'Both permissions are required to enter this interview. Use the retry button below after enabling them in your browser.'}</p></div></div>}<div className="camera-overlay"><div className="permission-tags"><span className={`permission-tag ${camera === 'granted' ? 'ok' : 'warn'}`}>{camera === 'granted' ? <Check size={12} /> : <Camera size={12} />} camera</span><span className={`permission-tag ${microphone === 'granted' ? 'ok' : 'warn'}`}>{microphone === 'granted' ? <Check size={12} /> : <Mic size={12} />} microphone</span></div><Wifi size={15} color="hsl(var(--primary-foreground) / .75)" /></div></div>
      <div className="panel question-panel">
        <div className="question-meta"><span className="question-num">question {String(questionIndex + 1).padStart(2, '0')}</span><span>open response</span></div>
        <div className="question-text" data-testid={`text-question-${questionIndex}`}>{questions[questionIndex]}</div>
        <button type="button" className="speak-button" onClick={speak} data-testid="button-read-question">{speaking ? <VolumeX size={15} /> : <Volume2 size={15} />} {speaking ? 'Reading aloud' : 'Read question aloud'}</button>
         {!started && <div className="permission-callout"><Info size={16} /><span>{camera === 'checking' || microphone === 'checking' ? 'Checking permissions before you enter the room.' : camera === 'granted' && microphone === 'granted' ? 'When you enter the room, your answer timer begins. Keep this tab visible for the duration of the interview.' : 'Camera and microphone access are required. Grant both permissions, then retry before entering.'}</span></div>}
        {started && !recognitionSupported && <div className="permission-callout"><Info size={16} /><span>Speech recognition is not available in this browser. Type your response below — the assessment still works fully.</span></div>}
         {!started ? <div className="interview-actions">{camera !== 'granted' || microphone !== 'granted' ? <button type="button" className="button button-secondary" onClick={() => void checkPermissions()} data-testid="button-retry-permissions"><RotateCcw size={16} /> Retry permissions</button> : <button type="button" className="button button-primary" onClick={begin} data-testid="button-start-session">Enter interview room <ChevronRight size={16} /></button>}</div> : <><div className="answer-label">Your answer</div><textarea className="answer-area" data-testid="textarea-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={recognitionSupported ? 'Speak using the microphone, or type here…' : 'Type your answer here…'} /><div className="answer-footer"><span className={`recognition-status ${listening ? 'listening' : ''}`}>{listening ? <><span className="signal-dot" /> listening — speak naturally</> : recognitionSupported ? 'Speech capture is optional' : 'Typed fallback active'}</span><button type="button" className={`mic-button ${listening ? 'listening' : ''}`} onClick={toggleListening} disabled={!recognitionSupported || microphone !== 'granted'} aria-label={listening ? 'Stop recording' : 'Start recording'} data-testid="button-toggle-microphone">{listening ? <MicOff size={18} /> : <Mic size={18} />}</button></div><div className="interview-actions"><button type="button" className="button button-primary" disabled={!answer.trim()} onClick={next} data-testid="button-next-question">{questionIndex === questions.length - 1 ? 'Finish interview' : 'Save and continue'} <ChevronRight size={16} /></button></div></>}
      </div>
    </div>
  </div></main></Shell>;
}

function Report() {
  const [, setLocation] = useLocation();
  const report = readStorage<Report | null>(REPORT_KEY, null);
  const restart = () => { localStorage.removeItem(REPORT_KEY); localStorage.removeItem(CANDIDATE_KEY); setLocation('/onboarding'); };
  if (!report) return <Shell><main className="page"><div className="empty-report"><div className="empty-icon"><FileText size={31} /></div><div className="eyebrow" style={{ justifyContent: 'center' }}><span className="eyebrow-line" /> no report yet <span className="eyebrow-line" /></div><h1>Your room is waiting.</h1><p>Complete an InterVox interview and your transparent screening summary will appear here.</p><Link href="/onboarding" className="button button-primary" data-testid="link-start-empty-report">Start an interview <ChevronRight size={16} /></Link></div></main></Shell>;
  const averages = ['correctness', 'confidence', 'vocabulary', 'communication'].map((metric) => Math.round(report.results.reduce((sum, result) => sum + Number(result[metric as 'correctness' | 'confidence' | 'vocabulary' | 'communication']), 0) / report.results.length));
  const labels = ['Correctness', 'Confidence', 'Vocabulary', 'Communication'];
  return <Shell><main className="page"><div className="report-header"><div><div className="eyebrow"><span className="eyebrow-line" /> your screening signal</div><h1>{report.candidate.fullName ? `${report.candidate.fullName.split(' ')[0]}'s report.` : 'Your report.'}</h1><p className="muted" style={{ marginBottom: 0 }}>Prepared for {report.candidate.pursuing || 'your opportunity'} · {report.candidate.company || 'candidate room'}</p></div><div className="score-card"><div className="score-label">qualification score</div><div className="score-number" data-testid="text-final-score">{report.score}</div><div className="score-decision">{report.qualified ? 'Qualified signal' : 'Not qualified signal'}</div></div></div>
    <div className="report-grid">
      <section className="panel breakdown-panel"><div><h3>A considered read.</h3><p className="muted" style={{ fontSize: '.82rem', margin: 0, lineHeight: 1.6 }}>Your score reflects the shape of these four answers — not a measure of your potential as a person.</p></div><div className="metric-list">{averages.map((value, index) => <div className="metric-row" key={labels[index]}><div className="metric-label"><span>{labels[index]}</span><strong>{value}</strong></div><div className="metric-bar"><span style={{ width: `${value}%` }} /></div></div>)}</div></section>
      <section className="panel"><h3>Answer by answer.</h3><div className="question-results">{report.results.map((result, index) => <div className="result-row" key={`${result.question}-${index}`}><span className="result-index">{String(index + 1).padStart(2, '0')}</span><div className="result-copy"><strong>{result.question}</strong><span>{result.answer || 'No transcript captured'}</span></div><span className="result-score">{Math.round((result.correctness + result.confidence + result.vocabulary + result.communication) / 4)} / 100</span></div>)}</div></section>
      <div className="disclaimer" data-testid="text-report-disclaimer"><strong>A note on fairness.</strong> InterVox is assistive screening, designed to help a hiring team decide what to look at next. This score is not a diagnosis, an authenticity guarantee, or an employment decision. Final hiring decisions remain with people.</div>
       <div className="report-actions"><button type="button" className="button button-secondary" onClick={restart} data-testid="button-restart-report"><RotateCcw size={16} /> Start another interview</button>{report.qualified && <Link href="/shortlisted" className="button button-primary" data-testid="link-view-shortlisted"><UserCheck size={16} /> View shortlisted</Link>}<Link href="/" className="button button-secondary" data-testid="link-report-home">Done</Link></div>
     </div>
    </main></Shell>;
}

function Shortlisted() {
  const [entries, setEntries] = useState<ShortlistedEntry[]>(() => readStorage(SHORTLIST_KEY, []));
  useEffect(() => {
    const refresh = () => setEntries(readStorage(SHORTLIST_KEY, []));
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  return <Shell><main className="page"><div className="shortlist-page">
    <div className="step-header"><div><div className="eyebrow"><span className="eyebrow-line" /> recruiter signal</div><h1>Shortlisted.</h1><p className="muted shortlist-intro">Candidates who crossed the qualification threshold appear here after completing all four answers.</p></div><div className="step-count"><UserCheck size={17} /> {entries.length} qualified</div></div>
    {entries.length === 0 ? <div className="panel shortlist-empty"><div className="empty-icon"><UserCheck size={27} /></div><h3>No candidates yet.</h3><p>Complete an interview with a qualifying score and the candidate will appear in this section.</p><Link href="/onboarding" className="button button-primary" data-testid="link-start-shortlist-empty">Start a candidate session <ChevronRight size={16} /></Link></div> : <div className="shortlist-grid">{entries.map((entry) => <article className="panel shortlist-card" key={`${entry.candidate.email}-${entry.qualifiedAt}`}><div className="shortlist-card-top"><div className="candidate-avatar">{entry.candidate.fullName.slice(0, 2).toUpperCase()}</div><div><h3>{entry.candidate.fullName}</h3><p>{entry.candidate.pursuing} · {entry.candidate.company}</p></div><div className="shortlist-score"><strong>{entry.score}</strong><span>score</span></div></div><div className="shortlist-meta"><span>{entry.candidate.field}</span><span>{entry.candidate.email}</span><span>qualified {new Date(entry.qualifiedAt).toLocaleDateString()}</span></div><Link href="/report" className="button button-secondary shortlist-report-link">View latest report <ChevronRight size={15} /></Link></article>)}</div>}
    </div></main></Shell>;
}

function Router() {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={Home} /><Route path="/onboarding" component={Onboarding} /><Route path="/interview" component={Interview} /><Route path="/report" component={Report} /><Route path="/shortlisted" component={Shortlisted} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function NotFound() {
  return <Shell><main className="page"><div className="empty-report"><div className="empty-icon"><XCircle size={31} /></div><h1>That room does not exist.</h1><p>The address may have changed. Return to the welcome room to begin again.</p><Link href="/" className="button button-primary" data-testid="link-not-found-home">Return home</Link></div></main></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;