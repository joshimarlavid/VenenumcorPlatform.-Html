import React, { useState, useRef, useEffect } from 'react';
import { AppView, ProcessingState, ImageSize, HistoryItem, Bookmark } from './types';
import { 
    extractTextFromDocument, 
    generateSpeech, 
    transcribeAudio, 
    analyzeImage, 
    generateImage 
} from './services/geminiService';
import { fileToBase64, blobToBase64 } from './services/utils';
import LiveSession from './components/LiveSession';
import { 
    BookOpen, 
    Mic, 
    Image as ImageIcon, 
    Cpu, 
    Radio, 
    Upload, 
    Play, 
    FileText, 
    Loader2, 
    CheckCircle,
    Download,
    History as HistoryIcon,
    Bookmark as BookmarkIcon,
    Trash2,
    Gauge,
    Pause,
    RotateCcw
} from 'lucide-react';

// Spanish/English Voice Options Mapping
const VOICE_OPTIONS = [
    { id: 'v1', name: 'Voice A (Fem)', desc: 'Clear & Professional', geminiVoiceName: 'Kore' },
    { id: 'v2', name: 'Voice B (Masc)', desc: 'Deep & Steady', geminiVoiceName: 'Fenrir' },
    { id: 'v3', name: 'Voice C (Fem)', desc: 'Soft & Storyteller', geminiVoiceName: 'Puck' },
];

export default function App() {
    const [currentView, setCurrentView] = useState<AppView>(AppView.READER);
    const [procState, setProcState] = useState<ProcessingState>({ isLoading: false, status: '' });
    
    // Reader State
    const [extractedText, setExtractedText] = useState<string>('');
    const [detectedLang, setDetectedLang] = useState<string>('');
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [currentDocId, setCurrentDocId] = useState<string | null>(null);
    const [playbackRate, setPlaybackRate] = useState<number>(1.0);
    
    // History & Persistence
    const [history, setHistory] = useState<HistoryItem[]>(() => {
        const saved = localStorage.getItem('omni_history');
        return saved ? JSON.parse(saved) : [];
    });

    // Refs
    const audioRef = useRef<HTMLAudioElement>(null);

    // Transcribe State
    const [transcription, setTranscription] = useState<string>('');
    
    // Analyze State
    const [analysisResult, setAnalysisResult] = useState<string>('');
    const [analyzedImgUrl, setAnalyzedImgUrl] = useState<string>('');

    // Generate State
    const [genPrompt, setGenPrompt] = useState('');
    const [genSize, setGenSize] = useState<ImageSize>(ImageSize.SIZE_1K);
    const [generatedImgBase64, setGeneratedImgBase64] = useState<string>('');

    // --- Effects ---
    
    // Save history whenever it changes
    useEffect(() => {
        localStorage.setItem('omni_history', JSON.stringify(history));
    }, [history]);

    // Apply playback rate when audio player exists or rate changes
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate, audioUrl]);

    // --- Helpers ---

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const updateHistoryItem = (id: string, updates: Partial<HistoryItem>) => {
        setHistory(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
    };

    const deleteHistoryItem = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setHistory(prev => prev.filter(item => item.id !== id));
        if (currentDocId === id) {
            setExtractedText('');
            setAudioUrl(null);
            setCurrentDocId(null);
        }
    };

    // --- Handlers ---

    // 1. Reader Handler
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setProcState({ isLoading: true, status: 'Reading document...' });
        setAudioUrl(null);
        setExtractedText('');
        setCurrentDocId(null);

        try {
            const base64 = await fileToBase64(file);
            const result = await extractTextFromDocument(base64, file.type);
            
            // Create History Item
            const newDocId = crypto.randomUUID();
            const newItem: HistoryItem = {
                id: newDocId,
                fileName: file.name,
                uploadDate: Date.now(),
                text: result.text,
                language: result.language,
                bookmarks: [],
                lastPosition: 0
            };

            setHistory(prev => [newItem, ...prev]);
            setCurrentDocId(newDocId);
            setExtractedText(result.text);
            setDetectedLang(result.language);
            setProcState({ isLoading: false, status: 'Ready to read' });
        } catch (err: any) {
            setProcState({ isLoading: false, status: '', error: err.message });
        }
    };

    const handleHistoryClick = (item: HistoryItem) => {
        setExtractedText(item.text);
        setDetectedLang(item.language);
        setCurrentDocId(item.id);
        setAudioUrl(null); // Reset audio as we need to regenerate/reload
        setProcState({ isLoading: false, status: 'Loaded from history' });
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleReadAloud = async (voiceId: string) => {
        if (!extractedText) return;
        const voice = VOICE_OPTIONS.find(v => v.id === voiceId);
        if (!voice) return;

        setProcState({ isLoading: true, status: `Generating audio with ${voice.name}...` });
        try {
            // We limit text length for demo purposes to avoid huge latency/costs, 
            // but in a real app we'd chunk it.
            const audioBase64 = await generateSpeech(extractedText.slice(0, 4000), voice.geminiVoiceName);
            const blob = await (await fetch(`data:audio/mp3;base64,${audioBase64}`)).blob();
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
            setProcState({ isLoading: false, status: 'Playing audio' });
            
            // Auto-resume logic will be handled by onCanPlay in the audio tag
        } catch (err: any) {
            setProcState({ isLoading: false, status: '', error: err.message });
        }
    };

    const handleAddBookmark = () => {
        if (!audioRef.current || !currentDocId) return;
        const currentTime = audioRef.current.currentTime;
        
        const newBookmark: Bookmark = {
            id: crypto.randomUUID(),
            time: currentTime,
            label: `Bookmark at ${formatTime(currentTime)}`
        };

        const currentItem = history.find(h => h.id === currentDocId);
        if (currentItem) {
            updateHistoryItem(currentDocId, { 
                bookmarks: [...currentItem.bookmarks, newBookmark].sort((a, b) => a.time - b.time) 
            });
        }
    };

    const handleJumpToBookmark = (time: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            audioRef.current.play();
        }
    };

    const handleAudioTimeUpdate = () => {
        if (!audioRef.current || !currentDocId) return;
        // Optimization: Don't update state on every tick, maybe just ref or check interval?
        // For simplicity in this demo, we won't persist every second to localStorage, 
        // but we will update the internal history object on Pause or Manual save.
    };

    const handleAudioPause = () => {
        if (!audioRef.current || !currentDocId) return;
        updateHistoryItem(currentDocId, { lastPosition: audioRef.current.currentTime });
    };

    const handleAudioLoaded = () => {
        if (!audioRef.current || !currentDocId) return;
        const item = history.find(h => h.id === currentDocId);
        if (item && item.lastPosition > 0) {
            // Check if user wants to resume? For now, we auto-seek if it's > 5 seconds in
            if (item.lastPosition > 5) {
                audioRef.current.currentTime = item.lastPosition;
            }
        }
    };

    // 2. Transcribe Handler
    const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        setProcState({ isLoading: true, status: 'Transcribing audio...' });
        try {
            const base64 = await fileToBase64(file);
            const text = await transcribeAudio(base64, file.type);
            setTranscription(text);
            setProcState({ isLoading: false, status: 'Done' });
        } catch (err: any) {
            setProcState({ isLoading: false, status: '', error: err.message });
        }
    };

    // 3. Analyze Image Handler
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setProcState({ isLoading: true, status: 'Analyzing image...' });
        const base64 = await fileToBase64(file);
        setAnalyzedImgUrl(`data:${file.type};base64,${base64}`);

        try {
            const text = await analyzeImage(base64, file.type, "Describe this image in detail.");
            setAnalysisResult(text);
            setProcState({ isLoading: false, status: 'Done' });
        } catch (err: any) {
            setProcState({ isLoading: false, status: '', error: err.message });
        }
    };

    // 4. Generate Image Handler
    const handleGenerateImage = async () => {
        if (!genPrompt) return;
        setProcState({ isLoading: true, status: 'Dreaming up pixels...' });
        try {
            const base64 = await generateImage(genPrompt, genSize);
            setGeneratedImgBase64(base64);
            setProcState({ isLoading: false, status: 'Done' });
        } catch (err: any) {
            setProcState({ isLoading: false, status: '', error: err.message });
        }
    };

    // --- Render Helpers ---

    const renderNav = () => (
        <nav className="flex flex-wrap justify-center gap-2 mb-8 bg-slate-800 p-2 rounded-2xl border border-slate-700 w-fit mx-auto sticky top-4 z-50 backdrop-blur-md bg-opacity-90 shadow-xl">
            <NavBtn icon={<BookOpen size={18} />} label="Reader" active={currentView === AppView.READER} onClick={() => setCurrentView(AppView.READER)} />
            <NavBtn icon={<Mic size={18} />} label="Transcribe" active={currentView === AppView.TRANSCRIBE} onClick={() => setCurrentView(AppView.TRANSCRIBE)} />
            <NavBtn icon={<Cpu size={18} />} label="Analyze" active={currentView === AppView.ANALYZE} onClick={() => setCurrentView(AppView.ANALYZE)} />
            <NavBtn icon={<ImageIcon size={18} />} label="Imagine" active={currentView === AppView.GENERATE} onClick={() => setCurrentView(AppView.GENERATE)} />
            <NavBtn icon={<Radio size={18} />} label="Live" active={currentView === AppView.LIVE} onClick={() => setCurrentView(AppView.LIVE)} />
        </nav>
    );

    const renderReader = () => {
        const currentItem = history.find(h => h.id === currentDocId);

        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fadeIn">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Upload Section */}
                    <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 text-center space-y-4">
                        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto text-blue-400">
                            <Upload size={32} />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold mb-2">Upload Document</h2>
                            <p className="text-slate-400 text-sm">Supports PDF, HTML, TXT (Images also work)</p>
                        </div>
                        <input 
                            type="file" 
                            onChange={handleFileUpload}
                            className="block w-full text-sm text-slate-400
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-full file:border-0
                            file:text-sm file:font-semibold
                            file:bg-blue-600 file:text-white
                            file:cursor-pointer hover:file:bg-blue-700
                            cursor-pointer"
                        />
                    </div>

                    {procState.isLoading && (
                        <div className="flex items-center justify-center gap-3 text-blue-400 p-4 bg-blue-500/10 rounded-xl">
                            <Loader2 className="animate-spin" />
                            <span>{procState.status}</span>
                        </div>
                    )}

                    {extractedText && (
                        <div className="space-y-6">
                            {/* Text Preview */}
                            <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                                <div className="flex justify-between items-center mb-4">
                                     <h3 className="font-bold text-slate-300">
                                         {currentItem?.fileName || "Document Preview"}
                                     </h3>
                                     <span className="text-xs bg-slate-700 px-3 py-1 rounded-full text-blue-300 font-mono">
                                        {detectedLang === 'es' ? '🇪🇸 Spanish' : detectedLang === 'en' ? '🇺🇸 English' : detectedLang}
                                     </span>
                                </div>
                                <div className="max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    <p className="text-slate-300 text-sm whitespace-pre-wrap font-serif leading-relaxed">
                                        {extractedText}
                                    </p>
                                </div>
                            </div>

                            {/* Voice Selection */}
                            <div>
                                <h4 className="text-sm font-semibold text-slate-500 uppercase mb-3">Select Voice</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {VOICE_OPTIONS.map(voice => (
                                        <button
                                            key={voice.id}
                                            onClick={() => handleReadAloud(voice.id)}
                                            disabled={procState.isLoading}
                                            className="group relative bg-slate-800 p-4 rounded-xl border border-slate-700 hover:border-blue-500 hover:bg-slate-750 transition-all text-left"
                                        >
                                            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-blue-400 transition-opacity">
                                                <Play size={20} fill="currentColor" />
                                            </div>
                                            <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">{voice.name}</h3>
                                            <p className="text-xs text-slate-400">{voice.desc}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Audio Player & Controls */}
                            {audioUrl && (
                                <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-2xl border border-blue-500/30 shadow-lg space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-blue-400 font-semibold flex items-center gap-2">
                                            <Radio size={18} /> Now Playing
                                        </h4>
                                        {currentItem?.lastPosition ? (
                                             <span className="text-xs text-slate-500">
                                                 Resumed from {formatTime(currentItem.lastPosition)}
                                             </span>
                                        ) : null}
                                    </div>
                                    
                                    <audio 
                                        ref={audioRef}
                                        controls 
                                        autoPlay 
                                        src={audioUrl} 
                                        className="w-full accent-blue-500"
                                        onPause={handleAudioPause}
                                        onCanPlay={handleAudioLoaded}
                                    />
                                    
                                    {/* Speed & Bookmarks Controls */}
                                    <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                                        <div className="flex items-center gap-3 bg-slate-950/50 p-2 rounded-lg">
                                            <Gauge size={16} className="text-slate-400" />
                                            <span className="text-xs font-mono text-slate-300 w-8">{playbackRate}x</span>
                                            <input 
                                                type="range" 
                                                min="0.5" 
                                                max="2.0" 
                                                step="0.1" 
                                                value={playbackRate}
                                                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                                                className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                            />
                                        </div>

                                        <button 
                                            onClick={handleAddBookmark}
                                            className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-sm transition-colors"
                                        >
                                            <BookmarkIcon size={16} />
                                            Add Bookmark
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Bookmarks List */}
                            {currentItem && currentItem.bookmarks.length > 0 && (
                                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                                    <h4 className="text-sm font-semibold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <BookmarkIcon size={14} /> Bookmarks
                                    </h4>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {currentItem.bookmarks.map(bm => (
                                            <button
                                                key={bm.id}
                                                onClick={() => handleJumpToBookmark(bm.time)}
                                                className="flex items-center justify-between p-3 bg-slate-700/50 hover:bg-slate-700 rounded-lg text-left transition-colors group"
                                            >
                                                <span className="text-sm text-slate-300">{formatTime(bm.time)}</span>
                                                <Play size={12} className="opacity-0 group-hover:opacity-100 text-blue-400" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Sidebar: History */}
                <div className="space-y-4">
                    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden flex flex-col h-[600px]">
                        <div className="p-4 border-b border-slate-700 bg-slate-800/50 backdrop-blur sticky top-0">
                            <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                                <HistoryIcon size={18} /> Library History
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                            {history.length === 0 ? (
                                <div className="text-center py-10 text-slate-500 text-sm">
                                    No documents yet.
                                </div>
                            ) : (
                                history.map(item => (
                                    <div 
                                        key={item.id}
                                        onClick={() => handleHistoryClick(item)}
                                        className={`p-3 rounded-xl cursor-pointer transition-all border ${currentDocId === item.id ? 'bg-blue-600/10 border-blue-500/50' : 'bg-slate-700/30 border-transparent hover:bg-slate-700/50 hover:border-slate-600'}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <h4 className={`text-sm font-medium line-clamp-1 ${currentDocId === item.id ? 'text-blue-300' : 'text-slate-300'}`}>
                                                {item.fileName}
                                            </h4>
                                            <button 
                                                onClick={(e) => deleteHistoryItem(e, item.id)}
                                                className="text-slate-500 hover:text-red-400 p-1"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                        <div className="flex justify-between items-center text-xs text-slate-500">
                                            <span>{new Date(item.uploadDate).toLocaleDateString()}</span>
                                            {item.lastPosition > 0 && (
                                                <span className="flex items-center gap-1 text-blue-400/80">
                                                    <RotateCcw size={10} /> {formatTime(item.lastPosition)}
                                                </span>
                                            )}
                                        </div>
                                        {item.bookmarks.length > 0 && (
                                            <div className="mt-2 pt-2 border-t border-slate-700/50 flex gap-1 flex-wrap">
                                                {item.bookmarks.slice(0, 3).map(bm => (
                                                    <span key={bm.id} className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-400">
                                                        {formatTime(bm.time)}
                                                    </span>
                                                ))}
                                                {item.bookmarks.length > 3 && <span className="text-[10px] text-slate-500">+{item.bookmarks.length - 3}</span>}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderTranscribe = () => (
        <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
            <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 text-center space-y-4">
                <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mx-auto text-purple-400">
                    <Mic size={32} />
                </div>
                <h2 className="text-xl font-semibold">Audio Transcription</h2>
                <input 
                    type="file" 
                    accept="audio/*"
                    onChange={handleAudioUpload}
                    className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white file:cursor-pointer hover:file:bg-purple-700"
                />
            </div>

            {procState.isLoading && (
                <div className="text-center text-purple-400 flex justify-center gap-2">
                    <Loader2 className="animate-spin" /> {procState.status}
                </div>
            )}

            {transcription && (
                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                    <h3 className="text-sm font-bold text-slate-500 uppercase mb-3">Transcript</h3>
                    <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{transcription}</p>
                </div>
            )}
        </div>
    );

    const renderAnalyze = () => (
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 animate-fadeIn">
            <div className="space-y-6">
                <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 text-center space-y-4 h-full flex flex-col justify-center">
                    <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto text-green-400">
                        <Cpu size={32} />
                    </div>
                    <h2 className="text-xl font-semibold">Image Analysis</h2>
                    <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white file:cursor-pointer hover:file:bg-green-700"
                    />
                </div>
            </div>
            
            <div className="space-y-4">
                {analyzedImgUrl && (
                    <img src={analyzedImgUrl} alt="Analyzed" className="w-full h-48 object-cover rounded-xl border border-slate-700" />
                )}
                
                {procState.isLoading && (
                    <div className="text-green-400 flex gap-2 items-center"><Loader2 className="animate-spin"/> Analyzing...</div>
                )}
                
                {analysisResult && (
                    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 h-fit">
                        <h3 className="text-sm font-bold text-slate-500 uppercase mb-3">Gemini Analysis</h3>
                        <p className="text-slate-200 text-sm leading-relaxed">{analysisResult}</p>
                    </div>
                )}
            </div>
        </div>
    );

    const renderGenerate = () => (
        <div className="max-w-3xl mx-auto space-y-8 animate-fadeIn">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    <label className="block text-sm font-medium text-slate-400">Prompt</label>
                    <textarea 
                        value={genPrompt}
                        onChange={(e) => setGenPrompt(e.target.value)}
                        placeholder="A futuristic city made of crystal, golden hour lighting..."
                        className="w-full h-32 bg-slate-800 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none resize-none"
                    />
                </div>
                <div className="space-y-4">
                    <label className="block text-sm font-medium text-slate-400">Size</label>
                    <div className="space-y-2">
                        {[ImageSize.SIZE_1K, ImageSize.SIZE_2K, ImageSize.SIZE_4K].map(size => (
                            <button
                                key={size}
                                onClick={() => setGenSize(size)}
                                className={`w-full py-3 rounded-lg text-sm font-semibold transition-all border ${genSize === size ? 'bg-pink-600 border-pink-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750'}`}
                            >
                                {size}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <button 
                onClick={handleGenerateImage}
                disabled={!genPrompt || procState.isLoading}
                className="w-full py-4 bg-gradient-to-r from-pink-600 to-rose-600 rounded-xl font-bold text-white shadow-lg hover:shadow-pink-500/20 disabled:opacity-50 transition-all flex justify-center items-center gap-2"
            >
                {procState.isLoading ? <Loader2 className="animate-spin" /> : <ImageIcon size={20} />}
                Generate Image
            </button>

            {generatedImgBase64 && (
                <div className="relative group">
                    <img 
                        src={`data:image/jpeg;base64,${generatedImgBase64}`} 
                        alt="Generated" 
                        className="w-full rounded-2xl shadow-2xl border border-slate-700" 
                    />
                    <a 
                        href={`data:image/jpeg;base64,${generatedImgBase64}`} 
                        download="gemini-creation.jpg"
                        className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white p-2 rounded-lg backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                    >
                        <Download size={20} />
                    </a>
                </div>
            )}
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-900 text-slate-50 selection:bg-blue-500/30 flex flex-col">
            <div className="flex-grow p-6">
                <header className="text-center mb-10 pt-4">
                    <div className="inline-block px-3 py-1 mb-3 text-[10px] font-bold tracking-[0.2em] text-blue-400 border border-blue-500/20 rounded-full uppercase bg-blue-500/5">
                        Developed by Venenum Cor
                    </div>
                    <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                        Gemini OmniReader
                    </h1>
                    <p className="text-slate-400">Read, Listen, Create, and Converse.</p>
                </header>

                {renderNav()}

                <main className="container mx-auto pb-12">
                    {procState.error && (
                        <div className="max-w-md mx-auto mb-6 bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl text-center text-sm">
                            {procState.error}
                        </div>
                    )}

                    {currentView === AppView.READER && renderReader()}
                    {currentView === AppView.TRANSCRIBE && renderTranscribe()}
                    {currentView === AppView.ANALYZE && renderAnalyze()}
                    {currentView === AppView.GENERATE && renderGenerate()}
                    {currentView === AppView.LIVE && (
                        <div className="h-[600px]">
                            <LiveSession />
                        </div>
                    )}
                </main>
            </div>

            <footer className="w-full py-8 text-center bg-slate-950 border-t border-slate-800">
                 <p className="text-xs text-slate-500 font-mono uppercase tracking-widest px-4">
                    Because reading a book loud shouldn't be something you had to pay for.
                </p>
            </footer>
        </div>
    );
}

// Simple Nav Button Component
const NavBtn = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${active ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
    >
        {icon}
        <span>{label}</span>
    </button>
);
