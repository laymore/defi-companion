
/**
 * MemWal Integration Service
 * MemWal provides a decentralized long-term memory layer for AI agents.
 */

const MEMWAL_API_URL = 'https://api.memwal.ai/v1';

export interface MemWalMemory {
  id?: string;
  userId: string;
  text: string;
  metadata?: any;
  createdAt?: number;
}

export async function addMemWalMemory(text: string, userId: string): Promise<boolean> {
  const apiKey = process.env.MEMWAL_API_KEY || (import.meta as any).env?.VITE_MEMWAL_API_KEY;
  if (!apiKey) {
    console.warn("Missing MEMWAL_API_KEY. Using local echo for demo.");
    return true; 
  }

  try {
    const response = await fetch(`${MEMWAL_API_URL}/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        user_id: userId,
        text,
        metadata: { source: 'SuiRobo' }
      })
    });
    return response.ok;
  } catch (error) {
    console.error("MemWal Error:", error);
    return false;
  }
}

export async function getMemWalHistory(userId: string): Promise<any[]> {
  const apiKey = process.env.MEMWAL_API_KEY || (import.meta as any).env?.VITE_MEMWAL_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch(`${MEMWAL_API_URL}/memories?user_id=${userId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    const data = await response.json();
    return data.memories || [];
  } catch (error) {
    console.error("MemWal Fetch Error:", error);
    return [];
  }
}
