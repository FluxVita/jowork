export type MemoryScope = 'personal' | 'team' | 'project';

export interface Memory {
  id: string;
  scope: MemoryScope;
  content: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
