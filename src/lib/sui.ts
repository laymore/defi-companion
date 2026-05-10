import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { db, ensureConnected, handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, setDoc, enableNetwork } from 'firebase/firestore';

export type NetworkType = 'mainnet' | 'testnet';

const getUrl = (net: NetworkType) => 
  net === 'mainnet' ? 'https://fullnode.mainnet.sui.io:443' : 'https://fullnode.testnet.sui.io:443';

export const clients = {
  mainnet: new SuiJsonRpcClient({ url: getUrl('mainnet'), network: 'mainnet' }),
  testnet: new SuiJsonRpcClient({ url: getUrl('testnet'), network: 'testnet' }),
};

export async function getOrCreateKeypair(userId: string): Promise<Ed25519Keypair> {
  const secretDocRef = doc(db, 'users', userId, 'secrets', 'wallet');
  
  let attempts = 0;
  const maxAttempts = 2;
  let cloudKey: string | null = null;

  while (attempts < maxAttempts) {
    try {
      // First, check/force connectivity
      if (attempts > 0) await enableNetwork(db);
      
      const secretSnap = await getDoc(secretDocRef);
      if (secretSnap.exists()) {
        cloudKey = secretSnap.data().encryptedData;
      }
      break; // Success or definitely doesn't exist
    } catch (err: any) {
      attempts++;
      console.warn(`Attempt ${attempts} to read wallet from cloud failed:`, err.message);
      if (attempts >= maxAttempts) {
         console.error("Failed to read wallet from cloud after retries", err);
         handleFirestoreError(err, OperationType.GET, secretDocRef.path);
      } else {
         // wait a bit before retry
         await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  if (cloudKey) {
    try {
      if (!cloudKey.startsWith('[')) {
         return Ed25519Keypair.fromSecretKey(cloudKey);
      }
    } catch (e) {
      console.warn("Failed to parse stored key from cloud");
    }
  }

  // Fallback to local storage (migration from old version) or generate new
  const storedKey = localStorage.getItem(`sui_key_${userId}`);
  if (storedKey) {
    try {
      if (storedKey.startsWith('[')) {
          localStorage.removeItem(`sui_key_${userId}`);
      } else {
          const kp = Ed25519Keypair.fromSecretKey(storedKey);
          // Sync it back to cloud
          try {
            await setDoc(secretDocRef, { encryptedData: storedKey, updatedAt: Date.now() });
          } catch(e) {}
          return kp;
      }
    } catch (e) {
      console.warn("Failed to parse stored key from localStorage");
      localStorage.removeItem(`sui_key_${userId}`);
    }
  }
  
  // Generate a new keypair
  const keypair = new Ed25519Keypair();
  const rawKey = keypair.getSecretKey();
  localStorage.setItem(`sui_key_${userId}`, rawKey);
  
  try {
    await setDoc(secretDocRef, { encryptedData: rawKey, updatedAt: Date.now() });
  } catch(e) {}
  
  return keypair;
}

export function suiToMist(sui: number): bigint {
  return BigInt(Math.floor(sui * 1_000_000_000));
}

export function mistToSui(mist: string | bigint | number): number {
  return Number(BigInt(mist)) / 1_000_000_000;
}

export async function getBalance(address: string, network: NetworkType = 'mainnet') {
  const result = await clients[network].getBalance({
    owner: address,
  });
  // balance is in MIST (1 SUI = 10^9 MIST)
  const suiBalance = parseInt(result.totalBalance) / 1_000_000_000;
  return suiBalance;
}

export interface TokenBalance {
  coinType: string;
  symbol: string;
  balance: number;
  iconUrl?: string;
  decimals: number;
}

export async function getAllTokensBalance(address: string, network: NetworkType = 'mainnet'): Promise<TokenBalance[]> {
  const result = await clients[network].getAllBalances({ owner: address });
  const tokens: TokenBalance[] = [];

  const KNOWN_COINS = ['SUI', 'WAL', 'DEEP'];

  for (const bal of result) {
    if (bal.totalBalance === '0') continue;

    try {
      const metadata = await clients[network].getCoinMetadata({ coinType: bal.coinType });
      if (metadata) {
        // filter known coins or ones with iconUrl
        if (KNOWN_COINS.includes(metadata.symbol.toUpperCase()) || metadata.iconUrl) {
          const decimals = metadata.decimals;
          const balance = parseInt(bal.totalBalance) / Math.pow(10, decimals);
          tokens.push({
            coinType: bal.coinType,
            symbol: metadata.symbol,
            balance,
            iconUrl: metadata.iconUrl || undefined,
            decimals
          });
        }
      } else if (bal.coinType === '0x2::sui::SUI') {
         tokens.push({
            coinType: bal.coinType,
            symbol: 'SUI',
            balance: parseInt(bal.totalBalance) / 1_000_000_000,
            decimals: 9
         });
      }
    } catch(e) {
      console.warn("Failed to fetch metadata for", bal.coinType);
    }
  }
  
  // Sort by SUI first, then by balance
  tokens.sort((a, b) => {
    if (a.symbol.toUpperCase() === 'SUI') return -1;
    if (b.symbol.toUpperCase() === 'SUI') return 1;
    return b.balance - a.balance;
  });

  return tokens;
}

export async function requestTestTokens(address: string, network: NetworkType = 'testnet') {
  if (network === 'mainnet') return false;
  // simple fauect request for testnet
  try {
     const res = await fetch('https://faucet.testnet.sui.io/gas', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ FixedAmountRequest: { recipient: address } })
     });
     return res.ok;
  } catch (e) {
     console.error(e);
     return false;
  }
}

export async function resolveSuiDomain(domain: string, network: NetworkType = 'mainnet'): Promise<string | null> {
  const original = domain.trim();
  if (/^0x[a-fA-F0-9]{1,64}$/.test(original)) {
    return original; 
  }
  
  let normalized = original;
  if (original.includes('@')) {
    // "gate@sui" -> "gate.sui"
    // "bina@gate" -> "bina.gate.sui"
    const parts = original.split('@');
    if (parts[1] === 'sui') {
      normalized = `${parts[0]}.sui`;
    } else {
      normalized = `${parts[0]}.${parts[1]}.sui`;
    }
  } else if (!original.endsWith('.sui') && !original.startsWith('@')) {
    normalized = `${original}.sui`;
  }
  
  try {
    let resolved = await clients[network].resolveNameServiceAddress({ name: normalized });
    if (!resolved && network !== 'mainnet') {
      resolved = await clients['mainnet'].resolveNameServiceAddress({ name: normalized });
    }
    if (resolved) return resolved;
  } catch(e) {
    if (network !== 'mainnet') {
      try {
        const resolvedMain = await clients['mainnet'].resolveNameServiceAddress({ name: normalized });
        if (resolvedMain) return resolvedMain;
      } catch(ex) {}
    }
  }
  
  try {
    let resolvedFallback = await clients[network].resolveNameServiceAddress({ name: original });
    if (!resolvedFallback && network !== 'mainnet') {
      resolvedFallback = await clients['mainnet'].resolveNameServiceAddress({ name: original });
    }
    if (resolvedFallback) return resolvedFallback;
  } catch(e) {
    if (network !== 'mainnet') {
      try {
        const resolvedMainFallback = await clients['mainnet'].resolveNameServiceAddress({ name: original });
        if (resolvedMainFallback) return resolvedMainFallback;
      } catch(ex) {}
    }
  }

  return null;
}

export const KNOWN_TOKENS: Record<string, string> = {
  SUI: '0x2::sui::SUI',
  WAL: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  DEEP: '0xdeeb7a139718474733be87236d3330ac9ef3765f046487e47dfa929112702a55::deep::DEEP',
  DEEPTRADE: '0xdeeb7a139718474733be87236d3330ac9ef3765f046487e47dfa929112702a55::deep::DEEP', // Alias for DEEP
};

export function getDeepBookClient(network: NetworkType = 'mainnet') {
  // DeepBookClient constructor expects { client, network, address? }
  // We use "as any" to handle potential SDK version mismatches in type definitions
  return new DeepBookClient({
    client: clients[network] as any,
    network: network as any
  } as any);
}

export async function executeSwap(
  keypair: Ed25519Keypair,
  fromSymbol: string,
  toSymbol: string,
  amountIn: number, // actual unit (e.g. SUI not MIST)
  network: NetworkType = 'mainnet'
) {
  if (network !== 'mainnet') {
     throw new Error("Chức năng Swap hiện tại chỉ được hỗ trợ trên mạng Mainnet. Vui lòng chuyển mạng sang Mainnet ở góc phải trên cùng để thực hiện.");
  }
  
  let fromType = KNOWN_TOKENS[fromSymbol.toUpperCase()] || fromSymbol;
  let toType = KNOWN_TOKENS[toSymbol.toUpperCase()] || toSymbol;
  
  if (!fromType.includes('::')) throw new Error(`Error 1009: Coin type for "${fromSymbol}" không tìm thấy. Vui lòng cung cấp Contract Address chính xác.`);
  if (!toType.includes('::')) throw new Error(`Error 1009: Coin type for "${toSymbol}" không tìm thấy. Vui lòng cung cấp Contract Address chính xác.`);

  try {
     console.log(`Starting swap via 7K Aggregator: ${amountIn} ${fromSymbol} -> ${toSymbol}`);
     
     let decimals = 9;
     try {
        const meta = await clients[network].getCoinMetadata({ coinType: fromType });
        if (meta) decimals = meta.decimals;
     } catch(e) {}

     // Helper to convert float to string without scientific notation and with precise decimals
     const toBaseUnits = (num: number, dec: number) => {
        const parts = num.toFixed(dec).split('.');
        return BigInt(parts[0] + (parts[1] || '').padEnd(dec, '0')).toString();
     };

     const amountInRaw = toBaseUnits(amountIn, decimals);

     // 1. Get Quote from 7K (via Proxy)
     const quoteUrl = `/api/7k/quote?from=${fromType}&to=${toType}&amount=${amountInRaw}`;
     const quoteRes = await fetch(quoteUrl);
     if (!quoteRes.ok) {
        throw new Error(`7K API Quote Error: ${quoteRes.status} ${quoteRes.statusText}`);
     }
     let quoteData;
     try {
        quoteData = await quoteRes.json();
     } catch (e) {
        throw new Error("Lỗi phản hồi từ 7K Aggregator (Format không hợp lệ). Dự kiến JSON nhưng nhận được dữ liệu khác.");
     }

     if (!quoteData || quoteData.error || !quoteData.quoteId) {
        throw new Error(quoteData?.message || "Không tìm thấy lộ trình swap hoặc thanh khoản không đủ trên 7K.");
     }

     console.log("7K Quote found:", quoteData);

     // 2. Get Swap Transaction from 7K (via Proxy)
     const swapRes = await fetch('/api/7k/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
           quoteId: quoteData.quoteId,
           sender: keypair.toSuiAddress(),
           slippage: 0.01 // 1%
        })
     });

     if (!swapRes.ok) {
        const errorData = await swapRes.json().catch(() => ({}));
        throw new Error(errorData.message || `7K API Swap Error: ${swapRes.status} ${swapRes.statusText}`);
     }
     
     let swapData;
     try {
        swapData = await swapRes.json();
     } catch (e) {
        throw new Error("Lỗi phản hồi khi tạo giao dịch từ 7K (Format không hợp lệ).");
     }

     if (!swapData || swapData.error || !swapData.tx || !swapData.tx.txBytes) {
        throw new Error(swapData?.message || "Lỗi tạo giao dịch swap từ 7K (Thiếu txBytes).");
     }

     console.log("7K Swap Transaction created");

     // 3. Execute Transaction
     // 7K returns txBytes (base64)
     const txBlock = Transaction.from(swapData.tx.txBytes);
     
     const result = await (clients[network] as any).signAndExecuteTransaction({
         signer: keypair,
         transaction: txBlock,
     });

     console.log('Swap Success:', result.digest);
     return await clients[network].waitForTransaction({ digest: result.digest });
  } catch (error: any) {
     console.error('Swap Error:', error);
     const msg = error.message || String(error);
     
     // Detect many common issues
     if (msg.includes('insufficient')) {
        throw new Error(`Số dư không đủ để thực hiện giao dịch (bao gồm phí gas).`);
     }
     if (msg.includes('JSON')) {
        throw new Error(`Lỗi kết nối tới Aggregator. Có thể dịch vụ 7K đang bảo trì hoặc bị chặn.`);
     }
     
     throw new Error(`Lỗi Swap: ${msg}`);
  }
}

export async function executeProposedTransaction(keypair: Ed25519Keypair, txDetails: { to: string, amountMIST: string }, network: NetworkType = 'mainnet') {
  const tx = new Transaction();
  // Note: amount is in MIST
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(txDetails.amountMIST)]);
  tx.transferObjects([coin], tx.pure.address(txDetails.to));
  
  const result = await (clients[network] as any).signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
  });
  
  return await clients[network].waitForTransaction({ digest: result.digest });
}
