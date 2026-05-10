import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { getOrCreateKeypair, getBalance, getAllTokensBalance, TokenBalance, requestTestTokens, executeProposedTransaction, executeSwap, resolveSuiDomain, NetworkType, KNOWN_TOKENS } from '../lib/sui';
import { AIChat } from './AIChat';
import { SwapCard } from './SwapCard';
import { SoulManager } from './SoulManager';
import { LogOut, Copy, RefreshCw, Activity, Globe, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AgentSoul } from '../lib/agent-soul';

export function WalletDashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [network, setNetwork] = useState<NetworkType>('mainnet');
  const [keypair, setKeypair] = useState<any>(null);
  const [address, setAddress] = useState<string>('');
  const [balance, setBalance] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [proposedTx, setProposedTx] = useState<any>(null);
  const [resolvedTxAddress, setResolvedTxAddress] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'idle' | 'executing' | 'success' | 'error'>('idle');
  const [agentAddress, setAgentAddress] = useState<string>('');
  const [agentBalance, setAgentBalance] = useState<number | null>(null);
  const [currentSoul, setCurrentSoul] = useState<AgentSoul | null>(null);

  const refreshAgentInfo = async () => {
    try {
      const resp = await fetch(`/api/agent/info?network=${network}`);
      const data = await resp.json();
      if (data.address) {
        setAgentAddress(data.address);
        setAgentBalance(data.balance);
      }
    } catch (e) {
      console.error("Failed to fetch agent info", e);
    }
  };

  useEffect(() => {
    refreshAgentInfo();
  }, [network]);


  useEffect(() => {
    if (proposedTx?.to) {
      setResolvedTxAddress(null);
      resolveSuiDomain(proposedTx.to, network).then(res => {
         if (res) setResolvedTxAddress(res);
      }).catch(() => {});
    } else {
      setResolvedTxAddress(null);
    }
  }, [proposedTx?.to, network]);

  useEffect(() => {
    let active = true;
    getOrCreateKeypair(user.uid).then(kp => {
      if (!active) return;
      setKeypair(kp);
      const addr = kp.toSuiAddress();
      setAddress(addr);
      refreshBalance(addr, network);
    }).catch(console.error);

    return () => { active = false; };
  }, [user.uid, network]);

  const refreshBalance = async (addr: string, currentNet: NetworkType = network) => {
    setIsRefreshing(true);
    try {
      const [bal, toks] = await Promise.all([
        getBalance(addr, currentNet),
        getAllTokensBalance(addr, currentNet)
      ]);
      setBalance(bal);
      setTokens(toks);
    } catch (e) {
      console.error(e);
      setBalance(null);
      setTokens([]);
    }
    setIsRefreshing(false);
  };

  const handleCopyLink = () => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = address;
      textArea.style.position = "absolute";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('Đã copy địa chỉ ví:\n' + address);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const approveTx = async () => {
    if (!proposedTx || !keypair) return;
    setTxStatus('executing');
    try {
      if (proposedTx.type === 'swap') {
        await executeSwap(keypair, proposedTx.from, proposedTx.to, parseFloat(proposedTx.amount), network);
      } else {
        const resolvedAddress = await resolveSuiDomain(proposedTx.to, network);
        if (!resolvedAddress) throw new Error("Không thể phân giải địa chỉ.");
        const amountMIST = Math.floor(proposedTx.amountSui * 1_000_000_000).toString();
        await executeProposedTransaction(keypair, { to: resolvedAddress, amountMIST }, network);
      }
      setTxStatus('success');
      setTimeout(() => {
        setProposedTx(null);
        setTxStatus('idle');
        refreshBalance(address, network);
      }, 2000);
    } catch (e: any) {
      console.error(e);
      alert("Lỗi: " + e.message);
      setTxStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#050510] text-gray-200 font-sans p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column */}
        <div className="lg:col-span-5 space-y-6">
          <header className="flex items-center justify-between pb-6 border-b border-gray-800 flex-wrap gap-4">
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-900 flex items-center justify-center text-cyan-400 font-medium border border-cyan-800">
                  {user.email?.[0].toUpperCase()}
                </div>
                <div>
                   <p className="text-sm font-medium text-white">{user.displayName || user.email}</p>
                   <div className="flex items-center gap-3 mt-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${network === 'mainnet' ? 'bg-green-500' : 'bg-cyan-500'}`}></span>
                        <select 
                          value={network}
                          onChange={(e) => setNetwork(e.target.value as NetworkType)}
                          className="text-xs bg-transparent text-gray-400 font-medium focus:outline-none appearance-none cursor-pointer hover:text-white"
                        >
                          <option value="testnet">Sui Testnet</option>
                          <option value="mainnet">Sui Mainnet</option>
                        </select>
                        <button onClick={handleCopyLink} className="p-1 hover:bg-white/10 rounded-md text-gray-500 hover:text-cyan-400">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded-md">
                         <span className="text-xs font-mono text-cyan-400 font-bold">{balance?.toFixed(3) || '0.000'} SUI</span>
                         <button onClick={() => refreshBalance(address, network)} className={`ml-1 text-cyan-500/50 hover:text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`}>
                           <RefreshCw className="w-2.5 h-2.5" />
                         </button>
                      </div>
                    </div>
                 </div>
              </div>
              <button onClick={onLogout} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white">
                 <LogOut className="w-5 h-5" />
              </button>
           </header>

           {/* Agent Wallet Card */}
           <div className="bg-gradient-to-br from-indigo-950/40 to-black border border-indigo-500/20 rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
              <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-500/20 rounded-xl">
                       <Bot className="w-4 h-4 text-indigo-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Ví Tự Trị của Agent</h3>
                 </div>
                 <div className="px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded text-[10px] text-indigo-400 font-bold">QUẢN LÝ BỞI NODE</div>
              </div>
              
              <div className="space-y-4">
                 <div className="bg-black/40 border border-gray-800 rounded-2xl p-4">
                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1 tracking-tighter">Địa chỉ ví Agent</p>
                    <div className="flex items-center justify-between gap-2">
                       <code className="text-xs text-indigo-300 font-mono truncate">{agentAddress || 'Đang tải...'}</code>
                       <button 
                         onClick={() => {
                           navigator.clipboard.writeText(agentAddress);
                           alert('Đã copy ví Agent:\n' + agentAddress);
                         }} 
                         className="p-1.5 hover:bg-indigo-500/20 rounded-lg text-indigo-400"
                       >
                         <Copy className="w-3.5 h-3.5" />
                       </button>
                    </div>
                 </div>
                 
                 <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                       <span className="text-xs text-gray-400 font-medium">Sẵn sàng tự trị (Auto-pilot)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                       <span className="text-xs text-gray-500">Số dư:</span>
                       <span className="text-sm font-mono text-indigo-400 font-bold">{agentBalance?.toFixed(4) || '0.0000'} SUI</span>
                    </div>
                 </div>
              </div>
           </div>

           {/* Agent Soul Management */}
           <SoulManager userId={user.uid} onUpdate={setCurrentSoul} />

           {/* Manual Swap */}
           <SwapCard 
             tokens={tokens} 
             network={network} 
             onPropose={setProposedTx} 
             isProcessing={txStatus === 'executing'}
           />

           {/* Assets */}
           <div className="bg-[#111218] border border-gray-800 rounded-3xl p-6 shadow-xl">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4 flex items-center">
                <Activity className="w-3 h-3 mr-2" /> Tài Sản
              </h3>
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                {tokens.map((token) => (
                  <div key={token.coinType} className="flex justify-between items-center p-3 bg-black/40 rounded-2xl border border-gray-800">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-cyan-900 border border-cyan-800 flex items-center justify-center text-xs font-bold text-cyan-400">{token.symbol[0]}</div>
                      <p className="font-semibold text-white">{token.symbol}</p>
                    </div>
                    <span className="font-mono text-cyan-400">{token.balance.toFixed(4)}</span>
                  </div>
                ))}
              </div>
           </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-7 flex flex-col gap-6">
           <AnimatePresence>
             {proposedTx && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="p-6 bg-cyan-950/30 border border-cyan-800/50 rounded-3xl relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-cyan-500"></div>
                   <h3 className="text-lg font-medium text-white mb-4">Lệnh Thực Thi ({proposedTx.type.toUpperCase()})</h3>
                   <div className="bg-black/50 p-4 rounded-xl font-mono text-sm space-y-2 mb-6">
                      <div className="flex justify-between"><span className="text-gray-500">Destination:</span><span className="text-gray-300 truncate ml-2">{proposedTx.to}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Amount:</span><span className="text-cyan-400 font-bold">{proposedTx.amountSui || proposedTx.amount} {proposedTx.type === 'transfer' ? 'SUI' : proposedTx.from}</span></div>
                   </div>
                   <div className="flex gap-3">
                      <button onClick={() => setProposedTx(null)} disabled={txStatus === 'executing'} className="flex-1 px-4 py-3 border border-gray-700 text-gray-400 rounded-xl">Từ chối</button>
                      <button onClick={approveTx} disabled={txStatus === 'executing'} className="flex-1 px-4 py-3 bg-cyan-500 text-black rounded-xl font-bold">{txStatus === 'executing' ? 'Đang gửi...' : 'Đồng ý'}</button>
                   </div>
                </motion.div>
             )}
           </AnimatePresence>
           <div className="flex-1 h-[600px]">
             <AIChat userId={user.uid} suiAddress={address} agentAddress={agentAddress} onProposeTx={setProposedTx} network={network} />
           </div>
        </div>
      </div>
    </div>
  );
}
