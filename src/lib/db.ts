import Dexie, { Table } from 'dexie';

export interface LocalMessage {
  id?: number;
  userId: string;
  text: string;
  sender: 'ai' | 'user';
  createdAt: number;
  synced: boolean; // Để theo dõi trạng thái đồng bộ lên Cloud
}

export class SuiRoboDB extends Dexie {
  messages!: Table<LocalMessage>;

  constructor() {
    super('SuiRoboDB');
    this.version(1).stores({
      messages: '++id, userId, createdAt, synced'
    });
  }
}

export const localDB = new SuiRoboDB();
