import { useState, useEffect } from 'react';
import { AgentSoul, saveSoulToWalrus, recoverSoulAtLaunch, verifyServices } from '../lib/agent-soul';
import { Sparkles, Brain, ShieldCheck, Database, Save, Loader2, UserRound, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const PREDEFINED_SKILLS = [
  'DeepTrade Analysis',
  'DeepTrade Liquidity',
  'DeepTrade Arbitrage',
  'Yield Farming',
  'Liquidity Provision',
  'Staking',
  'Token Swapping',
  'Lending & Borrowing',
  'Risk Management',
  'On-chain Analysis'
];

export function SoulManager({ userId, onUpdate }: { userId: string, onUpdate?: (soul: AgentSoul) => void }) {
  const [soul, setSoul] = useState<AgentSoul | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [servicesStatus, setServicesStatus] = useState({ walrus: false, memwal: false });

  const [formData, setFormData] = useState({
    name: 'SuiDefi-DeepBot',
    personality: 'Phân tích cực kỳ logic, chuyên gia về DeepTrade, nhạy bén với cơ hội lợi nhuận (yield), ưu tiên quản trị rủi ro.',
    skills: ['DeepTrade Analysis', 'DeepTrade Liquidity', 'DeepTrade Arbitrage'],
    motto: 'Tối ưu hóa giao dịch DeepTrade trên mạng Sui.'
  });

  useEffect(() => {
    async function init() {
      // 1. Verify Connectivity
      const status = await verifyServices();
      setServicesStatus(status);

      // 2. Load Soul with Decentralized Recovery (Sovereign Identity)
      // Pass userId
      const saved = await recoverSoulAtLaunch(userId); 
      if (saved) {
        setSoul(saved);
        setFormData({
          name: saved.name,
          personality: saved.personality,
          skills: saved.skills,
          motto: saved.motto
        });
        if (onUpdate) onUpdate(saved);
      }
      setIsLoading(false);
    }
    init();
  }, [userId]);

  const toggleSkill = (skill: string) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skill) 
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill]
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const newSoul: AgentSoul = {
        name: formData.name,
        personality: formData.personality,
        skills: formData.skills,
        motto: formData.motto,
        version: (soul?.version || 0) + 1,
        lastUpdated: Date.now()
      };

      const blobId = await saveSoulToWalrus(newSoul, userId);
      setSoul(newSoul);
      setIsEditing(false);
      if (onUpdate) onUpdate(newSoul);
      alert(`Linh hồn Agent đã được đồng bộ lên Walrus! (ID: ${blobId})`);
    } catch (e) {
      console.error(e);
      alert("Lỗi đồng bộ. Vui lòng kiểm tra kết nối Walrus.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-cyan-500" /></div>;

  return (
    <div className="bg-[#111218] border border-gray-800 rounded-3xl p-6 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 flex items-center">
          <Brain className="w-3 h-3 mr-2 text-purple-500" />
          Agent Identity (Walrus Cloud)
        </h3>
        <div className="flex gap-2">
            <span className={`text-[9px] px-2 py-0.5 rounded border flex items-center gap-1 ${servicesStatus.walrus ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
              {servicesStatus.walrus ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />} Walrus
            </span>
            <span className={`text-[9px] px-2 py-0.5 rounded border flex items-center gap-1 ${servicesStatus.memwal ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
              {servicesStatus.memwal ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />} MemWal
            </span>
        </div>
      </div>

      {!isEditing && soul ? (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }}
          className="space-y-4 pt-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-purple-500 to-cyan-500 flex items-center justify-center p-1">
                  <div className="bg-[#111218] w-full h-full rounded-full flex items-center justify-center">
                    <UserRound className="w-8 h-8 text-white" />
                  </div>
              </div>
              <div>
                  <h4 className="text-xl font-bold text-white flex items-center gap-2">
                    {soul.name}
                    <ShieldCheck className="w-4 h-4 text-cyan-400" title="Đã qua kiểm định Walrus" />
                  </h4>
                  <p className="text-xs text-gray-400 italic">"{soul.motto}"</p>
              </div>
            </div>
            <div className="text-right">
               <p className="text-[10px] text-gray-500 uppercase">Version</p>
               <p className="text-sm font-mono text-cyan-500">v{soul.version}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
             <div className="p-3 bg-black/40 rounded-2xl border border-gray-800">
                <p className="text-gray-500 uppercase font-bold mb-1">Tính cách</p>
                <p className="text-gray-300 leading-relaxed">{soul.personality}</p>
             </div>
             <div className="p-3 bg-black/40 rounded-2xl border border-gray-800">
                <p className="text-gray-500 uppercase font-bold mb-1">Kỹ năng</p>
                <div className="flex flex-wrap gap-1 mt-1">
                   {soul.skills.map(s => (
                     <span key={s} className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded-md">{s}</span>
                   ))}
                </div>
             </div>
          </div>

          <button 
            onClick={() => setIsEditing(true)}
            className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-xs font-bold transition-all border border-gray-700"
          >
            Sửa Linh Hồn Agent
          </button>
        </motion.div>
      ) : (
        <div className="space-y-4 pt-2">
          <div className="space-y-3">
             <div className="space-y-1 text-left">
                <label className="text-[10px] uppercase font-bold text-gray-500 px-1">Tên Agent (Identity)</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-black/40 border border-gray-800 text-sm p-3 rounded-xl text-white focus:outline-none focus:border-purple-500"
                />
             </div>
             <div className="space-y-1 text-left">
                <label className="text-[10px] uppercase font-bold text-gray-500 px-1">Châm ngôn (Motto)</label>
                <input 
                  type="text" 
                  value={formData.motto}
                  onChange={(e) => setFormData({...formData, motto: e.target.value})}
                  className="w-full bg-black/40 border border-gray-800 text-sm p-3 rounded-xl text-white focus:outline-none focus:border-purple-500"
                />
             </div>
             <div className="space-y-1 text-left">
                <label className="text-[10px] uppercase font-bold text-gray-500 px-1">Tính cách (Personality)</label>
                <textarea 
                  value={formData.personality}
                  onChange={(e) => setFormData({...formData, personality: e.target.value})}
                  className="w-full bg-black/40 border border-gray-800 text-sm p-3 rounded-xl text-white h-20 focus:outline-none focus:border-purple-500"
                />
             </div>
             <div className="space-y-1 text-left">
                <label className="text-[10px] uppercase font-bold text-gray-500 px-1">Kỹ năng Agent (DeFi Specialization)</label>
                <div className="flex flex-wrap gap-2 p-3 bg-black/40 border border-gray-800 rounded-xl">
                   {PREDEFINED_SKILLS.map(skill => (
                     <button
                       key={skill}
                       onClick={() => toggleSkill(skill)}
                       className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                         formData.skills.includes(skill)
                           ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/20'
                           : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700'
                       }`}
                     >
                       {skill}
                     </button>
                   ))}
                </div>
                <p className="text-[9px] text-gray-600 px-1 mt-1">* Chọn các kỹ năng DeFi mà Agent của bạn sẽ tập trung tối ưu hóa.</p>
             </div>
          </div>

          <div className="flex gap-2">
             <button 
               onClick={() => soul ? setIsEditing(false) : null}
               className="flex-1 py-3 bg-gray-800 text-gray-400 rounded-xl text-xs font-bold"
             >
               Hủy
             </button>
             <button 
               onClick={handleSave}
               disabled={isSaving}
               className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
             >
               {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
               Lưu và Đồng bộ Cloud
             </button>
          </div>
        </div>
      )}
      
      {!soul && !isEditing && (
        <div className="p-8 text-center bg-black/20 rounded-2xl border border-dashed border-gray-800">
           <Sparkles className="w-8 h-8 text-gray-700 mx-auto mb-2" />
           <p className="text-sm text-gray-500">Agent chưa có linh hồn trên Walrus.</p>
           <button 
             onClick={() => setIsEditing(true)}
             className="mt-4 px-6 py-2 bg-purple-600 text-white rounded-full text-[10px] font-bold uppercase tracking-wider"
           >
             Khởi Tạo Agent
           </button>
        </div>
      )}
    </div>
  );
}
