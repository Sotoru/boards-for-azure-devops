// Message contract between the extension and the Kanban webview.

export interface CardData {
  id: number;
  title: string;
  type: string;
  color: string;
  column: string;
  /** '' = default lane. */
  lane: string;
  assignee?: string;
  /** Assigned to the signed-in user. */
  mine: boolean;
  initials: string;
  tags: string[];
  active: boolean;
}
/** `done`: an outgoing column (completed items). */
export interface ColumnData { name: string; limit: number; accepts: string[]; done: boolean }

/** Kanban view settings, saved by the extension. `collapsed` holds lane names ('' = default lane). */
export interface BoardView { who: 'all' | 'mine' | 'unassigned'; hideDone: boolean; collapsed: string[]; query: string }

export interface BoardData {
  title: string;
  summary: string;
  boards: { id: string; name: string }[];
  board: string;
  columns: ColumnData[];
  /** Swimlane names in order, '' = default lane; a single entry means no lanes to draw. */
  lanes: string[];
  currentSprint: boolean;
  view: Partial<BoardView>;
  cards: CardData[];
  labels: Record<'filter' | 'refresh' | 'empty' | 'moveHint' | 'unassigned' | 'board' | 'defaultLane' | 'mine' | 'sprint' | 'hideDone' | 'presets' | 'showMore' | 'search', string>;
}

export type ToWebview =
  | { type: 'data'; data: BoardData }
  | { type: 'revert' }
  | { type: 'busy'; on: boolean }
  | { type: 'message'; text: string };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'open'; id: number }
  | { type: 'move'; id: number; column: string; lane: string }
  | { type: 'selectBoard'; id: string }
  | { type: 'filter' }
  | { type: 'toggleSprint' }
  | { type: 'saveView'; view: BoardView }
  | { type: 'refresh' };
