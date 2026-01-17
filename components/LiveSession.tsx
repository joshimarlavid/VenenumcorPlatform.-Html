import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, XCircle, Loader2, Volume2 } from 'lucide-react';
import { getLiveClient } from '../services/geminiService';
import { Modality, LiveServerMessage } from '@google/genai';
import { base64ToUint8Array, arrayBufferToBase64 } from '../services/utils';

// Helper for PCM Blob creation
function createPcmBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    const uint8 = new Uint8Array(int16.buffer);
    const binary = String.fromCharCode.apply(null, Array.from(uint8));
    const base64 = btoa(binary);
    
    // We construct a specific blob that the API expects or we handle base64 manually
    // But the Live API example shows sending a Blob with specific mimetype
    // Actually, in the official examples, we send the blob directly via the SDK which handles it.
    // However, the prompt's provided snippet `createBlob` returns { data: base64, mimeType }
    
    return {
        // @ts-ignore - The SDK types might expect a real Blob but the example returns this object structure
        data: base64, 
        mimeType: 'audio/pcm;rate=16000'
    } as any;
}

const LiveSession: React.FC = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [status, setStatus] = useState<string>('Ready to connect');
    const [logs, setLogs] = useState<string[]>([]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const inputContextRef = useRef<AudioContext | null>(null);
    const sessionRef = useRef<any>(null); // To store the session object
    const sessionPromiseRef = useRef<Promise<any> | null>(null);

    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    const addLog = (msg: string) => setLogs(prev => [msg, ...prev].slice(0, 5));

    const startSession = async () => {
        try {
            setStatus('Connecting...');
            const ai = getLiveClient();
            
            // Setup Output Audio
            const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            audioContextRef.current = outputCtx;
            const outputNode = outputCtx.createGain();
            outputNode.connect(outputCtx.destination);

            // Setup Input Audio
            const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            inputContextRef.current = inputCtx;
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
                if (isMuted) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = createPcmBlob(inputData);
                
                if (sessionPromiseRef.current) {
                    sessionPromiseRef.current.then(session => {
                        session.sendRealtimeInput({ media: pcmData });
                    });
                }
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                callbacks: {
                    onopen: () => {
                        setIsConnected(true);
                        setStatus('Connected (Gemini 2.5)');
                        addLog('Session opened');
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // Handle Audio Output
                        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (base64Audio) {
                            const bytes = base64ToUint8Array(base64Audio);
                            
                            // Decode
                            const dataInt16 = new Int16Array(bytes.buffer);
                            const buffer = outputCtx.createBuffer(1, dataInt16.length, 24000);
                            const channelData = buffer.getChannelData(0);
                            for (let i = 0; i < dataInt16.length; i++) {
                                channelData[i] = dataInt16[i] / 32768.0;
                            }

                            const src = outputCtx.createBufferSource();
                            src.buffer = buffer;
                            src.connect(outputNode);
                            
                            // Scheduling
                            const currentTime = outputCtx.currentTime;
                            if (nextStartTimeRef.current < currentTime) {
                                nextStartTimeRef.current = currentTime;
                            }
                            src.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += buffer.duration;
                            
                            sourcesRef.current.add(src);
                            src.onended = () => sourcesRef.current.delete(src);
                        }

                        // Handle Interruption
                        if (message.serverContent?.interrupted) {
                            addLog('Interrupted');
                            sourcesRef.current.forEach(s => s.stop());
                            sourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                        }
                    },
                    onclose: () => {
                        setIsConnected(false);
                        setStatus('Disconnected');
                    },
                    onerror: (err) => {
                        console.error(err);
                        setStatus('Error occurred');
                        addLog('Error in session');
                    }
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
                    },
                    systemInstruction: "You are a helpful, witty, and Spanish/English bilingual assistant.",
                }
            });

            sessionPromiseRef.current = sessionPromise;

        } catch (e: any) {
            console.error(e);
            setStatus(`Connection Failed: ${e.message}`);
        }
    };

    const stopSession = () => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(s => s.close()); // Close session
        }
        
        // Clean up audio contexts
        if (audioContextRef.current) audioContextRef.current.close();
        if (inputContextRef.current) inputContextRef.current.close();
        
        setIsConnected(false);
        setStatus('Ready to connect');
        sessionRef.current = null;
        sessionPromiseRef.current = null;
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopSession();
        };
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full space-y-8 p-6 bg-slate-800 rounded-xl border border-slate-700">
            <div className="text-center space-y-2">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto transition-all duration-500 ${isConnected ? 'bg-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)] animate-pulse' : 'bg-slate-700'}`}>
                    <Volume2 size={40} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white">Live Conversation</h2>
                <p className="text-slate-400">{status}</p>
            </div>

            <div className="flex gap-4">
                {!isConnected ? (
                    <button 
                        onClick={startSession}
                        className="flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-full font-bold shadow-lg transition-transform hover:scale-105"
                    >
                        <Mic size={20} />
                        Start Conversation
                    </button>
                ) : (
                    <>
                        <button 
                            onClick={() => setIsMuted(!isMuted)}
                            className={`p-4 rounded-full transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-white hover:bg-slate-600'}`}
                        >
                            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                        </button>
                        <button 
                            onClick={stopSession}
                            className="flex items-center gap-2 px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-full font-bold shadow-lg"
                        >
                            <XCircle size={20} />
                            End Call
                        </button>
                    </>
                )}
            </div>

            <div className="w-full max-w-md mt-6">
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">Session Logs</h3>
                <div className="bg-slate-900/50 rounded-lg p-3 font-mono text-xs text-slate-400 min-h-[100px]">
                    {logs.map((log, i) => (
                        <div key={i} className="mb-1 border-b border-slate-800/50 pb-1 last:border-0">{log}</div>
                    ))}
                    {logs.length === 0 && <span className="opacity-50">Waiting for events...</span>}
                </div>
            </div>
            
            {/* Hidden canvas for video processing if we added video later */}
            <canvas ref={canvasRef} className="hidden" />
        </div>
    );
};

export default LiveSession;
