export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  /** Optional uploaded filename or image URL preserved from a note. */
  image?: string | null;
}

export interface ChecklistData {
  checklist: ChecklistItem[];
}
