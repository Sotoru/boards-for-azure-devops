// Message contract between the extension and the Kanban webview.

export interface CardData {
  id: number;
  title: string;
  type: string;
  color: string;
  column: string;
  assignee?: string;
  initials: string;
  tags: string[];
  active: boolean;
}
export interface ColumnData { name: string; limit: number; accepts: string[] }

export interface BoardData {
  title: string;
  summary: string;
  boards: { id: string; name: string }[];
  board: string;
  columns: ColumnData[];
  cards: CardData[];
  labels: Record<'filter' | 'refresh' | 'empty' | 'moveHint' | 'unassigned' | 'board', string>;
}

export type ToWebview =
  | { type: 'data'; data: BoardData }
  | { type: 'revert' }
  | { type: 'busy'; on: boolean }
  | { type: 'message'; text: string };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'open'; id: number }
  | { type: 'move'; id: number; column: string }
  | { type: 'selectBoard'; id: string }
  | { type: 'filter' }
  | { type: 'refresh' };
