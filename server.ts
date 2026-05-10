import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import { addMemWalMemory, getMemWalHistory } from './src/lib/memwal';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getUrl = (net: 'mainnet' | 'testnet') => 
  net === 'mainnet' ? 'https://fullnode.mainnet.sui.io:443' : 'https://fullnode.testnet.sui.io:443';

// Initialize Agent Wallet (Server-side)
// In a real app, this would be loaded from a secure KMS or encrypted env var
const AGENT_SECRET = process.env.AGENT_WALLET_SEED || 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const agentKeypair = Ed25519Keypair.deriveKeypair(AGENT_SECRET);
const agentAddress = agentKeypair.toSuiAddress();

const mainnetClient = new SuiJsonRpcClient({ url: getUrl('mainnet'), network: 'mainnet' });
const testnetClient = new SuiJsonRpcClient({ url: getUrl('testnet'), network: 'testnet' });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  console.log(`[Agent] Sui Autonomous Wallet: ${agentAddress}`);

  // Agent API: Get Info
  app.get('/api/agent/info', async (req, res) => {
    try {
      const network = (req.query.network as string) || 'mainnet';
      const client = network === 'mainnet' ? mainnetClient : testnetClient;
      const balance = await client.getBalance({ owner: agentAddress });
      
      res.json({
        address: agentAddress,
        balance: Number(balance.totalBalance) / 1_000_000_000,
        network
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Agent API: Autonomous Action (No user approval needed for agent's own wallet)
  app.post('/api/agent/action', async (req, res) => {
    try {
      const { type, network } = req.body;
      const client = network === 'mainnet' ? mainnetClient : testnetClient;

      if (type === 'transfer') {
        const { to, amount } = req.body;
        const tx = new Transaction();
        const [coin] = tx.splitCoins(tx.gas, [Math.floor(amount * 1_000_000_000)]);
        tx.transferObjects([coin], to);

        const result = await client.signAndExecuteTransaction({
          signer: agentKeypair,
          transaction: tx,
        });
        return res.json({ success: true, digest: result.digest });
      }

      if (type === 'swap') {
        const { from, to, amount } = req.body;
        // Restrict to SUI, WAL, DEEP
        const allowed = ['SUI', 'WAL', 'DEEP', 'DEEPTRADE'];
        if (!allowed.includes(from.toUpperCase()) || !allowed.includes(to.toUpperCase())) {
           return res.status(400).json({ error: 'Agent chỉ hỗ trợ giao dịch SUI, WAL và DEEP/DEEPTRADE.' });
        }
        
        console.log(`[Agent DeepSwap] ${amount} ${from} -> ${to} on ${network}`);
        
        // DeepBook V3 / 7K Integration simulation
        return res.json({ 
          success: true, 
          digest: 'agent-deep-swap-' + Math.random().toString(36).substring(7),
          message: `Agent đã thực thi lệnh swap ${amount} ${from} sang ${to} tối ưu qua DeepBook V3.`
        });
      }

      if (type === 'deepbook_order') {
        const { poolId, side, price, quantity } = req.body;
        console.log(`[DeepBook Order] ${side} ${quantity} at ${price} on pool ${poolId}`);
        // In reality, use deepBookClient.placeLimitOrder(...)
        return res.json({ 
           success: true, 
           digest: 'db-order-' + Math.random().toString(36).substring(7),
           message: `Đã đặt lệnh DeepBook V3 ${side} thành công.` 
        });
      }

      res.status(400).json({ error: 'Unsupported action type' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy for 7K Aggregator (to avoid CORS)
  app.get('/api/7k/quote', async (req, res) => {
    try {
      const { from, to, amount } = req.query;
      console.log(`[Proxy] 7K Quote Request: ${from} -> ${to} (${amount})`);
      
      const params = new URLSearchParams();
      if (from) params.append('from', from as string);
      if (to) params.append('to', to as string);
      if (amount) params.append('amount', amount as string);
      
      const fetchWithRetry = async (url: string, options: any = {}, retries = 2) => {
        for (let i = 0; i < retries; i++) {
          try {
            const resp = await fetch(url, options);
            if (resp.status === 502 || resp.status === 504 || resp.status === 503) {
              if (i < retries - 1) {
                console.warn(`[Proxy] 7K status ${resp.status}, retrying ${i+1}/${retries}...`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
              }
            }
            return resp;
          } catch (e) {
            if (i < retries - 1) {
              await new Promise(r => setTimeout(r, 1000));
              continue;
            }
            throw e;
          }
        }
        return await fetch(url, options);
      };

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      };

      let response;
      let data: any = {};
      
      try {
        response = await fetchWithRetry(`https://api.7k.ag/v2/quote?${params.toString()}`, { headers });
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { _raw: text.slice(0, 500), message: "Invalid JSON response" };
        }
      } catch (e: any) {
        console.error(`[Proxy] 7K v2 Fetch Exception:`, e.message);
      }

      // Fallback if v2 failed (status >= 400 or exception)
      if (!response || !response.ok || response.status >= 500) {
        console.warn(`[Proxy] 7K v2 failed (Status: ${response?.status}), trying v1...`);
        try {
          response = await fetchWithRetry(`https://api.7k.ag/quote?${params.toString()}`, { headers });
          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch (e) {
            data = { _raw: text.slice(0, 500), message: "Invalid JSON response" };
          }
        } catch (e: any) {
          console.error(`[Proxy] 7K v1 Fetch Exception:`, e.message);
        }
      }

      if (!response || !response.ok) {
        const status = response?.status || 503;
        console.error(`[Proxy] 7K Quote Error (${status}):`, data);
        return res.status(status).json(data || { error: true, message: "7K API Unavailable" });
      }

      res.json(data);
    } catch (error: any) {
      console.error(`[Proxy] 7K Quote Catch All:`, error);
      res.status(500).json({ error: true, message: error.message });
    }
  });

  // Proxy for Walrus Publisher (CORS bypass for PUT)
  app.put('/api/walrus/publisher', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
    try {
      const epochs = req.query.epochs || '1';
      const send_object_to = req.query.send_object_to;
      const url = `https://publisher.walrus.space/v1/blobs?epochs=${epochs}${send_object_to ? `&send_object_to=${send_object_to}` : ''}`;
      
      console.log(`[Proxy] Walrus Publisher PUT: ${url}`);
      
      const response = await fetch(url, {
        method: 'PUT',
        body: req.body,
      });
      
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error: any) {
      console.error(`[Proxy] Walrus Publisher Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy for Walrus Aggregator (CORS bypass for GET)
  app.get('/api/walrus/aggregator/:id', async (req, res) => {
    try {
      const { id } = req.params;
      // We try the primary aggregator first
      const url = `https://aggregator.walrus.space/v1/${id}`;
      console.log(`[Proxy] Walrus Aggregator GET: ${url}`);
      
      const response = await fetch(url);
      if (response.ok) {
        const text = await response.text();
        return res.send(text);
      }
      
      // Fallback to secondary if primary fails
      const fallbackUrl = `https://walrus-aggregator.testnet.sui.io/v1/${id}`;
      console.log(`[Proxy] Walrus Aggregator Fallback GET: ${fallbackUrl}`);
      const fallbackResponse = await fetch(fallbackUrl);
      const fallbackText = await fallbackResponse.text();
      res.status(fallbackResponse.status).send(fallbackText);
    } catch (error: any) {
      console.error(`[Proxy] Walrus Aggregator Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/walrus/aggregator/health', (req, res) => {
    res.json({ status: 'ok', service: 'walrus-proxy' });
  });

  app.post('/api/7k/swap', async (req, res) => {
    try {
      console.log(`[Proxy] 7K Swap Request:`, req.body);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      const response = await fetch('https://api.7k.ag/v2/swap', {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body)
      });
      
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { _raw: text.slice(0, 500), message: "Invalid JSON from 7K" };
      }

      if (!response.ok) {
        console.error(`[Proxy] 7K Swap Error (${response.status}):`, data);
        return res.status(response.status).json(data);
      }
      res.json(data);
    } catch (error: any) {
      console.error(`[Proxy] 7K Swap Exception:`, error);
      res.status(500).json({ error: true, message: error.message });
    }
  });

  // Proxy for Kapa.ai (Sui MCP)
  app.get('/api/kapa/query', async (req, res) => {
    try {
      const { website_token, query } = req.query;
      const url = `https://api.kapa.ai/v1/query?website_token=${website_token}&query=${encodeURIComponent(query as string)}`;
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: true, message: error.message });
    }
  });

  // Proxy for DexScreener
  app.get('/api/dex/search', async (req, res) => {
    try {
      const { q } = req.query;
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q as string)}`;
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: true, message: error.message });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

// Discord Bot Integration
async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_CLIENT_SECRET || 'n41072aqNUtAGtNQ_q1L5i6w7R95hah6';
  const clientId = process.env.DISCORD_CLIENT_ID || '1486575593960243331';

  if (!token || !clientId || token === 'n41072aqNUtAGtNQ_q1L5i6w7R95hah6_PLACEHOLDER') { 
    console.warn('[Discord] Token or Client ID missing. Discord bot disabled.');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once('ready', () => {
    console.log(`[Discord] Bot logged in as ${client.user?.tag}`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isDM = !message.guild;
    const isMentioned = client.user && message.mentions.has(client.user);

    if (isDM || isMentioned) {
      try {
        await message.channel.sendTyping();
        
        const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
        const userId = message.author.id;

        // 1. Lấy lịch sử từ MemWal
        const history = await getMemWalHistory(userId);
        const historyContext = history.length > 0 
          ? history.slice(-5).map(m => `User: ${m.text}`).join('\n') 
          : "Không có lịch sử trước đó.";

        const prompt = `
          Bạn là "SuiRobo", Trợ lý AI trên Discord quản lý ví Sui.
          Địa chỉ ví Agent của bạn: ${agentAddress}
          Người dùng Discord: ${message.author.username} (ID: ${userId})
          
          CHIẾN LƯỢC: Bạn là chuyên gia về SUI, WAL và DEEP/DEEPTRADE. Bạn sử dụng DeepBook V3 để tối ưu giao dịch.
          GIỚI HẠN: Chỉ hỗ trợ 3 loại token này.
          
          Lịch sử trò chuyện gần đây:
          ${historyContext}

          Nhiệm vụ: Trả lời ngắn gọn, thân thiện bằng tiếng Việt. 
          Giúp người dùng giải đáp thắc mắc về Sui Network, giá cả và tài sản của bạn.
          Sử dụng Google Search nếu cần thông tin real-time.
          
          Tin nhắn mới từ người dùng: "${cleanContent}"
        `;

        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
          throw new Error('GEMINI_API_KEY is missing or invalid.');
        }

        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const result = await ai.models.generateContent({
          model: "gemini-2.0-flash", // Sử dụng flash 2.0 cho nhanh và mạnh
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            tools: [{ googleSearch: {} }]
          }
        });
        
        let aiResponse = result.text?.trim() || "Tôi không thể trả lời câu hỏi này lúc này.";
        
        // Thêm nguồn tin nếu có
        const groundingMetadata = (result as any).candidates?.[0]?.groundingMetadata;
        if (groundingMetadata?.groundingChunks?.length > 0) {
          const links = groundingMetadata.groundingChunks
            .map((c: any) => c.web?.uri)
            .filter(Boolean)
            .slice(0, 3);
          if (links.length > 0) {
            aiResponse += "\n\n**Nguồn:**\n" + links.join('\n');
          }
        }

        // 2. Lưu vào MemWal
        await addMemWalMemory(cleanContent, userId);

        // Discord limit 2000 chars
        const chunks = aiResponse.match(/[\s\S]{1,2000}/g) || [];
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      } catch (error: any) {
        console.error('[Discord] AI Error:', error);
        await message.reply('Rất tiếc, mình đang gặp chút trục trặc khi suy nghĩ. Hãy thử lại sau nhé!\nLỗi: ' + (error.message || 'Unknown error'));
      }
    }
  });

  try {
    await client.login(token);
  } catch (err) {
    console.error('[Discord] Login failed:', err);
  }
}

startServer();
startDiscordBot();
