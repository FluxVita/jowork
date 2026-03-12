export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  role: Role;
  createdAt: Date;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
}
