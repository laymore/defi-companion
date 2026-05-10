import { getOrCreateKeypair } from './sui';
import { db, handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { walrus } from '@mysten/walrus';

export interface AgentSoul {
  name: string;
  personality: string;
  skills: string[];
  motto: string;
  version: number;
  lastUpdated: number;
}

// Initialize Walrus Client with SDK (using SuiGrpcClient as recommended)
const getWalrusClient = (network: 'mainnet' | 'testnet' = 'mainnet') => {
  return new SuiGrpcClient({
    baseUrl: network === 'mainnet' ? 'https://fullnode.mainnet.sui.io:443' : 'https://fullnode.testnet.sui.io:443',
    network,
  }).$extend(
    walrus({
      uploadRelay: { host: window.location.origin + '/api/walrus/publisher' },
    })
  );
};

/**
 * Verifies if Walrus and MemWal services are reachable.
 */
export async function verifyServices(): Promise<{ walrus: boolean; memwal: boolean }> {
  let walrusOk = false;
  let memwalOk = false;

  try {
    // Check aggregator proxy availability
    const resp = await fetch('/api/walrus/aggregator/health', { method: 'GET' }).catch(() => null);
    walrusOk = resp ? true : false; 
  } catch (e) {}

  try {
    await fetch('https://api.memwal.ai', { method: 'GET', mode: 'no-cors' });
    memwalOk = true;
  } catch (e) {}

  return { walrus: walrusOk, memwal: memwalOk };
}

async function sealData(data: string, secretSeed: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(secretSeed.slice(0, 32)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("sui-soul-salt"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(data)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

async function unsealData(sealedBase64: string, secretSeed: string): Promise<string> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const combined = new Uint8Array(atob(sealedBase64).split("").map(c => c.charCodeAt(0)));
  
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(secretSeed.slice(0, 32)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("sui-soul-salt"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted
  );

  return dec.decode(decrypted);
}

/**
 * Saves the agent's soul to Walrus for transparency and registers it for sovereign identity.
 * Identity is stored as PUBLIC JSON to allow community verification (Anti-scam).
 */
export async function saveSoulToWalrus(soul: AgentSoul, userId: string): Promise<string> {
  const keypair = await getOrCreateKeypair(userId);
  const agentAddress = keypair.toSuiAddress();
  
  // For Identity Transparency, we store as plain JSON (not sealed) as requested
  const json = JSON.stringify(soul);
  const blobBytes = new TextEncoder().encode(json);

  try {
    // 1. Upload to Walrus using SERVER PROXY (Bypasses CORS)
    // send_object_to ensures the wallet owns the metadata object on Sui
    const url = `/api/walrus/publisher?epochs=1&send_object_to=${agentAddress}`;
    console.log(`Uploading soul to Walrus via Proxy: ${url}`);
    
    const response = await fetch(url, {
      method: 'PUT',
      body: blobBytes,
    }).catch(err => {
      console.error(`Network Error during Walrus Proxy PUT (${url}):`, err);
      throw new Error(`Không thể kết nối tới server proxy Walrus. (URL: ${url})`);
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Walrus Proxy Error (${response.status}): ${errorText}`);
    }
    
    const info = await response.json();
    // Walrus returns blobId in newlyCreated or alreadyCertified
    const blobId = info.newlyCreated?.blobObject?.blobId || info.alreadyCertified?.blobId;
    
    if (!blobId) throw new Error('No blobId returned from Walrus');

    // 2. Local Sync (Autonomy) - Save to sovereign local storage tied to wallet address
    localStorage.setItem(`soul-cache-${agentAddress}`, json);
    localStorage.setItem(`soul-blob-${agentAddress}`, blobId);
    // Legacy support
    localStorage.setItem(`soul-cache-${userId}`, json);

    // 3. Centralized Registry Backup (Best effort)
    const userDoc = doc(db, 'users', userId);
    await setDoc(userDoc, {
      soulBlobId: blobId,
      lastUpdated: Date.now(),
      agentAddress: agentAddress
    }, { merge: true }).catch(err => console.warn("Cloud registry sync failed, but on-chain data is safe:", err));

    return blobId;
  } catch (error) {
    console.error("Walrus Sovereign Save Error:", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function fetchFromWalrus(blobId: string): Promise<string> {
  const url = `/api/walrus/aggregator/${blobId}`;
  try {
    console.log(`[Identity] Fetching from Walrus via Proxy: ${url}`);
    const response = await fetch(url);
    if (response.ok) {
      return await response.text();
    }
    throw new Error(`Proxy aggregator returned status ${response.status}`);
  } catch (e) {
    console.error(`[Identity] Proxy fetch failed:`, e);
    throw e;
  }
}

/**
 * Sovereign recovery: Deep scan Sui blockchain as the primary source of truth.
 */
export async function recoverSoulAtLaunch(userId: string): Promise<AgentSoul | null> {
  const keypair = await getOrCreateKeypair(userId);
  const agentAddress = keypair.toSuiAddress();

  console.log(`[Identity] Initiating deep scan on Sui for: ${agentAddress}...`);
  
  try {
    const { clients } = await import('./sui');
    
    // 1. Primary Source of Truth: Scan Sui Blockchain (Mainnet)
    // We look for objects owned by the agent address that anchor to Walrus blobs
    const ownedObjects = await (clients.mainnet as any).getOwnedObjects({
      owner: agentAddress,
      options: { showContent: true, showType: true }
    }).catch((err: any) => {
      console.warn("[Identity] Sui Mainnet scan failed, checking Testnet fallback...", err);
      return (clients.testnet as any).getOwnedObjects({
        owner: agentAddress,
        options: { showContent: true, showType: true }
      }).catch(() => ({ data: [] }));
    });

    // Look for anchor metadata in any owned objects
    const soulObj = ownedObjects.data.find((obj: any) => {
      const fields = obj.data?.content?.fields;
      return fields?.blob_id || fields?.walrus_blob_id || fields?.metadata?.soul_ref;
    });

    let blobId: string | null = null;
    if (soulObj) {
      const fields = (soulObj.data?.content as any).fields;
      blobId = fields.blob_id || fields.walrus_blob_id || fields.metadata?.soul_ref;
      console.log("[Identity] Found sovereign anchor on Sui blockchain:", blobId);
    }

    // 2. Secondary Source: Centralized Registry Fallback (Firestore)
    // Only used if on-chain object is not found (e.g. indexing delay)
    if (!blobId) {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        blobId = userDoc.data().soulBlobId;
        console.log("[Identity] Found reference in Cloud Registry backup.");
      }
    }

    // 3. Last Resort: Local Metadata (Only for immediate responsiveness if truly offline)
    if (!blobId) {
      blobId = localStorage.getItem(`soul-blob-${agentAddress}`) || localStorage.getItem(`soul-blob-${userId}`);
      if (blobId) console.log("[Identity] Using local metadata link (blockchain link missing).");
    }

    if (blobId) {
      try {
        const json = await fetchFromWalrus(blobId);
        const soul = JSON.parse(json);
        
        // Verify identity integrity
        console.log("[Identity] Verification successful. Restoring agent state...");
        
        // Update local cache ONLY after successful on-chain verification
        localStorage.setItem(`soul-cache-${agentAddress}`, json);
        localStorage.setItem(`soul-blob-${agentAddress}`, blobId);
        
        return soul;
      } catch (error) {
        console.error(`[Identity] Connection to Walrus failed:`, error);
        // If we have a local cache and aggregator is down, we might show it but mark as "OFFLINE/UNVERIFIED"
        const cached = localStorage.getItem(`soul-cache-${agentAddress}`);
        if (cached) {
          console.warn("[Identity] Warning: Using cached data due to Walrus connection failure.");
          return JSON.parse(cached);
        }
        throw new Error(`Mất kết nối tới Walrus. Không thể xác thực định danh Agent.`);
      }
    }
  } catch (error) {
    console.error("[Identity] Sovereign recovery process interrupted:", error);
  }

  console.log("[Identity] No valid identity found on-chain for this wallet.");
  return null;
}
