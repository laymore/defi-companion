import { useState, useEffect } from 'react';
import { ArrowRightLeft, Search, Loader2, Info } from 'lucide-react';
import { TokenBalance, KNOWN_TOKENS, NetworkType } from '../lib/sui';
import { motion, AnimatePresence } from 'motion/react';

interface SwapCardProps {
  tokens: TokenBalance[];
  network: NetworkType;
  onPropose: (tx: any) => void;
  isProcessing?: boolean;
}

export function SwapCard({ tokens, network, onPropose, isProcessing }: SwapCardProps) {
  const [fromToken, setFromToken] = useState<TokenBalance | null>(null);
  const [toToken, setToToken] = useState<string>('DEEP');
  const [amount, setAmount] = useState<string>('');
  const [quote, setQuote] = useState<any>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize with SUI if available
  useEffect(() => {
    if (!fromToken && tokens.length > 0) {
      const sui = tokens.find(t => t.symbol === 'SUI');
      setFromToken(sui || tokens[0]);
    }
  }, [tokens]);

  const handleFetchQuote = async () => {
    if (!fromToken || !amount || parseFloat(amount) <= 0) return;
    if (network !== 'mainnet') {
      setError("Swap chỉ khả dụng trên Mainnet.");
      return;
    }

    setIsQuoting(true);
    setError(null);
    setQuote(null);

    try {
      const fromType = fromToken.coinType;
      const toType = KNOWN_TOKENS[toToken] || toToken;
      
      const decimals = fromToken.decimals;
      const toBaseUnits = (num: number, dec: number) => {
        const parts = num.toFixed(dec).split('.');
        return BigInt(parts[0] + (parts[1] || '').padEnd(dec, '0')).toString();
      };
      const amountInRaw = toBaseUnits(parseFloat(amount), decimals);

      const res = await fetch(`/api/7k/quote?from=${fromType}&to=${toType}&amount=${amountInRaw}`);
      const data = await res.json();

      if (data.error || !data.amountOut) {
         throw new Error(data.message || "Không thể lấy báo giá.");
      }
      setQuote(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsQuoting(false);
    }
  };

  const handlePropose = () => {
    if (!fromToken || !amount || !toToken) return;
    onPropose({
      type: 'swap',
      from: fromToken.symbol,
      to: toToken,
      amount: amount,
      network: network
    });
  };

  const maxBalance = fromToken?.balance || 0;

  return (
    <div className="bg-[#111218] border border-gray-800 rounded-3xl p-6 shadow-xl space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 flex items-center">
          <ArrowRightLeft className="w-3 h-3 mr-2 text-indigo-500" />
          Swap Tokens
        </h3>
        {network !== 'mainnet' && (
          <span className="text-[10px] text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded border border-orange-400/20">Mainnet Only</span>
        )}
      </div>

      <div className="space-y-3">
        {/* From */}
        <div className="bg-black/40 border border-gray-800 rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] uppercase font-bold text-gray-500">Bán (From)</span>
            <span className="text-[10px] text-gray-400">Số dư: <button onClick={() => setAmount(maxBalance.toString())} className="text-indigo-400 hover:underline">{maxBalance.toFixed(4)}</button></span>
          </div>
          <div className="flex gap-3">
            <select 
              value={fromToken?.coinType || ''} 
              onChange={(e) => setFromToken(tokens.find(t => t.coinType === e.target.value) || null)}
              className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {tokens.map(t => (
                <option key={t.coinType} value={t.coinType}>{t.symbol}</option>
              ))}
            </select>
            <input 
              type="number" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent text-right text-lg font-mono font-bold text-white focus:outline-none placeholder:text-gray-700"
            />
          </div>
        </div>

        <div className="flex justify-center -my-3 relative z-10">
          <div className="bg-[#111218] p-2 rounded-full border border-gray-800 shadow-lg">
            <ArrowRightLeft className="w-4 h-4 text-gray-500 rotate-90" />
          </div>
        </div>

        {/* To */}
        <div className="bg-black/40 border border-gray-800 rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] uppercase font-bold text-gray-500">Mua (To)</span>
          </div>
          <div className="flex gap-3">
            <select 
              value={toToken} 
              onChange={(e) => setToToken(e.target.value)}
              className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {Object.keys(KNOWN_TOKENS).map(sym => (
                <option key={sym} value={sym}>{sym}</option>
              ))}
            </select>
            <div className="flex-1 text-right text-lg font-mono font-bold text-gray-400">
              {isQuoting ? <Loader2 className="w-5 h-5 animate-spin ml-auto" /> : quote ? (parseFloat(quote.amountOut) / Math.pow(10, 9)).toFixed(4) : '0.00'}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button 
          onClick={handleFetchQuote}
          disabled={!amount || isQuoting || network !== 'mainnet' || parseFloat(amount) > maxBalance}
          className="flex-1 py-3 bg-gray-800 text-white rounded-xl text-xs font-bold hover:bg-gray-700 disabled:opacity-30 flex items-center justify-center gap-2"
        >
          {isQuoting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Lấy báo giá
        </button>
        <button 
          onClick={handlePropose}
          disabled={!amount || isQuoting || network !== 'mainnet' || parseFloat(amount) > maxBalance}
          className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-500 shadow-lg shadow-indigo-600/20 disabled:opacity-30"
        >
          Phê duyệt Swap
        </button>
      </div>
    </div>
  );
}
