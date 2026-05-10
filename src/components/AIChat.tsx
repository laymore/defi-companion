import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Mic, Send, Bot, Loader2, Cloud } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { addMemWalMemory, getMemWalHistory } from '../lib/memwal';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Message {
  id: string | number;
  text: string;
  sender: 'ai' | 'user';
  createdAt: number;
}

import { NetworkType, suiToMist, mistToSui } from '../lib/sui';
import { AgentSoul, recoverSoulAtLaunch } from '../lib/agent-soul';

export type BrainMode = 'cloud';

export function AIChat({ userId, suiAddress, agentAddress, onProposeTx, network }: { 
  userId: string, 
  suiAddress: string, 
  agentAddress: string,
  onProposeTx: (tx: any) => void,
  brainMode?: BrainMode,
  network: NetworkType
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSoul, setCurrentSoul] = useState<AgentSoul | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Sync Soul from Walrus
    recoverSoulAtLaunch(userId).then(soul => {
      if (soul) setCurrentSoul(soul);
    });

    const defaultSoul: AgentSoul = {
      name: "SuiRobo",
      personality: "Chuyên nghiệp, phân tích dữ liệu chính xác và hỗ trợ tận tâm.",
      skills: ["Quản lý tài sản", "Giao dịch Sui", "Phân tích On-chain"],
      motto: "Decentralized intelligence for the Sui ecosystem.",
      version: 1,
      lastUpdated: Date.now()
    };

    const activeSoul = currentSoul || defaultSoul;

    let unsubscribeFirestore = () => {};

    const q = query(
      collection(db, 'users', userId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    
    unsubscribeFirestore = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach(doc => {
         msgs.push({ id: doc.id, ...doc.data() } as Message);
      });
      setMessages(msgs);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (error) => {
      console.error("Firestore sync error:", error);
    });

    // Setup speech
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'vi-VN';
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        handleSend(transcript);
        setIsRecording(false);
      };
      recognitionRef.current.onerror = () => setIsRecording(false);
      recognitionRef.current.onend = () => setIsRecording(false);
    }

    return () => unsubscribeFirestore();
  }, [userId]);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      if (recognitionRef.current) {
        recognitionRef.current.start();
        setIsRecording(true);
      } else {
        alert("Trình duyệt của bạn không hỗ trợ nhận dạng giọng nói.");
      }
    }
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;
    const currentInput = text;
    setInput('');
    setIsLoading(true);

    const now = Date.now();
    
    // 1. Save User Message to Firestore (for UI) AND MemWal (for long-term memory)
    const path = `users/${userId}/messages`;
    try {
      await Promise.all([
        addDoc(collection(db, 'users', userId, 'messages'), {
          text: currentInput,
          sender: 'user',
          createdAt: now
        }),
        addMemWalMemory(currentInput, suiAddress || userId)
      ]);
    } catch(e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }

    // 2. Retrieve history from MemWal for context
    const history = await getMemWalHistory(suiAddress || userId);
    const historyContext = history.length > 0 
      ? history.slice(-5).map(m => `- ${m.text}`).join('\n')
      : "Không có lịch sử trước đó.";

    const activeSoul: AgentSoul = currentSoul || {
      name: "DeepTrade-Master",
      personality: "Chuyên gia DeepTrade, phân tích cực kỳ logic, nhạy bén với cơ hội lợi nhuận (yield), ưu tiên quản trị rủi ro và tối ưu hóa giao dịch.",
      skills: ["DeepTrade Analysis", "DeepTrade Liquidity", "DeepTrade Arbitrage", "Sui Yield Farming"],
      motto: "Làm chủ DeepTrade, tối đa hóa lợi nhuận trên mạng Sui.",
      version: 1,
      lastUpdated: Date.now()
    };

    const systemInstruction = `
        BẠN LÀ: "${activeSoul.name}" - CHUYÊN GIA TỐI ƯU HÓA DEEPTRADE TRÊN SUI.
        THỜI GIAN HIỆN TẠI: ${new Date().toLocaleString('vi-VN')}
        
        CHIẾN LƯỢC DEEPTRADE & DEFI:
        - Bạn là bậc thầy về DeepTrade và DeepBook V3: Am hiểu DeepBook V3 SDK (BalanceManager, Custody, Pools), DeepTrade Liquidity, DeepTrade Execution.
        - Hệ sinh thái của bạn CHỈ tập trung vào 3 loại tài sản: SUI, WAL, và DEEP (DEEPTRADE). Hãy ưu tiên các cặp giao dịch liên quan đến 3 token này trên DeepBook V3.
        - Nhiệm vụ: Giúp người dùng thực hiện các lệnh DeepBook V3 thông minh (Place Limit/Market Orders thông qua BalanceManager), phân tích thanh khoản, và tối ưu lợi nhuận.
        - TÍNH CÁCH: ${activeSoul.personality}
        - KỸ NĂNG: ${activeSoul.skills.join(', ')}
        
        ĐIỀU KHOẢN CỐT LÕI (CORE DIRECTIVES):
        1. PHẠM VI TÀI SẢN: Chỉ hỗ trợ SUI, WAL, DEEP/DEEPTRADE. Nếu người dùng hỏi về token khác, hãy thông báo bạn là chuyên gia chuyên biệt cho bộ 3 này và đề xuất sử dụng chúng.
        2. BẢO MẬT & RỦI RO: Cảnh báo nếu tương tác với pool rủi ro.
        3. TỐI ƯU HÓA DEEPBOOK: Sử dụng DeepBook V3 để có giá tốt nhất và trượt giá thấp nhất.
        
        NĂNG LỰC TRUY VẤN:
        - Bạn PHẢI sử dụng Google Search để cập nhật tình hình DeepTrade hiện tại: TVL, Volume giao dịch, các cặp tiền mới nhất và các chương trình Incentive của DeepTrade.
        
        THÔNG TIN MẠNG:
        - NETWORK: ${network.toUpperCase()}
        - VÍ NGƯỜI DÙNG: ${suiAddress}
        - VÍ TRỢ LÝ (Autonomous): ${agentAddress}
        
        BỘ NHỚ DÀI HẠN (MemWal History):
        ${historyContext}
        
        QUY TẮC HOẠT ĐỘNG:
        1. CHUYỂN ĐỔI ĐƠN VỊ: 1 SUI = 1,000,000,000 MIST.
        2. HÀNH ĐỘNG TỰ QUYẾT: <agent_action>{"type": "transfer/swap", ...}</agent_action>. Ưu tiên dùng ví Agent để thực thi lệnh DeepTrade nhanh chóng.
        3. HÀNH ĐỘNG ĐỀ XUẤT: Giao dịch từ ví NGƯỜI DÙNG PHẢI qua phê duyệt (Proposal).
        4. GIÁ CẢ & DEEPTRADE INSIGHTS: PHẢI sử dụng Google Search. Trích dẫn nguồn. 
        5. PHONG CÁCH: Chuyên nghiệp, nhạy bén, sử dụng ngôn ngữ giao dịch DeepTrade chuyên sâu.
      `;

    try {
      const response = await ai.models.generateContent({ 
        model: "gemini-3.1-pro-preview",
        contents: [{ role: 'user', parts: [{ text: currentInput }] }],
        config: {
          systemInstruction: systemInstruction,
          tools: [
            {
              googleSearch: {},
            },
          ],
        }
      } as any);

      let aiResponse = response.text || "Tôi không thể xử lý yêu cầu lúc này.";
      
      // Check for proposals (User Wallet)
      const txMatch = aiResponse.match(/<tx_proposal>(.*?)<\/tx_proposal>/s);
      if (txMatch && txMatch[1]) {
        try {
          const txDetails = JSON.parse(txMatch[1].trim());
          txDetails.type = 'transfer';
          onProposeTx(txDetails);
          aiResponse = aiResponse.replace(/<tx_proposal>.*?<\/tx_proposal>/s, '').trim();
        } catch(e) {}
      }
      // Check for Agent Actions (Autonomous Wallet)
      const agentMatch = aiResponse.match(/<agent_action>(.*?)<\/agent_action>/s);
      if (agentMatch?.[1]) {
        try {
          const actionDetails = JSON.parse(agentMatch[1].trim());
          const resp = await fetch('/api/agent/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(actionDetails)
          });
          const resBody = await resp.json();
          if (resBody.success) {
            aiResponse += `\n\n[Agent Wallet Action Success! Digest: ${resBody.digest.slice(0, 10)}...]`;
          } else {
            aiResponse += `\n\n[Agent Wallet Error: ${resBody.error}]`;
          }
           aiResponse = aiResponse.replace(/<agent_action>.*?<\/agent_action>/s, '').trim();
        } catch(e) {}
      }

      const swapMatch = aiResponse.match(/<swap_proposal>(.*?)<\/swap_proposal>/s);

      if (swapMatch && swapMatch[1]) {
        try {
          const swapDetails = JSON.parse(swapMatch[1].trim());
          swapDetails.type = 'swap';
          onProposeTx(swapDetails);
          aiResponse = aiResponse.replace(/<swap_proposal>.*?<\/swap_proposal>/s, '').trim();
        } catch(e) {}
      }

      const aiNow = Date.now();
      // 2. Save Bot Message to Firestore AND MemWal
      try {
        await Promise.all([
          addDoc(collection(db, 'users', userId, 'messages'), {
            text: aiResponse,
            sender: 'ai',
            createdAt: aiNow
          }),
          addMemWalMemory(aiResponse, suiAddress || userId)
        ]);
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, path);
      }
      
    } catch (e: any) {
      console.error(e);
      // Fallback for user error
      try {
        await addDoc(collection(db, 'users', userId, 'messages'), {
          text: "Rất tiếc, mình đang gặp chút trục trặc khi suy nghĩ. Có vẻ do lỗi kết nối AI hoặc quota. Hãy thử lại sau nhé!",
          sender: 'ai',
          createdAt: Date.now()
        });
      } catch(inner) {}
    } finally {
      setIsLoading(false);
    }
  };

  const speakText = (text: string) => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    speechSynthesis.speak(utterance);
  };

  return (
    <div className="flex flex-col h-[500px] bg-[#151619] border border-gray-800 rounded-2xl overflow-hidden shadow-2xl relative">
      <div className="bg-[#0f0f11] p-4 flex justify-between items-center border-b border-gray-800">
        <div className="flex items-center gap-2">
           <Bot className="text-cyan-400 w-5 h-5" />
           <div className="flex flex-col">
              <span className="text-sm font-medium tracking-wide uppercase text-gray-300">{currentSoul?.name || "SuiRobo Assistant"}</span>
              <span className="text-[9px] text-gray-500 italic truncate max-w-[150px]">{currentSoul?.motto || "AI Trợ lý của bạn"}</span>
           </div>
           <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-[10px] text-blue-400 font-bold uppercase tracking-tighter flex items-center gap-1">
             <Cloud className="w-2.5 h-2.5" />
             AI Cloud & MemWal
           </span>
        </div>
        <div className="flex gap-2">
           <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#08080a]">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.sender === 'ai' && (
              <div className="w-8 h-8 rounded-full bg-cyan-900/30 flex items-center justify-center border border-cyan-800">
                <Bot className="w-4 h-4 text-cyan-400" />
              </div>
            )}
            <div className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed ${
              msg.sender === 'user' 
                ? 'bg-[#2A2B32] text-gray-200 rounded-br-none' 
                : 'bg-transparent border border-gray-800 text-gray-300 rounded-bl-none shadow-[inset_0_0_20px_rgba(34,211,238,0.02)]'
            }`}>
              {msg.text}
              {msg.sender === 'ai' && (
                <button onClick={() => speakText(msg.text)} className="ml-2 text-gray-500 hover:text-cyan-400 transition-colors inline-block align-middle">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                </button>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 justify-start">
             <div className="w-8 h-8 rounded-full bg-cyan-900/30 flex items-center justify-center border border-cyan-800">
                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
             </div>
             <div className="p-3 bg-transparent border border-gray-800 text-gray-500 rounded-2xl rounded-bl-none text-sm">
               Processing...
             </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-3 bg-black/40 border-t border-gray-800 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={toggleRecording}
            className={`p-3 rounded-full shrink-0 transition-all ${isRecording ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-[#2A2B32] text-gray-400 hover:text-white'}`}
          >
            <Mic className="w-5 h-5" />
          </button>
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
            disabled={isLoading}
            placeholder="Ra lệnh cho trợ lý ảo..."
            className="flex-1 min-w-0 bg-[#2A2B32] border border-gray-700 text-white rounded-full px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors placeholder:text-gray-500 disabled:opacity-50"
          />
          <button 
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="p-3 rounded-full shrink-0 bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
